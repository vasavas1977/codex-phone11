import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootCertificates } from "node:tls";
import { createRequire } from "node:module";

const state = vi.hoisted(() => ({
  configs: [] as Record<string, any>[], authOptions: [] as Record<string, any>[], native: false, failConstruction: false,
  JsClient: class {}, NativeClient: class {},
  end: vi.fn(), query: vi.fn(), connect: vi.fn(), on: vi.fn(),
}));
vi.mock("better-auth", () => ({ betterAuth: (options: Record<string, any>) => { state.authOptions.push(options); return {}; } }));
vi.mock("pg/lib/client.js", () => ({ default: state.JsClient }));
vi.mock("pg", () => ({ default: {
  get Client() { return state.native ? state.NativeClient : state.JsClient; },
  Pool: class {
    constructor(config: Record<string, any>) {
      if (state.failConstruction) throw new Error("PRIVATE_CONSTRUCTOR_PASSWORD");
      state.configs.push(config);
    }
    on = state.on;
    end = state.end;
    query = state.query;
    connect = state.connect;
  },
} }));
const require = createRequire(import.meta.url);
// Actual vendor parameter/startup projection, no connection or SQL execution.
const ActualJsClient = require("pg/lib/client.js");
const input = () => ({ host: "postgres", port: 5432, database: "phone11ai", user: "phone11_retained_runtime", password: "PRIVATE_TEST_PASSWORD", tlsCaPem: rootCertificates[0] });
const load = () => import("../server/pbx/db");
function finite(error: unknown, code: string) {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(code);
  expect(error).not.toHaveProperty("cause");
  expect(JSON.stringify(error)).not.toMatch(/PRIVATE|postgres|BEGIN CERTIFICATE|SELECT|password/i);
}
beforeEach(() => {
  vi.resetModules();
  state.configs.length = 0; state.authOptions.length = 0; state.native = false; state.failConstruction = false;
  state.end.mockReset().mockResolvedValue(undefined);
  state.query.mockReset().mockResolvedValue({ rows: [] });
  state.connect.mockReset(); state.on.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("opt-in owned PBX pool", () => {
  it("keeps the unconfigured legacy discrete settings/SSL behavior and refuses owned close", async () => {
    vi.stubEnv("PG_CONNECTION_STRING", undefined); vi.stubEnv("DATABASE_URL", undefined);
    for (const [k, v] of Object.entries({ HOST: "legacy.invalid", PORT: "5440", DATABASE: "legacy", USER: "legacy", PASSWORD: "PRIVATE_LEGACY", SSL: "false" })) vi.stubEnv(`PG_${k}`, v);
    const db = await load(); const pool = db.getPool(); expect(db.getPool()).toBe(pool);
    expect(state.configs[0]).toMatchObject({ host: "legacy.invalid", port: 5440, database: "legacy", user: "legacy", ssl: false, max: 20 });
    await expect(db.closeOwnedPbxPool()).rejects.toThrow("PBX_OWNED_POOL_NOT_CONFIGURED");
    expect(db.getPool()).toBe(pool); expect(state.end).not.toHaveBeenCalled();
  });

  it("captures explicit TLS/timeouts/search path and ignores ambient URL/SSL/options/application/replication", async () => {
    for (const key of ["PG_CONNECTION_STRING", "DATABASE_URL", "PG_HOST", "PGHOST", "PG_USER", "PGUSER", "PG_PASSWORD", "PGPASSWORD", "PG_DATABASE", "PGDATABASE", "DB_SSL", "PG_SSL", "PGSSLMODE", "PGOPTIONS", "PGAPPNAME", "PGCLIENT_ENCODING", "PGREPLICATION"]) vi.stubEnv(key, "PRIVATE_AMBIENT");
    const db = await load(); const binding = input(); db.configureOwnedPbxPool(binding);
    expect(state.configs).toHaveLength(0);
    binding.host = "mutated.invalid"; binding.password = "PRIVATE_MUTATED"; binding.tlsCaPem = "PRIVATE_MUTATED";
    const pool = db.getPool(); expect(db.getPool()).toBe(pool); expect(state.configs).toHaveLength(1);
    const c = state.configs[0];
    expect(c).toMatchObject({ host: "postgres", user: "phone11_retained_runtime", database: "phone11ai", port: 5432, password: "PRIVATE_TEST_PASSWORD",
      max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15000, query_timeout: 10000, statement_timeout: 10000, lock_timeout: 3000,
      idle_in_transaction_session_timeout: 15000, application_name: "phone11_retained_runtime", client_encoding: "UTF8", replication: "false", Client: state.JsClient });
    expect(c).not.toHaveProperty("connectionString"); expect(c.ssl.ca).toBe(rootCertificates[0]); expect(c.ssl.rejectUnauthorized).toBe(true);
    expect(c.options).toBe("-c search_path=pg_catalog,public,pg_temp -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000");
    expect(c.ssl.checkServerIdentity("localhost", { subjectaltname: "DNS:postgres" })).toBeUndefined();
    expect(c.ssl.checkServerIdentity("other", { subjectaltname: "DNS:other" })).toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    const actual = new ActualJsClient(c);
    expect(actual.connectionParameters).toMatchObject({ host: "postgres", port: 5432, user: "phone11_retained_runtime", database: "phone11ai", application_name: "phone11_retained_runtime", replication: "false", client_encoding: "UTF8" });
    expect(actual.getStartupConf()).toMatchObject({ application_name: "phone11_retained_runtime", replication: "false", statement_timeout: "10000", lock_timeout: "3000", idle_in_transaction_session_timeout: "15000", options: c.options });
    await db.closeOwnedPbxPool();
  });

  it("pins IPv4 SAN checks to the supplied host instead of driver's reported hostname", async () => {
    const db = await load(); db.configureOwnedPbxPool({ ...input(), host: "127.0.0.1" }); db.getPool();
    const ssl = state.configs[0].ssl;
    expect(ssl.checkServerIdentity("localhost", { subjectaltname: "IP Address:127.0.0.1" })).toBeUndefined();
    expect(ssl.checkServerIdentity("localhost", { subjectaltname: "DNS:localhost" })).toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    await db.closeOwnedPbxPool();
  });

  it.each([
    ["host", ""], ["host", "/run/postgresql"], ["host", "postgres://other"], ["host", "::1"], ["host", "999.1.1.1"], ["host", "host option"],
    ["port", "5432"], ["port", 0], ["port", 65536], ["port", 5432.1], ["database", "public; DROP"], ["user", "role\n"],
    ["password", ""], ["password", "x\0y"], ["password", "x".repeat(1025)], ["tlsCaPem", ""], ["tlsCaPem", "-----BEGIN CERTIFICATE-----\nBAD\n-----END CERTIFICATE-----"],
    ["tlsCaPem", `${rootCertificates[0]}\nPRIVATE_TRAILING`], ["tlsCaPem", "x".repeat(65537)],
  ])("rejects invalid %s input before any pool construction (case %#)", async (key, value) => {
    const db = await load();
    try { db.configureOwnedPbxPool({ ...input(), [key]: value } as any); throw Error("ACCEPTED"); }
    catch (error) { finite(error, "PBX_OWNED_POOL_BINDING_REFUSED"); }
    expect(state.configs).toHaveLength(0);
  });

  it("rejects unknown fields, non-data properties and repeated/conflicting bindings", async () => {
    const db = await load();
    expect(() => db.configureOwnedPbxPool({ ...input(), ssl: false } as any)).toThrow("PBX_OWNED_POOL_BINDING_REFUSED");
    const accessor = { ...input(), get password() { throw Error("PRIVATE_GETTER"); } };
    expect(() => db.configureOwnedPbxPool(accessor)).toThrow("PBX_OWNED_POOL_BINDING_REFUSED");
    db.configureOwnedPbxPool(input());
    expect(() => db.configureOwnedPbxPool(input())).toThrow("PBX_OWNED_POOL_BINDING_REFUSED");
    expect(() => db.configureOwnedPbxPool({ ...input(), user: "other" })).toThrow("PBX_OWNED_POOL_BINDING_REFUSED");
    expect(state.configs).toHaveLength(0); await db.closeOwnedPbxPool();
  });

  it("rejects late binding after even a failed legacy getPool attempt", async () => {
    for (const key of ["PG_CONNECTION_STRING", "DATABASE_URL", "PG_HOST", "DB_HOST", "POSTGRES_HOST", "PG_USER", "DB_USER", "POSTGRES_USER", "PG_PASSWORD", "DB_PASSWORD", "POSTGRES_PASSWORD", "PG_DATABASE", "DB_NAME", "DB_DATABASE", "POSTGRES_DB"]) vi.stubEnv(key, undefined);
    const db = await load(); expect(() => db.getPool()).toThrow(/Missing required database settings/);
    expect(() => db.configureOwnedPbxPool(input())).toThrow("PBX_OWNED_POOL_BINDING_REFUSED"); expect(state.configs).toHaveLength(0);
  });

  it("uses one graph pool across queries/transactions and closes it once after explicit drain", async () => {
    const events: string[] = []; const client = { query: vi.fn(async (sql: string) => { events.push(sql); return { rows: [] }; }), release: vi.fn(() => events.push("RELEASE")) };
    state.connect.mockResolvedValue(client); state.end.mockImplementation(async () => { events.push("END"); });
    const db = await load(); db.configureOwnedPbxPool(input()); const pool = db.getPool();
    await db.query("SELECT 1"); await db.withTransaction(async c => { expect(c).toBe(client); await c.query("SELECT 2"); });
    const closing = db.closeOwnedPbxPool(); expect(db.closeOwnedPbxPool()).toBe(closing);
    expect(() => db.getPool()).toThrow("PBX_OWNED_POOL_UNAVAILABLE"); await closing;
    expect(events).toEqual(["BEGIN", "SELECT 2", "COMMIT", "RELEASE", "END"]); expect(state.configs).toHaveLength(1); expect(state.end).toHaveBeenCalledOnce();
    expect(pool).toBeDefined(); await expect(db.query("SELECT 3")).rejects.toThrow("PBX_OWNED_POOL_UNAVAILABLE");
    expect(() => db.configureOwnedPbxPool(input())).toThrow("PBX_OWNED_POOL_BINDING_REFUSED");
  });

  it("actual getPhone11Auth constructs both auth instances around this same owned graph pool", async () => {
    // Only the vendor constructor is inert here; the maintained getter/options
    // path is actual. This proves wiring, not database/schema/auth execution.
    vi.stubEnv("PHONE11_AUTH_BASE_URL", "https://auth.example.invalid");
    vi.stubEnv("PHONE11_AUTH_SECRET", "PRIVATE_SYNTHETIC_AUTH_SECRET_32_BYTES");
    vi.stubEnv("PHONE11_AUTH_TRUSTED_ORIGINS", "");
    for (const key of ["PHONE11_PASSWORD_RESET_PROVIDER", "PHONE11_PASSWORD_RESET_RESEND_API_KEY", "PHONE11_PASSWORD_RESET_FROM"]) vi.stubEnv(key, undefined);
    const db = await load(); db.configureOwnedPbxPool(input());
    const auth = await import("../server/_core/phone11-auth");
    const service = auth.getPhone11Auth(); expect(auth.getPhone11Auth()).toBe(service);
    expect(state.authOptions).toHaveLength(2); expect(state.configs).toHaveLength(1);
    for (const options of state.authOptions) expect(options.database).toBe(db.getPool());
    await db.closeOwnedPbxPool(); expect(state.end).toHaveBeenCalledOnce();
    expect(() => db.getPool()).toThrow("PBX_OWNED_POOL_UNAVAILABLE");
  });

  it("permanently closes before first use without constructing a pool", async () => {
    const db = await load(); db.configureOwnedPbxPool(input()); const closing = db.closeOwnedPbxPool(); await closing;
    expect(db.closeOwnedPbxPool()).toBe(closing); expect(() => db.getPool()).toThrow("PBX_OWNED_POOL_UNAVAILABLE");
    expect(state.end).not.toHaveBeenCalled(); expect(state.configs).toHaveLength(0);
  });

  it("retains one pending closure and sanitizes failure without retry or resurrection", async () => {
    let rejectEnd!: (error: Error) => void;
    state.end.mockImplementation(() => new Promise((_resolve, reject) => { rejectEnd = reject; }));
    const db = await load(); db.configureOwnedPbxPool(input()); db.getPool(); const closing = db.closeOwnedPbxPool();
    await Promise.resolve(); expect(db.closeOwnedPbxPool()).toBe(closing); expect(() => db.getPool()).toThrow("PBX_OWNED_POOL_UNAVAILABLE");
    rejectEnd(Error("PRIVATE_END_PASSWORD")); finite(await closing.catch(e => e), "PBX_OWNED_POOL_CLOSE_UNCONFIRMED");
    expect(db.closeOwnedPbxPool()).toBe(closing); expect(state.end).toHaveBeenCalledOnce(); expect(state.configs).toHaveLength(1);
  });

  it("refuses native transport or constructor failure finitely and never retries strict creation", async () => {
    const db = await load(); db.configureOwnedPbxPool(input()); state.native = true;
    try { db.getPool(); } catch (error) { finite(error, "PBX_OWNED_POOL_UNAVAILABLE"); }
    state.native = false; expect(() => db.getPool()).toThrow("PBX_OWNED_POOL_UNAVAILABLE"); expect(state.configs).toHaveLength(0);
    await db.closeOwnedPbxPool(); expect(state.end).not.toHaveBeenCalled();
    vi.resetModules(); const other = await load(); other.configureOwnedPbxPool(input()); state.failConstruction = true;
    expect(() => other.getPool()).toThrow("PBX_OWNED_POOL_UNAVAILABLE"); state.failConstruction = false;
    expect(() => other.getPool()).toThrow("PBX_OWNED_POOL_UNAVAILABLE"); expect(state.configs).toHaveLength(0); await other.closeOwnedPbxPool();
  });

  it("logs no binding or driver detail on owned configuration/close/pool-error paths", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = await load(); db.configureOwnedPbxPool(input()); db.getPool();
    state.on.mock.calls[0][1](Error("PRIVATE_ASYNC_PASSWORD")); state.end.mockRejectedValue(Error("PRIVATE_END_PASSWORD"));
    await expect(db.closeOwnedPbxPool()).rejects.toThrow("PBX_OWNED_POOL_CLOSE_UNCONFIRMED");
    expect(log.mock.calls).toEqual([["[PBX DB] Pool error"]]);
  });

  it("omits query text and raw errors from strict-path slow/error logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(600).mockReturnValue(600);
    const db = await load(); db.configureOwnedPbxPool(input());
    await db.query("SELECT 'PRIVATE_SQL_LITERAL'"); expect(warn.mock.calls).toEqual([["[PBX DB] Slow query (600ms)"]]);
    state.query.mockRejectedValue(Error("PRIVATE_DRIVER_DETAIL"));
    await expect(db.query("SELECT 'PRIVATE_SQL_LITERAL'")).rejects.toThrow("PRIVATE_DRIVER_DETAIL");
    expect(error.mock.calls).toEqual([["[PBX DB] Query error"]]); await db.closeOwnedPbxPool();
  });
});
