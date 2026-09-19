import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));
const cache = vi.hoisted(() => ({ invalidateCache: vi.fn() }));

vi.mock("../server/pbx/db", () => ({ query: db.query, withTransaction: db.withTransaction }));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
  invalidateCache: cache.invalidateCache,
}));

import { ivrRouter } from "../server/pbx/ivr-router";

const context = (role: "admin" | "user" = "admin") => ({
  user: { id: 9, role },
  req: { ip: "127.0.0.1", headers: {} },
  res: {},
}) as any;

const anonymousContext = () => ({
  user: null,
  req: { ip: "127.0.0.1", headers: {} },
  res: {},
}) as any;

const membership = (role: "owner" | "admin" | "manager" | "user" = "admin") => ({
  id: 1,
  user_id: 9,
  tenant_id: 7,
  role,
  is_default: true,
  tenant_name: "Acme",
  tenant_slug: "acme",
  tenant_status: "active",
});

beforeEach(() => {
  vi.clearAllMocks();
  db.withTransaction.mockImplementation(async (callback) => callback({ query: db.query }));
});

describe("PBX voice application administration", () => {
  it("requires authentication before any IVR, queue, ring-group, or schedule database access", async () => {
    const caller = ivrRouter.createCaller(anonymousContext());
    await expect(caller.ivr.list({ tenant_id: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.ringGroups.delete({ id: 4 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.queues.stats({ queue_id: 5, hours: 24 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.timeConditions.setRules({ time_condition_id: 6, rules: [] })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.timeConditions.update({
      id: 6,
      name: "Main office",
      timezone: "Asia/Bangkok",
      match_action: "hangup",
      nomatch_action: "hangup",
      rules: [{ day_of_week: [1, 2, 3, 4, 5], start_time: "09:00", end_time: "18:00" }],
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("denies an authenticated user who is not an admin of the selected workspace", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership("user")] });
    await expect(ivrRouter.createCaller(context("user")).ivr.list({ tenant_id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(String(db.query.mock.calls[0][0])).toContain("tenant_memberships");
  });

  it("allows a workspace administrator without requiring a platform-admin account", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await ivrRouter.createCaller(context("user")).ivr.list({ tenant_id: 7 });
    expect(result).toEqual([]);
    expect(db.query.mock.calls[1][1]).toEqual([7]);
  });

  it("refuses a requested workspace that is absent from the administrator's memberships", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership("owner")] });
    await expect(ivrRouter.createCaller(context()).queues.list({ tenant_id: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("scopes an IVR read to the active workspace", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(ivrRouter.createCaller(context()).ivr.get({ id: 41 })).rejects.toThrow("IVR menu not found");
    expect(db.query.mock.calls[1][0]).toContain("id = $1 AND tenant_id = $2");
    expect(db.query.mock.calls[1][1]).toEqual([41, 7]);
  });

  it("uses the verified workspace rather than trusting a supplied tenant ID", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [{ id: 2, tenant_id: 7, name: "Support" }] });
    const result = await ivrRouter.createCaller(context()).queues.list({ tenant_id: 7 });
    expect(result).toHaveLength(1);
    expect(db.query.mock.calls[1][1]).toEqual([7]);
  });

  it("rejects ring-group members from another workspace before changing membership", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] });
    await expect(ivrRouter.createCaller(context()).ringGroups.setMembers({
      ring_group_id: 4,
      members: [
        { extension_id: 10, priority: 1, delay_seconds: 0, is_active: true },
        { extension_id: 99, priority: 2, delay_seconds: 0, is_active: true },
      ],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.withTransaction).not.toHaveBeenCalled();
    expect(db.query.mock.calls[2][1]).toEqual([7, [10, 99]]);
  });

  it("rejects duplicate, inactive, or out-of-range ring-group members before replacement", async () => {
    const caller = ivrRouter.createCaller(context());
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] });
    await expect(caller.ringGroups.setMembers({
      ring_group_id: 4,
      members: [
        { extension_id: 10, priority: 1, delay_seconds: 0, is_active: true },
        { extension_id: 10, priority: 2, delay_seconds: 0, is_active: true },
      ],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.withTransaction).not.toHaveBeenCalled();

    db.query.mockReset();
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] });
    await expect(caller.ringGroups.setMembers({
      ring_group_id: 4,
      members: [{ extension_id: 10, priority: 1, delay_seconds: 121, is_active: true }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.withTransaction).not.toHaveBeenCalled();

    db.query.mockReset();
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(caller.ringGroups.setMembers({
      ring_group_id: 4,
      members: [{ extension_id: 10, priority: 1, delay_seconds: 0, is_active: true }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("replaces ring-group members only after active tenant validation", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] });
    await expect(ivrRouter.createCaller(context()).ringGroups.setMembers({
      ring_group_id: 4,
      members: [{ extension_id: 10, priority: 2, delay_seconds: 30, is_active: true }],
    })).resolves.toEqual({ ok: true, count: 1 });
    expect(db.query.mock.calls[2][0]).toContain("status = 'active'");
    expect(db.query.mock.calls[2][0]).toContain("deleted_at IS NULL");
    expect(db.query.mock.calls[3][0]).toContain("DELETE FROM ring_group_members");
    expect(db.query.mock.calls[4][1]).toEqual([4, 10, 2, 30, true]);
    expect(cache.invalidateCache).toHaveBeenCalledWith("dialplan:ringgroup:7:4");
  });

  it("rejects malformed queue agents before any database access", async () => {
    const caller = ivrRouter.createCaller(context());
    await expect(caller.queues.setAgents({
      queue_id: 4,
      agents: [{ extension_id: 10, priority: 1.5, skills: ["sales"], max_no_answer: 3 }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.queues.setAgents({
      queue_id: 4,
      agents: [{ extension_id: 10, priority: 1, skills: [""], max_no_answer: 3 }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("rejects duplicate, inactive, or cross-tenant queue agents before replacement", async () => {
    const caller = ivrRouter.createCaller(context());
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] });
    await expect(caller.queues.setAgents({
      queue_id: 4,
      agents: [
        { extension_id: 10, priority: 1, skills: [], max_no_answer: 3 },
        { extension_id: 10, priority: 2, skills: [], max_no_answer: 3 },
      ],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.withTransaction).not.toHaveBeenCalled();

    db.query.mockReset();
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(caller.queues.setAgents({
      queue_id: 4,
      agents: [{ extension_id: 10, priority: 1, skills: [], max_no_answer: 3 }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.withTransaction).not.toHaveBeenCalled();

    db.query.mockReset();
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] });
    await expect(caller.queues.setAgents({
      queue_id: 4,
      agents: [
        { extension_id: 10, priority: 1, skills: [], max_no_answer: 3 },
        { extension_id: 99, priority: 2, skills: [], max_no_answer: 3 },
      ],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("preserves supported queue-agent metadata while replacing validated members", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] });
    await expect(ivrRouter.createCaller(context()).queues.setAgents({
      queue_id: 4,
      agents: [{ extension_id: 10, priority: 2, skills: ["sales", "thai"], max_no_answer: 6, is_logged_in: true }],
    })).resolves.toEqual({ ok: true, count: 1 });
    expect(db.query.mock.calls[2][0]).toContain("status = 'active'");
    expect(db.query.mock.calls[3][0]).toContain("DELETE FROM queue_agents");
    expect(db.query.mock.calls[4][1]).toEqual([4, 10, 2, '["sales","thai"]', 6, true]);
    expect(cache.invalidateCache).toHaveBeenCalledWith("dialplan:queue:7:4");
  });

  it("rejects unsupported queue callbacks and invalid extensions before writes", async () => {
    const caller = ivrRouter.createCaller(context());
    db.query.mockResolvedValueOnce({ rows: [membership("admin")] });
    await expect(caller.queues.create({
      tenant_id: 7,
      name: "Support",
      strategy: "ring_all",
      overflow_action: "callback" as any,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    db.query.mockReset();
    await expect(caller.queues.create({
      tenant_id: 7,
      name: "Support",
      extension: "1",
      strategy: "ring_all",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("tenant-validates queue overflow targets and invalidates the dialplan on update", async () => {
    const caller = ivrRouter.createCaller(context());
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ overflow_action: "hangup", overflow_target: null }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(caller.queues.update({
      id: 4,
      name: " Support ",
      strategy: "ring_all",
      overflow_action: "transfer",
      overflow_target: "3001",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE call_queues"))).toBe(false);

    db.query.mockReset();
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ overflow_action: "hangup", overflow_target: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: "Support" }] });
    await expect(caller.queues.update({
      id: 4,
      name: " Support ",
      strategy: "ring_all",
      overflow_action: "transfer",
      overflow_target: "3001",
    })).resolves.toEqual({ id: 4, name: "Support" });
    const update = db.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE call_queues"));
    expect(update?.[1]).toContain("Support");
    expect(cache.invalidateCache).toHaveBeenCalledWith("dialplan:queue:7:4");
  });

  it("counts and reads only callable same-tenant queue agents", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4, tenant_id: 7, agents_online: "1", total_agents: "1" }] })
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4, tenant_id: 7 }] })
      .mockResolvedValueOnce({ rows: [] });
    const caller = ivrRouter.createCaller(context());
    await caller.queues.list({ tenant_id: 7 });
    await caller.queues.get({ id: 4 });
    expect(db.query.mock.calls[1][0]).toContain("sa.status = 'active'");
    expect(db.query.mock.calls[1][0]).toContain("e.type = 'user'");
    expect(db.query.mock.calls[4][0]).toContain("sa.user_id IS NOT NULL");
  });

  it("invalidates the tenant-qualified queue dialplan after agent login changes", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: [] });
    const caller = ivrRouter.createCaller(context());
    await caller.queues.agentLogin({ queue_id: 4, extension_id: 10 });
    expect(cache.invalidateCache).toHaveBeenCalledWith("dialplan:queue:7:4");

    db.query.mockReset();
    cache.invalidateCache.mockClear();
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: [] });
    await caller.queues.agentLogout({ queue_id: 4, extension_id: 10 });
    expect(cache.invalidateCache).toHaveBeenCalledWith("dialplan:queue:7:4");
  });

  it("rejects malformed or duplicate DTMF keys before replacing a menu", async () => {
    const caller = ivrRouter.createCaller(context());
    await expect(caller.ivr.setActions({
      menu_id: 41,
      actions: [{ digit: "A", action_type: "hangup" }],
    })).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();

    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 41 }] });
    await expect(caller.ivr.setActions({
      menu_id: 41,
      actions: [
        { digit: "1", action_type: "hangup" },
        { digit: "1", action_type: "repeat" },
      ],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM ivr_actions"))).toBe(false);
  });

  it("rejects a destination outside the active workspace before deleting existing actions", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 41 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(ivrRouter.createCaller(context()).ivr.setActions({
      menu_id: 41,
      actions: [{ digit: "1", action_type: "transfer_ext", target: " 9001 " }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM ivr_actions"))).toBe(false);
  });

  it("validates and trims an in-workspace extension target before persistence", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 41 }] })
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    await ivrRouter.createCaller(context()).ivr.setActions({
      menu_id: 41,
      actions: [{ digit: "1", action_type: "transfer_ext", target: " 3001 " }],
    });
    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO ivr_actions"));
    expect(insert?.[1]).toEqual([41, "1", "transfer_ext", "3001", undefined, 0]);
    expect(cache.invalidateCache).toHaveBeenCalledWith("dialplan:ivr:41");
  });

  it("does not accept routes whose dialplan consumer is unsupported", async () => {
    for (const action_type of ["external_number", "time_condition"] as const) {
      await expect(ivrRouter.createCaller(context()).ivr.setActions({
        menu_id: 41,
        actions: [{ digit: "1", action_type } as any],
      })).rejects.toThrow();
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  it("rejects a time-condition destination outside the active workspace before replacing rules", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 6 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(ivrRouter.createCaller(context()).timeConditions.update({
      id: 6,
      name: "Main office",
      timezone: "Asia/Bangkok",
      match_action: "transfer",
      match_target: "3001",
      nomatch_action: "hangup",
      rules: [{ day_of_week: [1, 2, 3, 4, 5], start_time: "09:00", end_time: "18:00" }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE time_conditions"))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM time_condition_rules"))).toBe(false);
  });

  it("updates a time condition and its weekday rules atomically after tenant validation", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 6 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ id: 6, name: "Main office" }] });

    await expect(ivrRouter.createCaller(context()).timeConditions.update({
      id: 6,
      name: " Main office ",
      description: "Monday–Friday, 08:30–17:30",
      timezone: "Asia/Bangkok",
      match_action: "transfer",
      match_target: " 3001 ",
      nomatch_action: "hangup",
      rules: [{ day_of_week: [1, 2, 3, 4, 5], start_time: "08:30", end_time: "17:30" }],
    })).resolves.toEqual({ id: 6, name: "Main office" });

    const update = db.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE time_conditions"));
    expect(update?.[1]).toEqual([6, "Main office", "Monday–Friday, 08:30–17:30", "Asia/Bangkok", "transfer", "3001", "hangup", null, 7]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM time_condition_rules"))).toBe(true);
    expect(cache.invalidateCache).toHaveBeenCalledWith("dialplan:timecondition:7:6");
  });

  it("rejects unavailable ring-group fallbacks before writing a group", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(ivrRouter.createCaller(context()).ringGroups.create({
      tenant_id: 7,
      name: "Support",
      strategy: "simultaneous",
      fallback_action: "voicemail",
      fallback_target: "3001",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(db.query.mock.calls[1][0]).toContain("e.voicemail_enabled = true");
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO ring_groups"))).toBe(false);
  });

  it("requires an active in-workspace IVR fallback and tenant-qualifies its cache", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: "Support" }] });

    await expect(ivrRouter.createCaller(context()).ringGroups.create({
      tenant_id: 7,
      name: "Support",
      strategy: "sequential",
      fallback_action: "ivr",
      fallback_target: "12",
    })).resolves.toEqual({ id: 4, name: "Support" });

    expect(db.query.mock.calls[1][0]).toContain("FROM ivr_menus");
    expect(db.query.mock.calls[1][0]).toContain("is_active = true");
    expect(cache.invalidateCache).toHaveBeenCalledWith("dialplan:ringgroup:7:4");
  });

  it("persists a cleared ring-group extension as null", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ fallback_action: "hangup", fallback_target: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 4, extension: null }] });

    await expect(ivrRouter.createCaller(context()).ringGroups.update({
      id: 4,
      extension: null,
    })).resolves.toEqual({ id: 4, extension: null });

    const update = db.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE ring_groups"));
    expect(update?.[0]).toContain("extension = $2");
    expect(update?.[1]).toContain(null);
  });
});
