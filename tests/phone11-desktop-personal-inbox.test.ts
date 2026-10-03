import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(), markRead: vi.fn(), remove: vi.fn(), storage: vi.fn(), voicemails: vi.fn() }));

vi.mock("../server/pbx/db", () => ({ query: db.query, withTransaction: vi.fn() }));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn(async (_key, _ttl, callback) => callback()),
  invalidateCache: vi.fn(),
}));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: vi.fn(), queryAuditLogs: vi.fn() }));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: vi.fn(), regenerateSipCredentials: vi.fn(),
}));
vi.mock("../server/pbx/cdr-processor", () => ({
  getCallStats: vi.fn(), getVoicemails: db.voicemails, requireVoicemailStorage: db.storage,
  VoicemailStorageUnavailableError: class extends Error {},
}));
vi.mock("../server/pbx/voicemail-access", () => ({
  countVoicemails: vi.fn(), deleteVoicemail: db.remove,
  markVoicemailRead: db.markRead, voicemailStorageStatus: vi.fn(),
}));
vi.mock("../server/profile/photo", () => ({ profilePhotoDescriptors: vi.fn() }));

import { pbxRouter } from "../server/pbx/pbx-router";
import { VoicemailStorageUnavailableError } from "../server/pbx/cdr-processor";

const ctx = () => ({ user: { id: 9, role: "user" }, req: { ip: "127.0.0.1", headers: {} }, res: {} }) as any;
const membership = (tenantId: number) => ({
  user_id: 9, tenant_id: tenantId, role: "user", is_default: null,
  tenant_name: `Workspace ${tenantId}`, tenant_slug: null, tenant_status: "active",
});
const summary = { total_calls: "1", answered_calls: "1", missed_calls: "0", total_duration_seconds: "12" };

beforeEach(() => {
  db.query.mockReset();
  db.markRead.mockReset();
  db.remove.mockReset();
  db.storage.mockReset();
  db.voicemails.mockReset();
  db.storage.mockResolvedValue(undefined);
  db.markRead.mockResolvedValue(true);
  db.remove.mockResolvedValue(true);
});

describe("pbx.selfService.usage tenant selection", () => {
  it("rejects a nonmember before any call-record read", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(8)] });
    await expect(pbxRouter.createCaller(ctx()).selfService.usage({ tenantId: 7 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain("tm.user_id = $1");
    expect(db.query.mock.calls[0][1]).toEqual([9]);
  });

  it("uses explicit tenant with existing call-time ownership and the legacy response shape", async () => {
    const call = { id: 22, direction: "internal", disposition: "answered",
      caller_number: "3001", callee_number: "1020", total_duration_seconds: 12,
      started_at: new Date("2026-09-27T00:00:00Z") };
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] })
      .mockResolvedValueOnce({ rows: [summary] })
      .mockResolvedValueOnce({ rows: [call] });
    await expect(pbxRouter.createCaller(ctx()).selfService.usage({ tenantId: 8, period: "month" }))
      .resolves.toEqual({ tenantId: 8, totalCalls: 1, answeredCalls: 1, missedCalls: 0,
        totalDurationSeconds: 12, calls: [call] });
    for (const [sql, values] of db.query.mock.calls.slice(1)) {
      expect(sql).toContain("cr.tenant_id = $1");
      expect(sql).toContain("cr.caller_user_id = $2");
      expect(sql).toContain("cr.callee_user_id = $2");
      expect(sql).toContain("JOIN extensions e");
      expect(sql).not.toContain("JOIN user_extensions ue");
      expect(sql).not.toMatch(/cr\.\*|recording_url|metadata/i);
      expect(values).toEqual([8, 9, "30 days"]);
    }
    expect(db.query.mock.calls[2][0]).toContain("LIMIT 50");
    expect(db.query.mock.calls[2][0]).toContain("cr.from_number AS caller_number");
    expect(db.query.mock.calls[2][0]).toContain("cr.to_number AS callee_number");
  });

  it("preserves the omitted-tenant and week defaults while validating tenant selection", async () => {
    const caller = pbxRouter.createCaller(ctx());
    for (const tenantId of [0, -1, 1.5]) {
      await expect(caller.selfService.usage({ tenantId } as any))
        .rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(db.query).not.toHaveBeenCalled();
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] })
      .mockResolvedValueOnce({ rows: [summary] }).mockResolvedValueOnce({ rows: [] });
    await expect(caller.selfService.usage({ period: "week" })).resolves.toMatchObject({ tenantId: 7, totalCalls: 1, calls: [] });
    expect(db.query.mock.calls[1][1]).toEqual([7, 9, "7 days"]);
    expect(db.query.mock.calls[2][1]).toEqual([7, 9, "7 days"]);
    db.query.mockResolvedValueOnce({ rows: [membership(7)] })
      .mockResolvedValueOnce({ rows: [summary] }).mockResolvedValueOnce({ rows: [] });
    await expect(caller.selfService.usage()).resolves.toMatchObject({ tenantId: 7, totalCalls: 1, calls: [] });
    expect(db.query.mock.calls[4][1]).toEqual([7, 9, "30 days"]);
    expect(db.query.mock.calls[5][1]).toEqual([7, 9, "30 days"]);
  });
});

describe("pbx.selfService.callHistory", () => {
  it("rejects invalid page input before any database read", async () => {
    const caller = pbxRouter.createCaller(ctx());
    await expect(caller.selfService.callHistory({ tenantId: 7, limit: 101 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.selfService.callHistory({ tenantId: 7, cursor: { startedAt: "bad", id: 1 } }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("rejects a nonmember before the live assignment or CDR read", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(8)] });
    await expect(pbxRouter.createCaller(ctx()).selfService.callHistory({ tenantId: 7 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("uses the selected tenant and denies a member who lost the active assignment", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(pbxRouter.createCaller(ctx()).selfService.callHistory({ tenantId: 8 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][1]).toEqual([9, 8]);
  });

  it("returns a bounded page using the authenticated user, tenant and cursor", async () => {
    const cursor = { startedAt: "2026-09-29T10:00:00.000Z", id: 29 };
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] })
      .mockResolvedValueOnce({ rows: [{ one: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(pbxRouter.createCaller(ctx()).selfService.callHistory({ tenantId: 8, limit: 10, cursor }))
      .resolves.toEqual({ tenantId: 8, items: [], nextCursor: null });
    expect(db.query.mock.calls[2][1]).toEqual([8, 9, cursor.startedAt, cursor.id, 11]);
  });
});

describe("pbx.voicemail.markRead tenant selection", () => {
  it("uses the selected tenant and preserves omitted-tenant behavior", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] });
    await expect(pbxRouter.createCaller(ctx()).voicemail.markRead({ id: 41, tenantId: 8 }))
      .resolves.toEqual({ success: true });
    expect(db.markRead).toHaveBeenCalledWith(8, 9, 41);
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] });
    await expect(pbxRouter.createCaller(ctx()).voicemail.markRead({ id: 42 }))
      .resolves.toEqual({ success: true });
    expect(db.markRead).toHaveBeenLastCalledWith(7, 9, 42);
  });

  it("denies a nonmember before touching voicemail storage", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7)] });
    await expect(pbxRouter.createCaller(ctx()).voicemail.markRead({ id: 41, tenantId: 8 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.storage).not.toHaveBeenCalled();
    expect(db.markRead).not.toHaveBeenCalled();
  });

  it("returns a non-disclosing false acknowledgment when no owned unread row changed", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7)] });
    db.markRead.mockResolvedValueOnce(false);
    await expect(pbxRouter.createCaller(ctx()).voicemail.markRead({ id: 41 }))
      .resolves.toEqual({ success: false });
    expect(db.markRead).toHaveBeenCalledWith(7, 9, 41);
  });

  it("rejects an invalid selected tenant before membership or storage queries", async () => {
    await expect(pbxRouter.createCaller(ctx()).voicemail.markRead({ id: 41, tenantId: 0 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.storage).not.toHaveBeenCalled();
  });
});

describe("pbx.voicemail.list authoritative workspace", () => {
  it("echoes the resolved tenant on each row, overriding a spoofed row value", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] });
    db.voicemails.mockResolvedValueOnce([{ id: 41, caller_number: "1020", tenant_id: 999 }]);
    await expect(pbxRouter.createCaller(ctx()).voicemail.list({ tenantId: 8 }))
      .resolves.toEqual([{ id: 41, caller_number: "1020", tenant_id: 8 }]);
    expect(db.voicemails).toHaveBeenCalledWith(8, 9, undefined);
  });

  it("denies a nonmember before loading voicemail rows", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7)] });
    await expect(pbxRouter.createCaller(ctx()).voicemail.list({ tenantId: 8 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.voicemails).not.toHaveBeenCalled();
  });
});

describe("pbx.voicemail.delete tenant selection and acknowledgment", () => {
  it("uses the selected workspace while preserving omitted-tenant clients", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] });
    await expect(pbxRouter.createCaller(ctx()).voicemail.delete({ id: 41, tenantId: 8 }))
      .resolves.toEqual({ success: true });
    expect(db.remove).toHaveBeenCalledWith(8, 9, 41);
    db.query.mockResolvedValueOnce({ rows: [membership(7), membership(8)] });
    await expect(pbxRouter.createCaller(ctx()).voicemail.delete({ id: 42 }))
      .resolves.toEqual({ success: true });
    expect(db.remove).toHaveBeenLastCalledWith(7, 9, 42);
  });

  it("returns false without disclosing why no owned row changed", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7)] });
    db.remove.mockResolvedValueOnce(false);
    await expect(pbxRouter.createCaller(ctx()).voicemail.delete({ id: 41 }))
      .resolves.toEqual({ success: false });
  });

  it("denies a nonmember before accessing storage or deleting", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7)] });
    await expect(pbxRouter.createCaller(ctx()).voicemail.delete({ id: 41, tenantId: 8 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.storage).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
  });

  it("rejects invalid tenant selection before database access", async () => {
    await expect(pbxRouter.createCaller(ctx()).voicemail.delete({ id: 41, tenantId: 0 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
  });

  it("does not acknowledge a failed storage operation", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7)] });
    db.remove.mockRejectedValueOnce(new VoicemailStorageUnavailableError("storage unavailable"));
    await expect(pbxRouter.createCaller(ctx()).voicemail.delete({ id: 41 }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
