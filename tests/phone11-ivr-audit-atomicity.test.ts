import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  events: [] as string[], audits: [] as unknown[][], failAudit: false, failChild: false, auditCode: "42501", failRelease: false,
  failCommit: false, failRollback: false, missingResource: false, emptyAgent: false, role: "admin", available: true,
  pending: 0, committed: 0, releases: 0, pooled: vi.fn(), client: vi.fn(),
}));
vi.mock("pg", () => ({ default: { Pool: class {
  on() {}
  query = fixture.pooled;
  async connect() { return { query: fixture.client, release() { fixture.releases++; fixture.events.push("RELEASE"); if (fixture.failRelease) throw new Error("PRIVATE_RELEASE_DETAIL"); } }; }
} } }));
const cache = vi.hoisted(() => ({ invalidateCache: vi.fn() }));
vi.mock("../server/pbx/redis", () => ({ ...cache, cacheGetOrSet: vi.fn() }));
vi.mock("../server/pbx/schema-capabilities", () => ({
  readManagementCapabilities: async () => Object.fromEntries(["ivr", "ringGroups", "queues", "businessHours"].map(key => [key, fixture.available])),
}));
// The real router/database load only after pg and Redis transports are replaced.
// eslint-disable-next-line import/first
import { ivrRouter } from "../server/pbx/ivr-router";

const context = { user: { id: 9 }, req: { ip: "127.0.0.1", headers: {} }, res: {} } as any;
const caller = () => ivrRouter.createCaller(context);
const schedule = { name: "PRIVATE_NAME", timezone: "Asia/Bangkok", match_action: "hangup", nomatch_action: "hangup" } as const;
const rule = { day_of_week: [1], start_time: "09:00", end_time: "17:00", label: "PRIVATE_LABEL" };
const cases = [
  ["ivr.create", "ivr_menu.created", "ivr_menu", () => caller().ivr.create({ tenant_id: 7, name: "PRIVATE_NAME", greeting_tts: "PRIVATE_TTS" })],
  ["ivr.update", "ivr_menu.updated", "ivr_menu", () => caller().ivr.update({ id: 41, name: "PRIVATE_NAME" })],
  ["ivr.delete", "ivr_menu.deleted", "ivr_menu", () => caller().ivr.delete({ id: 41 })],
  ["ivr.setActions", "ivr_menu.actions_replaced", "ivr_menu", () => caller().ivr.setActions({ menu_id: 41, actions: [{ digit: "1", action_type: "hangup", description: "PRIVATE_DESCRIPTION" }] })],
  ["ringGroups.create", "ring_group.created", "ring_group", () => caller().ringGroups.create({ tenant_id: 7, name: "PRIVATE_NAME" })],
  ["ringGroups.update", "ring_group.updated", "ring_group", () => caller().ringGroups.update({ id: 41, is_active: false })],
  ["ringGroups.delete", "ring_group.deleted", "ring_group", () => caller().ringGroups.delete({ id: 41 })],
  ["ringGroups.setMembers", "ring_group.members_replaced", "ring_group", () => caller().ringGroups.setMembers({ ring_group_id: 41, members: [{ extension_id: 10, priority: 2 }] })],
  ["queues.create", "queue.created", "call_queue", () => caller().queues.create({ tenant_id: 7, name: "PRIVATE_NAME" })],
  ["queues.update", "queue.updated", "call_queue", () => caller().queues.update({ id: 41, is_active: false })],
  ["queues.delete", "queue.deleted", "call_queue", () => caller().queues.delete({ id: 41 })],
  ["queues.setAgents", "queue.agents_replaced", "call_queue", () => caller().queues.setAgents({ queue_id: 41, agents: [{ extension_id: 10, priority: 2, skills: ["PRIVATE_SKILLS"] }] })],
  ["queues.agentLogin", "queue.agent_logged_in", "call_queue", () => caller().queues.agentLogin({ queue_id: 41, extension_id: 10 })],
  ["queues.agentLogout", "queue.agent_logged_out", "call_queue", () => caller().queues.agentLogout({ queue_id: 41, extension_id: 10 })],
  ["timeConditions.create", "time_condition.created", "time_condition", () => caller().timeConditions.create({ tenant_id: 7, ...schedule })],
  ["timeConditions.update", "time_condition.updated", "time_condition", () => caller().timeConditions.update({ id: 41, ...schedule, rules: [rule] })],
  ["timeConditions.setRules", "time_condition.rules_replaced", "time_condition", () => caller().timeConditions.setRules({ time_condition_id: 41, rules: [rule] })],
  ["timeConditions.delete", "time_condition.deleted", "time_condition", () => caller().timeConditions.delete({ id: 41 })],
] as const;
const beforeRow = { id: 41, is_active: true, timeout_ms: 5000, fallback_action: "hangup", overflow_action: "hangup", name: "PRIVATE_OLD_NAME", sip_password: "PRIVATE_SECRET" };
const afterRow = { ...beforeRow, is_active: false, timeout_ms: 6000, name: "PRIVATE_DB_NAME", target: "PRIVATE_TARGET", media_file: "PRIVATE_PATH" };

beforeEach(() => {
  vi.stubEnv("PG_CONNECTION_STRING", "postgres://offline:synthetic@invalid.invalid/offline");
  fixture.events = []; fixture.audits = []; fixture.failAudit = false; fixture.failChild = false; fixture.auditCode = "42501"; fixture.failRelease = false; fixture.failCommit = false; fixture.failRollback = false;
  fixture.missingResource = false; fixture.emptyAgent = false; fixture.role = "admin"; fixture.available = true;
  fixture.pending = 0; fixture.committed = 0; fixture.releases = 0;
  fixture.pooled.mockReset().mockImplementation(() => { throw new Error("POOLED_QUERY_FORBIDDEN"); });
  cache.invalidateCache.mockReset().mockImplementation(async () => { fixture.events.push("CACHE"); });
  fixture.client.mockReset().mockImplementation(async (sql: string, parameters: unknown[] = []) => {
    const text = sql.trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) {
      fixture.events.push(text);
      if (text === "ROLLBACK" && fixture.failRollback) throw new Error("PRIVATE_ROLLBACK_DETAIL");
      if (text === "COMMIT") { if (fixture.failCommit) throw Object.assign(new Error("PRIVATE_AUDIT_DEFERRED_CONSTRAINT_DETAIL"), { detail: "PRIVATE_AUDIT_ROW_DETAIL", code: "23503" }); fixture.committed += fixture.pending; }
      if (text !== "COMMIT") fixture.pending = 0;
      return { rows: [] };
    }
    if (text.includes("FROM tenant_memberships")) return { rows: [{ tenant_id: 7, role: fixture.role }] };
    if (text.includes("INSERT INTO audit_logs")) {
      fixture.events.push("AUDIT"); fixture.audits.push(parameters);
      if (fixture.failAudit) throw Object.assign(new Error("PRIVATE_PG_DETAIL"), { detail: "PRIVATE_ROW", code: fixture.auditCode });
      return { rows: [] };
    }
    if (/^SELECT id, .+ FROM (ivr_menus|ring_groups|call_queues|time_conditions)/.test(text)) {
      expect(parameters).toEqual([41, 7]);
      return { rows: fixture.missingResource ? [] : [beforeRow] };
    }
    if (text.includes("FROM queue_agents")) return { rows: fixture.emptyAgent ? [] : [{ extension_id: 10, is_logged_in: !text.includes("= true") }] };
    if (/^SELECT/.test(text)) return { rows: [{ ...beforeRow, id: 10 }] };
    if (/^(INSERT|UPDATE|DELETE)/.test(text)) {
      fixture.events.push("DML"); fixture.pending++;
      if (fixture.failChild && text.startsWith("INSERT INTO ivr_actions")) throw new Error("synthetic child failure");
      if (text.startsWith("UPDATE queue_agents")) return { rows: fixture.emptyAgent ? [] : [{ extension_id: 10, is_logged_in: text.includes("= true") }] };
      if (text.startsWith("DELETE")) return { rows: [{ ...beforeRow, digit: "9", extension_id: 11 }] };
      return { rows: [{ ...afterRow, digit: "2", extension_id: 10, priority: 3 }] };
    }
    throw new Error("Unexpected fixture query");
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("atomic routing audit on the real withTransaction control path (injected pg, no database)", () => {
  it.each(cases)("%s inserts exactly one safe audit on the leased client before COMMIT", async (_name, action, resource, invoke) => {
    await invoke();
    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0].slice(0, 5)).toEqual([7, 9, action, resource, "41"]);
    const values = JSON.stringify(fixture.audits);
    expect(values).not.toContain("PRIVATE_");
    expect(fixture.events.indexOf("AUDIT")).toBeLessThan(fixture.events.indexOf("COMMIT"));
    expect(fixture.events.indexOf("COMMIT")).toBeLessThan(fixture.events.indexOf("CACHE"));
    expect(fixture.events.filter(event => event === "BEGIN")).toHaveLength(1);
    expect(fixture.events).not.toContain("ROLLBACK");
    expect(fixture.committed).toBeGreaterThan(0);
    expect(fixture.releases).toBe(1);
    expect(fixture.pooled).not.toHaveBeenCalled();
  });
  it.each(cases)("%s rolls back and withholds cache/result when audit storage rejects", async (_name, _action, _resource, invoke) => {
    fixture.failAudit = true;
    const error = await invoke().catch(value => value);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not record routing change" });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("PRIVATE_");
    expect(fixture.events).toContain("DML"); expect(fixture.events).toContain("AUDIT");
    expect(fixture.events).toContain("ROLLBACK"); expect(fixture.events).not.toContain("COMMIT");
    expect(fixture.committed).toBe(0); expect(fixture.releases).toBe(1);
    expect(cache.invalidateCache).not.toHaveBeenCalled(); expect(fixture.pooled).not.toHaveBeenCalled();
  });
  it.each(cases)("%s refuses revoked authority before DML or audit", async (_name, _action, _resource, invoke) => {
    fixture.role = "user";
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.events).not.toContain("DML"); expect(fixture.audits).toHaveLength(0);
    expect(fixture.events).toContain("ROLLBACK"); expect(fixture.pooled).not.toHaveBeenCalled();
  });
  it("records actual returned before/after values instead of submitted configuration", async () => {
    await caller().ivr.update({ id: 41, timeout_ms: 7000 });
    expect(JSON.parse(fixture.audits[0][5] as string)).toMatchObject({ id: 41, timeout_ms: 5000 });
    expect(JSON.parse(fixture.audits[0][6] as string)).toMatchObject({ id: 41, timeout_ms: 6000 });
  });
  it("records replaced deleted and inserted rows from RETURNING", async () => {
    await caller().ivr.setActions({ menu_id: 41, actions: [{ digit: "1", action_type: "hangup" }] });
    expect(JSON.parse(fixture.audits[0][5] as string)).toMatchObject({ count: 1, rows: [{ digit: "9" }] });
    expect(JSON.parse(fixture.audits[0][6] as string)).toMatchObject({ count: 1, rows: [{ digit: "2" }] });
  });
  it("rolls back a child replacement failure before any audit or cache effect", async () => {
    fixture.failChild = true;
    await expect(caller().ivr.setActions({ menu_id: 41, actions: [{ digit: "1", action_type: "hangup" }] })).rejects.toThrow();
    expect(fixture.events).toContain("ROLLBACK"); expect(fixture.events).not.toContain("COMMIT");
    expect(fixture.audits).toHaveLength(0); expect(fixture.committed).toBe(0); expect(fixture.releases).toBe(1);
    expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it.each(["user", "manager"])("rejects %s authority before DML and audit", async role => {
    fixture.role = role;
    await expect(caller().ivr.delete({ id: 41 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.events).not.toContain("DML"); expect(fixture.audits).toHaveLength(0);
    expect(fixture.events).toContain("ROLLBACK");
  });
  it("rejects unavailable facilities before DML and audit", async () => {
    fixture.available = false;
    await expect(caller().ivr.delete({ id: 41 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.events).not.toContain("DML"); expect(fixture.audits).toHaveLength(0);
  });
  it("rejects a cross-tenant resource before DML and audit", async () => {
    fixture.missingResource = true;
    await expect(caller().ivr.delete({ id: 41 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.events).not.toContain("DML"); expect(fixture.audits).toHaveLength(0);
  });
  it("audits defaults applied by the existing partial IVR schema for an id-only update", async () => {
    await caller().ivr.update({ id: 41 });
    expect(fixture.events).toContain("DML"); expect(fixture.audits).toHaveLength(1);
  });
  it.each(["agentLogin", "agentLogout"] as const)("does not claim %s changed an absent queue agent", async operation => {
    fixture.emptyAgent = true;
    await caller().queues[operation]({ queue_id: 41, extension_id: 10 });
    expect(fixture.audits).toHaveLength(0);
  });
  it.each(["42P01", "23502", "23503", "23505", "23514", "22001"])("rolls back audit statement rejection %s without leaking database details", async code => {
    fixture.failAudit = true; fixture.auditCode = code;
    await expect(caller().ivr.create({ tenant_id: 7, name: "Synthetic" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not record routing change" });
    expect(fixture.events).toContain("ROLLBACK"); expect(fixture.events).not.toContain("COMMIT");
    expect(fixture.committed).toBe(0); expect(fixture.releases).toBe(1); expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it("keeps audit refusal private if client release also fails", async () => {
    fixture.failAudit = true; fixture.failRelease = true;
    const error = await caller().ivr.delete({ id: 41 }).catch(value => value);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not record routing change" });
    expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain("PRIVATE_");
    expect(fixture.events).toContain("ROLLBACK"); expect(fixture.events).not.toContain("COMMIT");
    expect(fixture.releases).toBe(1); expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it("keeps the client error private even when rollback fails after audit rejection", async () => {
    fixture.failAudit = true; fixture.failRollback = true;
    const error = await caller().ivr.delete({ id: 41 }).catch(value => value);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not record routing change" });
    expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain("PRIVATE_");
    expect(fixture.events).toContain("ROLLBACK"); expect(fixture.events).not.toContain("COMMIT");
    expect(fixture.releases).toBe(1); expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it.each(["commit", "commit-and-rollback", "commit-and-release", "release-after-commit"])("sanitizes %s failure after a successful audit without claiming rollback", async phase => {
    fixture.failCommit = phase.startsWith("commit");
    fixture.failRollback = phase === "commit-and-rollback";
    fixture.failRelease = phase === "commit-and-release" || phase === "release-after-commit";
    const error = await caller().ivr.create({ tenant_id: 7, name: "Synthetic" }).catch(value => value);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not complete routing change" });
    expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain("PRIVATE_");
    expect(error.message).not.toMatch(/roll.?back|not committed|nothing committed/i);
    expect(fixture.events).toContain("AUDIT"); expect(fixture.events).toContain("COMMIT");
    expect(fixture.audits).toHaveLength(1); expect(fixture.releases).toBe(1);
    expect(cache.invalidateCache).not.toHaveBeenCalled(); expect(fixture.pooled).not.toHaveBeenCalled();
    if (phase === "release-after-commit") {
      // This fixture genuinely acknowledges COMMIT before release throws. Do not
      // label that cleanup failure as a rollback of the successful transaction.
      expect(fixture.committed).toBeGreaterThan(0); expect(fixture.events).not.toContain("ROLLBACK");
    } else {
      expect(fixture.events).toContain("ROLLBACK"); expect(fixture.committed).toBe(0);
    }
  });
  it("keeps postcommit cache failures outside transaction-error handling", async () => {
    const cacheError = new Error("Synthetic postcommit cache failure");
    cache.invalidateCache.mockRejectedValueOnce(cacheError);
    await expect(caller().ivr.create({ tenant_id: 7, name: "Synthetic" })).rejects.toThrow(cacheError.message);
    expect(fixture.committed).toBeGreaterThan(0); expect(fixture.audits).toHaveLength(1);
    expect(fixture.events).not.toContain("ROLLBACK"); expect(fixture.releases).toBe(1);
  });
  it("does not invalidate cache or return success if commit fails after audit insertion", async () => {
    fixture.failCommit = true;
    await expect(caller().ivr.create({ tenant_id: 7, name: "Synthetic" })).rejects.toThrow();
    expect(fixture.events).toContain("AUDIT"); expect(fixture.events).toContain("ROLLBACK");
    expect(fixture.committed).toBe(0); expect(cache.invalidateCache).not.toHaveBeenCalled(); expect(fixture.releases).toBe(1);
  });
});
