/** Inert worker-only factory. Operator must fence/retire the old actor before start(). */
import path from "node:path";
import { configureOwnedPbxPool, closeOwnedPbxPool, type OwnedPbxPoolBinding } from "phone11-maintained/db";
import { requiredAuthority, attestOwnedPool, type DatabaseAuthority } from "phone11-maintained/pool-attestation";
import { configureWorkerRedis, closeWorkerRedis } from "./owned-redis";
import { createWorkerLifecycle } from "./lifecycle";
import { assertWorkerSchema } from "./schema";

export interface WorkerBinding {
  database: OwnedPbxPoolBinding;
  databaseAuthority: DatabaseAuthority;
  enabled: { chatNotifications: boolean; chatMediaRetention: boolean; recordingAnalysis: boolean; recordingRetention: boolean; eslEvents: boolean };
  recordingsPath?: string;
  chatMediaPath?: string;
  redisUrl?: string;
  apns?: { keyPath: string; keyId: string; teamId: string; bundleId: string; environment: "sandbox" | "production" };
  analysis?: { apiKey: string; model: string };
  capture: { mode: "off" | "cleanup-only" | "enabled"; host?: string; port?: number; password?: string; announcementPath?: string; spoolPath?: string; uploadUrl?: string; integrationSecret?: string };
  events?: { host: string; port: number; password: string };
}
let attempted = false;
let terminal = false;
function text(value: unknown, maximum = 4096): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new Error();
  return value;
}
function absolute(value: unknown): string {
  const result = text(value);
  if (result === "/" || !path.isAbsolute(result) || path.normalize(result) !== result) throw new Error();
  return result;
}
function port(value: unknown): string {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) throw new Error();
  return String(value);
}
function selectedEnvironment(binding: WorkerBinding) {
  const keys = ["chatNotifications", "chatMediaRetention", "recordingAnalysis", "recordingRetention", "eslEvents"] as const;
  if (!binding.enabled || Object.keys(binding.enabled).length !== keys.length || keys.some(key => typeof binding.enabled[key] !== "boolean")
    || !["off", "cleanup-only", "enabled"].includes(binding.capture?.mode)) throw new Error();
  const enabled = Object.freeze({ ...binding.enabled }), captureMode = binding.capture.mode;
  const environment: Record<string, string> = {
    NODE_ENV: "production", PHONE11_CHAT_NOTIFICATIONS_ENABLED: enabled.chatNotifications ? "1" : "0",
    PHONE11_RECORDING_AI_ENABLED: String(enabled.recordingAnalysis), PHONE11_RECORDING_RETENTION_ENABLED: String(enabled.recordingRetention),
    PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED: String(captureMode === "enabled"),
  };
  if (enabled.recordingAnalysis || enabled.recordingRetention) environment.RECORDINGS_PATH = absolute(binding.recordingsPath);
  if (enabled.chatMediaRetention) environment.PHONE11_CHAT_MEDIA_PATH = absolute(binding.chatMediaPath);
  if (enabled.chatMediaRetention) environment.PHONE11_PROFILE_PHOTO_CLEANUP_EXTERNAL = "1";
  if (enabled.chatNotifications) Object.assign(environment, {
    APNS_KEY_PATH: absolute(binding.apns?.keyPath), APNS_KEY_ID: text(binding.apns?.keyId, 10),
    APNS_TEAM_ID: text(binding.apns?.teamId, 10), APNS_BUNDLE_ID: text(binding.apns?.bundleId, 256), APNS_ENVIRONMENT: text(binding.apns?.environment, 16),
  });
  if (enabled.recordingAnalysis) Object.assign(environment, { GEMINI_API_KEY: text(binding.analysis?.apiKey), PHONE11_RECORDING_GEMINI_MODEL: text(binding.analysis?.model, 128) });
  if (enabled.eslEvents) {
    if (process.env.FS_ESL_HOST || process.env.FS_ESL_PASSWORD || process.env.FS_ESL_PORT) throw new Error();
    Object.assign(environment, { FREESWITCH_ESL_HOST: text(binding.events?.host, 253), FREESWITCH_ESL_PORT: port(binding.events?.port), FREESWITCH_ESL_PASSWORD: text(binding.events?.password) });
    if (environment.FREESWITCH_ESL_PASSWORD === "ClueCon") throw new Error();
  }
  if (captureMode !== "off") {
    Object.assign(environment, {
      PHONE11_RECORDING_ESL_HOST: text(binding.capture.host, 253), PHONE11_RECORDING_ESL_PORT: port(binding.capture.port),
      PHONE11_RECORDING_ESL_PASSWORD: text(binding.capture.password), PHONE11_RECORDING_ANNOUNCEMENT_PATH: absolute(binding.capture.announcementPath),
      PHONE11_RECORDING_SPOOL_PATH: absolute(binding.capture.spoolPath), PHONE11_RECORDING_UPLOAD_URL: text(binding.capture.uploadUrl), FS_SHARED_SECRET: text(binding.capture.integrationSecret),
    });
    if (environment.FS_SHARED_SECRET.length < 24 || environment.PHONE11_RECORDING_ESL_PASSWORD === "ClueCon") throw new Error();
    const upload = new URL(environment.PHONE11_RECORDING_UPLOAD_URL);
    if (upload.protocol !== "https:" || upload.pathname !== "/api/recordings/upload" || upload.search || upload.hash || upload.username || upload.password) throw new Error();
  }
  if (Object.entries(environment).some(([key, value]) => process.env[key] !== undefined && process.env[key] !== value)) throw new Error();
  return { environment: Object.freeze(environment), enabled, captureMode };
}

export async function prepareBoundWorkerRuntime(binding: WorkerBinding) {
  if (attempted) throw new Error("WORKER_BOUND_SETUP_REFUSED");
  attempted = true;
  let poolBound = false;
  let lifecycle: ReturnType<typeof createWorkerLifecycle> | undefined;
  try {
    // Private value copy before any effect/await; caller mutation cannot change
    // the selected database, actor policy or later deferred imports.
    binding = structuredClone(binding);
    const { environment: selected, enabled, captureMode } = selectedEnvironment(binding);
    const available = () => !terminal && Object.entries(selected).every(([key, value]) => process.env[key] === value);
    const requireSelected = () => { if (!available()) throw new Error(); };
    const authority = requiredAuthority(binding.databaseAuthority);
    if (enabled.eslEvents) configureWorkerRedis(text(binding.redisUrl));
    configureOwnedPbxPool(binding.database); poolBound = true;
    for (const [key, value] of Object.entries(selected)) process.env[key] = value;
    await attestOwnedPool(binding.database.user, binding.database.database, authority);
    requireSelected();
    await assertWorkerSchema({ chat: enabled.chatNotifications, analysis: enabled.recordingAnalysis, retention: enabled.recordingRetention, capture: captureMode !== "off" });
    requireSelected();
    // These imports are deferred because media/Redis/storage modules capture
    // configuration. All starters below are the actual maintained functions.
    const [chat, media, recording, capture, events, websocket, apns, fsConfig] = await Promise.all([
      enabled.chatNotifications ? import("../../server/chat-notifications/dispatcher") : undefined,
      enabled.chatMediaRetention ? import("../../server/chat/media") : undefined,
      enabled.recordingAnalysis || enabled.recordingRetention ? import("../../server/cloud-recordings/worker") : undefined,
      captureMode !== "off" ? import("../../server/cloud-recordings/capture-service") : undefined,
      enabled.eslEvents ? import("../../server/pbx/fs-event-listener") : undefined,
      enabled.eslEvents ? import("../../server/pbx/websocket") : undefined,
      enabled.chatNotifications ? import("../../server/push/apns") : undefined,
      enabled.eslEvents ? import("../../server/pbx/fs-config") : undefined,
    ]);
    requireSelected();
    apns?.readApnsConfig(); fsConfig?.getFreeSwitchConfig(selected);
    requireSelected();
    const captureInstance = capture?.configuredRecordingCapture(true);
    if (capture && !captureInstance) throw new Error();
    requireSelected();
    lifecycle = createWorkerLifecycle({
      startChatNotificationDispatcher: () => chat?.startChatNotificationDispatcher({ enabled: available }) ?? (async () => undefined),
      startChatMediaRetention: () => media?.startChatMediaRetention({ enabled: enabled.chatMediaRetention }) ?? (async () => undefined),
      startRecordingAnalysis: () => enabled.recordingAnalysis ? recording!.startRecordingAnalysisWorker() : async () => undefined,
      startRecordingRetention: () => enabled.recordingRetention ? recording!.startRecordingRetentionWorker() : async () => undefined,
      startRecordingCapture: () => capture?.startRecordingCaptureService({ instance: captureInstance! }) ?? (async () => undefined),
      startFreeSwitchEventListener: () => events?.fsEventListener.start(),
      stopFreeSwitchEventListener: () => events?.fsEventListener.stop(),
      shutdownWebSockets: () => websocket?.wsManager.shutdown(),
    }, async () => { await closeWorkerRedis(); await closeOwnedPbxPool(); });
    requireSelected();
    const owned = lifecycle;
    return Object.freeze({
      /** Explicit operator action after actual old actor absence/reconciliation. */
      async start() {
        if (!available()) throw new Error("WORKER_START_REFUSED");
        await owned.start();
      },
      close() { terminal = true; return owned.close(); },
      status: owned.status,
      actorIds: Object.freeze(["chat-notification", "chat-media-retention", "recording-analysis", "recording-retention", "recording-capture", "esl-events"]),
      disposition: Object.freeze({ ...enabled, capture: captureMode }),
    });
  } catch {
    terminal = true;
    try {
      if (lifecycle) await lifecycle.close();
      else { await closeWorkerRedis(); if (poolBound) await closeOwnedPbxPool(); }
    } catch { throw new Error("WORKER_BOUND_SETUP_CLEANUP_UNCONFIRMED"); }
    throw new Error("WORKER_BOUND_SETUP_REFUSED");
  }
}
