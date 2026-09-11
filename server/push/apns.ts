import * as http2 from "node:http2";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PushPayload, PushToken } from "../push-gateway";

export class PushProviderError extends Error {
  constructor(public readonly kind: "configuration" | "authentication" | "invalid-token" | "throttled" | "unavailable" | "rejected" | "timeout" | "transport", public readonly status?: number, public readonly reason?: string, public readonly retryAfterMs?: number, public readonly invalidatedAt?: number) {
    // Never include a provider body, URL, device token, key path or credential.
    super(`Push provider ${kind}`); this.name = "PushProviderError";
  }
  get invalidToken() { return this.kind === "invalid-token"; }
}
export interface ApnsConfig { keyPath: string; keyId: string; teamId: string; bundleId: string; environment: "production" | "sandbox"; }
export function readApnsConfig(): ApnsConfig {
  const { APNS_KEY_PATH: keyPath, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_BUNDLE_ID: bundleId, APNS_ENVIRONMENT: environment } = process.env;
  if (!keyPath?.trim() || !keyId?.match(/^[A-Za-z0-9]{10}$/) || !teamId?.match(/^[A-Za-z0-9]{10}$/) || !bundleId?.match(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/) || !["production", "sandbox"].includes(environment ?? "")) throw new PushProviderError("configuration");
  return { keyPath, keyId, teamId, bundleId, environment: environment as ApnsConfig["environment"] };
}
const knownReasons = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered", "InvalidProviderToken", "ExpiredProviderToken", "MissingProviderToken", "Forbidden", "TooManyRequests", "TooManyProviderTokenUpdates", "InternalServerError", "ServiceUnavailable", "Shutdown", "PayloadTooLarge", "BadTopic", "TopicDisallowed", "BadPayload"]);
function rejection(status: number, body: string, retryAfter: string | string[] | undefined, now: number) {
  let reason: string | undefined, invalidatedAt: number | undefined;
  try { const response = JSON.parse(body); if (knownReasons.has(response.reason)) reason = response.reason;
    if (status === 410 && Number.isSafeInteger(response.timestamp) && response.timestamp > 0) invalidatedAt = response.timestamp; } catch { /* untrusted provider content is discarded */ }
  let retryAfterMs: number | undefined;
  if (typeof retryAfter === "string") {
    const value = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(value) && value >= 0) retryAfterMs = value;
  }
  if (["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(reason ?? "") && [400, 410].includes(status)) return new PushProviderError("invalid-token", status, reason, undefined, invalidatedAt);
  if (status === 403) return new PushProviderError("authentication", status, reason);
  if (status === 429) return new PushProviderError("throttled", status, reason, retryAfterMs);
  if (status >= 500) return new PushProviderError("unavailable", status, reason, Math.max(retryAfterMs ?? 0, 15 * 60_000));
  return new PushProviderError("rejected", status, reason);
}
interface Dependencies {
  connect?: typeof http2.connect;
  loadConfig?: () => ApnsConfig;
  readKey?: (path: string) => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}
/** Explicit TLS HTTP/2; a receipt means APNs accepted the request, not handset delivery. */
type ApnsDevice = Pick<PushToken, "platform" | "tokenType" | "token" | "bundleId" | "sandbox">;
export interface ChatAlertPayload { eventId: string; expiresAt: number; }
function createApnsTransport(deps: Dependencies = {}, purpose: "voip" | "alert") {
  const connect = deps.connect ?? http2.connect, now = deps.now ?? Date.now;
  const loadConfig = deps.loadConfig ?? readApnsConfig, readKey = deps.readKey ?? (path => readFile(path, "utf8"));
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const budgetMs = Math.max(10, Math.min(deps.timeoutMs ?? 5000, 5000));
  let cached: { identity: string; jwt: string; issuedAt: number } | undefined;
  let pendingJwt: { identity: string; promise: Promise<string> } | undefined;
  async function jwt(config: ApnsConfig) {
    const identity = JSON.stringify([config.keyPath, config.keyId, config.teamId]);
    const at = now();
    if (cached?.identity === identity && at >= cached.issuedAt && at - cached.issuedAt < 50 * 60_000) return cached.jwt;
    if (pendingJwt?.identity === identity) return pendingJwt.promise;
    const promise = (async () => { try {
      const key = createPrivateKey(await readKey(config.keyPath));
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
      const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.keyId })).toString("base64url");
      const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: Math.floor(at / 1000) })).toString("base64url");
      const input = `${header}.${claims}`;
      const value = `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
      cached = { identity, jwt: value, issuedAt: at }; return value;
    } catch { throw new PushProviderError("configuration"); } })();
    pendingJwt = { identity, promise };
    try { return await promise; } finally { if (pendingJwt?.promise === promise) pendingJwt = undefined; }
  }
  async function request(config: ApnsConfig, token: ApnsDevice, body: string, authorization: string, id: string, timeoutMs: number, expiration: string) {
    return new Promise<void>((resolve, reject) => {
      let session: http2.ClientHttp2Session | undefined, stream: http2.ClientHttp2Stream | undefined, settled = false;
      let headers: http2.IncomingHttpHeaders = {}, responseBody = "", bytes = 0;
      const finish = (error?: PushProviderError) => {
        if (settled) return; settled = true; clearTimeout(timer);
        stream?.close(); session?.destroy();
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new PushProviderError("timeout")), timeoutMs);
      try {
        const host = config.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
        session = connect(`https://${host}`, { minVersion: "TLSv1.2", settings: { enablePush: false } });
        session.on("error", () => finish(new PushProviderError("transport")));
        session.on("goaway", () => finish(new PushProviderError("transport")));
        session.on("close", () => { if (!settled) finish(new PushProviderError("transport")); });
        stream = session.request({ ":method": "POST", ":path": `/3/device/${token.token}`, authorization: `bearer ${authorization}`,
          "apns-topic": purpose === "voip" ? `${config.bundleId}.voip` : config.bundleId, "apns-push-type": purpose, "apns-priority": "10", "apns-expiration": expiration, "apns-id": id, "content-type": "application/json" });
        stream.on("response", value => { headers = value; });
        stream.on("data", chunk => {
          bytes += Buffer.byteLength(chunk); if (bytes > 8192) { finish(new PushProviderError("rejected")); return; }
          responseBody += chunk.toString("utf8");
        });
        stream.on("error", () => finish(new PushProviderError("transport")));
        stream.on("aborted", () => finish(new PushProviderError("transport")));
        stream.on("close", () => { if (!settled) finish(new PushProviderError("transport")); });
        stream.on("end", () => {
          const status = Number(headers[":status"]);
          if (status === 200) finish();
          else if (Number.isInteger(status) && status >= 400) finish(rejection(status, responseBody, headers["retry-after"], now()));
          else finish(new PushProviderError("transport"));
        });
        stream.end(body);
      } catch { finish(new PushProviderError("transport")); }
    });
  }
  return async (token: ApnsDevice, payload: PushPayload | ChatAlertPayload, beforeAttempt?: () => Promise<boolean>, deadlineAt?: number): Promise<void> => {
    // One live-call budget includes key I/O, ownership checks, retry waits and HTTP/2.
    // A gateway can supply an earlier deadline shared by all of this call's devices.
    const deadline = Math.min(now() + budgetMs, Number.isFinite(deadlineAt) ? deadlineAt! : Infinity);
    const withinBudget = <T>(operation: () => Promise<T>): Promise<T> => {
      const remaining = deadline - now();
      if (remaining <= 0) return Promise.reject(new PushProviderError("timeout"));
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new PushProviderError("timeout")), remaining);
        Promise.resolve().then(operation).then(value => {
          clearTimeout(timer);
          if (now() >= deadline) reject(new PushProviderError("timeout")); else resolve(value);
        }, error => { clearTimeout(timer); reject(error); });
      });
    };
    if (now() >= deadline) throw new PushProviderError("timeout");
    const config = loadConfig();
    if (token.platform !== "ios" || token.tokenType !== (purpose === "voip" ? "voip" : "apns") || token.bundleId !== config.bundleId || !!token.sandbox !== (config.environment === "sandbox")) throw new PushProviderError("configuration");
    if (!/^[0-9a-fA-F]{32,512}$/.test(token.token)) throw new PushProviderError("invalid-token");
    const call = payload as PushPayload;
    const alert = payload as ChatAlertPayload;
    if (purpose === "alert" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(alert.eventId ?? "")) throw new PushProviderError("rejected");
    if (purpose === "alert" && (!Number.isFinite(alert.expiresAt) || alert.expiresAt <= now() || alert.expiresAt > now() + 600_000)) throw new PushProviderError("rejected");
    const expiration = purpose === "alert" ? String(Math.floor(alert.expiresAt / 1000)) : "0";
    const body = JSON.stringify(purpose === "alert" ? {
      aps: { alert: { title: "Phone11", body: "New message" }, sound: "default" }, type: "phone11_chat", eventId: alert.eventId,
    } : call.wake ? { aps: { "content-available": 1 }, ...call.wake }
      : { aps: { "content-available": 1 }, callId: call.callId, callerNumber: call.callerNumber,
        callerName: call.callerName || call.callerNumber, hasVideo: !!call.hasVideo, type: "voip_call", timestamp: now() });
    if (Buffer.byteLength(body) > (purpose === "alert" ? 4096 : 5120)) throw new PushProviderError("rejected", 413, "PayloadTooLarge");
    const authorization = await withinBudget(() => jwt(config)), id = randomUUID();
    for (let attempt = 0; ; attempt++) {
      try {
        if (beforeAttempt && !await withinBudget(beforeAttempt)) throw new PushProviderError("rejected");
        if (now() >= deadline) throw new PushProviderError("timeout");
        await request(config, token, body, authorization, id, Math.max(1, deadline - now()), expiration); return;
      }
      catch (error) {
        // Retry only an explicit per-device throttle, once, within this live call's budget.
        // Apple specifies 15 minutes for 5xx: such a retry would ring a stale call, so fail.
        // Timeouts/transport failures have uncertain acceptance and are never replayed.
        if (purpose === "alert" || !(error instanceof PushProviderError) || error.kind !== "throttled" || error.reason !== "TooManyRequests" || attempt > 0) throw error;
        const delay = Math.max(250, error.retryAfterMs ?? 1000);
        if (now() + delay + 250 >= deadline) throw error;
        await withinBudget(() => sleep(delay));
        if (now() >= deadline) throw error;
      }
    }
  };
}
export function createApnsSender(deps: Dependencies = {}) { return createApnsTransport(deps, "voip") as (token: PushToken, payload: PushPayload, beforeAttempt?: () => Promise<boolean>, deadlineAt?: number) => Promise<void>; }
export function createApnsAlertSender(deps: Dependencies = {}) { return createApnsTransport(deps, "alert") as (token: ApnsDevice, payload: ChatAlertPayload, beforeAttempt?: () => Promise<boolean>, deadlineAt?: number) => Promise<void>; }
export const sendApnsPush = createApnsSender();
export const sendApnsAlert = createApnsAlertSender();
