import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { custodyClaim, custodyObservation } from "./fixtures/phone11-pbx-clone-custody-v2";
vi.mock("pg", () => { throw new Error("OFFLINE_PG_IMPORT_FORBIDDEN"); });
import {
  admitCloneConnectionInput, assertNoAmbientConnectionKeys, CLONE_SOCKET, CLONE_SOURCE,
  createCloneAdapterForTests, createRealPgAdapter, LIMITS, safeCloneError,
  type CloneAdapter, type TestTransportClient, type TestTransportPool,
} from "../scripts/phone11-pbx-clone/real-pg-adapter";

const H = "a1".repeat(32);
const ATTEMPT = "a1".repeat(16);
function input() {
  return {
    schema: "phone11-pbx-clone-real-pg-admission/v2", purpose: "CLONE_HANDLER_REHEARSAL", attemptId: ATTEMPT,
    target: { socketDirectory: CLONE_SOCKET, database: "phone11ai", port: 5432, sourceSystemIdentifier: "7638134557377753122", cloneSystemIdentifier: "7638134557377753123" },
    source: { candidateCommit: CLONE_SOURCE, rollbackArtifactSha256: H },
    software: { workerImageId: `sha256:${H}`, selectedManifest: `sha256:${H}`, nodeRuntimeSha256: H, nodeVersion: "22.14.0", driverBundleSha256: H },
    custody: custodyClaim(),
    role: { login: `p11_clone_runtime_${ATTEMPT}`, password: "a1".repeat(32), restrictedLoginObservationSha256: H, restricted: true, nonOwner: true, noSchemaCreate: true, noDatabaseCreate: true, noPrivilegedMembership: true },
  };
}
function token(value = input()) { return admitCloneConnectionInput(JSON.stringify(value), custodyObservation()); }
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const result = { rows: [{ value: 7 }], command: "SELECT", rowCount: 1, oid: 0, fields: [] } as pg.QueryResult;
function fixture() {
  const clientErrorListeners = new Set<(error: unknown) => void>();
  const rawQuery = vi.fn(async (_text: string, _values?: unknown[]) => result);
  const release = vi.fn();
  const raw: TestTransportClient = {
    query: rawQuery as TestTransportClient["query"], release,
    on: (_event, listener) => clientErrorListeners.add(listener),
    removeListener: (_event, listener) => clientErrorListeners.delete(listener),
  };
  let poolError!: (error: unknown) => void;
  const connect = vi.fn(async () => raw);
  const end = vi.fn(async () => {});
  const pool: TestTransportPool = { connect, end, on: (_event, listener) => { poolError = listener; } };
  const factory = vi.fn((_options: pg.PoolConfig) => pool);
  const controller = new AbortController();
  const adapter = createCloneAdapterForTests(token(), factory, controller.signal);
  return { adapter, controller, raw, rawQuery, release, connect, end, factory, clientErrorListeners, poolError: (error: unknown) => poolError(error) };
}
const adapters: CloneAdapter[] = [];
function setup() { const value = fixture(); adapters.push(value.adapter); return value; }
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  const closing = adapters.splice(0).map(adapter => adapter.close());
  await vi.advanceTimersByTimeAsync(LIMITS.close + 1);
  await Promise.all(closing); vi.useRealTimers(); vi.restoreAllMocks();
});

describe("pure clone admission (no actual driver connection)", () => {
  it("returns an opaque non-serializing token, not credentials", () => {
    const admitted = token(); expect(Object.keys(admitted)).toEqual([]); expect(JSON.stringify(admitted)).toBe("{}"); expect(Object.isFrozen(admitted)).toBe(true);
  });
  it.each(["", "{", "null", "[]", '"secret"', " ".repeat(8193)])("rejects malformed or oversized bounded input", text => {
    expect(() => admitCloneConnectionInput(text)).toThrow(/INPUT_REFUSED|ADMISSION_REFUSED/);
  });
  it.each([
    ["host", (v: ReturnType<typeof input>) => { v.target.socketDirectory = "43.210.122.111"; }],
    ["socket traversal", (v: ReturnType<typeof input>) => { v.target.socketDirectory = `${CLONE_SOCKET}/../socket`; }],
    ["database", (v: ReturnType<typeof input>) => { v.target.database = "postgres"; }],
    ["port", (v: ReturnType<typeof input>) => { v.target.port = 55443; }],
    ["source system", (v: ReturnType<typeof input>) => { v.target.sourceSystemIdentifier = "1"; }],
    ["same cluster", (v: ReturnType<typeof input>) => { v.target.cloneSystemIdentifier = v.target.sourceSystemIdentifier; }],
    ["candidate", (v: ReturnType<typeof input>) => { v.source.candidateCommit = "0".repeat(40); }],
    ["rollback unbound", (v: ReturnType<typeof input>) => { v.source.rollbackArtifactSha256 = ""; }],
    ["zero hash", (v: ReturnType<typeof input>) => { v.software.driverBundleSha256 = "0".repeat(64); }],
    ["image tag", (v: ReturnType<typeof input>) => { v.software.workerImageId = "postgres:16"; }],
    ["node unbound", (v: ReturnType<typeof input>) => { v.software.nodeVersion = ""; }],
    ["nonprivate socket", (v: ReturnType<typeof input>) => { v.custody.privateSocket = false; }],
    ["network", (v: ReturnType<typeof input>) => { v.custody.networkNone = false; }],
    ["mounts", (v: ReturnType<typeof input>) => { v.custody.noExternalMounts = false; }],
    ["role substituted", (v: ReturnType<typeof input>) => { v.role.login = "phone11ai"; }],
    ["password unset", (v: ReturnType<typeof input>) => { v.role.password = ""; }],
    ["whitespace password", (v: ReturnType<typeof input>) => { v.role.password = " ".repeat(64); }],
    ["password repeated", (v: ReturnType<typeof input>) => { v.role.password = "f".repeat(64); }],
    ["owner", (v: ReturnType<typeof input>) => { v.role.nonOwner = false; }],
    ["DDL", (v: ReturnType<typeof input>) => { v.role.noSchemaCreate = false; }],
    ["privileged", (v: ReturnType<typeof input>) => { v.role.restricted = false; }],
  ])("refuses %s before construction", (_label, mutate) => { const value = input(); mutate(value); expect(() => token(value)).toThrow("ADMISSION_REFUSED"); });
  it.each(["root", "target", "software", "custody", "source", "role"])("rejects unknown %s keys", level => {
    const value = input(); const object = level === "root" ? value : value[level as "target"];
    Object.assign(object, { connectionString: "postgres://private" });
    expect(() => token(value)).toThrow("ADMISSION_REFUSED");
  });
  it.each(["PGHOST", "PGPASSFILE", "PGOPTIONS", "DATABASE_URL", "DB_PASSWORD", "POSTGRES_SSL", "NODE_PG_FORCE_NATIVE", "NODE_OPTIONS", "NODE_PATH"])("rejects ambient %s by key without consuming values", key => {
    expect(() => assertNoAmbientConnectionKeys(["PATH", key])).toThrow("ENVIRONMENT_REFUSED");
  });
  it("allows unrelated environment names without using them", () => { expect(() => assertNoAmbientConnectionKeys(["PATH", "NODE_ENV", "TZ"])).not.toThrow(); });
  it("rejects forged token and a reused token", async () => {
    const factory = vi.fn();
    expect(() => createCloneAdapterForTests({} as never, factory, new AbortController().signal)).toThrow("ADMISSION_REFUSED"); expect(factory).not.toHaveBeenCalled();
    const value = token(); const f = setup();
    const a = createCloneAdapterForTests(value, () => ({ connect: f.connect, end: vi.fn(async () => {}), on: vi.fn() }), new AbortController().signal); adapters.push(a);
    expect(() => createCloneAdapterForTests(value, factory, new AbortController().signal)).toThrow("ADMISSION_REFUSED");
  });
  it("requires test mode for injected transport", () => {
    vi.stubEnv("NODE_ENV", "production"); const factory = vi.fn();
    try { expect(() => createCloneAdapterForTests(token(), factory, new AbortController().signal)).toThrow("RUNTIME_REFUSED"); expect(factory).not.toHaveBeenCalled(); }
    finally { vi.unstubAllEnvs(); }
  });
  it("a well-shaped synthetic input cannot import pg or activate the unbound runtime factory", async () => {
    await expect(createRealPgAdapter(token(), new AbortController().signal)).rejects.toThrow("EXECUTION_UNBOUND"); // Refuses before environment/runtime reads, driver import or a real pg.Pool constructor.
  });
  it("preaborted input does not construct a pool", () => { const c = new AbortController(); c.abort(); const factory = vi.fn(); expect(() => createCloneAdapterForTests(token(), factory, c.signal)).toThrow("CANCELLED"); expect(factory).not.toHaveBeenCalled(); });
});

describe("injected offline transport/lifecycle, not actual pg or handlers", () => {
  it("supplies all fixed connection/timeout settings without a URL/pgpass or fallbacks", async () => {
    const f = setup(); const options = f.factory.mock.calls[0][0];
    expect(options).toMatchObject({ host: CLONE_SOCKET, port: 5432, database: "phone11ai", user: input().role.login, password: input().role.password, ssl: false, max: 2, connectionTimeoutMillis: LIMITS.connect, statement_timeout: 3000, lock_timeout: 1000, idle_in_transaction_session_timeout: 5000 });
    expect(options).not.toHaveProperty("connectionString"); expect(options).not.toHaveProperty("query_timeout"); expect(options).not.toHaveProperty("log");
  });
  it("forwards SQL/parameters/results and releases once without console output", async () => {
    const f = setup(); const log = vi.spyOn(console, "log"); const warn = vi.spyOn(console, "warn"); const error = vi.spyOn(console, "error"); const params = ["sensitive", 4];
    expect(await f.adapter.query("SELECT $1, $2", params)).toBe(result);
    expect(f.rawQuery).toHaveBeenCalledWith("SELECT $1, $2", params); expect(f.release.mock.calls).toEqual([[false]]); expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it("commits and returns callback value on the same leased client", async () => {
    const f = setup(); const value = await f.adapter.withTransaction(async client => { expect(await client.query("INSERT fixed", [7])).toBe(result); return 42; });
    expect(value).toBe(42); expect(f.connect).toHaveBeenCalledTimes(1); expect(f.rawQuery.mock.calls.map(call => call[0])).toEqual(["BEGIN", "INSERT fixed", "COMMIT"]); expect(f.release.mock.calls).toEqual([[false]]);
  });
  it("rolls back handler errors and preserves exact in-memory error", async () => {
    const f = setup(); const failure = Object.assign(new Error("private SQL password"), { code: "23503", detail: "private detail" });
    await expect(f.adapter.withTransaction(async client => { await client.query("UPDATE fixed"); throw failure; })).rejects.toBe(failure);
    expect(f.rawQuery.mock.calls.map(call => call[0])).toEqual(["BEGIN", "UPDATE fixed", "ROLLBACK"]); expect(f.release.mock.calls).toEqual([[false]]);
    expect(safeCloneError(failure)).toEqual({ kind: "postgres", code: "23503" });
  });
  it("rolls back commit failure without replacing its error", async () => {
    const f = setup(); const failure = Object.assign(new Error("private"), { code: "40001" }); f.rawQuery.mockImplementation(async text => { if (text === "COMMIT") throw failure; return result; });
    await expect(f.adapter.withTransaction(async () => 7)).rejects.toBe(failure); expect(f.rawQuery.mock.calls.map(c => c[0])).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
  });
  it("destroys failed rollback while preserving the original error", async () => {
    const f = setup(); const failure = new Error("private"); f.rawQuery.mockImplementation(async text => { if (text === "ROLLBACK") throw new Error("raw rollback"); return result; });
    await expect(f.adapter.withTransaction(async () => { throw failure; })).rejects.toBe(failure); expect(f.release.mock.calls).toEqual([[true]]);
  });
  it("release is idempotent and released handles cannot query", async () => {
    const f = setup(); const client = await f.adapter.getPool().connect(); client.release(); client.release(); await expect(client.query("SELECT 1")).rejects.toThrow("CLOSED"); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it("query errors propagate in memory and still release", async () => {
    const f = setup(); const failure = Object.assign(new Error("SQL secret"), { code: "42501" }); f.rawQuery.mockRejectedValue(failure);
    await expect(f.adapter.query("private SQL")).rejects.toBe(failure); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it("refuses callback/query-config interfaces without forwarding them", async () => {
    const f = setup(); await expect(f.adapter.query({ text: "SELECT" } as never)).rejects.toThrow("QUERY_INTERFACE_REFUSED"); expect(f.rawQuery).not.toHaveBeenCalled();
  });
  it("connect deadline closes adapter; a late connection is destroyed", async () => {
    const f = setup(); const waiting = deferred<TestTransportClient>(); f.connect.mockReturnValue(waiting.promise);
    const outcome = f.adapter.query("SELECT 1").catch(safeCloneError); await vi.advanceTimersByTimeAsync(LIMITS.connect + 1);
    expect(await outcome).toEqual({ kind: "adapter", code: "CONNECT_TIMEOUT" }); waiting.resolve(f.raw); await vi.advanceTimersByTimeAsync(1);
    expect(f.release.mock.calls).toEqual([[true]]); expect(f.rawQuery).not.toHaveBeenCalled(); await expect(f.adapter.query("SELECT 2")).rejects.toThrow("CONNECT_TIMEOUT");
  });
  it("close waits for an in-flight acquisition and destroys it before reporting ended", async () => {
    const f = setup(); const waiting = deferred<TestTransportClient>(); f.connect.mockReturnValue(waiting.promise);
    const outcome = f.adapter.query("SELECT").catch(safeCloneError); await vi.advanceTimersByTimeAsync(1);
    let ended = false; const closing = f.adapter.close().then(value => { ended = true; return value; });
    await vi.advanceTimersByTimeAsync(1); expect(ended).toBe(false);
    waiting.resolve(f.raw); await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual({ kind: "adapter", code: "CLOSED" });
    expect(await closing).toEqual({ ended: true, code: "CLOSED" }); expect(f.release.mock.calls).toEqual([[true]]); expect(f.rawQuery).not.toHaveBeenCalled();
  });
  it("an unresolved acquisition cannot be laundered into successful pool shutdown", async () => {
    const f = setup(); f.connect.mockReturnValue(new Promise(() => {}));
    const outcome = f.adapter.query("SELECT").catch(safeCloneError); await vi.advanceTimersByTimeAsync(1);
    const closing = f.adapter.close(); await vi.advanceTimersByTimeAsync(LIMITS.close + 1);
    expect(await closing).toEqual({ ended: false, code: "CLOSE_TIMEOUT" }); expect(await outcome).toEqual({ kind: "adapter", code: "CLOSED" });
  });
  it("late failed release cannot claim completed pool shutdown", async () => {
    const f = setup(); const waiting = deferred<TestTransportClient>(); f.connect.mockReturnValue(waiting.promise);
    const outcome = f.adapter.query("SELECT").catch(safeCloneError); await vi.advanceTimersByTimeAsync(1);
    const closing = f.adapter.close(); f.release.mockImplementation(() => { throw new Error("private late cleanup"); }); waiting.resolve(f.raw);
    expect(await outcome).toEqual({ kind: "adapter", code: "CLOSED" }); expect(await closing).toEqual({ ended: false, code: "CLOSE_FAILED" });
  });
  it("query deadline destroys lease, never commits or reuses late results", async () => {
    const f = setup(); const waiting = deferred<pg.QueryResult>(); f.rawQuery.mockImplementation(async text => text === "BEGIN" ? result : waiting.promise);
    const outcome = f.adapter.withTransaction(async client => client.query("blocked")).catch(safeCloneError);
    await vi.advanceTimersByTimeAsync(LIMITS.query + 1); expect(await outcome).toEqual({ kind: "adapter", code: "QUERY_TIMEOUT" }); waiting.resolve(result); await vi.advanceTimersByTimeAsync(1);
    expect(f.rawQuery.mock.calls.map(c => c[0])).toEqual(["BEGIN", "blocked"]); expect(f.release.mock.calls).toEqual([[true]]);
  });
  it("bounds a stalled callback and fences late callback commit", async () => {
    const f = setup(); const waiting = deferred<number>(); const outcome = f.adapter.withTransaction(async () => waiting.promise).catch(safeCloneError);
    await vi.advanceTimersByTimeAsync(LIMITS.transaction + 1); expect(await outcome).toEqual({ kind: "adapter", code: "TRANSACTION_TIMEOUT" }); waiting.resolve(7); await vi.advanceTimersByTimeAsync(1);
    expect(f.rawQuery.mock.calls.map(c => c[0])).toEqual(["BEGIN"]); expect(f.release.mock.calls).toEqual([[true]]);
  });
  it("cancellation rejects active work and closes it without later commit", async () => {
    const f = setup(); const waiting = deferred<pg.QueryResult>(); f.rawQuery.mockReturnValue(waiting.promise);
    const outcome = f.adapter.query("private SQL").catch(safeCloneError); await vi.advanceTimersByTimeAsync(1); f.controller.abort();
    expect(await outcome).toEqual({ kind: "adapter", code: "CANCELLED" }); expect(f.release.mock.calls).toEqual([[true]]); waiting.resolve(result); await vi.advanceTimersByTimeAsync(1); expect(f.end).toHaveBeenCalledTimes(1);
  });
  it("bounds lease lifetime when a caller forgets release", async () => { const f = setup(); await f.adapter.getPool().connect(); await vi.advanceTimersByTimeAsync(LIMITS.transaction + 1); expect(f.release.mock.calls).toEqual([[true]]); expect(() => f.adapter.getPool()).toThrow("TRANSACTION_TIMEOUT"); });
  it("bounds whole adapter lifetime without connections", async () => { const f = setup(); await vi.advanceTimersByTimeAsync(LIMITS.lifetime + 1); expect(() => f.adapter.getPool()).toThrow("LIFETIME_TIMEOUT"); expect(f.end).toHaveBeenCalledTimes(1); });
  it("idle pool errors are swallowed into constant refusal, never logged", async () => { const f = setup(); const error = vi.spyOn(console, "error"); f.poolError(new Error("raw sensitive pool error")); expect(() => f.adapter.getPool()).toThrow("POOL_ERROR"); expect(error).not.toHaveBeenCalled(); });
  it("active client connection errors close the lease without emitting private details", async () => { const f = setup(); await f.adapter.getPool().connect(); for (const listener of f.clientErrorListeners) listener(new Error("private")); expect(() => f.adapter.getPool()).toThrow("POOL_ERROR"); expect(f.release.mock.calls).toEqual([[true]]); });
  it("explicit close destroys held leases, ends once and refuses subsequent use", async () => { const f = setup(); await f.adapter.getPool().connect(); const a = f.adapter.close(); const b = f.adapter.close(); expect(a).toBe(b); expect(await a).toEqual({ ended: true, code: "CLOSED" }); expect(f.end).toHaveBeenCalledTimes(1); expect(f.release.mock.calls).toEqual([[true]]); await expect(f.adapter.query("SELECT")).rejects.toThrow("CLOSED"); });
  it("reports bounded uncertain shutdown, never a cleanup success", async () => { const f = setup(); f.end.mockReturnValue(new Promise(() => {})); const closing = f.adapter.close(); await vi.advanceTimersByTimeAsync(LIMITS.close + 1); expect(await closing).toEqual({ ended: false, code: "CLOSE_TIMEOUT" }); });
  it("reports rejected pool end only as a fixed failure", async () => { const f = setup(); f.end.mockRejectedValue(new Error("private shutdown")); expect(await f.adapter.close()).toEqual({ ended: false, code: "CLOSE_FAILED" }); });
  it("does not report cleanup success if driver release throws", async () => { const f = setup(); await f.adapter.getPool().connect(); f.release.mockImplementation(() => { throw new Error("private"); }); expect(await f.adapter.close()).toEqual({ ended: false, code: "CLOSE_FAILED" }); });
  it("destroy-and-refuse if caller releases an in-flight query", async () => {
    const f = setup(); const c = await f.adapter.getPool().connect(); const waiting = deferred<pg.QueryResult>(); f.rawQuery.mockReturnValue(waiting.promise); const outcome = c.query("blocked").catch(safeCloneError); c.release();
    expect(await outcome).toEqual({ kind: "adapter", code: "UNSETTLED_QUERY" }); expect(f.release.mock.calls).toEqual([[true]]); waiting.resolve(result);
  });
  it("refuses a transaction callback that leaves an unsettled query", async () => {
    const f = setup(); const waiting = deferred<pg.QueryResult>(); let leftover!: Promise<unknown>; f.rawQuery.mockImplementation(async text => text === "leftover" ? waiting.promise : result);
    const outcome = f.adapter.withTransaction(async c => { leftover = c.query("leftover").catch(safeCloneError); return 7; }).catch(safeCloneError);
    await vi.advanceTimersByTimeAsync(1); expect(await outcome).toEqual({ kind: "adapter", code: "UNSETTLED_QUERY" }); expect(f.rawQuery.mock.calls.map(c => c[0])).not.toContain("COMMIT"); waiting.resolve(result); await leftover;
  });
});

describe("constant error output boundary", () => {
  it("does not evaluate unknown error code accessors or echo details", () => { const getter = vi.fn(() => "password"); const error = Object.defineProperty(new Error("private"), "code", { get: getter }); expect(safeCloneError(error)).toEqual({ kind: "unknown", code: "UNCLASSIFIED" }); expect(getter).not.toHaveBeenCalled(); });
  it("drops unknown codes and hostile proxies", () => { expect(safeCloneError({ code: "password", stack: "secret", detail: "SQL" })).toEqual({ kind: "unknown", code: "UNCLASSIFIED" }); expect(safeCloneError(new Proxy({}, { getPrototypeOf() { throw new Error("private"); } }))).toEqual({ kind: "unknown", code: "UNCLASSIFIED" }); });
  it("retains allowlisted handler code only", () => { expect(safeCloneError({ code: "FORBIDDEN", message: "private", cause: { password: "secret" } })).toEqual({ kind: "handler", code: "FORBIDDEN" }); });
});
