/** Inert DID-only receiver library: no signals, CLI, environment loader or workers. */
import { createServer, type Server } from "node:http";
import { isIP } from "node:net";
import express from "express";
import { configureOwnedPbxPool, getPool, closeOwnedPbxPool, type OwnedPbxPoolBinding } from "phone11-maintained/db";
import { requiredAuthority, attestOwnedPool, type DatabaseAuthority } from "phone11-maintained/pool-attestation";
import { createKamailioRoutingRouter } from "../../server/pbx/kamailio-routing";
import { attestDidReadScope } from "./acl";
export interface DidListenerBinding {
  host: string; port: number;
  database: OwnedPbxPoolBinding;
  databaseAuthority: DatabaseAuthority;
  /** Separate private 64-hex key, matched to the reviewed native caller. */
  integrationSecret: string;
  /** One bounded startup/cleanup budget per phase, at most30seconds. */
  timeoutMs?: number;
}
let setupAttempted = false;
const refused = () => new Error("DID_LISTENER_START_REFUSED");
const uncertain = () => new Error("DID_LISTENER_CLEANUP_UNCONFIRMED");

export function createDidRoutingListener(input: DidListenerBinding) {
  let binding: DidListenerBinding;
  try {
    binding = structuredClone(input);
    if (!binding || !isIP(binding.host) || !Number.isInteger(binding.port) || binding.port < 1 || binding.port > 65535
      || typeof binding.integrationSecret !== "string" || !/^[a-f0-9]{64}$/.test(binding.integrationSecret)
      || binding.integrationSecret === binding.database?.password
      || (binding.timeoutMs !== undefined && (!Number.isInteger(binding.timeoutMs) || binding.timeoutMs < 1 || binding.timeoutMs > 30_000))) throw new Error();
    requiredAuthority(binding.databaseAuthority);
  } catch { throw refused(); }
  const timeout = binding.timeoutMs ?? 30_000;
  const listenAbort = new AbortController();
  let terminal = false, ready = false, poolBound = false, listeningObserved = false, unconfirmed = false;
  let server: Server | undefined;
  let work: Promise<void> | undefined;
  let startPromise: Promise<Readonly<{ state: "LISTENING"; service: "phone11-did-routing" }>> | undefined;
  let closePromise: Promise<void> | undefined;
  const admittedQueries = new Set<Promise<unknown>>();
  const ensureOpen = () => { if (terminal) throw refused(); };
  function bounded<T>(operation: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unconfirmed = true; reject(uncertain()); }, timeout);
      operation.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(uncertain()); });
    });
  }
  function close(): Promise<void> {
    terminal = true; ready = false;
    // Abort a pending libuv bind; server.close before listening alone is racy.
    if (!listeningObserved) listenAbort.abort();
    return closePromise ??= (async () => {
      try {
        if (work) await bounded(work.then(() => undefined, () => undefined));
        if (unconfirmed) throw uncertain();
        if (server?.listening) {
          await bounded(new Promise<void>((resolve, reject) => {
            server!.close(error => error ? reject(error) : resolve());
            server!.closeIdleConnections();
          }));
        }
        // A client can abort while the async factory still awaits SQL. Query
        // admission was fenced synchronously above; settle every already-owned
        // promise even after HTTP close, before ending its pool.
        await bounded(Promise.allSettled([...admittedQueries]));
        if (unconfirmed) throw uncertain();
        if (poolBound) await bounded(closeOwnedPbxPool());
      } catch { unconfirmed = true; throw uncertain(); }
    })();
  }
  function start() {
    if (terminal) return Promise.reject(refused());
    if (startPromise) return startPromise;
    work = Promise.resolve().then(async () => {
      ensureOpen();
      if (setupAttempted) throw refused();
      setupAttempted = true;
      configureOwnedPbxPool(binding.database); poolBound = true;
      await attestOwnedPool(binding.database.user, binding.database.database, requiredAuthority(binding.databaseAuthority)); ensureOpen();
      await attestDidReadScope(); ensureOpen();
      const app = express(); app.disable("x-powered-by"); app.set("trust proxy", false);
      app.use((_req, res, next) => { if (!ready || terminal) { res.status(503).json({ error: "DID runtime unavailable" }); return; } next(); });
      app.get(["/health", "/api/health"], (_req, res) => res.json({ ok: true, service: "phone11-did-routing" }));
      // Only the qualified header-secret route is admitted, before JSON/SQL.
      app.use((req, res, next) => { if (req.method !== "POST" || req.path !== "/api/kamailio/route") { res.sendStatus(404); return; } next(); });
      app.use(express.json({ limit: "4kb", strict: true }));
      app.use("/api/kamailio", createKamailioRoutingRouter({
        query: async (text, values) => {
          if (terminal || !ready) throw new Error("DID_QUERY_UNAVAILABLE");
          const task = getPool().query(text, values);
          admittedQueries.add(task);
          try { return await task; }
          catch { throw new Error("DID_QUERY_UNAVAILABLE"); }
          finally { admittedQueries.delete(task); }
        },
        getSecret: () => binding.integrationSecret,
      }));
      app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(error.status === 413 ? 413 : 400).json({ error: "DID request invalid" });
      });
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
    startPromise = bounded(work).then(() => { ensureOpen(); return Object.freeze({ state: "LISTENING" as const, service: "phone11-did-routing" as const }); })
      .catch(async () => { try { await close(); } catch { throw uncertain(); } throw refused(); });
    return startPromise;
  }
  return Object.freeze({ start, close });
}
