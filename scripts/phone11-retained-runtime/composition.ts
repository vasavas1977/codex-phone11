/** Inert route composition only. No CLI, listener, pool, worker or signal startup. */
import express, { type RequestHandler } from "express";
import { phone11Cors, registerAuthRoutes } from "phone11-maintained/auth-routes";
import { registerWakeRoutes } from "phone11-maintained/wake-routes";
import { createChatMediaRouter } from "phone11-maintained/chat-media";
import { storageRouter } from "phone11-maintained/recording-storage";
import { createPhone11RuntimeLifecycle, createPhone11Shutdown } from "phone11-maintained/runtime-role";

// These are the canonical retained paths. Existing specialized receivers own
// sign-in/reset, tRPC, voicemail, recording upload and native CDR ingestion.
// HEAD follows the maintained Express GET contract. OPTIONS runs maintained
// CORS only for an admitted path. This does not assert current ingress use.
const read = (method: string) => method === "GET" || method === "HEAD";
export type RetainedProfile = "auth-playback" | "retained-full";
export function retainedRequestAdmitted(method: string, pathname: string, profile: RetainedProfile): boolean {
  if (typeof method !== "string" || typeof pathname !== "string") return false;
  const option = method === "OPTIONS";
  if (["/api/auth/me", "/api/ready/auth"].includes(pathname.replace(/\/$/, ""))) return option || read(method);
  if (/^\/api\/auth\/sign-out\/?$/.test(pathname)) return option || method === "POST";
  if (/^\/api\/recordings\/play\/[^/]+\/?$/.test(pathname)) return option || read(method);
  if (profile !== "retained-full") return false;
  if (/^\/api\/phone11\/wake\/(claim|ready|status|end|offer|terminal)\/?$/.test(pathname)) return option || method === "POST";
  if (/^\/api\/chat\/media\/upload\/?$/.test(pathname)) return option || method === "POST";
  if (/^\/api\/chat\/media\/[^/]+\/?$/.test(pathname)) return option || read(method);
  return false;
}

type AuthDependencies = Required<NonNullable<Parameters<typeof registerAuthRoutes>[1]>>;
export type CandidateBindings = {
  profile: RetainedProfile;
  admissionAvailable: () => boolean;
  auth: AuthDependencies;
  wake: NonNullable<Parameters<typeof registerWakeRoutes>[1]>;
  chatTransaction: NonNullable<Parameters<typeof createChatMediaRouter>[0]>;
  /** Must close ALL resources actually owned by the eventual binding. No default. */
  closeResources: () => void | Promise<void>;
};

const forbiddenWorker = () => { throw new Error("RETAINED_RUNTIME_WORKERS_FORBIDDEN"); };
export function createRetainedRuntimeCandidate(bindings: CandidateBindings) {
  if (!bindings || !["auth-playback", "retained-full"].includes(bindings.profile) || typeof bindings.admissionAvailable !== "function" || typeof bindings.auth?.getAuth !== "function" || typeof bindings.auth?.getDatabase !== "function" ||
      !bindings.wake || typeof bindings.wake.device !== "function" || typeof bindings.wake.offer !== "function" ||
      typeof bindings.wake.terminal !== "function" || typeof bindings.chatTransaction !== "function" ||
      typeof bindings.closeResources !== "function") throw new Error("RETAINED_RUNTIME_BINDINGS_REQUIRED");
  const lifecycle = createPhone11RuntimeLifecycle("api-candidate", {
    startChatNotificationDispatcher: forbiddenWorker, startChatMediaRetention: forbiddenWorker,
    startRecordingAnalysis: forbiddenWorker, startRecordingRetention: forbiddenWorker,
    startRecordingCapture: forbiddenWorker, startFreeSwitchEventListener: forbiddenWorker,
    stopFreeSwitchEventListener: forbiddenWorker, shutdownWebSockets: forbiddenWorker,
  });
  const app = express();
  const profile = bindings.profile;
  app.disable("x-powered-by");
  // Explicitly retain the safer Express default: no trusted proxy/IP inference.
  // A future real proxy binding requires its own exact accepted CIDRs.
  app.set("trust proxy", false);
  const admission: RequestHandler = (req, res, next) => {
    if (!retainedRequestAdmitted(req.method, req.path, profile)) { res.status(404).json({ error: "Not found" }); return; }
    if (!bindings.admissionAvailable()) { res.status(503).json({ error: "Retained runtime is unavailable" }); return; }
    next();
  };
  app.use(admission, phone11Cors);
  registerAuthRoutes(app, bindings.auth);
  registerWakeRoutes(app, bindings.wake);
  app.use("/api/chat/media", createChatMediaRouter(bindings.chatTransaction));
  // Whole maintained router is behind the earlier exact playback-only gate.
  // Neither its upload nor voicemail handlers can be admitted here.
  app.use("/api/recordings", storageRouter);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return Object.freeze({
    app,
    plan: lifecycle.plan,
    // Caller owns server creation/listen/readiness. This candidate never listens.
    // Shared maintained shutdown drains HTTP before the required resource closer.
    createShutdown(server: Parameters<typeof createPhone11Shutdown>[0], timeoutMs?: number) {
      return createPhone11Shutdown(server, lifecycle.background, timeoutMs, bindings.closeResources);
    },
  });
}
