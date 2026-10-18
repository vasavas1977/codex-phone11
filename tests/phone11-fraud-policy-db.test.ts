import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

// The only transport is a mocked dedicated pg pool. No shared DB import, service,
// real login or network connection is used by this suite.
const f = vi.hoisted(() => ({
  events: [] as string[], configs: [] as Record<string, any>[], releases: [] as unknown[],
  row: {} as Record<string, unknown>, fail: "", connect: vi.fn(), query: vi.fn(), end: vi.fn(),
  forceNative: false, JsClient: class {}, NativeClient: class {},
}));
vi.mock("pg/lib/client.js", () => ({ default: f.JsClient }));
vi.mock("pg", () => ({ default: { get Client() { return f.forceNative ? f.NativeClient : f.JsClient; }, Pool: class {
  constructor(config: Record<string, any>) { f.configs.push(config); }
  on() {}
  connect = f.connect;
  end = f.end;
} } }));
// A privileged pool must never even be imported by this adapter.
vi.mock("../server/pbx/db", () => { throw new Error("PRIVILEGED_FALLBACK_FORBIDDEN"); });

const valid: Record<string, string> = {
  HOST: "db.example.invalid", PORT: "5432", DATABASE: "phone11", USER: "phone11_runtime", PASSWORD: "PRIVATE_PASSWORD",
  SCHEMA: "phone11_policy", TENANT_ID: "7", ROLE_OID: "101", SCHEMA_OID: "102", HELPER_OID: "103",
  HELPER_OWNER: "phone11_lock", HELPER_OWNER_OID: "104", HELPER_SHA256: "a".repeat(64), SERVER_MAJOR: "17",
  FRAUD_OID: "105", AUDIT_OID: "106", AUDIT_SEQUENCE_OID: "107",
};
const safeRow = () => ({
  database_name: "phone11", session_name: "phone11_runtime", current_name: "phone11_runtime",
  role_oid: "101", schema_oid: "102", helper_oid: "103", helper_owner_oid: "104", helper_owner: "phone11_lock",
  helper_sha256: "a".repeat(64), server_major: "17", role_safe: true, owner_safe: true,
  authority_safe: true, helper_safe: true, storage_safe: true,
});
function setConfig(overrides: Record<string, string | undefined> = {}) {
  for (const key of [...Object.keys(valid), "GENERATED_LAB", "TLS_CA_PEM"]) {
    vi.stubEnv(`PHONE11_FRAUD_${key}`, key in overrides ? overrides[key] : valid[key]);
  }
}
const load = () => import("../server/pbx/fraud-policy-db");
function publicError(error: unknown) {
  expect(error).toMatchObject({ code: "FRAUD_POLICY_UNAVAILABLE", message: "Fraud controls are unavailable" });
  expect(JSON.stringify(error)).not.toMatch(/PRIVATE_|db\.example|SELECT|password|cause/i);
  expect((error as Error).message).not.toContain("PRIVATE_");
  expect(error).not.toHaveProperty("cause");
}
beforeEach(() => {
  vi.resetModules();
  Object.assign(f, { events: [], configs: [], releases: [], row: safeRow(), fail: "", forceNative: false });
  setConfig();
  vi.stubEnv("PG_CONNECTION_STRING", "postgres://PRIVATE_SHARED@invalid.invalid/private");
  vi.stubEnv("DATABASE_URL", "postgres://PRIVATE_SHARED@invalid.invalid/private");
  vi.stubEnv("PGOPTIONS", "-c search_path=PRIVATE_SCHEMA");
  f.end.mockReset().mockImplementation(async () => { f.events.push("END"); });
  f.query.mockReset().mockImplementation(async (sql: string) => {
    const phase = sql.startsWith("BEGIN") ? "BEGIN" : sql.startsWith("SET LOCAL search_path") ? "PATH"
      : sql.startsWith("SET LOCAL statement_timeout") ? "TIMEOUTS" : sql.startsWith("SELECT\n") ? "ATTEST" : sql;
    f.events.push(phase);
    if (f.fail.split(",").includes(phase)) throw new Error(`PRIVATE_${phase}_ERROR`);
    return { rows: phase === "ATTEST" ? [f.row] : [], rowCount: phase === "ATTEST" ? 1 : 0 };
  });
  f.connect.mockReset().mockImplementation(async () => {
    f.events.push("CONNECT");
    if (f.fail === "CONNECT") throw new Error("PRIVATE_PASSWORD_CONNECT");
    return { query: f.query, release: (destroy: unknown) => {
      f.events.push("RELEASE"); f.releases.push(destroy);
      if (f.fail.split(",").includes("RELEASE")) throw new Error("PRIVATE_RELEASE");
    } };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("fixed-tenant fraud configuration", () => {
  it("refuses ambient native-driver selection before any credential-bearing pool or connection", async () => {
    vi.stubEnv("NODE_PG_FORCE_NATIVE", "1"); f.forceNative = true;
    const adapter = await load();
    publicError(await adapter.withFraudPolicyTransaction(7, async () => 1).catch(error => error));
    expect(f.configs).toEqual([]); expect(f.connect).not.toHaveBeenCalled();
  });
  it("binds the explicit JS Client into the normal dedicated pool", async () => {
    await (await load()).withFraudPolicyTransaction(7, async () => 1);
    expect(f.configs[0].Client).toBe(f.JsClient);
  });
  it("reports configuration-only availability without opening a connection", async () => {
    const adapter = await load();
    expect(adapter.getFraudPolicyBindingStatus(7)).toEqual({ available: true });
    expect(adapter.getFraudPolicyBindingStatus(8)).toEqual({ available: false });
    expect(adapter.getFraudPolicyBindingStatus(Number.NaN)).toEqual({ available: false });
    expect(f.configs).toEqual([]); expect(f.connect).not.toHaveBeenCalled();
  });
  it.each(Object.keys(valid))("requires dedicated %s with no shared fallback", async key => {
    setConfig({ [key]: undefined });
    const adapter = await load();
    expect(adapter.getFraudPolicyBindingStatus(7)).toEqual({ available: false });
    publicError(await adapter.withFraudPolicyTransaction(7, async () => 1).catch(error => error));
    expect(f.configs).toEqual([]); expect(f.connect).not.toHaveBeenCalled();
  });
  it.each([
    ["HOST", "postgres://db.example.invalid"], ["HOST", "/tmp/postgres"], ["HOST", "host options=-c"],
    ["PORT", "5432tail"], ["PORT", "0"], ["PORT", "65536"], ["TENANT_ID", "7.0"], ["TENANT_ID", "2147483648"],
    ["SCHEMA", 'safe"; SET ROLE root'], ["SCHEMA", "pg_catalog"], ["DATABASE", "information_schema"],
    ["ROLE_OID", "101 OR true"], ["ROLE_OID", "0"], ["HELPER_SHA256", "a".repeat(63)],
    ["SERVER_MAJOR", "15"], ["HELPER_OWNER", "phone11_runtime"], ["HELPER_OWNER_OID", "101"],
    ["AUDIT_OID", "105"], ["GENERATED_LAB", "true"], ["GENERATED_LAB", "1"], ["TLS_CA_PEM", "not a CA"],
  ])("fails closed on invalid %s=%s", async (key, value) => {
    setConfig({ [key]: value }); const adapter = await load();
    expect(adapter.getFraudPolicyBindingStatus(7)).toEqual({ available: false });
    expect(f.configs).toEqual([]);
  });
  it("uses explicit discrete credentials, bounded pool and verified TLS", async () => {
    await (await load()).withFraudPolicyTransaction(7, async () => "ok");
    expect(f.configs).toHaveLength(1);
    expect(f.configs[0]).toMatchObject({ host: "db.example.invalid", port: 5432, database: "phone11", user: "phone11_runtime",
      password: "PRIVATE_PASSWORD", ssl: { rejectUnauthorized: true }, max: 2,
      connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 10000, lock_timeout: 3000,
      idle_in_transaction_session_timeout: 15000 });
    expect(f.configs[0]).not.toHaveProperty("connectionString");
    // Inspect the real installed driver's option resolver without opening a
    // transport: pg treats options:'' as absent and would inherit PGOPTIONS.
    const ConnectionParameters = createRequire(import.meta.url)("pg/lib/connection-parameters");
    const resolved = new ConnectionParameters(f.configs[0]);
    expect(resolved.options).toBe("-c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000");
    expect(resolved.options).not.toContain("PRIVATE_SCHEMA");
  });
  it("allows no TLS only on the explicitly generated exact loopback lab", async () => {
    setConfig({ GENERATED_LAB: "1", HOST: "127.0.0.1", DATABASE: "phone11_pbx_test" });
    f.row.database_name = "phone11_pbx_test";
    await (await load()).withFraudPolicyTransaction(7, async () => 1);
    expect(f.configs[0].ssl).toBe(false);
  });
  it.each([
    ["127.0.0.1", "IP Address:127.0.0.1", "DNS:localhost"],
    ["db.example.invalid", "DNS:db.example.invalid", "DNS:other.example.invalid"],
  ])("verifies certificate SAN against configured %s even if the driver reports localhost", async (host, matchingSan, wrongSan) => {
    setConfig({ HOST: host });
    await (await load()).withFraudPolicyTransaction(7, async () => 1);
    const ssl = f.configs[0].ssl;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.checkServerIdentity).toBeTypeOf("function");
    expect(ssl.checkServerIdentity("localhost", { subjectaltname: matchingSan })).toBeUndefined();
    expect(ssl.checkServerIdentity(host, { subjectaltname: wrongSan })).toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    // A driver-supplied name matching the wrong certificate cannot redirect trust.
    expect(ssl.checkServerIdentity("other.example.invalid", { subjectaltname: wrongSan })).toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  });
  it("refuses unsupported IPv6 literal bindings before any connection", async () => {
    setConfig({ HOST: "::1" });
    expect((await load()).getFraudPolicyBindingStatus(7)).toEqual({ available: false });
    expect(f.configs).toEqual([]);
    expect(f.connect).not.toHaveBeenCalled();
  });
  it.each(["localhost", "::1", "127.0.0.2"])("refuses lab exception for %s", async host => {
    setConfig({ GENERATED_LAB: "1", HOST: host, DATABASE: "phone11_pbx_test" });
    expect((await load()).getFraudPolicyBindingStatus(7)).toEqual({ available: false });
  });
  it("fails closed after configuration changes until an explicit drained close", async () => {
    const adapter = await load();
    await adapter.withFraudPolicyTransaction(7, async () => 1);
    vi.stubEnv("PHONE11_FRAUD_PASSWORD", "PRIVATE_NEW_PASSWORD");
    expect(adapter.getFraudPolicyBindingStatus(7)).toEqual({ available: false });
    publicError(await adapter.withFraudPolicyTransaction(7, async () => 1).catch(error => error));
    vi.stubEnv("PHONE11_FRAUD_PASSWORD", valid.PASSWORD);
    expect(adapter.getFraudPolicyBindingStatus(7)).toEqual({ available: false });
    await adapter.closeFraudPolicyPool();
    expect(adapter.getFraudPolicyBindingStatus(7)).toEqual({ available: true });
    expect(f.end).toHaveBeenCalledOnce();
  });
});

describe("per-lease identity, authority and helper attestation", () => {
  it.each([
    ["database_name", "other"], ["session_name", "root"], ["current_name", "root"], ["role_oid", "999"],
    ["schema_oid", "999"], ["helper_oid", "999"], ["helper_owner_oid", "999"], ["helper_owner", "root"],
    ["helper_sha256", "b".repeat(64)], ["server_major", "16"], ["role_safe", false], ["owner_safe", false],
    ["authority_safe", false], ["helper_safe", false], ["storage_safe", false], ["role_safe", "true"],
  ])("rejects %s drift before exposing the client", async (key, value) => {
    f.row[key] = value; const callback = vi.fn();
    publicError(await (await load()).withFraudPolicyTransaction(7, callback).catch(error => error));
    expect(callback).not.toHaveBeenCalled();
    expect(f.events).toEqual(["CONNECT", "BEGIN", "PATH", "TIMEOUTS", "ATTEST", "ROLLBACK", "RELEASE"]);
    expect(f.releases).toEqual([true]);
  });
  it("attests every lease even when the config and pool are cached", async () => {
    const adapter = await load(); await adapter.withFraudPolicyTransaction(7, async () => 1);
    f.row.current_name = "root";
    publicError(await adapter.withFraudPolicyTransaction(7, async () => 2).catch(error => error));
    expect(f.configs).toHaveLength(1); expect(f.events.filter(phase => phase === "ATTEST")).toHaveLength(2);
  });
  it("checks safe role attributes, memberships, ownership, helper ABI/hash/ACL and pinned storage", async () => {
    await (await load()).withFraudPolicyTransaction(7, async () => 1);
    const sql = f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT\n"))![0];
    for (const check of ["NOT r.rolsuper", "NOT r.rolbypassrls", "NOT r.rolcreaterole", "NOT r.rolcreatedb",
      "NOT r.rolreplication", "NOT r.rolinherit", "r.rolconfig IS NULL", "pg_auth_members", "pg_shdepend",
      "has_schema_privilege", "has_database_privilege", "p.prosecdef", "p.proargtypes[0]", "p.proconfig=ARRAY",
      "aclexplode", "pg_catalog.sha256", "f.relforcerowsecurity", "a.relforcerowsecurity"])
      expect(sql).toContain(check);
    expect(sql).not.toMatch(/current_setting\('phone11\.|SET ROLE/);
  });
  it("pins a safely quoted path and uses only the selected tenant binding", async () => {
    const adapter = await load();
    publicError(await adapter.withFraudPolicyTransaction(8, async () => 1).catch(error => error));
    expect(f.events).toEqual([]);
    await adapter.withFraudPolicyTransaction(7, async () => 1);
    expect(f.query.mock.calls[1][0]).toBe('SET LOCAL search_path = pg_catalog, "phone11_policy", pg_temp');
    expect(f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT\n"))![1])
      .toEqual(["phone11_policy", "103", "phone11_runtime", "105", "106", "107"]);
  });
});

describe("dedicated transaction lifecycle", () => {
  it("uses one typed leased client for callback statements, commit and release", async () => {
    const result = await (await load()).withFraudPolicyTransaction(7, async client => {
      expect(client.query).toBe(f.query);
      await client.query("ACTOR_LOCK"); await client.query("DML"); await client.query("AUDIT"); return "committed";
    });
    expect(result).toBe("committed");
    expect(f.events).toEqual(["CONNECT", "BEGIN", "PATH", "TIMEOUTS", "ATTEST", "ACTOR_LOCK", "DML", "AUDIT", "COMMIT", "RELEASE"]);
    expect(f.releases).toEqual([false]);
  });
  it("preserves callback errors only after confirmed same-client rollback and release", async () => {
    const denied = new Error("public denial");
    const result = await (await load()).withFraudPolicyTransaction(7, async () => { throw denied; }).catch(error => error);
    expect(result).toBe(denied);
    expect(f.events.slice(-2)).toEqual(["ROLLBACK", "RELEASE"]); expect(f.releases).toEqual([false]);
    expect(f.events).not.toContain("COMMIT");
  });
  it.each(["CONNECT", "BEGIN", "PATH", "TIMEOUTS", "ATTEST", "COMMIT", "COMMIT,ROLLBACK", "RELEASE"])
    ("sanitizes %s transport/lifecycle failure", async failure => {
      f.fail = failure;
      publicError(await (await load()).withFraudPolicyTransaction(7, async () => "not returned").catch(error => error));
      expect(f.events.filter(phase => phase === "RELEASE")).toHaveLength(failure === "CONNECT" ? 0 : 1);
      if (failure === "RELEASE") expect(f.events).not.toContain("ROLLBACK");
    });
  it.each(["ROLLBACK", "RELEASE", "ROLLBACK,RELEASE"])("sanitizes a callback error when %s also fails", async failure => {
    f.fail = failure;
    publicError(await (await load()).withFraudPolicyTransaction(7, async () => { throw new Error("PRIVATE_CALLBACK"); }).catch(error => error));
    expect(f.events.slice(-2)).toEqual(["ROLLBACK", "RELEASE"]);
  });
  it("rejects shutdown during a lease and permits drained shutdown", async () => {
    const adapter = await load();
    await adapter.withFraudPolicyTransaction(7, async () => {
      publicError(await adapter.closeFraudPolicyPool().catch(error => error));
    });
    expect(f.end).not.toHaveBeenCalled(); await adapter.closeFraudPolicyPool(); expect(f.end).toHaveBeenCalledOnce();
  });
});
