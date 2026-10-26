import { PushProviderError } from "./apns";
import type { PushToken } from "../push-gateway";

export type FcmDevice = Pick<PushToken, "platform" | "tokenType" | "token" | "bundleId" | "sandbox">;
export interface FcmMessage {
  data: Record<string, string>;
  notification?: { title: string; body: string };
  android: {
    priority: "HIGH" | "NORMAL";
    ttl: string;
    restricted_package_name?: string;
    notification?: { channel_id: string; sound?: string; tag?: string };
  };
}
export interface FcmConfig { projectId: string; packageName: string; }
export function readFcmConfig(): FcmConfig {
  const { FCM_PROJECT_ID: projectId, FCM_ANDROID_PACKAGE: packageName } = process.env;
  if (!projectId?.match(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/) ||
      !packageName?.match(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/)) throw new PushProviderError("configuration");
  return { projectId, packageName };
}
interface Dependencies {
  loadConfig?: () => FcmConfig;
  accessToken?: (deadlineAt: number) => Promise<string>;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}
/** ADC owns credential refresh; no credentials or provider bodies are logged. */
async function applicationAccessToken(): Promise<string> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
  const client = await auth.getClient();
  const response = await client.getAccessToken();
  if (!response.token) throw new PushProviderError("authentication");
  return response.token;
}
function rejection(status: number, body: string): PushProviderError {
  let code: string | undefined;
  try {
    const details = JSON.parse(body)?.error?.details;
    if (Array.isArray(details)) code = details.find(value => value?.["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError")?.errorCode;
  } catch { /* Untrusted provider text is discarded. */ }
  // INVALID_ARGUMENT can describe a bad payload/package, so never delete a token
  // for it. Only the typed, status-matched UNREGISTERED response revokes a revision.
  if (status === 404 && code === "UNREGISTERED") return new PushProviderError("invalid-token", status);
  if (status === 401 || status === 403) return new PushProviderError("authentication", status);
  if (status === 429) return new PushProviderError("throttled", status);
  if (status >= 500) return new PushProviderError("unavailable", status);
  return new PushProviderError("rejected", status);
}
/** HTTP v1 acceptance is a provider receipt, never handset/ringing evidence. */
export function createFcmSender(deps: Dependencies = {}) {
  const now = deps.now ?? (() => Date.now()), request = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args)), loadConfig = deps.loadConfig ?? readFcmConfig;
  const accessToken = deps.accessToken ?? applicationAccessToken;
  const budget = Math.max(10, Math.min(deps.timeoutMs ?? 5000, 5000));
  return async (device: FcmDevice, message: FcmMessage, beforeAttempt?: () => Promise<boolean>, deadlineAt?: number, expiresAt?: number): Promise<void> => {
    const deadline = Math.min(now() + budget, Number.isFinite(deadlineAt) ? deadlineAt! : Infinity);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - now()));
    const within = <T>(operation: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
      const abort = () => { cleanup(); reject(new PushProviderError("timeout")); };
      const cleanup = () => controller.signal.removeEventListener("abort", abort);
      controller.signal.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted || now() >= deadline) { abort(); return; }
      Promise.resolve().then(() => {
        if (controller.signal.aborted || now() >= deadline) throw new PushProviderError("timeout");
        return operation();
      }).then(value => {
        cleanup();
        if (controller.signal.aborted || now() >= deadline) reject(new PushProviderError("timeout")); else resolve(value);
      }, error => { cleanup(); reject(error); });
    });
    try {
      const config = loadConfig();
      if (device.platform !== "android" || device.tokenType !== "fcm" || device.sandbox || device.bundleId !== config.packageName ||
          !device.token || device.token.length > 4096 || /[\s\x00-\x1f]/.test(device.token) ||
          !message.data || Object.values(message.data).some(value => typeof value !== "string") ||
          !["HIGH", "NORMAL"].includes(message.android.priority) || !/^(?:0|[1-9]\d{0,2})s$/.test(message.android.ttl) ||
          Number(message.android.ttl.slice(0, -1)) > 600 ||
          (message.android.restricted_package_name !== undefined && message.android.restricted_package_name !== config.packageName)) throw new PushProviderError("configuration");
      let body = JSON.stringify({ message: { token: device.token, ...message,
        android: { ...message.android, restricted_package_name: config.packageName } } });
      if (Buffer.byteLength(body) > 4096) throw new PushProviderError("rejected", 413);
      let authorization: string;
      try { authorization = await within(() => accessToken(deadline)); }
      catch (error) { if (error instanceof PushProviderError) throw error; throw new PushProviderError("authentication"); }
      if (!authorization || /[\r\n]/.test(authorization)) throw new PushProviderError("authentication");
      if (beforeAttempt && !await within(beforeAttempt)) throw new PushProviderError("rejected");
      if (expiresAt !== undefined) {
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new PushProviderError("rejected");
        const ttl = Math.min(Number(message.android.ttl.slice(0,-1)),Math.floor((expiresAt-now())/1000));
        body = JSON.stringify({message:{token:device.token,...message,android:{...message.android,ttl:`${ttl}s`,restricted_package_name:config.packageName}}});
      }
      const response = await within(() => request(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${authorization}` }, body, signal: controller.signal,
      }));
      if (response.status === 200) { void response.body?.cancel().catch(() => {}); return; }
      // Bound untrusted error data and deadline even if a provider stalls its body.
      let responseBody = "";
      const reader = response.body?.getReader();
      if (reader) {
        try {
          let bytes = 0;
          while (true) {
            const chunk = await within(() => reader.read());
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 8192) break;
            responseBody += new TextDecoder().decode(chunk.value);
          }
        } finally { void reader.cancel().catch(() => {}); }
      }
      throw rejection(response.status, responseBody);
    } catch (error) {
      if (error instanceof PushProviderError) throw error;
      throw new PushProviderError(controller.signal.aborted || now() >= deadline ? "timeout" : "transport");
    } finally { clearTimeout(timer); controller.abort(); }
  };
}
export const sendFcmMessage = createFcmSender();
