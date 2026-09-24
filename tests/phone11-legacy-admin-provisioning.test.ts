import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn() }));
const provisioning = vi.hoisted(() => ({
  getPhoneConfig: vi.fn(),
  ensurePilotExtensionForUser: vi.fn(),
  assignExtensionToUser: vi.fn(),
  listExtensions: vi.fn(),
  createExtension: vi.fn(),
  listOrganizations: vi.fn(),
  listDidNumbers: vi.fn(),
  createDidNumber: vi.fn(),
}));

vi.mock("../server/pbx/db", () => ({
  getPool: () => ({ query: db.query }),
  query: db.query,
  withTransaction: db.withTransaction,
}));
vi.mock("../server/phone-provisioning", () => provisioning);

import { appRouter } from "../server/routers";

const context = (role = "user") =>
  ({ user: { id: 9, role }, req: { headers: {} }, res: {} }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("legacy phone administration tenant isolation", () => {
  it("keeps ordinary phone configuration independent of management workspace selection", async () => {
    provisioning.getPhoneConfig.mockResolvedValueOnce({ extension: "4101" });

    await expect(
      appRouter.createCaller(context()).phone.getConfig(),
    ).resolves.toEqual({ extension: "4101" });

    expect(provisioning.getPhoneConfig).toHaveBeenCalledWith(9, undefined);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("does not let a global administrator select a tenant without a live workspace-admin membership", async () => {
    db.query.mockResolvedValue({ rows: [] });

    await expect(
      appRouter.createCaller(context("admin")).phone.createExtension({
        orgId: 81,
        extensionNumber: "4101",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(provisioning.createExtension).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("tm.status = 'active'"),
      [9, 81],
    );
    expect(db.query.mock.calls[0][0]).toContain("tm.role IN ('owner', 'admin')");
  });

  it("binds a tenant administrator's extension and DID writes to the authorized tenant", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] });
    provisioning.createExtension.mockResolvedValue({ id: 41 });
    provisioning.createDidNumber.mockResolvedValue({ id: 73 });
    const caller = appRouter.createCaller(context());

    await expect(caller.phone.createExtension({ orgId: 7, extensionNumber: "4101" })).resolves.toEqual({ id: 41 });
    await expect(caller.phone.createDid({ orgId: 7, number: "+6620000000" })).resolves.toEqual({ id: 73 });

    expect(provisioning.createExtension).toHaveBeenCalledWith(expect.objectContaining({ orgId: 7 }));
    expect(provisioning.createExtension).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 9 }));
    expect(provisioning.createDidNumber).toHaveBeenCalledWith(expect.objectContaining({ orgId: 7 }));
    expect(db.query.mock.calls.map(([, values]) => values)).toEqual([[9, 7], [9, 7]]);
  });

  it("ignores a caller-supplied weak SIP password and uses server-generated credentials", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] });
    provisioning.createExtension.mockResolvedValueOnce({ id: 41 });
    await appRouter.createCaller(context()).phone.createExtension({
      orgId: 7, extensionNumber: "4101", password: "1",
    } as any);
    expect(provisioning.createExtension.mock.calls[0][0]).not.toHaveProperty("password");
  });

  it.each(["createExtension", "createDid"] as const)(
    "requires an explicit workspace for ambiguous %s writes",
    async (operation) => {
      db.query.mockResolvedValueOnce({
        rows: [{ tenant_id: 7 }, { tenant_id: 8 }],
      });
      const caller = appRouter.createCaller(context());
      const request = operation === "createExtension"
        ? caller.phone.createExtension({ extensionNumber: "4101" })
        : caller.phone.createDid({ number: "+6620000000" });

      await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(provisioning.createExtension).not.toHaveBeenCalled();
      expect(provisioning.createDidNumber).not.toHaveBeenCalled();
      expect(String(db.query.mock.calls[0][0])).not.toContain("tm.is_default");
    },
  );

  it("preserves the oldest authorized workspace for a legacy read without a selection", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ tenant_id: 7 }, { tenant_id: 8 }],
    });
    provisioning.listExtensions.mockResolvedValueOnce([{ id: 41 }]);

    await expect(
      appRouter.createCaller(context()).phone.listExtensions(),
    ).resolves.toEqual([{ id: 41 }]);

    expect(provisioning.listExtensions).toHaveBeenCalledWith(7);
    expect(String(db.query.mock.calls[0][0])).toContain("tm.created_at ASC");
    expect(String(db.query.mock.calls[0][0])).not.toContain("tm.is_default");
  });

  it("does not assign an extension from another tenant even when the caller is a platform administrator", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 18 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      appRouter.createCaller(context("admin")).phone.assignExtension({ userId: 44, extensionId: 501 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(db.query.mock.calls[1]).toEqual([
      expect.stringContaining("tm.tenant_id = $2"),
      [9, 18],
    ]);
    expect(provisioning.assignExtensionToUser).not.toHaveBeenCalled();
  });

  it("keeps ordinary pilot synchronization on the server-owned provisioning path", () => {
    const source = readFileSync(resolve(process.cwd(), "app/settings/sip.tsx"), "utf8");

    expect(source).toContain("return ensurePilotConfig.mutateAsync();");
    expect(source).not.toContain("trpc.phone.createExtension.useMutation()");
    expect(source).not.toContain("trpc.phone.assignExtension.useMutation()");
    expect(source).not.toContain("falling back to admin APIs");
  });
});
