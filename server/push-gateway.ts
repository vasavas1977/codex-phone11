/**
 * Push Gateway — Phone11 Server
 *
 * Manages VoIP push token registration and push notification delivery.
 *
 * Token storage:
 *  - In-memory Map for development (no persistence across restarts)
 *  - TODO: Migrate to database table for production
 *
 * Push delivery:
 *  - iOS: APNs VoIP push via PushKit token
 *  - Android: FCM high-priority data message
 *
 * Integration with SIP proxy:
 *  - Kamailio/FreeSWITCH calls triggerPushForUser() when INVITE arrives
 *  - This sends the VoIP push to wake the device
 *  - Device wakes → registers SIP → receives INVITE via WebSocket
 */

import { z } from "zod";

// ─── Types ──────────────────────────────────────────────────────────

export interface PushToken {
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
  token: z.string().min(1),
  tokenType: z.enum(["voip", "fcm", "apns"]),
  sipUri: z.string().min(1),
  deviceId: z.string().min(1),
  platform: z.enum(["ios", "android"]),
  bundleId: z.string().min(1),
  appVersion: z.string().optional(),
  sandbox: z.boolean().optional(),
});

export const unregisterTokenSchema = z.object({
  token: z.string().min(1),
  deviceId: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

export const triggerPushSchema = z.object({
  sipUri: z.string().min(1),
  callId: z.string().min(1),
  callerNumber: z.string().min(1),
  callerName: z.string().optional(),
  hasVideo: z.boolean().optional(),
});

// ─── In-Memory Token Store ──────────────────────────────────────────
// Key: sipUri → Map of deviceId → PushToken
// TODO: Replace with database table for production persistence

const tokenStore = new Map<string, Map<string, PushToken>>();

/**
 * Register a push token for a device.
 */
export function registerPushToken(data: z.infer<typeof registerTokenSchema>): {
  success: boolean;
  message: string;
} {
  const { sipUri, deviceId } = data;

  if (!tokenStore.has(sipUri)) {
    tokenStore.set(sipUri, new Map());
  }

  const deviceTokens = tokenStore.get(sipUri)!;
  deviceTokens.set(deviceId, {
    ...data,
    registeredAt: Date.now(),
  });

  console.log(
    `[PushGateway] Token registered: ${data.tokenType} for ${sipUri} (device: ${deviceId})`
  );

  return {
    success: true,
    message: `Token registered for ${sipUri}`,
  };
}

/**
 * Unregister a push token for a device.
 */
export function unregisterPushToken(data: z.infer<typeof unregisterTokenSchema>): {
  success: boolean;
  message: string;
} {
  const { token, deviceId } = data;

  // Find and remove the token across all SIP URIs
  for (const [sipUri, devices] of tokenStore.entries()) {
    const existing = devices.get(deviceId);
    if (existing && existing.token === token) {
      devices.delete(deviceId);
      if (devices.size === 0) {
        tokenStore.delete(sipUri);
      }
      console.log(`[PushGateway] Token unregistered: ${deviceId} from ${sipUri}`);
      return { success: true, message: "Token unregistered" };
    }
  }

  return { success: true, message: "Token not found (already removed)" };
}

/**
 * Get all registered tokens for a SIP URI.
 */
export function getTokensForUser(sipUri: string): PushToken[] {
  const devices = tokenStore.get(sipUri);
  if (!devices) return [];
  return Array.from(devices.values());
}

/**
 * Trigger a VoIP push notification for an incoming call.
 *
 * Called by the SIP proxy integration when an INVITE arrives
 * for a user who may not have an active WebSocket connection.
 *
 * @returns Number of push notifications sent
 */
export async function triggerPushForUser(
  data: z.infer<typeof triggerPushSchema>
): Promise<{ sent: number; errors: string[] }> {
  const { sipUri, callId, callerNumber, callerName, hasVideo } = data;

  const tokens = getTokensForUser(sipUri);
  if (tokens.length === 0) {
    console.log(`[PushGateway] No tokens registered for ${sipUri}`);
    return { sent: 0, errors: [`No tokens for ${sipUri}`] };
  }

  const payload: PushPayload = {
    callId,
    callerNumber,
    callerName,
    hasVideo,
  };

  let sent = 0;
  const errors: string[] = [];

  for (const token of tokens) {
    try {
      if (token.platform === "ios") {
        await sendApnsPush(token, payload);
      } else {
        await sendFcmPush(token, payload);
      }
      token.lastUsed = Date.now();
      sent++;
    } catch (error: any) {
      const msg = `Failed to push to ${token.deviceId}: ${error.message}`;
      console.error(`[PushGateway] ${msg}`);
      errors.push(msg);

      // If token is invalid, remove it
      if (isInvalidTokenError(error)) {
        const devices = tokenStore.get(sipUri);
        if (devices) {
          devices.delete(token.deviceId);
          console.log(`[PushGateway] Removed invalid token: ${token.deviceId}`);
        }
      }
    }
  }

  console.log(
    `[PushGateway] Push sent for ${sipUri}: ${sent}/${tokens.length} successful`
  );

  return { sent, errors };
}

// ─── APNs Push (iOS VoIP) ───────────────────────────────────────────

/**
 * Send a VoIP push notification via Apple Push Notification service.
 *
 * Requirements:
 *  - APNs VoIP certificate (.p12) or Auth Key (.p8)
 *  - Set APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH environment variables
 *
 * The push payload is minimal — just enough to wake the app and
 * display CallKit UI. Full call details come via SIP INVITE.
 */
async function sendApnsPush(token: PushToken, payload: PushPayload): Promise<void> {
  const apnsKeyPath = process.env.APNS_KEY_PATH;
  const apnsKeyId = process.env.APNS_KEY_ID;
  const apnsTeamId = process.env.APNS_TEAM_ID;

  if (!apnsKeyPath || !apnsKeyId || !apnsTeamId) {
    console.warn(
      "[PushGateway] APNs not configured. Set APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID."
    );
    // In development, log the push instead of sending
    console.log("[PushGateway] [DEV] Would send APNs VoIP push:", {
      token: token.token.substring(0, 16) + "...",
      payload,
    });
    return;
  }

  // APNs HTTP/2 push
  // Production: api.push.apple.com
  // Sandbox: api.sandbox.push.apple.com
  const host = token.sandbox
    ? "api.sandbox.push.apple.com"
    : "api.push.apple.com";

  const apnsPayload = {
    aps: {
      // VoIP pushes don't use alert/badge — the app handles display via CallKit
      "content-available": 1,
    },
    // Custom data for the app
    callId: payload.callId,
    callerNumber: payload.callerNumber,
    callerName: payload.callerName || payload.callerNumber,
    hasVideo: payload.hasVideo || false,
    type: "voip_call",
    timestamp: Date.now(),
  };

  try {
    // Use node-apn or HTTP/2 client in production
    // For now, use fetch with HTTP/2 (Node 18+)
    const jwt = await generateApnsJwt(apnsKeyPath, apnsKeyId, apnsTeamId);

    const response = await fetch(
      `https://${host}/3/device/${token.token}`,
      {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": `${token.bundleId}.voip`, // VoIP topic = bundleId + ".voip"
          "apns-push-type": "voip",
          "apns-priority": "10", // Immediate delivery
          "apns-expiration": "0", // Don't store if device offline
        },
        body: JSON.stringify(apnsPayload),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`APNs error ${response.status}: ${errorBody}`);
    }

    console.log(`[PushGateway] APNs VoIP push sent to ${token.deviceId}`);
  } catch (error: any) {
    throw new Error(`APNs push failed: ${error.message}`);
  }
}

/**
 * Generate a JWT for APNs authentication.
 * Uses the .p8 auth key file.
 */
async function generateApnsJwt(
  keyPath: string,
  keyId: string,
  teamId: string
): Promise<string> {
  const fs = await import("fs");
  const crypto = await import("crypto");

  const key = fs.readFileSync(keyPath, "utf8");

  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: keyId })
  ).toString("base64url");

  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(
    JSON.stringify({ iss: teamId, iat: now })
  ).toString("base64url");

  const signingInput = `${header}.${claims}`;
  const sign = crypto.createSign("SHA256");
  sign.update(signingInput);
  const signature = sign
    .sign(key, "base64")
    // Convert standard base64 to base64url
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${header}.${claims}.${signature}`;
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
async function getFcmAccessToken(): Promise<string> {
  const now = Date.now();
  if (fcmAccessToken && now < fcmTokenExpiry - 5 * 60 * 1000) {
    return fcmAccessToken;
  }

  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) {
    throw new Error("Failed to obtain FCM access token via ADC");
  }

  fcmAccessToken = tokenResponse.token;
  // Default expiry: 1 hour
  fcmTokenExpiry = now + 55 * 60 * 1000;

  console.log("[PushGateway] FCM OAuth2 access token refreshed");
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
async function sendFcmPush(token: PushToken, payload: PushPayload): Promise<void> {
  const projectId = process.env.FCM_PROJECT_ID || "phone11-push";

  // Check if ADC is available
  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken();
  } catch (adcError: any) {
    console.warn(
      `[PushGateway] FCM ADC not available: ${adcError.message}. ` +
      `Set GOOGLE_APPLICATION_CREDENTIALS or run 'gcloud auth application-default login'.`
    );
    // In development, log the push instead of sending
    console.log("[PushGateway] [DEV] Would send FCM push:", {
      token: token.token.substring(0, 16) + "...",
      payload,
    });
    return;
  }

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
      if (response.status === 404 || errorBody.includes("UNREGISTERED")) {
        throw Object.assign(
          new Error(`FCM token invalid: ${errorBody}`),
          { invalidToken: true }
        );
      }

      throw new Error(`FCM v1 error ${response.status}: ${errorBody}`);
    }

    const result = await response.json();
    console.log(`[PushGateway] FCM v1 push sent to ${token.deviceId}: ${result.name}`);
  } catch (error: any) {
    if (error.invalidToken) throw error;
    throw new Error(`FCM push failed: ${error.message}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function isInvalidTokenError(error: any): boolean {
  return (
    error?.invalidToken === true ||
    error?.message?.includes("NotRegistered") ||
    error?.message?.includes("InvalidRegistration") ||
    error?.message?.includes("BadDeviceToken") ||
    error?.message?.includes("Unregistered")
  );
}

/**
 * Get stats about registered tokens (for admin dashboard).
 */
export function getPushStats(): {
  totalUsers: number;
  totalDevices: number;
  byPlatform: { ios: number; android: number };
} {
  let totalDevices = 0;
  const byPlatform = { ios: 0, android: 0 };

  for (const devices of tokenStore.values()) {
    for (const token of devices.values()) {
      totalDevices++;
      byPlatform[token.platform]++;
    }
  }

  return {
    totalUsers: tokenStore.size,
    totalDevices,
    byPlatform,
  };
}
