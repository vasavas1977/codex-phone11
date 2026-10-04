import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { ivrRouter } from "../server/pbx/ivr-router";

const state = vi.hoisted(() => ({
  query: vi.fn(), withTransaction: vi.fn(), cache: vi.fn(), capabilities: vi.fn(),
  memberships: [{ tenant_id: 7, role: "admin" }] as { tenant_id: number; role: string }[],
}));
vi.mock("../server/pbx/db", () => ({ query: state.query, withTransaction: state.withTransaction }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: state.cache, invalidateCache: vi.fn() }));
vi.mock("../server/pbx/schema-capabilities", () => ({ readManagementCapabilities: state.capabilities }));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: vi.fn() }));

type Caller = ReturnType<typeof ivrRouter.createCaller>;
const context = (user: { id: number } | null = { id: 9 }) => ({ user, req: { ip: "127.0.0.1", headers: {} }, res: {} }) as Parameters<typeof ivrRouter.createCaller>[0];
const reads: [string, (caller: Caller) => Promise<unknown>][] = [
  ["ring groups list", c => c.ringGroups.list({ tenant_id: 7 })],
  ["ring groups get including members", c => c.ringGroups.get({ id: 4 })],
  ["queues list", c => c.queues.list({ tenant_id: 7 })],
  ["queues get including agents", c => c.queues.get({ id: 4 })],
  ["queues stats", c => c.queues.stats({ queue_id: 4, hours: 24 })],
  ["business hours list", c => c.timeConditions.list({ tenant_id: 7 })],
  ["business hours get including rules", c => c.timeConditions.get({ id: 4 })],
];
const selectedReads: [string, (caller: Caller, tenantId: number) => Promise<unknown>][] = [
  ["ring groups", (c, tenant_id) => c.ringGroups.list({ tenant_id })],
  ["queues", (c, tenant_id) => c.queues.list({ tenant_id })],
  ["business hours", (c, tenant_id) => c.timeConditions.list({ tenant_id })],
];

beforeEach(() => {
  vi.clearAllMocks();
  state.memberships = [{ tenant_id: 7, role: "admin" }];
  state.cache.mockResolvedValue([{ userId: 9, tenantId: 7, role: "admin", tenantName: "Stale workspace", tenantStatus: "active" }]);
  state.capabilities.mockResolvedValue({ ivr: true, ringGroups: true, queues: true, businessHours: true });
  state.query.mockImplementation(async sql => ({ rows: String(sql).includes("tenant_memberships") ? state.memberships : [{ id: 4, tenant_id: 7, marker: "normal result" }] }));
});

const databaseUrl = process.env.PHONE11_ROUTING_AUTH_TEST_DATABASE_URL;
if (process.env.PHONE11_ROUTING_AUTH_REQUIRE_POSTGRES === "1" && !databaseUrl) {
  throw Error("Required disposable PostgreSQL routing read authority fixture is missing");
}
describe.skipIf(!databaseUrl)("current routing read admission on an owned disposable PostgreSQL 17", () => {
  let pool: Pool;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.protocol !== "postgres:" || url.hostname !== "127.0.0.1" || url.pathname !== "/phone11_routing_auth_test" || url.username !== "p11_routing_auth_runtime" || !url.port || !url.password || url.search || url.hash)
      throw Error("Use only the owned loopback disposable routing read authority database");
    pool = new Pool({ host: "127.0.0.1", port: Number(url.port), user: "p11_routing_auth_runtime", password: decodeURIComponent(url.password), database: "phone11_routing_auth_test", ssl: false, max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000, options: "-c search_path=p11_routing_auth_test,pg_catalog -c statement_timeout=5000 -c lock_timeout=4000" });
    const identity = await pool.query("SELECT current_database() db,current_schema() schema,current_user role,current_setting('server_version_num') version,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(identity.rows[0]).toMatchObject({ db: "phone11_routing_auth_test", schema: "p11_routing_auth_test", role: "p11_routing_auth_runtime", rolsuper: false, rolbypassrls: false });
    expect(Number(identity.rows[0].version)).toBeGreaterThanOrEqual(170000); expect(Number(identity.rows[0].version)).toBeLessThan(180000);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM ring_groups; DELETE FROM tenant_memberships; DELETE FROM tenants; INSERT INTO tenants(id,status) VALUES(7,'active'),(8,'active'); INSERT INTO tenant_memberships(user_id,tenant_id,role,status,created_at) VALUES(9,7,'admin','active','2026-01-01')");
    // Only admission SQL executes in this minimal fixture. Resource results
    // retain the normal router fixture; this does not claim PBX data acceptance.
    state.query.mockImplementation(async (sql, parameters) => String(sql).includes("tenant_memberships")
      ? pool.query(sql, parameters) : { rows: [{ id: 4, tenant_id: parameters[parameters.length - 1], marker: "normal result" }] });
  });
  afterAll(async () => { if (pool) await pool.end(); });
  it.each(["revoked membership", "deleted membership", "inactive tenant", "wrong actor", "demoted user", "demoted manager"])("actual admission SQL refuses %s despite stale cached admin", async condition => {
    if (condition === "revoked membership") await pool.query("UPDATE tenant_memberships SET status='inactive'");
    if (condition === "deleted membership") await pool.query("DELETE FROM tenant_memberships");
    if (condition === "inactive tenant") await pool.query("UPDATE tenants SET status='inactive' WHERE id=7");
    if (condition === "wrong actor") await pool.query("UPDATE tenant_memberships SET user_id=10");
    if (condition === "demoted user") await pool.query("UPDATE tenant_memberships SET role='user'");
    if (condition === "demoted manager") await pool.query("UPDATE tenant_memberships SET role='manager'");
    await expect(ivrRouter.createCaller(context()).ringGroups.list({ tenant_id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.query).toHaveBeenCalledTimes(1); expect(state.capabilities).not.toHaveBeenCalled();
    expect(state.cache).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"])("actual admission SQL accepts a current %s", async role => {
    await pool.query("UPDATE tenant_memberships SET role=$1", [role]);
    await expect(ivrRouter.createCaller(context()).queues.list({ tenant_id: 7 })).resolves.toMatchObject([{ marker: "normal result" }]);
    expect(state.query.mock.calls[1][1]).toEqual([7]); expect(state.cache).not.toHaveBeenCalled();
  });
  it("admits a selected second tenant without borrowing its role for the first", async () => {
    await pool.query("UPDATE tenant_memberships SET role='user'; INSERT INTO tenant_memberships(user_id,tenant_id,role,status,created_at) VALUES(9,8,'owner','active','2026-02-01')");
    const caller = ivrRouter.createCaller(context());
    await caller.timeConditions.list({ tenant_id: 8 }); expect(state.query.mock.calls[1][1]).toEqual([8]);
    await expect(caller.timeConditions.list({ tenant_id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.timeConditions.get({ id: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.query).toHaveBeenCalledTimes(4);
  });
  it("does not reuse the deleted first membership when another current tenant remains", async () => {
    await pool.query("DELETE FROM tenant_memberships; INSERT INTO tenant_memberships(user_id,tenant_id,role,status,created_at) VALUES(9,8,'admin','active','2026-02-01')");
    await expect(ivrRouter.createCaller(context()).queues.list({ tenant_id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN", message: "User does not have access to the requested tenant" });
    expect(state.query).toHaveBeenCalledTimes(1); expect(state.capabilities).not.toHaveBeenCalled();
  });
});

describe("routing reads require current administrator authority", () => {
  for (const condition of ["revoked membership", "deleted membership", "inactive tenant", "wrong actor", "demoted user", "demoted manager"]) {
    it.each(reads)(`%s refuses ${condition} despite a cached administrator`, async (_name, invoke) => {
      state.memberships = condition === "demoted user" ? [{ tenant_id: 7, role: "user" }]
        : condition === "demoted manager" ? [{ tenant_id: 7, role: "manager" }] : [];
      await expect(invoke(ivrRouter.createCaller(context()))).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(state.cache).not.toHaveBeenCalled();
      expect(state.query).toHaveBeenCalledTimes(1);
      expect(state.query.mock.calls[0][0]).toContain("tm.user_id = $1");
      expect(state.query.mock.calls[0][0]).toContain("tm.status = 'active' AND t.status = 'active'");
      expect(state.query.mock.calls[0][1]).toEqual([9]);
      expect(state.capabilities).not.toHaveBeenCalled();
    });
  }
  for (const role of ["owner", "admin"]) {
    it.each(reads)(`%s preserves normal results for a current ${role}`, async (_name, invoke) => {
      state.memberships = [{ tenant_id: 7, role }];
      const result = await invoke(ivrRouter.createCaller(context()));
      expect(JSON.stringify(result)).toContain("normal result");
      expect(state.query.mock.calls[0][0]).toContain("tenant_memberships");
      expect(state.query.mock.calls[0][1]).toEqual([9]);
      expect(state.cache).not.toHaveBeenCalled();
      expect(state.withTransaction).not.toHaveBeenCalled();
    });
  }
  it.each(reads)("%s requires authentication before any database/cache access", async (_name, invoke) => {
    await expect(invoke(ivrRouter.createCaller(context(null)))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.query).not.toHaveBeenCalled(); expect(state.cache).not.toHaveBeenCalled();
  });
  it.each(selectedReads)("%s refuses a cached selected tenant without a current membership", async (_name, invoke) => {
    state.memberships = [{ tenant_id: 8, role: "admin" }];
    await expect(invoke(ivrRouter.createCaller(context()), 7)).rejects.toMatchObject({
      code: "FORBIDDEN", message: "User does not have access to the requested tenant",
    });
    expect(state.query).toHaveBeenCalledTimes(1); expect(state.capabilities).not.toHaveBeenCalled();
  });
  it.each(selectedReads)("%s scopes an explicit second workspace to its current role", async (_name, invoke) => {
    state.memberships = [{ tenant_id: 7, role: "user" }, { tenant_id: 8, role: "owner" }];
    await invoke(ivrRouter.createCaller(context()), 8);
    expect(state.query.mock.calls[1][1]).toEqual([8]);
    await expect(invoke(ivrRouter.createCaller(context()), 7)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.cache).not.toHaveBeenCalled();
  });
  it.each(reads.filter(([name]) => !name.endsWith("list")))("%s keeps oldest active workspace selection", async (_name, invoke) => {
    state.memberships = [{ tenant_id: 8, role: "owner" }, { tenant_id: 7, role: "admin" }];
    await invoke(ivrRouter.createCaller(context()));
    expect(state.query.mock.calls[0][0]).toContain("ORDER BY tm.created_at ASC, tm.tenant_id ASC");
    expect(state.query.mock.calls[1][1]).toEqual([4, 8]);
    state.memberships = [{ tenant_id: 8, role: "user" }, { tenant_id: 7, role: "admin" }];
    await expect(invoke(ivrRouter.createCaller(context()))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(reads.filter(([name]) => !name.endsWith("list")))("%s refuses a foreign parent before child data", async (_name, invoke) => {
    state.query.mockImplementation(async sql => ({ rows: String(sql).includes("tenant_memberships") ? state.memberships : [] }));
    await expect(invoke(ivrRouter.createCaller(context()))).rejects.toThrow();
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(state.query.mock.calls[1][0]).toContain("tenant_id = $2");
    expect(state.query.mock.calls[1][1]).toEqual([4, 7]);
    expect(state.query.mock.calls.some(([sql]) => /FROM (queue_stats|queue_agents|ring_group_members|time_condition_rules)/.test(String(sql)))).toBe(false);
  });
  it.each([
    ["ringGroups", "Ring groups", selectedReads[0][1]],
    ["queues", "Call queues", selectedReads[1][1]],
    ["businessHours", "Business hours", selectedReads[2][1]],
  ] as const)("%s checks current authority before its friendly unavailable error", async (facility, label, invoke) => {
    state.capabilities.mockResolvedValue({ ivr: true, ringGroups: true, queues: true, businessHours: true, [facility]: false });
    await expect(invoke(ivrRouter.createCaller(context()), 7)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: `${label} is unavailable on this server` });
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls[0][0]).toContain("tenant_memberships");
    expect(state.cache).not.toHaveBeenCalled();
  });
  it("rechecks authority on every request using the same caller", async () => {
    const caller = ivrRouter.createCaller(context());
    await caller.queues.list({ tenant_id: 7 }); state.memberships = [];
    await expect(caller.queues.list({ tenant_id: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN", message: "User has no active tenant memberships",
    });
    expect(state.cache).not.toHaveBeenCalled();
  });
  it("keeps IVR's exactly-one active workspace rule and explicit selection", async () => {
    state.memberships = [{ tenant_id: 7, role: "admin" }, { tenant_id: 8, role: "owner" }];
    await expect(ivrRouter.createCaller(context()).ivr.get({ id: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.memberships = [{ tenant_id: 8, role: "owner" }];
    await ivrRouter.createCaller(context()).ivr.get({ id: 4, tenant_id: 8 });
    expect(state.query.mock.calls[1][1]).toEqual([9, 8]);
    expect(state.query.mock.calls[2][1]).toEqual([4, 8]);
  });
});
