import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("../server/pbx/db", () => ({
  query: db.query,
  withTransaction: db.withTransaction,
}));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
  invalidateCache: vi.fn(),
}));
vi.mock("../server/pbx/audit", () => ({
  writeAuditLog: vi.fn(),
  queryAuditLogs: vi.fn(),
}));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: vi.fn(),
  regenerateSipCredentials: vi.fn(),
  decryptSecret: vi.fn(),
}));
vi.mock("../server/pbx/cdr-processor", () => ({
  getCallStats: vi.fn(),
  getVoicemails: vi.fn(),
}));

// The router must load after its database and service modules are mocked.
// eslint-disable-next-line import/first
import { pbxRouter } from "../server/pbx/pbx-router";

const context = (globalRole = "user") =>
  ({
    user: { id: 9, role: globalRole },
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
  }) as any;

const membership = (
  role: "owner" | "admin" | "manager" | "user",
  tenantId = 7,
) => ({
  id: 1,
  user_id: 9,
  tenant_id: tenantId,
  role,
  is_default: true,
  tenant_name: "Acme",
  tenant_slug: "acme",
  tenant_status: "active",
});

beforeEach(() => {
  vi.clearAllMocks();
  db.withTransaction.mockImplementation(async (callback) =>
    callback({ query: db.query }),
  );
});

describe("PBX workspace administrator authorization", () => {
  it.each(["owner", "admin"] as const)(
    "allows a workspace %s with an ordinary platform account",
    async (role) => {
      db.query.mockResolvedValueOnce({ rows: [membership(role)] });

      await expect(
        pbxRouter
          .createCaller(context("user"))
          .tenant.updateSettings({ tenantId: 7 }),
      ).resolves.toEqual({ success: true });
    },
  );

  it.each(["manager", "user"] as const)(
    "denies a workspace %s before any PBX mutation",
    async (role) => {
      db.query.mockResolvedValueOnce({ rows: [membership(role)] });

      await expect(
        pbxRouter
          .createCaller(context("admin"))
          .tenant.updateSettings({ tenantId: 7 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.query).toHaveBeenCalledTimes(1);
    },
  );

  it("denies a requested workspace outside the user's memberships", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership("owner", 7)] });

    await expect(
      pbxRouter
        .createCaller(context("admin"))
        .tenant.updateSettings({ tenantId: 99 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("uses tenant membership authorization across every PBX admin entry point", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/pbx/pbx-router.ts"),
      "utf8",
    );
    expect(source).not.toContain("adminProcedure");
    expect(source.match(/await getTenantAdminCtx\(ctx/g)).toHaveLength(14);
  });
});

describe("DID route assignment", () => {
  it.each([
    ["extension", "extensions", "status = 'active'"],
    ["ring_group", "ring_groups", "is_active = true"],
    ["queue", "call_queues", "is_active = true"],
    ["ivr", "ivr_menus", "is_active = true"],
    ["time_condition", "time_conditions", "tenant_id = $2"],
  ] as const)(
    "accepts a tenant-owned %s destination",
    async (routeType, table, activeCondition) => {
      db.query
        .mockResolvedValueOnce({ rows: [membership("admin")] })
        .mockResolvedValueOnce({ rows: [{ id: 44 }] })
        .mockResolvedValueOnce({ rows: [{ id: 23 }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
          id: 44,
          assignedRouteType: routeType,
          assignedRouteId: 23,
        }),
      ).resolves.toEqual({ success: true });

      expect(db.query.mock.calls[2][0]).toContain(`FROM ${table}`);
      expect(db.query.mock.calls[2][0]).toContain(activeCondition);
      expect(db.query.mock.calls[2][1]).toEqual([23, 7]);
      expect(db.query.mock.calls[3][0]).toContain("UPDATE phone_numbers");
    },
  );

  it("rejects a missing or cross-tenant destination before updating the DID", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
        id: 44,
        assignedRouteType: "queue",
        assignedRouteId: 99,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE phone_numbers"),
      ),
    ).toBe(false);
  });

  it.each([
    { assignedRouteType: "ivr" as const, assignedRouteId: null },
    { assignedRouteType: null, assignedRouteId: 23 },
  ])("rejects an incomplete destination pair", async (route) => {
    await expect(
      pbxRouter.createCaller(context()).phoneNumbers.assignRoute({
        id: 44,
        ...route,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("allows an administrator to clear a DID route", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
        id: 44,
        assignedRouteType: null,
        assignedRouteId: null,
      }),
    ).resolves.toEqual({ success: true });
    expect(db.query.mock.calls[2][0]).toContain("UPDATE phone_numbers");
  });
});
