/** Explicit library entrypoint. Import/build never listens or installs signals. */
import { createServer, type Server } from "node:http";
import { isIP } from "node:net";
import { constants } from "node:fs";
import { open, lstat, type FileHandle } from "node:fs/promises";
import express from "express";
import { createBoundRetainedRuntime, type PrivateRetainedBinding } from "./bound";

export interface RetainedDirectoryIdentity {
  device: number; inode: number; uid: number; gid: number; mode: 0o700;
}
export interface RetainedListenerBinding {
  host: string;
  port: number;
  runtime: PrivateRetainedBinding;
  storage: { recordings: RetainedDirectoryIdentity; chatMedia: RetainedDirectoryIdentity };
  /** One bounded startup-settlement/drain budget per phase; default 30 seconds. */
  shutdownTimeoutMs?: number;
}

const refused = () => new Error("RETAINED_LISTENER_START_REFUSED");
const uncertain = () => new Error("RETAINED_LISTENER_CLEANUP_UNCONFIRMED");
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(uncertain()), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(uncertain()); });
  });
}

/** Private config is copied before effects; no injected auth/pool/server factory. */
export function createRetainedApiListener(input: RetainedListenerBinding) {
  let binding: RetainedListenerBinding;
  try {
    binding = structuredClone(input);
    if (!binding || !isIP(binding.host) || !Number.isInteger(binding.port) || binding.port < 1 || binding.port > 65535
      || !binding.runtime || !binding.storage || ![undefined, "auth-playback", "retained-full"].includes(binding.runtime.profile)) throw new Error();
    for (const identity of [binding.storage.recordings, binding.storage.chatMedia]) {
      if (!identity || ![identity.device, identity.inode, identity.uid, identity.gid].every(value => Number.isSafeInteger(value) && value >= 0)
        || identity.inode === 0 || identity.mode !== 0o700 || identity.uid !== process.getuid?.() || identity.gid !== process.getgid?.()) throw new Error();
    }
    if (binding.shutdownTimeoutMs !== undefined && (!Number.isInteger(binding.shutdownTimeoutMs) || binding.shutdownTimeoutMs < 1 || binding.shutdownTimeoutMs > 30_000)) throw new Error();
  } catch { throw refused(); }
  const profile = binding.runtime.profile ?? "auth-playback";
  const timeout = binding.shutdownTimeoutMs ?? 30_000;
  const listenAbort = new AbortController();
  const directories: FileHandle[] = [];
  let terminal = false, ready = false, listeningObserved = false;
  let runtime: Awaited<ReturnType<typeof createBoundRetainedRuntime>> | undefined;
  let server: Server | undefined;
  let work: Promise<void> | undefined;
  let startPromise: Promise<Readonly<{ state: "LISTENING"; profile: typeof profile }>> | undefined;
  let closePromise: Promise<void> | undefined;
  const ensureOpen = () => { if (terminal) throw refused(); };

  async function holdDirectory(pathname: string, identity: RetainedDirectoryIdentity) {
    // Exact held leaf identity, no directory enumeration or file content read.
    // Parent/mount immutability and write ACLs remain deployment prerequisites.
    if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.includes("\0")) throw refused();
    const handle = await open(pathname, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    directories.push(handle);
    ensureOpen();
    const actual = await handle.stat();
    ensureOpen();
    const named = await lstat(pathname);
    ensureOpen();
    if (!actual.isDirectory() || !named.isDirectory() || actual.dev !== identity.device || actual.ino !== identity.inode
      || actual.uid !== identity.uid || actual.gid !== identity.gid || (actual.mode & 0o7777) !== identity.mode
      || named.dev !== actual.dev || named.ino !== actual.ino || named.uid !== actual.uid || named.gid !== actual.gid
      || named.mode !== actual.mode) throw refused();
  }

  function close(): Promise<void> {
    terminal = true; ready = false;
    // Node's listen AbortSignal cancels a bind still pending in libuv. Merely
    // calling server.close before listening would allow a later listener leak.
    if (!listeningObserved) listenAbort.abort();
    return closePromise ??= (async () => {
      try {
        // Wait the actual setup operation, not a wrapper that can settle early.
        // An ignored dependency remains unknown; it can never listen afterward.
        if (work) await bounded(work.then(() => undefined, () => undefined), timeout);
        if (runtime && server && listeningObserved && server.listening) await runtime.createShutdown(server, timeout)();
        else if (runtime) await bounded(runtime.close(), timeout);
        for (const handle of directories) await bounded(handle.close(), timeout);
      } catch { throw uncertain(); }
    })();
  }

  function start() {
    if (terminal) return Promise.reject(refused());
    if (startPromise) return startPromise;
    work = Promise.resolve().then(async () => {
      ensureOpen();
      await holdDirectory(binding.runtime.recordingsPath, binding.storage.recordings); ensureOpen();
      await holdDirectory(binding.runtime.chatMediaPath, binding.storage.chatMedia); ensureOpen();
      runtime = await createBoundRetainedRuntime(binding.runtime); ensureOpen();
      const app = express();
      app.disable("x-powered-by"); app.set("trust proxy", false);
      app.use((req, res, next) => {
        if (!ready || terminal) { res.status(503).json({ error: "Retained runtime is unavailable" }); return; }
        next();
      });
      const health = (_req: express.Request, res: express.Response) => res.json({ ok: true, service: "phone11-retained-api", profile });
      app.get(["/health", "/api/health"], health);
      app.get("/api/ws/status", (_req, res) => res.status(503).json({ ok: false, enabled: false, reason: "Authenticated event delivery is not enabled" }));
      app.get("/manus-storage/*", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.status(503).json({ error: "Legacy storage is unavailable. Use authenticated Phone11 media." }); });
      app.all(["/api/oauth/*", "/api/auth/session", "/api/auth/logout"], (_req, res) => res.status(410).json({ error: "Install the Phone11 sign-in update" }));
      app.use(runtime.app);
      server = createServer(app);
      server.headersTimeout = 10_000; server.requestTimeout = 30_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 100;
      server.on("error", () => { terminal = true; ready = false; void close().catch(() => undefined); });
      await new Promise<void>((resolve, reject) => {
        const current = server!;
        const cleanup = () => { current.off("listening", onListen); current.off("error", onError); current.off("close", onClose); };
        const onListen = () => { listeningObserved = true; cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(refused()); };
        const onClose = () => { cleanup(); reject(refused()); };
        current.once("listening", onListen); current.once("error", onError); current.once("close", onClose);
        try { ensureOpen(); current.listen({ host: binding.host, port: binding.port, signal: listenAbort.signal }); }
        catch { cleanup(); reject(refused()); }
      });
      ensureOpen(); ready = true;
    });
    startPromise = bounded(work, timeout).then(() => {
      ensureOpen(); return Object.freeze({ state: "LISTENING" as const, profile });
    }).catch(async () => {
      try { await close(); } catch { throw uncertain(); }
      throw refused();
    });
    return startPromise;
  }
  return Object.freeze({ start, close });
}
