import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../server/pbx/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
// eslint-disable-next-line import/first
import { decodeReadiness, readPbxDatabaseReadiness, readinessServerAddress, READINESS_SQL, READINESS_TABLES } from "../server/pbx/database-readiness";

const flags = () => ({ databaseMatch: true, serverMatch: true, versionMatch: true, schemaMatch: true, readOnly: true, repeatableRead: true, roleIsLogin: true, sessionMatchesConnectionUser: true, loginCanLogin: true, loginSuperuser: false, loginCreateRole: false, loginCreateDb: false, loginReplication: false, loginBypassRls: false, currentSuperuser: false, currentCreateRole: false, currentCreateDb: false, currentReplication: false, currentBypassRls: false, databaseConnect: true, schemaUsage: true, schemaCreate: false, tables: Object.fromEntries(READINESS_TABLES.map(t => [t, { present: true, select: true, insert: false, update: false, delete: false }])) });
function fixture() {
  const c = Object.assign(new EventEmitter(), {
    user: "PRIVATE_STARTUP_ROLE",
    release: vi.fn(),
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === READINESS_SQL) return { rows: [{ observation: flags() }] };
      if (sql.includes("FROM tenant_memberships")) return { rows: [{ role: "admin" }] };
      return { rows: [] };
    }),
  });
  const connect = vi.fn(async () => c as unknown as PoolClient);
  return { c, connect, dependencies: { pool: { connect } as unknown as Pick<Pool, "connect">, serverAddress: "172.18.0.4" } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("app-owned PBX connection observation", () => {
  it("requires commissioned server-side address with no fabricated fallback", async () => {
    expect(readinessServerAddress({})).toBeUndefined();
    expect(readinessServerAddress({ PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS: "bad" })).toBeUndefined();
    vi.stubEnv("PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS", "");
    const f = fixture();
    await expect(readPbxDatabaseReadiness(9, 7, { pool: f.dependencies.pool })).resolves.toEqual({ status: "unavailable", reason: "NOT_COMMISSIONED" });
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.c.query).toHaveBeenCalledTimes(1);
    expect(f.c.query.mock.calls[0][0]).toContain("FROM tenant_memberships");
    expect(f.c.release).toHaveBeenCalledWith(undefined);
  });
  it.each(["revoked", "non-admin"])("denies missing-config observations to %s users", async () => {
    vi.stubEnv("PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS", "");
    const f = fixture(); f.c.query.mockResolvedValue({ rows: [] });
      await expect(readPbxDatabaseReadiness(9, 7, { pool: f.dependencies.pool })).resolves.toEqual({ status: "forbidden" });
      expect(f.c.query).toHaveBeenCalledTimes(1);
      expect(f.c.query.mock.calls[0][0]).toContain("tm.role::text IN ('owner', 'admin')");
      expect(f.c.query.mock.calls[0][0]).not.toBe(READINESS_SQL);
  });
  it("bounds missing-config checkout and destroys a late arrival without SQL", async () => {
    vi.useFakeTimers(); vi.stubEnv("PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS", "");
    const f = fixture(); let arrive!: (c: PoolClient) => void;
    f.connect.mockImplementation(() => new Promise(resolve => { arrive = resolve; }));
    const pending = readPbxDatabaseReadiness(9, 7, { pool: f.dependencies.pool });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toEqual({ status: "unavailable", reason: "OBSERVATION_FAILED" });
    arrive(f.c as unknown as PoolClient); await Promise.resolve(); await Promise.resolve();
    expect(f.c.query).not.toHaveBeenCalled(); expect(f.c.release).toHaveBeenCalledTimes(1);
    expect(f.c.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
  it("bounds initial live authority even with missing commissioning configuration", async () => {
    vi.useFakeTimers(); vi.stubEnv("PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS", "");
    const f = fixture(); let finish!: (value: { rows: { role: string }[] }) => void;
    f.c.query.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = readPbxDatabaseReadiness(9, 7, { pool: f.dependencies.pool });
    await vi.advanceTimersByTimeAsync(45000);
    await expect(pending).resolves.toEqual({ status: "unavailable", reason: "OBSERVATION_FAILED" });
    finish({ rows: [{ role: "admin" }] }); await Promise.resolve(); await Promise.resolve();
    expect(f.c.query).toHaveBeenCalledTimes(1); expect(f.c.release).toHaveBeenCalledTimes(1);
    expect(f.c.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
  it("uses one client, fresh pre/post authority, RO transaction, rollback and healthy release", async () => {
    const f = fixture(); const result = await readPbxDatabaseReadiness(9, 7, f.dependencies);
    expect(result).toMatchObject({ status: "observed", scope: "checkedOutPbxPoolConnection", tenantId: 7 });
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.c.query.mock.calls.map(([s]) => s === READINESS_SQL ? "CATALOG" : s.includes("FROM tenant_memberships") ? "AUTHORITY" : s)).toEqual(["AUTHORITY", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='30s'", "CATALOG", "ROLLBACK", "AUTHORITY"]);
    expect(f.c.query).toHaveBeenCalledWith(READINESS_SQL, ["172.18.0.4", 16384, "160013", "PRIVATE_STARTUP_ROLE"]);
    expect(f.c.release).toHaveBeenCalledTimes(1);
    expect(f.c.release).toHaveBeenCalledWith(undefined);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("observes SET ROLE and powerful flags honestly without restricted-runtime admission", async () => {
    const f = fixture(); const v = { ...flags(), roleIsLogin: false, loginSuperuser: true, currentBypassRls: true };
    f.c.query.mockImplementation(async sql => sql === READINESS_SQL ? { rows: [{ observation: v }] } : sql.includes("FROM tenant_memberships") ? { rows: [{ role: "owner" }] } : { rows: [] });
    await expect(readPbxDatabaseReadiness(9, 7, f.dependencies)).resolves.toMatchObject({ status: "observed", observation: { roleIsLogin: false, loginSuperuser: true, currentBypassRls: true } });
  });
  it("denies revoked or inactive authority after checkout without metadata", async () => {
    const f = fixture(); f.c.query.mockResolvedValue({ rows: [] });
    await expect(readPbxDatabaseReadiness(9, 7, f.dependencies)).resolves.toEqual({ status: "forbidden" });
    expect(f.c.query).toHaveBeenCalledTimes(1); expect(f.c.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
  it("final revocation discards already computed metadata after rollback", async () => {
    const f = fixture(); let checks = 0;
    f.c.query.mockImplementation(async sql => sql.includes("FROM tenant_memberships") ? { rows: ++checks === 1 ? [{ role: "admin" }] : [] } : sql === READINESS_SQL ? { rows: [{ observation: flags() }] } : { rows: [] });
    await expect(readPbxDatabaseReadiness(9, 7, f.dependencies)).resolves.toEqual({ status: "forbidden" });
    expect(f.c.query.mock.calls.some(([s]) => s === "ROLLBACK")).toBe(true);
    expect(f.c.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
  it.each(["databaseMatch", "serverMatch", "versionMatch", "schemaMatch", "readOnly", "repeatableRead", "sessionMatchesConnectionUser", "loginCanLogin"])("refuses identity/session mismatch %s", async key => {
    const f = fixture(); const v = { ...flags(), [key]: false };
    f.c.query.mockImplementation(async sql => sql === READINESS_SQL ? { rows: [{ observation: v }] } : sql.includes("FROM tenant_memberships") ? { rows: [{ role: "admin" }] } : { rows: [] });
    await expect(readPbxDatabaseReadiness(9, 7, f.dependencies)).resolves.toEqual({ status: "unavailable", reason: "IDENTITY_MISMATCH" });
    expect(f.c.query.mock.calls.at(-1)?.[0]).toContain("FROM tenant_memberships");
  });
  it("bounds checkout and discards a late arrival without SQL", async () => {
    vi.useFakeTimers(); const f = fixture(); let arrive!: (c: PoolClient) => void;
    f.connect.mockImplementation(() => new Promise(resolve => { arrive = resolve; }));
    const pending = readPbxDatabaseReadiness(9, 7, f.dependencies);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toEqual({ status: "unavailable", reason: "OBSERVATION_FAILED" });
    arrive(f.c as unknown as PoolClient); await Promise.resolve(); await Promise.resolve();
    expect(f.c.query).not.toHaveBeenCalled(); expect(f.c.release).toHaveBeenCalledTimes(1);
    expect(f.c.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
  it("bounds pending query, destroys only borrowed client, and prevents late rollback/authority", async () => {
    vi.useFakeTimers(); const f = fixture(); let finish!: (value: { rows: { observation: ReturnType<typeof flags> }[] }) => void;
    f.c.query.mockImplementation(async sql => sql === READINESS_SQL ? await new Promise(resolve => { finish = resolve; }) : sql.includes("FROM tenant_memberships") ? { rows: [{ role: "admin" }] } : { rows: [] });
    const pending = readPbxDatabaseReadiness(9, 7, f.dependencies);
    await vi.advanceTimersByTimeAsync(45000); await expect(pending).resolves.toEqual({ status: "unavailable", reason: "OBSERVATION_FAILED" });
    finish({ rows: [{ observation: flags() }] }); await Promise.resolve(); await Promise.resolve();
    expect(f.c.query.mock.calls.some(([s]) => s === "ROLLBACK")).toBe(false);
    expect(f.c.release).toHaveBeenCalledTimes(1);
  });
  it("sanitizes query failure and broken rollback without successful release claim", async () => {
    for (const failSql of [READINESS_SQL, "ROLLBACK"]) {
      const f = fixture(); const raw = new Error("PRIVATE_DSN_PASSWORD_ROLE");
      f.c.query.mockImplementation(async sql => { if (sql === failSql) throw raw; return sql === READINESS_SQL ? { rows: [{ observation: flags() }] } : sql.includes("FROM tenant_memberships") ? { rows: [{ role: "admin" }] } : { rows: [] }; });
      const result = await readPbxDatabaseReadiness(9, 7, f.dependencies);
      expect(result).toEqual({ status: "unavailable", reason: "OBSERVATION_FAILED" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(f.c.release.mock.calls[0][0]).not.toBe(raw);
    }
  });
  it("handles socket errors without uncaught private causes", async () => {
    const f = fixture(); f.c.query.mockImplementation(async () => { f.c.emit("error", new Error("PRIVATE")); return { rows: [] }; });
    await expect(readPbxDatabaseReadiness(9, 7, f.dependencies)).resolves.toEqual({ status: "unavailable", reason: "OBSERVATION_FAILED" });
    expect(f.c.release).toHaveBeenCalledTimes(1);
  });
  it("does not accept metadata when healthy release fails and tries broken cleanup", async () => {
    const f = fixture(); f.c.release.mockImplementationOnce(() => { throw new Error("PRIVATE_RELEASE"); });
    await expect(readPbxDatabaseReadiness(9, 7, f.dependencies)).resolves.toEqual({ status: "unavailable", reason: "OBSERVATION_FAILED" });
    expect(f.c.release).toHaveBeenCalledTimes(2);
    expect(f.c.release.mock.calls[1][0]).toBeInstanceOf(Error);
  });
  it("rejects extra fields, strings, nulls and role names in output", () => {
    for (const value of [null, { ...flags(), roleName: "PRIVATE" }, { ...flags(), loginSuperuser: "false" }, { ...flags(), tables: { ...flags().tables, private_table: {} } }]) expect(() => decodeReadiness(value)).toThrow("Invalid readiness observation");
    const v = flags(); v.tables.tenants.select = null as unknown as boolean; expect(() => decodeReadiness(v)).toThrow();
    expect(READINESS_SQL).not.toMatch(/pg_authid|pg_stat_activity|COUNT\s*\(|FROM\s+public\./i);
  });
});
