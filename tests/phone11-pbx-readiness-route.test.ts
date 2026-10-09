import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const state = vi.hoisted(() => ({ role: "admin", live: vi.fn(), observe: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../server/pbx/database-readiness", () => ({ readPbxDatabaseReadiness: state.observe }));
vi.mock("../server/pbx/tenant-middleware", () => ({
  resolveTenantContext: vi.fn(async (_user, tenant) => { if (tenant !== 7) throw new TRPCError({ code: "FORBIDDEN" }); return { tenantId: 7, role: state.role, memberships: [{ tenantId: 7 }] }; }),
  hasRole: (role: string) => role === "owner" || role === "admin",
  requireLiveTenantAdminMembership: state.live,
  validateTenantOwnership: vi.fn(),
}));
vi.mock("../server/pbx/redis", () => ({ invalidateCache: vi.fn() }));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: vi.fn(), queryAuditLogs: vi.fn() }));
vi.mock("../server/pbx/sip-secrets", () => ({ createSipCredentials: vi.fn(), regenerateSipCredentials: vi.fn(), decryptSecret: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({ getCallStats: vi.fn(), getVoicemails: vi.fn() }));
vi.mock("../server/profile/photo", () => ({ profilePhotoDescriptors: vi.fn() }));
// eslint-disable-next-line import/first
import { pbxRouter } from "../server/pbx/pbx-router";

const context = (user: unknown = { id: 9, role: "user" }, header = "1") => ({ user, req: { method: "GET", headers: { "x-phone11-read-only-probe": header } }, res: { setHeader: vi.fn() } }) as any;
beforeEach(() => { state.role = "admin"; state.live.mockReset().mockResolvedValue("admin"); state.observe.mockReset().mockResolvedValue({ status: "unavailable", reason: "NOT_COMMISSIONED" }); });
describe("selected-tenant PBX readiness route", () => {
  it("enters the bounded helper directly without a separate shared-pool authority lookup", async () => {
    state.live.mockImplementation(() => new Promise(() => {}));
    await expect(pbxRouter.createCaller(context()).databaseReadiness({ tenantId: 7 })).resolves.toEqual({ status: "unavailable", reason: "NOT_COMMISSIONED" });
    expect(state.live).not.toHaveBeenCalled(); expect(state.observe).toHaveBeenCalledWith(9, 7);
  });
  it("rejects anonymous requests before diagnostic", async () => { await expect(pbxRouter.createCaller(context(null)).databaseReadiness({ tenantId: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(state.observe).not.toHaveBeenCalled(); });
  it("does not admit a global admin refused by the helper's live tenant guard", async () => { state.observe.mockResolvedValue({ status: "forbidden" }); await expect(pbxRouter.createCaller(context({ id: 9, role: "admin" })).databaseReadiness({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(state.observe).toHaveBeenCalledWith(9, 7); });
  it.each([undefined, { tenantId: 0 }, { tenantId: 7, serverAddress: "other" }])("requires strict explicit selection", async input => { await expect(pbxRouter.createCaller(context()).databaseReadiness(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state.observe).not.toHaveBeenCalled(); });
  it("passes the exact selected tenant to the helper and sanitizes its authority refusal", async () => {
    state.observe.mockResolvedValue({ status: "forbidden" });
    await expect(pbxRouter.createCaller(context()).databaseReadiness({ tenantId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Workspace administrator access is required" });
    expect(state.observe).toHaveBeenCalledWith(9, 8); expect(state.live).not.toHaveBeenCalled();
  });
  it("denies a direct caller without readonly protocol", async () => { await expect(pbxRouter.createCaller(context(undefined, "0")).databaseReadiness({ tenantId: 7 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state.observe).not.toHaveBeenCalled(); });
  it("returns only the helper's sanitized failure", async () => { state.observe.mockResolvedValue({ status: "unavailable", reason: "OBSERVATION_FAILED" }); await expect(pbxRouter.createCaller(context()).databaseReadiness({ tenantId: 7 })).resolves.toEqual({ status: "unavailable", reason: "OBSERVATION_FAILED" }); expect(state.live).not.toHaveBeenCalled(); });
  it("turns final helper revocation into constant forbidden response", async () => { state.observe.mockResolvedValue({ status: "forbidden" }); await expect(pbxRouter.createCaller(context()).databaseReadiness({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Workspace administrator access is required" }); });
});
