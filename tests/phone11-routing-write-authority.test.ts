import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { ivrRouter } from "../server/pbx/ivr-router";

const state = vi.hoisted(() => ({
  query: vi.fn(), transactionQuery: vi.fn(), withTransaction: vi.fn(), cacheGetOrSet: vi.fn(),
  audit: vi.fn(), invalidate: vi.fn(), capabilities: vi.fn(), committed: false,
  actor: [{ tenant_id: 7, role: "admin" }] as { tenant_id: number; role: string }[],
}));
vi.mock("../server/pbx/db", () => ({ query: state.query, withTransaction: state.withTransaction }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: state.cacheGetOrSet, invalidateCache: state.invalidate }));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: state.audit }));
vi.mock("../server/pbx/schema-capabilities", () => ({ readManagementCapabilities: state.capabilities }));

type Caller = ReturnType<typeof ivrRouter.createCaller>;
const context = () => ({ user: { id: 9 }, req: { ip: "127.0.0.1", headers: {} }, res: {} }) as Parameters<typeof ivrRouter.createCaller>[0];
const cases: [string, (caller: Caller) => Promise<unknown>][] = [
  ["IVR create", c => c.ivr.create({ tenant_id: 7, name: "Menu" })],
  ["IVR update", c => c.ivr.update({ id: 4, name: "Menu" })],
  ["IVR delete", c => c.ivr.delete({ id: 4 })],
  ["IVR actions", c => c.ivr.setActions({ menu_id: 4, actions: [{ digit: "1", action_type: "hangup", sort_order: 0 }] })],
  ["group create", c => c.ringGroups.create({ tenant_id: 7, name: "Group", fallback_action: "hangup" })],
  ["group update", c => c.ringGroups.update({ id: 4, name: "Group", fallback_action: "hangup" })],
  ["group delete", c => c.ringGroups.delete({ id: 4 })],
  ["group members", c => c.ringGroups.setMembers({ ring_group_id: 4, members: [] })],
  ["queue create", c => c.queues.create({ tenant_id: 7, name: "Queue", overflow_action: "hangup" })],
  ["queue update", c => c.queues.update({ id: 4, name: "Queue", overflow_action: "hangup" })],
  ["queue delete", c => c.queues.delete({ id: 4 })],
  ["queue agents", c => c.queues.setAgents({ queue_id: 4, agents: [] })],
  ["queue login", c => c.queues.agentLogin({ queue_id: 4, extension_id: 10 })],
  ["queue logout", c => c.queues.agentLogout({ queue_id: 4, extension_id: 10 })],
  ["hours create", c => c.timeConditions.create({ tenant_id: 7, name: "Hours", match_action: "hangup", nomatch_action: "hangup" })],
  ["hours update", c => c.timeConditions.update({ id: 4, name: "Hours", match_action: "hangup", nomatch_action: "hangup", rules: [{ day_of_week: [1], start_time: "09:00", end_time: "17:00" }] })],
  ["hours rules", c => c.timeConditions.setRules({ time_condition_id: 4, rules: [] })],
  ["hours delete", c => c.timeConditions.delete({ id: 4 })],
];
const dml = (sql: unknown) => /\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/.test(String(sql)) && !String(sql).includes("FOR UPDATE");

beforeEach(() => {
  vi.clearAllMocks(); state.committed = false; state.actor = [{ tenant_id: 7, role: "admin" }];
  state.capabilities.mockResolvedValue({ ivr: true, ringGroups: true, queues: true, businessHours: true });
  const stale = [{ userId: 9, tenantId: 7, role: "admin", tenantName: "Workspace", tenantStatus: "active" }];
  state.cacheGetOrSet.mockResolvedValue(stale);
  // Global prechecks see the stale snapshot; only the write client has current authority.
  state.query.mockImplementation(async sql => ({ rows: String(sql).includes("tenant_memberships") ? [{ tenant_id: 7, role: "admin" }] : [{ id: 4, tenant_id: 7 }] }));
  state.transactionQuery.mockImplementation(async sql => ({ rows: String(sql).includes("tenant_memberships") ? state.actor : [{ id: 4, tenant_id: 7, fallback_action: "hangup", overflow_action: "hangup" }] }));
  state.withTransaction.mockImplementation(async fn => { const result = await fn({ query: state.transactionQuery }); state.committed = true; return result; });
  state.audit.mockImplementation(async () => { expect(state.committed).toBe(true); });
  state.invalidate.mockImplementation(async () => { expect(state.committed).toBe(true); });
});

describe("routing writes hold current administrator authority", () => {
  it.each(cases)("%s refuses a revoked actor despite a cached administrator", async (_name, invoke) => {
    state.actor = [];
    await expect(invoke(ivrRouter.createCaller(context()))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(false);
    expect(state.query).not.toHaveBeenCalled(); expect(state.cacheGetOrSet).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled(); expect(state.invalidate).not.toHaveBeenCalled();
  });
  it.each(cases)("%s writes on the client which holds actor/tenant locks", async (_name, invoke) => {
    await invoke(ivrRouter.createCaller(context()));
    expect(state.transactionQuery.mock.calls[0][0]).toContain("FOR UPDATE OF tm, t");
    expect(state.transactionQuery.mock.calls[0][0]).toContain("tm.status = 'active' AND t.status = 'active'");
    expect(state.transactionQuery.mock.calls[0][1][0]).toBe(9);
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(true);
    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    expect(state.query).not.toHaveBeenCalled(); expect(state.cacheGetOrSet).not.toHaveBeenCalled();
  });
  it.each(["user", "manager"])("refuses a current %s without relying on cached admin", async role => {
    state.actor = [{ tenant_id: 7, role }];
    await expect(ivrRouter.createCaller(context()).ringGroups.create({ tenant_id: 7, name: "Group" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(false);
  });
  it("allows a current workspace owner", async () => {
    state.actor = [{ tenant_id: 7, role: "owner" }];
    await ivrRouter.createCaller(context()).queues.create({ tenant_id: 7, name: "Queue" });
    expect(state.committed).toBe(true);
  });
  it("pins an explicit workspace and refuses a missing membership", async () => {
    state.actor = [];
    await expect(ivrRouter.createCaller(context()).timeConditions.create({ tenant_id: 8, name: "Hours", match_action: "hangup", nomatch_action: "hangup" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transactionQuery.mock.calls[0][1]).toEqual([9, 8]);
  });
  it("locks tenant-owned parents before replacing child rows", async () => {
    await ivrRouter.createCaller(context()).ringGroups.setMembers({ ring_group_id: 4, members: [] });
    expect(state.transactionQuery.mock.calls[1][0]).toContain("tenant_id = $2 FOR UPDATE");
    expect(state.transactionQuery.mock.calls[1][1]).toEqual([4, 7]);
  });
  it("has no audit/cache effects when the write transaction fails", async () => {
    state.withTransaction.mockImplementationOnce(async fn => { await fn({ query: state.transactionQuery }); throw Error("commit failed"); });
    await expect(ivrRouter.createCaller(context()).queues.create({ tenant_id: 7, name: "Queue" })).rejects.toThrow("commit failed");
    expect(state.audit).not.toHaveBeenCalled(); expect(state.invalidate).not.toHaveBeenCalled();
  });
  it.each(["audit", "cache"])("reports postcommit %s failure without undoing the committed write", async effect => {
    const failure = Error("postcommit effect failed");
    if (effect === "audit") state.audit.mockRejectedValueOnce(failure);
    else state.invalidate.mockRejectedValueOnce(failure);
    await expect(ivrRouter.createCaller(context()).queues.create({ tenant_id: 7, name: "Queue" })).rejects.toThrow("postcommit effect failed");
    expect(state.committed).toBe(true);
    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    expect(state.transactionQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO call_queues"))).toBe(true);
  });
  it("preserves IVR's explicit-selection rule for multiple memberships", async () => {
    state.actor = [{ tenant_id: 7, role: "admin" }, { tenant_id: 8, role: "admin" }];
    await expect(ivrRouter.createCaller(context()).ivr.delete({ id: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

const databaseUrl = process.env.PHONE11_ROUTING_AUTH_TEST_DATABASE_URL;
if (process.env.PHONE11_ROUTING_AUTH_REQUIRE_POSTGRES === "1" && !databaseUrl) {
  throw Error("Required disposable PostgreSQL routing authority fixture is missing");
}
describe.skipIf(!databaseUrl)("routing authority on an owned disposable PostgreSQL 17", () => {
  let pool: Pool;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.protocol !== "postgres:" || url.hostname !== "127.0.0.1" || url.pathname !== "/phone11_routing_auth_test" || url.username !== "p11_routing_auth_runtime" || !url.port || !url.password || url.search || url.hash)
      throw Error("Use only the owned loopback disposable routing authority database");
    pool = new Pool({ host: "127.0.0.1", port: Number(url.port), user: "p11_routing_auth_runtime", password: decodeURIComponent(url.password), database: "phone11_routing_auth_test", ssl: false, application_name: "phone11-routing-auth-disposable-test", max: 4, connectionTimeoutMillis: 3000, query_timeout: 5000, options: "-c search_path=p11_routing_auth_test,pg_catalog -c statement_timeout=5000 -c lock_timeout=4000" });
    const identity = await pool.query("SELECT current_database() db, current_schema() schema, current_user role, current_setting('server_version_num') version, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(identity.rows[0]).toMatchObject({ db: "phone11_routing_auth_test", schema: "p11_routing_auth_test", role: "p11_routing_auth_runtime", rolsuper: false, rolbypassrls: false });
    expect(Number(identity.rows[0].version)).toBeGreaterThanOrEqual(170000); expect(Number(identity.rows[0].version)).toBeLessThan(180000);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM ring_groups; DELETE FROM tenant_memberships; DELETE FROM tenants; INSERT INTO tenants(id,status) VALUES(7,'active'),(8,'active'); INSERT INTO tenant_memberships(user_id,tenant_id,role,status,created_at) VALUES(9,7,'admin','active',now())");
    state.query.mockImplementation((sql, parameters) => pool.query(sql, parameters));
    state.withTransaction.mockImplementation(async fn => { const client = await pool.connect(); try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); state.committed = true; return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } });
  });
  afterAll(async () => { if (pool) await pool.end(); });
  const create = () => ivrRouter.createCaller(context()).ringGroups.create({ tenant_id: 7, name: "Locked group", fallback_action: "hangup" });
  it.each(["inactive membership", "deleted membership", "inactive tenant", "demoted role"])("refuses %s with zero committed writes", async condition => {
    if (condition === "inactive membership") await pool.query("UPDATE tenant_memberships SET status='inactive'");
    if (condition === "deleted membership") await pool.query("DELETE FROM tenant_memberships");
    if (condition === "inactive tenant") await pool.query("UPDATE tenants SET status='inactive' WHERE id=7");
    if (condition === "demoted role") await pool.query("UPDATE tenant_memberships SET role='user'");
    await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await pool.query("SELECT count(*)::int count FROM ring_groups")).rows[0].count).toBe(0);
  });
  it("rejects a foreign tenant even with a current admin membership elsewhere", async () => {
    await expect(ivrRouter.createCaller(context()).ringGroups.create({ tenant_id: 8, name: "Foreign" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  const untilBlocked = async (client: PoolClient) => {
    const blocker = Number((await client.query("SELECT pg_backend_pid() pid")).rows[0].pid);
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) blocked", [blocker]);
      if (result.rows[0].blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error("Expected actual PostgreSQL row-lock wait was not observed");
  };
  it("mutation waits for earlier revocation and then rejects", async () => {
    const revoker = await pool.connect(); await revoker.query("BEGIN");
    try {
      await revoker.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9 AND tenant_id=7");
      const result = create().then(() => ({ code: "accepted" }), error => ({ code: error.code }));
      await untilBlocked(revoker); await revoker.query("COMMIT");
      expect(await result).toEqual({ code: "FORBIDDEN" });
      expect((await pool.query("SELECT count(*)::int count FROM ring_groups")).rows[0].count).toBe(0);
    } finally { await revoker.query("ROLLBACK"); revoker.release(); }
  });
  it("earlier mutation holds actor authority through commit before revocation", async () => {
    let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
    let reached!: (client: PoolClient) => void; const atWrite = new Promise<PoolClient>(resolve => { reached = resolve; });
    state.withTransaction.mockImplementationOnce(async fn => {
      const client = await pool.connect(); await client.query("BEGIN");
      const wrapped = { query: async (sql: string, parameters?: unknown[]) => {
        if (/INSERT INTO ring_groups/.test(sql)) { reached(client); await paused; }
        return client.query(sql, parameters);
      } } as unknown as PoolClient;
      try { const result = await fn(wrapped); await client.query("COMMIT"); state.committed = true; return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
    const write = create(); const writer = await atWrite; const revoker = await pool.connect();
    try {
      await revoker.query("BEGIN"); const revoke = revoker.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9 AND tenant_id=7");
      await untilBlocked(writer); release(); await write; await revoke; await revoker.query("COMMIT");
      expect((await pool.query("SELECT count(*)::int count FROM ring_groups")).rows[0].count).toBe(1);
      await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { release(); await revoker.query("ROLLBACK"); revoker.release(); }
  });
});
