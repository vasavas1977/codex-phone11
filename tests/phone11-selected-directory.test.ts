import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: state.query, withTransaction: vi.fn() }));
vi.mock("../server/pbx/tenant-middleware", () => ({
  resolveTenantContext: vi.fn(), hasRole: vi.fn(), validateTenantOwnership: vi.fn(),
}));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: vi.fn(), queryAuditLogs: vi.fn() }));
vi.mock("../server/pbx/redis", () => ({ invalidateCache: vi.fn(), cacheGetOrSet: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({ getCallStats: vi.fn(), getVoicemails: vi.fn() }));

import { pbxRouter } from "../server/pbx/pbx-router";

const caller = pbxRouter.createCaller({
  user: { id: 9, role: "user" }, req: { headers: {} }, res: {},
} as any);

beforeEach(() => {
  state.query.mockReset();
  state.query.mockImplementation(async (sql: string) => sql.includes("SELECT 1 FROM tenant_memberships tm") &&
    !sql.includes("WITH authorized") ? { rows: [{ one: 1 }] } : { rows: [] });
});

describe("selected-tenant phone directory", () => {
  it("requires an explicit valid tenant and bounded inputs before reading data", async () => {
    for (const input of [{}, { tenantId: 0 }, { tenantId: 7, limit: 51 },
      { tenantId: 7, offset: 1001 }, { tenantId: 7, search: "x".repeat(65) },
      { tenantId: 7, search: "A\nB" }, { tenantId: 7, extra: true }]) {
      await expect(caller.directory.list(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(state.query).not.toHaveBeenCalled();
  });

  it("rejects a missing, suspended, unassigned or revoked caller without a directory read", async () => {
    state.query.mockResolvedValue({ rows: [] });
    await expect(caller.directory.list({ tenantId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.query).toHaveBeenCalledTimes(1);
    const [sql, params] = state.query.mock.calls[0];
    expect(params).toEqual([9, 8]);
    expect(sql).toContain("tm.status = 'active'");
    expect(sql).toContain("t.status = 'active'");
    expect(sql).toContain("caller.status = 'active'");
    expect(sql).toContain("caller.deleted_at IS NULL");
    expect(sql).toContain("caller.user_id = tm.user_id");
    expect(sql).toContain("cue.user_id = tm.user_id");
  });

  it("returns only minimal fields, echoes selected tenant, and bounds each page", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ one: 1 }] }).mockResolvedValueOnce({ rows: [
      { id: 2, name: "Jane", number: "3001", sip_password: "hidden" },
      { id: 3, name: "Alex", number: "3002", sip_password: "hidden" },
    ] });
    const page = await caller.directory.list({ tenantId: 7, search: "Ja", limit: 1, offset: 20 });
    expect(page).toEqual({ tenantId: 7, items: [{ id: 2, name: "Jane", number: "3001" }], nextOffset: 21 });
    const [sql, params] = state.query.mock.calls[1];
    expect(params).toEqual([9, 7, "%Ja%", 2, 20]);
    expect(sql).toContain("WITH authorized AS");
    expect(sql).toContain("JOIN authorized ON TRUE");
    expect(sql).toContain("e.tenant_id = $2");
    expect(sql).toContain("e.status = 'active'");
    expect(sql).toContain("member.status = 'active'");
    expect(sql).toContain("e.deleted_at IS NULL");
    expect(sql).not.toContain("e.*");
    expect(sql).not.toContain("sip_password");
  });

  it("treats SQL wildcard characters in a name search as literal text", async () => {
    await caller.directory.list({ tenantId: 7, search: "A%_\\" });
    expect(state.query.mock.calls[1][1][2]).toBe("%A\\%\\_\\\\%");
  });

  it("does not disclose directory rows after membership is revoked between reads", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ one: 1 }] }).mockResolvedValueOnce({ rows: [] });
    const page = await caller.directory.list({ tenantId: 7 });
    expect(page.items).toEqual([]);
    expect(state.query.mock.calls[1][0]).toContain("tm.status = 'active'");
  });
});
