import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("../server/pbx/db", () => ({ query: db.query, withTransaction: db.withTransaction }));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
  invalidateCache: vi.fn(),
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
});
