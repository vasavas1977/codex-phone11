import { expect, it, vi } from "vitest";
import { createProfileRouter } from "./router";
import { createProfileService, ProfileStatusUnavailableError, ProfileWorkspaceAdminAccessError } from "./service";

const context = (id: number | null) => ({
  user: id === null ? null : { id, role: "user" },
  req: {},
  res: {},
}) as never;

it("derives the administrator identity from the authenticated session and accepts only a tenant toggle", async () => {
  const adminSettings = vi.fn(async (_actorUserId: number, tenantId: number) => ({ tenantId, enabled: false, updatedBy: null, updatedAt: null }));
  const setAdminEnabled = vi.fn(async (actorUserId: number, tenantId: number, enabled: boolean) => ({ tenantId, enabled, updatedBy: actorUserId, updatedAt: new Date("2026-09-25T00:00:00Z") }));
  const service = { adminSettings, setAdminEnabled } as unknown as ReturnType<typeof createProfileService>;
  const caller = createProfileRouter(service).createCaller(context(7));
  await expect(caller.adminSettings({ tenantId: 10 })).resolves.toEqual({ tenantId: 10, enabled: false, updatedBy: null, updatedAt: null });
  await expect(caller.setAdminEnabled({ tenantId: 10, enabled: true })).resolves.toMatchObject({ tenantId: 10, enabled: true, updatedBy: 7 });
  await expect(caller.setAdminEnabled({ tenantId: 10, enabled: true, userId: 9 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(adminSettings).toHaveBeenCalledWith(7, 10);
  expect(setAdminEnabled).toHaveBeenCalledWith(7, 10, true);
});

it("requires an authenticated caller and maps unavailable schema separately from denied workspace roles", async () => {
  const service = {
    adminSettings: vi.fn(async () => { throw new ProfileWorkspaceAdminAccessError(); }),
    setAdminEnabled: vi.fn(async () => { throw new ProfileStatusUnavailableError(); }),
  } as unknown as ReturnType<typeof createProfileService>;
  const router = createProfileRouter(service);
  await expect(router.createCaller(context(null)).adminSettings({ tenantId: 10 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(router.createCaller(context(7)).adminSettings({ tenantId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(router.createCaller(context(7)).setAdminEnabled({ tenantId: 10, enabled: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});
