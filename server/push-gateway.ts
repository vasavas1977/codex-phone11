import type { Request } from "express";
import { resolvePushSession } from "./push/session";
import { z } from "zod";
import { pushRepository } from "./push/repository";
import { sendApnsPush } from "./push/apns";
import { assignedPushOwners, requirePushOwner, type PushOwner } from "./pbx/push-access";

// ─── Types ──────────────────────────────────────────────────────────

export interface PushToken {
  sessionId: string;
  owner: PushOwner;
  token: string;
  tokenType: "voip" | "fcm" | "apns";
  sipUri: string;
  deviceId: string;
  platform: "ios" | "android";
  bundleId: string;
  appVersion?: string;
  sandbox?: boolean;
  registeredAt: number;
  lastUsed?: number;
}

export interface PushPayload {
  /** Call-scoped native wake envelope; never contains credentials or caller content. */
  wake?: { v: 1; callUUID: string; bindingId: string; expiresAt: number };
  /** SIP Call-ID for deduplication */
  callId: string;
  /** Caller number */
  callerNumber: string;
  /** Caller display name */
  callerName?: string;
  /** Whether this is a video call */
  hasVideo?: boolean;
  /** SIP domain */
  sipDomain?: string;
}

// ─── Validation Schemas ─────────────────────────────────────────────

export const registerTokenSchema = z.object({
  token: z.string().min(1).max(4096),
  tokenType: z.enum(["voip", "fcm", "apns"]),
  sipUri: z.string().min(1).max(512),
  deviceId: z.string().min(1).max(512),
  platform: z.enum(["ios", "android"]),
  bundleId: z.string().min(1).max(512),
  appVersion: z.string().max(128).optional(),
  sandbox: z.boolean().optional(),
});

export const unregisterTokenSchema = z.object({
  token: z.string().min(1).max(4096),
  deviceId: z.string().min(1).max(512),
  platform: z.enum(["ios", "android"]),
});

export const triggerPushSchema = z.object({
  sipUri: z.string().min(1).max(512),
  callId: z.string().min(1).max(512),
  callerNumber: z.string().min(1).max(512),
  callerName: z.string().max(512).optional(),
  hasVideo: z.boolean().optional(),
});

/** Ownership is resolved from the server assignment, then rechecked in the storage transaction. */
export async function registerPushToken(data: z.infer<typeof registerTokenSchema>, userId: number, headers?: Request["headers"]) {
  const owner = await requirePushOwner(userId, data.sipUri);
  const sessionId = await resolvePushSession(headers, userId);
  await pushRepository.put({ ...data, sessionId, sipUri: owner.sipUri, owner, registeredAt: Date.now() });
  return { success: true, message: "Device token stored; background call delivery requires an available push provider" };
}
export async function unregisterPushToken(data: z.infer<typeof unregisterTokenSchema>, userId: number, headers?: Request["headers"]) {
  const sessionId = await resolvePushSession(headers, userId);
  await pushRepository.remove(userId, data, sessionId);
  return { success: true, message: "Device token removed" };
}
export async function getTokensForUser(sipUri: string) {
  return pushRepository.list(sipUri);
}

class PushDeadlineError extends Error {
  constructor() { super("Push delivery deadline elapsed"); }
}
/** Bound every asynchronous stage. Late completion/rejection is observed but cannot resume the caller. */
function withinCallDeadline<T>(deadlineAt: number, operation: () => Promise<T>): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.reject(new PushDeadlineError());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PushDeadlineError()), remaining);
    Promise.resolve().then(() => {
      if (Date.now() >= deadlineAt) throw new PushDeadlineError();
      return operation();
    }).then(value => {
      clearTimeout(timer);
      if (Date.now() >= deadlineAt) reject(new PushDeadlineError()); else resolve(value);
    }, error => { clearTimeout(timer); reject(error); });
  });
}
const deliveryUnavailable = "Push delivery unavailable or rejected by provider";
function safeDeliveryError(error: unknown) { return error instanceof PushDeadlineError ? error.message : deliveryUnavailable; }

/** A single five-second deadline includes lookup, provider work and revision-scoped cleanup. */
export async function triggerPushForUser(
  data: z.infer<typeof triggerPushSchema>
): Promise<{ sent: number; errors: string[] }> {
  const deadlineAt = Date.now() + 5000;
  const bounded = <T>(operation: () => Promise<T>) => withinCallDeadline(deadlineAt, operation);
  let sent = 0;
  const errors: string[] = [];
  try {
    const owners = await bounded(() => assignedPushOwners(data.sipUri));
    if (new Set(owners.map(owner => owner.tenantId)).size > 1) return { sent: 0, errors: ["The target phone account is ambiguous"] };
    const canonicalUri = owners[0]?.sipUri ?? data.sipUri;
    const tokens = (await bounded(() => getTokensForUser(canonicalUri))).filter(token => owners.some(owner =>
      owner.userId === token.owner.userId && owner.tenantId === token.owner.tenantId && owner.extensionId === token.owner.extensionId));
    if (!tokens.length) return { sent: 0, errors: ["No assigned device is available for push delivery"] };
    const payload: PushPayload = { callId: data.callId, callerNumber: data.callerNumber, callerName: data.callerName, hasVideo: data.hasVideo };
    for (const token of tokens) {
      try {
        if (!await bounded(() => pushRepository.isCurrent(token))) { errors.push("No assigned device is available for push delivery"); continue; }
        if (token.platform === "ios") {
          await bounded(() => sendApnsPush(token, payload, () => bounded(() => pushRepository.isCurrent(token)), deadlineAt));
        } else {
          await bounded(() => sendFcmPush(token, payload, deadlineAt));
        }
        sent++; // Retain observed provider acceptance even if its persistence later times out.
        await bounded(() => pushRepository.markUsed(token));
      } catch (error: any) {
        errors.push(safeDeliveryError(error));
        if (isInvalidTokenError(error) && (error.invalidatedAt === undefined || token.registeredAt <= error.invalidatedAt)) {
          try { await bounded(() => pushRepository.removeInvalid(token)); }
          catch (cleanupError) { errors.push(safeDeliveryError(cleanupError)); }
        }
        if (Date.now() >= deadlineAt || error instanceof PushDeadlineError) break;
      }
    }
  } catch (error) { errors.push(safeDeliveryError(error)); }
  return { sent, errors };
}

// ─── FCM Push (Android) — FCM HTTP v1 API ──────────────────────────

/**
 * FCM OAuth2 access token cache.
 * The token is valid for ~1 hour; we refresh 5 minutes before expiry.
 */
let fcmAccessToken: string | null = null;
let fcmTokenExpiry = 0;

/**
 * Get a valid FCM OAuth2 access token using Google Application Default Credentials.
 *
 * Authentication methods (in priority order):
 *  1. GOOGLE_APPLICATION_CREDENTIALS env → path to service account JSON
 *  2. gcloud auth application-default login → user credentials
 *  3. GCE/Cloud Run metadata server → automatic on Google Cloud
 *
 * Install: npm install google-auth-library
 */
async function getFcmAccessToken(deadlineAt: number): Promise<string> {
  const now = Date.now();
  if (fcmAccessToken && now < fcmTokenExpiry - 5 * 60 * 1000) {
    return fcmAccessToken;
  }

  const { GoogleAuth } = await withinCallDeadline(deadlineAt, () => import("google-auth-library"));
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });

  const client = await withinCallDeadline(deadlineAt, () => auth.getClient());
  const tokenResponse = await withinCallDeadline(deadlineAt, () => client.getAccessToken());

  if (!tokenResponse.token) {
    throw new Error("Failed to obtain FCM access token via ADC");
  }

  fcmAccessToken = tokenResponse.token;
  // Default expiry: 1 hour
  fcmTokenExpiry = now + 55 * 60 * 1000;

  return fcmAccessToken;
}

/**
 * Send a high-priority FCM data message for incoming call.
 *
 * Uses the modern FCM HTTP v1 API (not the deprecated legacy API).
 * Authentication via Application Default Credentials (ADC).
 *
 * Setup options:
 *  1. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *  2. Run: gcloud auth application-default login
 *  3. Deploy on Google Cloud (automatic)
 *
 * Uses data-only message (no notification field) so the app
 * handles display via Notifee full-screen notification.
 */
async function sendFcmPush(token: PushToken, payload: PushPayload, deadlineAt: number): Promise<void> {
  const projectId = process.env.FCM_PROJECT_ID;
  if (!projectId) throw new Error("FCM push delivery is not configured");

  // Check if ADC is available
  let accessToken: string;
  try {
    accessToken = await withinCallDeadline(deadlineAt, () => getFcmAccessToken(deadlineAt));
  } catch (adcError: any) {
    if (adcError instanceof PushDeadlineError) throw adcError;
    throw new Error("FCM push credentials are unavailable");
  }

  if (Date.now() >= deadlineAt) throw new Error("Push delivery deadline elapsed");

  // FCM HTTP v1 API payload
  const fcmPayload = {
    message: {
      token: token.token,
      // Data-only message — app handles display via Notifee
      data: {
        type: "voip_call",
        callId: payload.callId,
        callerNumber: payload.callerNumber,
        callerName: payload.callerName || payload.callerNumber,
        hasVideo: String(payload.hasVideo || false),
        timestamp: String(Date.now()),
      },
      android: {
        priority: "HIGH" as const,
        // TTL: 0s means don't store if device offline (call is time-sensitive)
        ttl: "0s",
        // Direct boot aware — deliver even before first unlock
        direct_boot_ok: true,
      },
    },
  };

  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(fcmPayload),
        signal: AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");

      // Handle token refresh on 401
      if (response.status === 401) {
        fcmAccessToken = null;
        fcmTokenExpiry = 0;
      }

      // Handle invalid token errors
      if (errorBody.includes("UNREGISTERED")) {
        throw Object.assign(
          new Error("FCM token invalid"),
          { invalidToken: true }
        );
      }

      throw new Error("FCM provider rejected delivery");
    }

    // Success headers are provider acceptance; discard the body without delaying the call.
    void response.body?.cancel().catch(() => {});
  } catch (error: any) {
    if (error.invalidToken) throw error;
    throw new Error("FCM push delivery unavailable");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function isInvalidTokenError(error: any): boolean { return error?.invalidToken === true; }

/** Admin-only aggregate. No token/device identifiers are returned. */
export async function getPushStats() { return pushRepository.stats(); }
