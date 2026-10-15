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
vi.mock("../server/pbx/audit", async importOriginal => ({
  ...await importOriginal<typeof import("../server/pbx/audit")>(),
  insertAuditLog: state.audit,
}));
vi.mock("../server/pbx/schema-capabilities", () => ({ readManagementCapabilities: state.capabilities }));

type Caller = ReturnType<typeof ivrRouter.createCaller>;
const context = (ip = "127.0.0.1") => ({ user: { id: 9 }, req: { ip, headers: {} }, res: {} }) as Parameters<typeof ivrRouter.createCaller>[0];
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

beforeEach(async () => {
  vi.clearAllMocks(); state.committed = false; state.actor = [{ tenant_id: 7, role: "admin" }];
  // A setup failure must not leave an unconsumed actual-reader one-shot for
  // another test. clearAllMocks clears calls, but preserves queued implementations.
  state.capabilities.mockReset();
  state.capabilities.mockResolvedValue({ ivr: true, ringGroups: true, queues: true, businessHours: true });
  const stale = [{ userId: 9, tenantId: 7, role: "admin", tenantName: "Workspace", tenantStatus: "active" }];
  state.cacheGetOrSet.mockResolvedValue(stale);
  // Global prechecks see the stale snapshot; only the write client has current authority.
  state.query.mockImplementation(async sql => ({ rows: String(sql).includes("tenant_memberships") ? [{ tenant_id: 7, role: "admin" }] : [{ id: 4, tenant_id: 7 }] }));
  state.transactionQuery.mockImplementation(async sql => ({ rows: String(sql).includes("tenant_memberships") ? state.actor : [{ id: 4, tenant_id: 7, fallback_action: "hangup", overflow_action: "hangup" }] }));
  state.withTransaction.mockImplementation(async fn => { const result = await fn({ query: state.transactionQuery }); state.committed = true; return result; });
  const actualAudit = await vi.importActual<typeof import("../server/pbx/audit")>("../server/pbx/audit");
  state.audit.mockReset().mockImplementation(async (execute, entry) => {
    expect(state.committed).toBe(false);
    await actualAudit.insertAuditLog(execute, entry);
  });
  state.invalidate.mockImplementation(async () => { expect(state.committed).toBe(true); });
});

describe("routing writes hold current administrator authority", () => {
  it.each(cases.slice(0, 4))("%s invalidates tenant-scoped and legacy IVR XML only after commit", async (_name, invoke) => {
    await invoke(ivrRouter.createCaller(context()));
    expect(state.invalidate).toHaveBeenCalledWith("dialplan:ivr:7:4");
    expect(state.invalidate).toHaveBeenCalledWith("dialplan:ivr:4");
    expect(state.committed).toBe(true);
  });
  it("preserves both IVR cache entries when the write transaction fails to commit", async () => {
    state.withTransaction.mockImplementationOnce(async fn => {
      await fn({ query: state.transactionQuery });
      throw new Error("synthetic commit refusal");
    });
    await expect(ivrRouter.createCaller(context()).ivr.update({ id: 4, name: "Menu" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not complete routing change", cause: undefined });
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.committed).toBe(false);
  });
  it.each([
    ["ivr", "IVR", cases[0][1]],
    ["ringGroups", "Ring groups", cases[4][1]],
    ["queues", "Call queues", cases[8][1]],
    ["businessHours", "Business hours", cases[14][1]],
  ] as const)("uses the friendly %s label when its schema is unavailable", async (facility, label, invoke) => {
    state.capabilities.mockResolvedValue({ ivr: true, ringGroups: true, queues: true, businessHours: true, [facility]: false });
    await expect(invoke(ivrRouter.createCaller(context()))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", message: `${label} is unavailable on this server`,
    });
    expect(state.transactionQuery.mock.calls[0][0]).toContain("FOR UPDATE OF tm, t");
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(false);
    expect(state.committed).toBe(false);
    expect(state.audit).not.toHaveBeenCalled(); expect(state.invalidate).not.toHaveBeenCalled();
  });
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
    expect(state.audit).toHaveBeenCalledTimes(1);
    const audits = state.transactionQuery.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO audit_logs"));
    expect(audits).toHaveLength(1); expect(audits[0][1].slice(0, 2)).toEqual([7, 9]);
    expect(state.query).not.toHaveBeenCalled(); expect(state.cacheGetOrSet).not.toHaveBeenCalled();
  });
  it("runs the actual capability reader on the held write client", async () => {
    const actual = await vi.importActual<typeof import("../server/pbx/schema-capabilities")>("../server/pbx/schema-capabilities");
    state.capabilities.mockImplementationOnce(actual.readManagementCapabilities);
    await expect(ivrRouter.createCaller(context()).ringGroups.create({ tenant_id: 7, name: "Group" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", message: "Ring groups is unavailable on this server",
    });
    expect(state.transactionQuery.mock.calls[0][0]).toContain("FOR UPDATE OF tm, t");
    expect(state.query).not.toHaveBeenCalled();
    expect(state.transactionQuery.mock.calls.map(([sql]) => String(sql))).toEqual([
      expect.stringContaining("FOR UPDATE OF tm, t"), expect.stringContaining("information_schema.columns"),
    ]);
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(false);
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
  it("attempts audit on the held client but withholds cache/result when commit fails", async () => {
    state.withTransaction.mockImplementationOnce(async fn => { await fn({ query: state.transactionQuery }); throw Error("PRIVATE_COMMIT_DETAIL"); });
    const error = await ivrRouter.createCaller(context()).queues.create({ tenant_id: 7, name: "Queue" }).catch(value => value);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not complete routing change", cause: undefined });
    expect(JSON.stringify(error)).not.toContain("PRIVATE_COMMIT_DETAIL");
    expect(state.audit).toHaveBeenCalledTimes(1);
    expect(state.transactionQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO audit_logs"))).toBe(true);
    expect(state.committed).toBe(false); expect(state.invalidate).not.toHaveBeenCalled();
  });
  it("refuses audit storage failure before commit and preserves a private-error boundary", async () => {
    const original = state.transactionQuery.getMockImplementation()!;
    state.transactionQuery.mockImplementation(async (sql, parameters) => {
      if (String(sql).includes("INSERT INTO audit_logs")) throw Error("PRIVATE_AUDIT_STORAGE_DETAIL");
      return original(sql, parameters);
    });
    const error = await ivrRouter.createCaller(context()).queues.create({ tenant_id: 7, name: "Queue" }).catch(value => value);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not record routing change", cause: undefined });
    expect(JSON.stringify(error)).not.toContain("PRIVATE_AUDIT_STORAGE_DETAIL");
    expect(state.audit).toHaveBeenCalledTimes(1); expect(state.withTransaction).toHaveBeenCalledTimes(1);
    expect(state.committed).toBe(false); expect(state.invalidate).not.toHaveBeenCalled();
  });
  it("reports postcommit cache failure after the routing and audit writes commit", async () => {
    state.invalidate.mockRejectedValueOnce(Error("postcommit effect failed"));
    await expect(ivrRouter.createCaller(context()).queues.create({ tenant_id: 7, name: "Queue" })).rejects.toThrow("postcommit effect failed");
    expect(state.committed).toBe(true);
    expect(state.audit).toHaveBeenCalledTimes(1); expect(state.withTransaction).toHaveBeenCalledTimes(1);
    expect(state.transactionQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO call_queues"))).toBe(true);
    expect(state.transactionQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO audit_logs"))).toBe(true);
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
    await pool.query("DELETE FROM audit_logs; DELETE FROM ring_groups; DELETE FROM tenant_memberships; DELETE FROM tenants; INSERT INTO tenants(id,status) VALUES(7,'active'),(8,'active'); INSERT INTO tenant_memberships(user_id,tenant_id,role,status,created_at) VALUES(9,7,'admin','active',now())");
    state.query.mockImplementation((sql, parameters) => pool.query(sql, parameters));
    state.withTransaction.mockImplementation(async fn => { const client = await pool.connect(); try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); state.committed = true; return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } });
  });
  afterAll(async () => { if (pool) await pool.end(); });
  const create = () => ivrRouter.createCaller(context()).ringGroups.create({ tenant_id: 7, name: "Locked group", fallback_action: "hangup" });
  it("checks actual schema capabilities with a one-connection pool while authority is held", async () => {
    const actual = await vi.importActual<typeof import("../server/pbx/schema-capabilities")>("../server/pbx/schema-capabilities");
    const url = new URL(databaseUrl!);
    const single = new Pool({ host: "127.0.0.1", port: Number(url.port), user: "p11_routing_auth_runtime", password: decodeURIComponent(url.password), database: "phone11_routing_auth_test", ssl: false, application_name: "phone11-routing-auth-single-client-test", max: 1, connectionTimeoutMillis: 3000, query_timeout: 5000, options: "-c search_path=p11_routing_auth_test,pg_catalog -c statement_timeout=5000 -c lock_timeout=4000" });
    const statements: string[] = [];
    try {
      // Open and release the sole connection with the normal startup budget.
      // pg-pool reads this public option for subsequent pending checkouts: a
      // second checkout while the write client is held must still fail quickly.
      await single.query("SELECT 1");
      expect(single.totalCount).toBe(1); expect(single.idleCount).toBe(1);
      single.options.connectionTimeoutMillis = 250;
      state.capabilities.mockImplementationOnce(actual.readManagementCapabilities);
      state.query.mockImplementation((sql, parameters) => single.query(sql, parameters));
      state.withTransaction.mockImplementationOnce(async fn => {
        const client = await single.connect();
        try {
          await client.query("BEGIN");
          const held = { query: (sql: string, parameters?: unknown[]) => {
            statements.push(sql); return client.query(sql, parameters);
          } } as unknown as PoolClient;
          const result = await fn(held); await client.query("COMMIT"); return result;
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      });
      // The fixture deliberately has no public management schema. Its actual
      // catalog read must refuse readiness, without waiting for another client.
      await expect(create()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Ring groups is unavailable on this server" });
      expect(statements[0]).toContain("FOR UPDATE OF tm, t");
      expect(statements[1]).toContain("information_schema.columns");
      expect(state.query).not.toHaveBeenCalled();
      expect(single.totalCount).toBe(1); expect(single.waitingCount).toBe(0);
      expect((await single.query("SELECT count(*)::int count FROM ring_groups")).rows[0].count).toBe(0);
    } finally { await single.end(); }
  });
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
  it("rolls back the routing row when actual audit storage rejects its address", async () => {
    const ctx = context("PRIVATE_INVALID_AUDIT_ADDRESS");
    const error = await ivrRouter.createCaller(ctx).ringGroups.create({ tenant_id: 7, name: "Private address", fallback_action: "hangup" }).catch(value => value);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not record routing change", cause: undefined });
    expect(JSON.stringify(error)).not.toContain("PRIVATE_INVALID_AUDIT_ADDRESS");
    expect(state.committed).toBe(false); expect(state.invalidate).not.toHaveBeenCalled();
    expect((await pool.query("SELECT count(*)::int count FROM ring_groups")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int count FROM audit_logs")).rows[0].count).toBe(0);
  });
  it("keeps both routing and audit rows invisible until the same COMMIT", async () => {
    let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
    let reached!: () => void; const atAudit = new Promise<void>(resolve => { reached = resolve; });
    state.withTransaction.mockImplementationOnce(async fn => {
      const client = await pool.connect(); await client.query("BEGIN");
      const held = { query: async (sql: string, parameters?: unknown[]) => {
        const result = await client.query(sql, parameters);
        if (sql.includes("INSERT INTO audit_logs")) { reached(); await paused; }
        return result;
      } } as unknown as PoolClient;
      try { const result = await fn(held); await client.query("COMMIT"); state.committed = true; return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
    const write = create();
    try {
      await Promise.race([atAudit, write.then(() => { throw Error("Missing precommit audit pause"); }, error => { throw error; })]);
      expect((await pool.query("SELECT count(*)::int count FROM ring_groups")).rows[0].count).toBe(0);
      expect((await pool.query("SELECT count(*)::int count FROM audit_logs")).rows[0].count).toBe(0);
      expect(state.invalidate).not.toHaveBeenCalled();
      release(); await write;
      expect((await pool.query("SELECT count(*)::int count FROM ring_groups")).rows[0].count).toBe(1);
      expect((await pool.query("SELECT tenant_id,actor_user_id,action,resource_type FROM audit_logs")).rows).toEqual([{ tenant_id: 7, actor_user_id: 9, action: "ring_group.created", resource_type: "ring_group" }]);
      expect(state.committed).toBe(true); expect(state.invalidate).toHaveBeenCalled();
    } finally { release(); await write.catch(() => undefined); }
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
    const write = create();
    // Observe a refusal before INSERT immediately rather than leaving a rejected
    // write unhandled while waiting forever for a pause that cannot be reached.
    const writer = await Promise.race([atWrite, write.then(
      () => { throw Error("Mutation completed before the expected write pause"); },
      error => { throw error; },
    )]);
    const revoker = await pool.connect();
    try {
      await revoker.query("BEGIN"); const revoke = revoker.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9 AND tenant_id=7");
      await untilBlocked(writer); release(); await write; await revoke; await revoker.query("COMMIT");
      expect((await pool.query("SELECT count(*)::int count FROM ring_groups")).rows[0].count).toBe(1);
      await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { release(); await revoker.query("ROLLBACK"); revoker.release(); }
  });
});


describe("IVR retry exit destination writes", () => {
  it.each(["transfer", "voicemail"] as const)("validates the %s exit extension in the write tenant", async exit_action => {
    await ivrRouter.createCaller(context()).ivr.create({ tenant_id: 7, name: "Menu", exit_action, exit_target: " 3001 " });
    const lookups = state.transactionQuery.mock.calls.filter(([sql]) => /FROM extensions/.test(String(sql)));
    expect(lookups).toHaveLength(1);
    expect(lookups[0][1]).toEqual([7, "3001"]);
    expect(lookups[0][0]).toMatch(/status = 'active' AND deleted_at IS NULL/);
    const insert = state.transactionQuery.mock.calls.find(([sql]) => /INSERT INTO ivr_menus/.test(String(sql)))!;
    expect(insert[1][10]).toBe("3001");
  });
  it.each(["transfer", "voicemail"] as const)("rejects a foreign/inactive %s exit before writing", async exit_action => {
    const original = state.transactionQuery.getMockImplementation()!;
    state.transactionQuery.mockImplementation(async (sql, params) => /FROM extensions/.test(String(sql)) ? { rows: [] } : original(sql, params));
    await expect(ivrRouter.createCaller(context()).ivr.create({ tenant_id: 7, name: "Menu", exit_action, exit_target: "3001" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(false);
    expect(state.invalidate).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "3001 XML foreign", "${destination_number}"])("rejects an invalid transfer destination %s", async exit_target => {
    await expect(ivrRouter.createCaller(context()).ivr.create({ tenant_id: 7, name: "Menu", exit_action: "transfer", exit_target }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(false);
  });
  it("validates a target-only update against the locked stored exit action", async () => {
    const original = state.transactionQuery.getMockImplementation()!;
    state.transactionQuery.mockImplementation(async (sql, params) => /SELECT exit_action, exit_target/.test(String(sql))
      ? { rows: [{ exit_action: "voicemail", exit_target: "3001" }] } : /FROM extensions/.test(String(sql)) ? { rows: [] } : original(sql, params));
    await expect(ivrRouter.createCaller(context()).ivr.update({ id: 4, exit_target: "4001" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    const read = state.transactionQuery.mock.calls.find(([sql]) => /SELECT exit_action, exit_target/.test(String(sql)))!;
    expect(read[0]).toContain("FOR UPDATE");
    expect(read[1]).toEqual([4, 7]);
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(false);
  });
  it("validates the existing destination when only the exit action changes", async () => {
    const original = state.transactionQuery.getMockImplementation()!;
    state.transactionQuery.mockImplementation(async (sql, params) => /SELECT exit_action, exit_target/.test(String(sql))
      ? { rows: [{ exit_action: "voicemail", exit_target: "3001" }] } : original(sql, params));
    await ivrRouter.createCaller(context()).ivr.update({ id: 4, exit_action: "transfer" });
    expect(state.transactionQuery.mock.calls.find(([sql]) => /FROM extensions/.test(String(sql)))?.[1]).toEqual([7, "3001"]);
  });
  it("clears a previous destination when changing the exit to hangup", async () => {
    const original = state.transactionQuery.getMockImplementation()!;
    state.transactionQuery.mockImplementation(async (sql, params) => /SELECT exit_action, exit_target/.test(String(sql))
      ? { rows: [{ exit_action: "voicemail", exit_target: "3001" }] } : original(sql, params));
    await ivrRouter.createCaller(context()).ivr.update({ id: 4, exit_action: "hangup" });
    const update = state.transactionQuery.mock.calls.find(([sql]) => /UPDATE ivr_menus/.test(String(sql)))!;
    expect(update[0]).toContain("exit_target");
    expect(update[1]).toContain(null);
    expect(state.transactionQuery.mock.calls.some(([sql]) => /FROM extensions/.test(String(sql)))).toBe(false);
  });
  it("rejects a destination paired with a hangup exit", async () => {
    await expect(ivrRouter.createCaller(context()).ivr.create({ tenant_id: 7, name: "Menu", exit_action: "hangup", exit_target: "3001" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.transactionQuery.mock.calls.some(([sql]) => dml(sql))).toBe(false);
  });
  it.each(["name", "greeting_file", "greeting_tts", "invalid_sound"] as const)("rejects XML controls in %s before writes", async field => {
    await expect(ivrRouter.createCaller(context()).ivr.create({ tenant_id: 7, name: "Menu", [field]: "bad\u0000value" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.withTransaction).not.toHaveBeenCalled();
  });
});
