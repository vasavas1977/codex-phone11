/** Clone-only connection seam. No target discovery, startup or output side effects. */
import type pg from "pg";

export const CLONE_SOCKET = "/run/phone11-pbx-clone/socket";
export const CLONE_SOURCE = "cd2b317c01d27ee472dca969a097133bd8968464";
export const LIMITS = Object.freeze({ connect: 2000, query: 5000, transaction: 15000, lifetime: 60000, close: 3000 });
const SOURCE_SYSTEM = "7638134557377753122";
// No actual software/role/rollback admission exists yet. Bind only in a reviewed revision.
const EXECUTION_ADMISSION_SHA256: string | null = null;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{32}$/;
const PG_CODES = new Set(["23502", "23503", "23505", "23514", "40001", "40P01", "42501", "42P01", "42703", "28P01", "55P03", "57014", "55000", "25006", "25P02", "3D000", "08006", "57P01"]);
const RPC_CODES = new Set(["FORBIDDEN", "UNAUTHORIZED", "BAD_REQUEST", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED", "INTERNAL_SERVER_ERROR"]);
export type Refusal = "INPUT_REFUSED" | "ADMISSION_REFUSED" | "EXECUTION_UNBOUND" | "ENVIRONMENT_REFUSED" | "RUNTIME_REFUSED" | "CLOSED" | "CANCELLED" | "CONNECT_TIMEOUT" | "QUERY_TIMEOUT" | "TRANSACTION_TIMEOUT" | "LIFETIME_TIMEOUT" | "POOL_ERROR" | "CLOSE_TIMEOUT" | "CLOSE_FAILED" | "QUERY_INTERFACE_REFUSED" | "UNSETTLED_QUERY";
const REFUSALS = new Set<string>(["INPUT_REFUSED", "ADMISSION_REFUSED", "EXECUTION_UNBOUND", "ENVIRONMENT_REFUSED", "RUNTIME_REFUSED", "CLOSED", "CANCELLED", "CONNECT_TIMEOUT", "QUERY_TIMEOUT", "TRANSACTION_TIMEOUT", "LIFETIME_TIMEOUT", "POOL_ERROR", "CLOSE_TIMEOUT", "CLOSE_FAILED", "QUERY_INTERFACE_REFUSED", "UNSETTLED_QUERY"]);
class CloneRefusal extends Error {
  constructor(readonly refusal: Refusal) { super(refusal); this.name = "CloneRefusal"; }
}
function refuse(code: Refusal): never { throw new CloneRefusal(code); }

/** Output boundary: never forwards message, detail, stack, cause, SQL or credentials. */
export function safeCloneError(error: unknown): Readonly<{ kind: "adapter" | "postgres" | "handler" | "unknown"; code: string }> {
  try {
    if (error instanceof CloneRefusal && REFUSALS.has(error.refusal)) return Object.freeze({ kind: "adapter", code: error.refusal });
    if (error && typeof error === "object") {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const code: unknown = descriptor?.value;
    if (typeof code === "string" && PG_CODES.has(code)) return Object.freeze({ kind: "postgres", code });
    if (typeof code === "string" && RPC_CODES.has(code)) return Object.freeze({ kind: "handler", code });
    }
  } catch { /* Hostile getters/proxies never reach the output boundary. */ }
  return Object.freeze({ kind: "unknown", code: "UNCLASSIFIED" });
}

type RecordValue = Record<string, unknown>;
function record(value: unknown, keys: string[]): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse("ADMISSION_REFUSED");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]))) refuse("ADMISSION_REFUSED");
  return value as RecordValue;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value) || /^0+$/.test(value)) refuse("ADMISSION_REFUSED");
  return value;
}
function image(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("sha256:")) refuse("ADMISSION_REFUSED");
  digest(value.slice(7)); return value;
}
interface Validated {
  attemptId: string; login: string; password: string; nodeVersion: string; observationSha256: string;
}
declare const brand: unique symbol;
export type CloneAdmission = Readonly<{ readonly [brand]: true }>;
const admitted = new WeakMap<CloneAdmission, Validated>();
const consumed = new WeakSet<CloneAdmission>();

/** Bounded private JSON/memory input. Pins/observations must be verified by the external clone custodian first. */
export function admitCloneConnectionInput(input: string): CloneAdmission {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > 8192) refuse("INPUT_REFUSED");
  let decoded: unknown;
  try { decoded = JSON.parse(input); } catch { refuse("INPUT_REFUSED"); }
  const root = record(decoded, ["schema", "attemptId", "purpose", "target", "source", "software", "custody", "role"]);
  if (root.schema !== "phone11-pbx-clone-real-pg-admission/v1" || root.purpose !== "CLONE_HANDLER_REHEARSAL" || typeof root.attemptId !== "string" || !ID.test(root.attemptId)) refuse("ADMISSION_REFUSED");
  const target = record(root.target, ["socketDirectory", "database", "port", "sourceSystemIdentifier", "cloneSystemIdentifier"]);
  if (target.socketDirectory !== CLONE_SOCKET || target.database !== "phone11ai" || target.port !== 5432 || target.sourceSystemIdentifier !== SOURCE_SYSTEM || typeof target.cloneSystemIdentifier !== "string" || !/^[1-9][0-9]{0,19}$/.test(target.cloneSystemIdentifier) || target.cloneSystemIdentifier === SOURCE_SYSTEM) refuse("ADMISSION_REFUSED");
  const source = record(root.source, ["candidateCommit", "rollbackArtifactSha256"]);
  if (source.candidateCommit !== CLONE_SOURCE) refuse("ADMISSION_REFUSED");
  digest(source.rollbackArtifactSha256);
  const software = record(root.software, ["workerImageId", "selectedManifest", "nodeRuntimeSha256", "nodeVersion", "driverBundleSha256"]);
  image(software.workerImageId); image(software.selectedManifest); digest(software.nodeRuntimeSha256); digest(software.driverBundleSha256);
  if (typeof software.nodeVersion !== "string" || !/^22\.[0-9]+\.[0-9]+$/.test(software.nodeVersion)) refuse("ADMISSION_REFUSED");
  const custody = record(root.custody, ["observationSha256", "privateSocket", "networkNone", "noMounts", "ownedFreshClone"]);
  digest(custody.observationSha256);
  if ([custody.privateSocket, custody.networkNone, custody.noMounts, custody.ownedFreshClone].some(value => value !== true)) refuse("ADMISSION_REFUSED");
  const role = record(root.role, ["login", "password", "restrictedLoginObservationSha256", "restricted", "nonOwner", "noSchemaCreate", "noDatabaseCreate", "noPrivilegedMembership"]);
  if (role.login !== `p11_clone_runtime_${root.attemptId}` || typeof role.password !== "string" || !/^[a-f0-9]{64}$/.test(role.password) || /^([a-f0-9])\1+$/.test(role.password)) refuse("ADMISSION_REFUSED");
  digest(role.restrictedLoginObservationSha256);
  if ([role.restricted, role.nonOwner, role.noSchemaCreate, role.noDatabaseCreate, role.noPrivilegedMembership].some(value => value !== true)) refuse("ADMISSION_REFUSED");
  const token = Object.freeze({}) as CloneAdmission;
  admitted.set(token, { attemptId: root.attemptId, login: role.login as string, password: role.password, nodeVersion: software.nodeVersion, observationSha256: custody.observationSha256 as string });
  return token;
}

/** Presence checks only. No environment values, files or default target configuration are read. */
export function assertNoAmbientConnectionKeys(keys: readonly string[]): void {
  if (keys.some(key => /^(?:PG|POSTGRES|DATABASE|DB_|NODE_PG_|NODE_OPTIONS|NODE_PATH)/i.test(key))) refuse("ENVIRONMENT_REFUSED");
}

export interface CloneClient {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
  release(destroy?: boolean): void;
}
export interface ClonePool {
  connect(): Promise<CloneClient>;
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}
export interface CloneAdapter {
  getPool(): ClonePool;
  query: ClonePool["query"];
  withTransaction<T>(fn: (client: CloneClient) => Promise<T>): Promise<T>;
  close(): Promise<Readonly<{ ended: boolean; code: "CLOSED" | "CLOSE_TIMEOUT" | "CLOSE_FAILED" }>>;
}
// Minimal actual pg transport surface; injectable factory below is restricted to test mode.
export interface TestTransportClient {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
  release(destroy?: boolean): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
  removeListener(event: "error", listener: (error: unknown) => void): unknown;
}
export interface TestTransportPool {
  connect(): Promise<TestTransportClient>;
  end(): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): unknown;
}
function poolOptions(config: Validated): pg.PoolConfig {
  return {
    host: CLONE_SOCKET, port: 5432, database: "phone11ai", user: config.login, password: config.password,
    ssl: false, max: 2, connectionTimeoutMillis: LIMITS.connect, idleTimeoutMillis: 2000,
    statement_timeout: 3000, lock_timeout: 1000, idle_in_transaction_session_timeout: 5000,
    application_name: "phone11-clone-handlers", options: "", client_encoding: "UTF8",
    allowExitOnIdle: true,
  };
}
function consume(token: CloneAdmission): Validated {
  const config = admitted.get(token);
  if (!config || consumed.has(token)) refuse("ADMISSION_REFUSED");
  consumed.add(token); admitted.delete(token); return config;
}
export async function createRealPgAdapter(token: CloneAdmission, signal: AbortSignal): Promise<CloneAdapter> {
  if (EXECUTION_ADMISSION_SHA256 === null) refuse("EXECUTION_UNBOUND");
  const config = admitted.get(token);
  if (!config || config.observationSha256 !== EXECUTION_ADMISSION_SHA256) refuse("ADMISSION_REFUSED");
  assertNoAmbientConnectionKeys(Object.keys(process.env));
  if (process.platform !== "linux" || process.arch !== "x64" || process.versions.node !== config.nodeVersion) refuse("RUNTIME_REFUSED");
  if (!(signal instanceof AbortSignal)) refuse("ADMISSION_REFUSED");
  if (signal.aborted) refuse("CANCELLED");
  const validated = consume(token);
  // pg's entry consults NODE_PG_FORCE_NATIVE. Do not evaluate it before admission/env checks.
  const driver = await import("pg");
  assertNoAmbientConnectionKeys(Object.keys(process.env));
  return create(validated, options => new driver.default.Pool(options), signal);
}
/** Offline tests only. A production bundle must not call or expose this factory. */
export function createCloneAdapterForTests(token: CloneAdmission, factory: (options: pg.PoolConfig) => TestTransportPool, signal: AbortSignal): CloneAdapter {
  if (process.env.NODE_ENV !== "test") refuse("RUNTIME_REFUSED");
  return create(consume(token), factory, signal);
}

function create(config: Validated, factory: (options: pg.PoolConfig) => TestTransportPool, signal: AbortSignal): CloneAdapter {
  if (!(signal instanceof AbortSignal)) refuse("ADMISSION_REFUSED");
  if (signal.aborted) refuse("CANCELLED");
  const pool = factory(poolOptions(config));
  let closed: Refusal | undefined;
  let closing: CloneAdapter["close"] extends () => infer T ? T | undefined : never;
  const leases = new Set<{ destroy(): void }>();
  const connecting = new Set<Promise<TestTransportClient>>();
  let releaseFailed = false;
  const waiters = new Set<(error: CloneRefusal) => void>();
  const active = () => { if (closed) refuse(closed); };
  function stop(code: Refusal): void {
    if (closed) return;
    closed = code;
    clearTimeout(lifetime);
    signal.removeEventListener("abort", abort);
    for (const fail of [...waiters]) fail(new CloneRefusal(code));
    for (const lease of [...leases]) lease.destroy();
    // Attach rejection handling immediately. The caller must still await close's bounded status.
    void close();
  }
  function bounded<T>(operation: Promise<T>, ms: number, code: Refusal, late?: (value: T) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true; clearTimeout(timer); waiters.delete(fail);
        if (error !== undefined) reject(error); else resolve(value as T);
      };
      const fail = (error: CloneRefusal) => finish(error);
      const timer = setTimeout(() => { stop(code); finish(new CloneRefusal(code)); }, ms);
      waiters.add(fail);
      operation.then(value => { if (settled) late?.(value); else finish(undefined, value); }, error => finish(error));
    });
  }
  async function connect(): Promise<CloneClient & { pending: number }> {
    active();
    const discard = (value: TestTransportClient) => { try { value.release(true); } catch { releaseFailed = true; } };
    const acquisition = pool.connect().then(value => {
      if (closed) { discard(value); refuse(closed); }
      return value;
    });
    connecting.add(acquisition);
    void acquisition.then(() => connecting.delete(acquisition), () => connecting.delete(acquisition));
    const raw = await bounded(acquisition, LIMITS.connect, "CONNECT_TIMEOUT", discard);
    if (closed) { discard(raw); refuse(closed); }
    let released = false;
    let pending = 0;
    let leaseTimer: ReturnType<typeof setTimeout>;
    const destroy = () => release(true);
    const clientError = () => stop("POOL_ERROR");
    raw.on("error", clientError);
    function release(requestDestroy = false): void {
      if (released) return;
      released = true; clearTimeout(leaseTimer); leases.delete(lease);
      // A forgotten/in-flight query is never returned to the reusable pool.
      // Remove our listener only after pg's pool has reinstalled its idle listener.
      try { raw.release(requestDestroy || pending > 0); }
      catch { releaseFailed = true; }
      finally { raw.removeListener("error", clientError); }
      if (pending > 0 && !closed) stop("UNSETTLED_QUERY");
    }
    const lease = { destroy };
    leases.add(lease);
    leaseTimer = setTimeout(() => stop("TRANSACTION_TIMEOUT"), LIMITS.transaction);
    return {
      get pending() { return pending; },
      async query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
        active(); if (released) refuse("CLOSED");
        if (typeof text !== "string" || !text || (values !== undefined && !Array.isArray(values))) refuse("QUERY_INTERFACE_REFUSED");
        pending++;
        try {
          const result = await bounded(raw.query<R>(text, values), LIMITS.query, "QUERY_TIMEOUT");
          active(); if (released) refuse("CLOSED");
          return result;
        }
        finally { pending--; }
      },
      release,
    };
  }
  async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
    const client = await connect();
    try { return await client.query<R>(text, values); } finally { client.release(); }
  }
  async function withTransaction<T>(fn: (client: CloneClient) => Promise<T>): Promise<T> {
    const client = await connect();
    return bounded((async () => {
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        active(); if (client.pending !== 0) { stop("UNSETTLED_QUERY"); refuse("UNSETTLED_QUERY"); }
        await client.query("COMMIT");
        return result;
      } catch (error) {
        if (!closed) {
          try { await client.query("ROLLBACK"); }
          catch { client.release(true); }
        }
        throw error; // Actual pg/handler error is preserved only inside the worker.
      } finally { client.release(); }
    })(), LIMITS.transaction, "TRANSACTION_TIMEOUT");
  }
  function close(): ReturnType<CloneAdapter["close"]> {
    if (closing) return closing;
    if (!closed) stop("CLOSED");
    if (closing) return closing;
    closing = new Promise(resolve => {
      let finished = false;
      const finish = (result: { ended: boolean; code: "CLOSED" | "CLOSE_TIMEOUT" | "CLOSE_FAILED" }) => {
        if (finished) return;
        finished = true; clearTimeout(timer); resolve(Object.freeze(result));
      };
      const timer = setTimeout(() => finish({ ended: false, code: "CLOSE_TIMEOUT" }), LIMITS.close);
      try { Promise.all([pool.end(), Promise.allSettled([...connecting])]).then(() => finish(releaseFailed ? { ended: false, code: "CLOSE_FAILED" } : { ended: true, code: "CLOSED" }), () => finish({ ended: false, code: "CLOSE_FAILED" })); }
      catch { finish({ ended: false, code: "CLOSE_FAILED" }); }
    });
    return closing;
  }
  const abort = () => stop("CANCELLED");
  const lifetime = setTimeout(() => stop("LIFETIME_TIMEOUT"), LIMITS.lifetime);
  signal.addEventListener("abort", abort, { once: true });
  pool.on("error", () => stop("POOL_ERROR"));
  const facade = Object.freeze({ connect, query });
  return Object.freeze({ getPool: () => { active(); return facade; }, query, withTransaction, close });
}
