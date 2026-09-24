import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const db = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  lastRole: "admin",
}));

vi.mock("../server/pbx/db", () => ({
  query: db.query,
  withTransaction: db.withTransaction,
}));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn(async (_key, _ttl, callback) => {
    const memberships = await callback();
    db.lastRole = memberships[0]?.role ?? "admin";
    return memberships;
  }),
  invalidateCache: vi.fn(),
}));
vi.mock("../server/pbx/tenant-middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/pbx/tenant-middleware")>()),
  requireLiveTenantAdminMembership: vi.fn(async () => db.lastRole),
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
vi.mock("../server/profile/photo", () => ({
  profilePhotoDescriptors: vi.fn(async () => new Map()),
}));

// The router must load after its database and service modules are mocked.
// eslint-disable-next-line import/first
import { pbxRouter } from "../server/pbx/pbx-router";
// eslint-disable-next-line import/first
import { getCallStats } from "../server/pbx/cdr-processor";
// eslint-disable-next-line import/first
import { profilePhotoDescriptors } from "../server/profile/photo";
// eslint-disable-next-line import/first
import { requireLiveTenantAdminMembership } from "../server/pbx/tenant-middleware";

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
  user_id: 9,
  tenant_id: tenantId,
  role,
  is_default: null,
  tenant_name: "Acme",
  tenant_slug: null,
  tenant_status: "active",
});

const schemaRows = (tables: Record<string, readonly string[]>) =>
  Object.entries(tables).flatMap(([table_name, columns]) =>
    columns.map((column_name) => ({ table_name, column_name })),
  );

const phoneNumberSchemaRows = schemaRows({
  phone_numbers: [
    "id", "tenant_id", "number_e164", "number_display", "country",
    "number_type", "provider", "status", "assigned_route_type",
    "assigned_route_id", "e911_address_id", "deleted_at", "updated_at",
  ],
  emergency_addresses: ["id", "tenant_id", "street", "city"],
});

const tenantSettingsSchemaRows = schemaRows({
  tenant_settings: [
    "tenant_id", "default_caller_id", "emergency_address_required",
    "recording_default_policy", "voicemail_default_enabled",
    "business_hours_timezone", "max_ring_timeout_seconds", "created_at", "updated_at",
  ],
});

const advancedRoutingSchemaRows = schemaRows({
  call_queues: [
    "id", "tenant_id", "name", "description", "extension", "strategy",
    "max_wait_time", "max_callers", "wrap_up_time", "announce_position",
    "announce_frequency", "moh_file", "join_announcement",
    "agent_announcement", "overflow_action", "overflow_target",
    "service_level_secs", "record_calls", "is_active", "created_at", "updated_at",
  ],
  queue_agents: [
    "queue_id", "extension_id", "priority", "skills", "max_no_answer",
    "is_logged_in", "last_call_at", "created_at", "updated_at",
  ],
  queue_stats: [
    "queue_id", "interval_start", "interval_end", "offered_calls",
    "answered_calls", "abandoned_calls", "overflowed_calls",
    "service_level_calls", "total_wait_seconds", "total_talk_seconds",
  ],
  extensions: [
    "id", "tenant_id", "extension_number", "display_name", "first_name",
    "last_name", "type", "user_id", "status", "deleted_at",
  ],
  sip_accounts: ["extension_id", "tenant_id", "user_id", "status", "deleted_at"],
  ivr_menus: [
    "id", "tenant_id", "name", "description", "greeting_file", "greeting_tts",
    "timeout_ms", "max_retries", "digit_timeout_ms", "invalid_sound",
    "exit_action", "exit_target", "is_active", "created_at", "updated_at",
  ],
  ivr_actions: [
    "id", "menu_id", "digit", "action_type", "target", "description",
    "sort_order", "created_at",
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  db.lastRole = "admin";
  db.withTransaction.mockImplementation(async (callback) =>
    callback({ query: db.query }),
  );
});

describe("PBX selected workspace reads", () => {
  const memberships = [membership("admin", 7), membership("owner", 12)];

  it("lists memberships without selecting a workspace", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships });
    await expect(pbxRouter.createCaller(context()).tenant.memberships()).resolves.toMatchObject([
      { tenantId: 7, role: "admin" },
      { tenantId: 12, role: "owner" },
    ]);
  });

  it.each([
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.tenant.people(),
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.tenant.members(),
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.extensions.list(),
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.phoneNumbers.list(),
  ])("refuses an unselected multi-workspace admin read", async (read) => {
    db.query.mockResolvedValueOnce({ rows: memberships });
    await expect(read(pbxRouter.createCaller(context()))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("rejects an unjoined workspace before any directory read", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships });
    await expect(pbxRouter.createCaller(context()).tenant.members({ tenantId: 99 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("rejects a selected workspace where the user lacks administrator role", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership("admin", 7), membership("user", 12)] });
    await expect(pbxRouter.createCaller(context()).tenant.people({ tenantId: 12 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.tenant.updateMember({ userId: 88, status: "inactive" }),
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.extensions.create({ extensionNumber: "3101" }),
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.extensions.update({ id: 1, displayName: "Nok" }),
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.extensions.delete({ id: 1 }),
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.extensions.resetPassword({ extensionId: 1 }),
    (caller: ReturnType<typeof pbxRouter.createCaller>) => caller.phoneNumbers.assignRoute({ id: 44, assignedRouteType: null, assignedRouteId: null }),
  ])("refuses an unselected multi-workspace admin mutation", async (write) => {
    db.query.mockResolvedValueOnce({ rows: memberships });
    await expect(write(pbxRouter.createCaller(context()))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("rejects a cached administrator after live membership revocation", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership("admin")] });
    vi.mocked(requireLiveTenantAdminMembership).mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access has changed" }),
    );
    await expect(pbxRouter.createCaller(context()).extensions.create({ extensionNumber: "3101" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.withTransaction).not.toHaveBeenCalled();
    expect(requireLiveTenantAdminMembership).toHaveBeenCalledWith(9, 7);
  });

  it("checks the live admin role in the selected workspace", async () => {
    const live = await vi.importActual<typeof import("../server/pbx/tenant-middleware")>(
      "../server/pbx/tenant-middleware",
    );
    db.query.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
    await expect(live.requireLiveTenantAdminMembership(9, 12)).resolves.toBe("owner");
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("tm.role::text IN ('owner', 'admin')"),
      [9, 12],
    );

    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(live.requireLiveTenantAdminMembership(9, 99))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolves an explicit tenant detail read without changing the legacy default read", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 12, name: "Second workspace", live_user_role: "owner" }] });
    await expect(pbxRouter.createCaller(context()).tenant.get({ tenantId: 12 }))
      .resolves.toMatchObject({ id: 12, userRole: "owner" });
    expect(db.query.mock.calls[2][1]).toEqual([12, 9]);

    vi.clearAllMocks();
    db.query.mockResolvedValueOnce({ rows: memberships })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7, name: "Acme", live_user_role: "admin" }] });
    await expect(pbxRouter.createCaller(context()).tenant.get())
      .resolves.toMatchObject({ id: 7, userRole: "admin" });
  });

  it("denies tenant details after membership revocation despite a cached membership", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(pbxRouter.createCaller(context()).tenant.get({ tenantId: 12 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query.mock.calls[2][0]).toContain("actor_tm.status = 'active'");
    expect(db.query.mock.calls[2][1]).toEqual([12, 9]);
  });

  it("returns the current role when a cached administrator has become a member", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7, name: "Acme", live_user_role: "user" }] });
    await expect(pbxRouter.createCaller(context()).tenant.get())
      .resolves.toMatchObject({ id: 7, userRole: "user" });
  });

  it("scopes selected member and extension lists to the requested membership", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships }).mockResolvedValueOnce({ rows: [] });
    await expect(pbxRouter.createCaller(context()).tenant.members({ tenantId: 12 })).resolves.toEqual([]);
    expect(db.query.mock.calls[1][1]).toEqual([12, 9]);

    vi.clearAllMocks();
    db.query.mockResolvedValueOnce({ rows: memberships })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] });
    await expect(pbxRouter.createCaller(context()).extensions.list({ tenantId: 12, page: 1 }))
      .resolves.toMatchObject({ pagination: { total: 0 } });
    expect(db.query.mock.calls[1][1][0]).toBe(12);
    expect(db.query.mock.calls[2][1]).toEqual([12, 9]);
  });

  it("reads only the selected workspace's phone number inventory", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships })
      .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
      .mockResolvedValueOnce({ rows: [{ id: 44, tenant_id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    await expect(pbxRouter.createCaller(context()).phoneNumbers.list({ tenantId: 12 }))
      .resolves.toMatchObject({ available: true, data: [{ id: 44, tenant_id: 12 }] });
    expect(requireLiveTenantAdminMembership).toHaveBeenCalledWith(9, 12);
    expect(db.query.mock.calls[2][1][0]).toBe(12);
    expect(db.query.mock.calls[3][1][0]).toBe(12);
    // The row and count reads also enforce current membership, rather than
    // relying only on the pre-read role check if revocation races that check.
    expect(db.query.mock.calls[2][0]).toContain("actor_tm.status = 'active'");
    expect(db.query.mock.calls[2][0]).toContain("actor_tm.role::text IN ('owner', 'admin')");
    expect(db.query.mock.calls[2][1][3]).toBe(9);
    expect(db.query.mock.calls[3][0]).toContain("actor_tm.status = 'active'");
    expect(db.query.mock.calls[3][1][1]).toBe(9);
  });

  it("authorizes selected admin capabilities before checking the schema", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships })
      .mockResolvedValueOnce({ rows: phoneNumberSchemaRows });
    await expect(pbxRouter.createCaller(context()).capabilities({ tenantId: 12 }))
      .resolves.toMatchObject({ phoneNumbers: true });
    expect(requireLiveTenantAdminMembership).toHaveBeenCalledWith(9, 12);
    expect(db.query.mock.calls[1][0]).toContain("information_schema.columns");
  });

  it("does not inspect capabilities after selected admin access is revoked", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships });
    vi.mocked(requireLiveTenantAdminMembership).mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" }),
    );
    await expect(pbxRouter.createCaller(context()).capabilities({ tenantId: 12 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("denies a revoked selected phone-number read before accessing the inventory", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships });
    vi.mocked(requireLiveTenantAdminMembership).mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" }),
    );

    await expect(pbxRouter.createCaller(context()).phoneNumbers.list({ tenantId: 12 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("rejects an unjoined phone-number workspace before reading the schema", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships });
    await expect(pbxRouter.createCaller(context()).phoneNumbers.list({ tenantId: 99 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("does not route a selected phone number after its admin role is revoked", async () => {
    db.query.mockResolvedValueOnce({ rows: memberships });
    vi.mocked(requireLiveTenantAdminMembership).mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" }),
    );

    await expect(pbxRouter.createCaller(context()).phoneNumbers.assignRoute({
      tenantId: 12,
      id: 44,
      assignedRouteType: null,
      assignedRouteId: null,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe("PBX management capabilities", () => {
  it("reports every absent production facility without touching its tables", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context()).capabilities(),
    ).resolves.toEqual({
      phoneNumbers: false,
      sites: false,
      ringGroups: false,
      queues: false,
      ivr: false,
      businessHours: false,
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(String(db.query.mock.calls[0][0])).toContain("information_schema.columns");
  });

  it("recognizes the reviewed queue and IVR migration column names", async () => {
    db.query.mockResolvedValueOnce({ rows: advancedRoutingSchemaRows });

    await expect(
      pbxRouter.createCaller(context()).capabilities(),
    ).resolves.toMatchObject({ queues: true, ivr: true });

    const queriedTables = db.query.mock.calls[0][1][0] as string[];
    expect(queriedTables).toContain("queue_agents");
    expect(queriedTables).toContain("ivr_actions");
  });
});

describe("PBX workspace administrator authorization", () => {
  it("returns tenant identity with explicit unavailable settings on the production schema", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          name: "Acme",
          plan: "business",
          status: "active",
          default_caller_id: null,
          emergency_address_required: null,
          recording_default_policy: null,
          voicemail_default_enabled: null,
          business_hours_timezone: null,
          max_ring_timeout_seconds: null,
          live_user_role: "admin",
        }],
      });

    await expect(
      pbxRouter.createCaller(context()).tenant.get(),
    ).resolves.toMatchObject({
      id: 7,
      name: "Acme",
      userRole: "admin",
      settingsAvailable: false,
      default_caller_id: null,
      business_hours_timezone: null,
    });

    expect(String(db.query.mock.calls[1][0])).toContain("information_schema.columns");
    expect(String(db.query.mock.calls[2][0])).not.toContain("tenant_settings");
  });

  it("rejects tenant setting writes before accessing an absent settings table", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateSettings({
        tenantId: 7,
        businessHoursTimezone: "Asia/Bangkok",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(
      db.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE tenant_settings")),
    ).toBe(false);
  });

  it.each(["owner", "admin"] as const)(
    "allows a workspace %s with an ordinary platform account",
    async (role) => {
      db.query
        .mockResolvedValueOnce({ rows: [membership(role)] })
        .mockResolvedValueOnce({ rows: tenantSettingsSchemaRows });

      await expect(
        pbxRouter
          .createCaller(context("user"))
          .tenant.updateSettings({ tenantId: 7 }),
      ).resolves.toEqual({ success: true });
    },
  );

  it("adds an authorized tenant photo descriptor to active extension-assignment people", async () => {
    const photo = {
      userId: 88,
      photoUrl: "/api/profile/photo/7/88?v=11111111-1111-4111-8111-111111111111",
      photoVersion: "11111111-1111-4111-8111-111111111111",
      mimeType: "image/png",
    };
    vi.mocked(profilePhotoDescriptors).mockResolvedValueOnce(new Map([[88, photo]]));
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({
        rows: [{ id: 88, name: "Nok", email: "nok@example.com", assigned_extension_numbers: ["3101"], profile_photo_authorized: true }],
      });

    await expect(pbxRouter.createCaller(context()).tenant.people()).resolves.toEqual([
      {
        id: 88,
        name: "Nok",
        email: "nok@example.com",
        assigned_extension_numbers: ["3101"],
        photoUrl: photo.photoUrl,
        photoVersion: photo.photoVersion,
      },
    ]);
    expect(profilePhotoDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({ query: db.query }),
      7,
      [88],
    );
  });

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
    expect(source.match(/await getTenantAdmin(?:Read|Mutation)?Ctx\(ctx/g)).toHaveLength(26);
  });

  it.each(["updateSettings", "updateMember", "createExtension"] as const)(
    "fails closed for an ambiguous implicit %s mutation",
    async (operation) => {
      db.query.mockResolvedValueOnce({
        rows: [membership("owner", 7), membership("owner", 8)],
      });
      const caller = pbxRouter.createCaller(context());
      const request = operation === "updateSettings"
        ? caller.tenant.updateSettings({})
        : operation === "updateMember"
          ? caller.tenant.updateMember({ userId: 88, role: "admin" })
          : caller.extensions.create({ extensionNumber: "3101" });

      await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.withTransaction).not.toHaveBeenCalled();
      expect(db.query).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["owner", "admin"] as const)(
    "lists only active people in the current workspace for a %s",
    async (role) => {
      const people = [
        {
          id: 88,
          name: "Nok",
          email: "nok@example.com",
          assigned_extension_numbers: ["3101"],
        },
      ];
      db.query
        .mockResolvedValueOnce({ rows: [membership(role)] })
        .mockResolvedValueOnce({ rows: people });

      await expect(
        pbxRouter.createCaller(context("user")).tenant.people(),
      ).resolves.toEqual(people);
      expect(db.query.mock.calls[1]).toEqual([
        expect.stringContaining("FROM tenant_memberships tm"),
        [7, 9],
      ]);
      expect(db.query.mock.calls[1][0]).toContain("tm.status = 'active'");
      expect(db.query.mock.calls[1][0]).toContain("e.tenant_id = tm.tenant_id");
      expect(db.query.mock.calls[1][0]).toContain("photo_e.tenant_id = $1");
      expect(db.query.mock.calls[1][0]).not.toContain("photo_e.tenant_id = tm.tenant_id");
      expect(db.query.mock.calls[1][0]).not.toContain("secret_ciphertext");
    },
  );

  it.each(["manager", "user"] as const)(
    "denies people listing to a workspace %s",
    async (role) => {
      db.query.mockResolvedValueOnce({ rows: [membership(role)] });

      await expect(
        pbxRouter.createCaller(context("admin")).tenant.people(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.query).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["owner", "admin"] as const)(
    "allows a workspace %s to read tenant-scoped call analytics",
    async (role) => {
      const report = { summary: { total_calls: "3" } };
      db.query.mockResolvedValueOnce({ rows: [membership(role)] });
      vi.mocked(getCallStats).mockResolvedValueOnce(report as any);

      await expect(
        pbxRouter
          .createCaller(context("user"))
          .dashboard.analytics({ period: "week" }),
      ).resolves.toEqual(report);
      expect(getCallStats).toHaveBeenCalledWith(7, "week");
    },
  );

  it.each(["manager", "user"] as const)(
    "denies a workspace %s before reading call analytics",
    async (role) => {
      db.query.mockResolvedValueOnce({ rows: [membership(role)] });

      await expect(
        pbxRouter
          .createCaller(context("admin"))
          .dashboard.analytics({ period: "month" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getCallStats).not.toHaveBeenCalled();
    },
  );

  it("rejects creating an extension for a person outside the active workspace", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context("user")).extensions.create({
        extensionNumber: "3101",
        userId: 88,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(db.query.mock.calls[1]).toEqual([
      expect.stringContaining("FROM tenant_memberships"),
      [88, 7],
    ]);
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO extensions"),
      ),
    ).toBe(false);
  });

  it("rejects assigning an existing extension to a person outside the active workspace", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context("user")).extensions.update({
        id: 44,
        userId: 88,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(db.query.mock.calls[2]).toEqual([
      expect.stringContaining("FROM tenant_memberships"),
      [88, 7],
    ]);
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE extensions"),
      ),
    ).toBe(false);
  });

  it("allows assigning an existing extension to an active workspace member", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_primary: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 55 }] });

    await expect(
      pbxRouter.createCaller(context("user")).extensions.update({
        id: 44,
        userId: 88,
      }),
    ).resolves.toEqual({ success: true });

    expect(db.query.mock.calls[2]).toEqual([
      expect.stringContaining("FROM tenant_memberships"),
      [88, 7],
    ]);
    expect(db.query.mock.calls[3]).toEqual([
      expect.stringContaining(
        "WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL",
      ),
      [88, 44, 7],
    ]);
    expect(db.query.mock.calls[4]).toEqual([
      expect.stringContaining("DELETE FROM user_extensions"),
      [44, 7],
    ]);
    expect(db.query.mock.calls[6]).toEqual([
      expect.stringContaining("INSERT INTO user_extensions"),
      [88, 44, true],
    ]);
    expect(db.query.mock.calls[7]).toEqual([
      expect.stringContaining("UPDATE sip_accounts"),
      [88, 44, 7],
    ]);
  });

  it("allows an administrator to unassign an existing extension with null", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 55 }] });

    await expect(
      pbxRouter.createCaller(context("user")).extensions.update({
        id: 44,
        userId: null,
      }),
    ).resolves.toEqual({ success: true });

    expect(db.query.mock.calls[2]).toEqual([
      expect.stringContaining("UPDATE extensions SET user_id = $1"),
      [null, 44, 7],
    ]);
    expect(db.query.mock.calls[3]).toEqual([
      expect.stringContaining("DELETE FROM user_extensions"),
      [44, 7],
    ]);
    expect(db.query.mock.calls[4]).toEqual([
      expect.stringContaining("UPDATE sip_accounts"),
      [null, 44, 7],
    ]);
  });

  it("does not make a second extension primary for a person with a primary assignment", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_primary: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 55 }] });

    await expect(
      pbxRouter.createCaller(context("user")).extensions.update({
        id: 44,
        userId: 88,
      }),
    ).resolves.toEqual({ success: true });

    expect(db.query.mock.calls[6]).toEqual([
      expect.stringContaining("INSERT INTO user_extensions"),
      [88, 44, false],
    ]);
  });

  it("rolls back an assignment when the extension has no single active SIP account", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_primary: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context("user")).extensions.update({
        id: 44,
        userId: 88,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[7]).toEqual([
      expect.stringContaining("UPDATE sip_accounts"),
      [88, 44, 7],
    ]);
  });
});

describe("DID route assignment", () => {
  it.each([
    [undefined, 7],
    [12, 12],
  ] as const)("denies a DID create when the %s admin role changes before the locked write", async (requestedTenantId, tenantId) => {
    db.query
      .mockResolvedValueOnce({ rows: requestedTenantId === undefined
        ? [membership("admin", 7)]
        : [membership("admin", 7), membership("owner", 12)] })
      .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
      .mockResolvedValueOnce({ rows: [] });

    await expect(pbxRouter.createCaller(context()).phoneNumbers.create({
      tenantId: requestedTenantId,
      number: "+6620303988",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.withTransaction).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[2]).toEqual([
      expect.stringContaining("FOR UPDATE OF tm, t"),
      [9, tenantId],
    ]);
    expect(String(db.query.mock.calls[2][0])).toContain("tm.role::text IN ('owner', 'admin')");
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO phone_numbers"))).toBe(false);
  });

  it.each([
    [undefined, 7],
    [12, 12],
  ] as const)("denies a DID route change when the %s admin role changes before the locked write", async (requestedTenantId, tenantId) => {
    db.query
      .mockResolvedValueOnce({ rows: requestedTenantId === undefined
        ? [membership("admin", 7)]
        : [membership("admin", 7), membership("owner", 12)] })
      .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(pbxRouter.createCaller(context()).phoneNumbers.assignRoute({
      tenantId: requestedTenantId,
      id: 44,
      assignedRouteType: null,
      assignedRouteId: null,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.withTransaction).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[3]).toEqual([
      expect.stringContaining("FOR UPDATE OF tm, t"),
      [9, tenantId],
    ]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE phone_numbers"))).toBe(false);
  });

  it("creates a number for the selected workspace under the authorization lock", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin", 7), membership("owner", 12)] })
      .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
      .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: 55, tenant_id: 12 }] });

    await expect(pbxRouter.createCaller(context()).phoneNumbers.create({
      tenantId: 12,
      number: "+6620303988",
    })).resolves.toMatchObject({ id: 55, tenant_id: 12 });
    expect(db.query.mock.calls[2][1]).toEqual([9, 12]);
    expect(db.query.mock.calls[3][1][0]).toBe(12);
  });

  it("routes a number in the selected workspace under the authorization lock", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin", 7), membership("owner", 12)] })
      .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] });

    await expect(pbxRouter.createCaller(context()).phoneNumbers.assignRoute({
      tenantId: 12,
      id: 44,
      assignedRouteType: null,
      assignedRouteId: null,
    })).resolves.toEqual({ success: true });
    expect(db.query.mock.calls[3][1]).toEqual([9, 12]);
    expect(db.query.mock.calls[4][1]).toEqual([null, null, 44, 12]);
  });

  it("reports phone-number management unavailable without querying the absent table", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context()).phoneNumbers.assignRoute({
        id: 44,
        assignedRouteType: null,
        assignedRouteId: null,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(String(db.query.mock.calls[1][0])).toContain(
      "information_schema.columns",
    );
  });

  it("returns an explicit unavailable empty phone-number inventory", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context()).phoneNumbers.list(),
    ).resolves.toMatchObject({
      available: false,
      data: [],
      pagination: { total: 0 },
    });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["extension", "extensions", "sa.status = 'active'"],
    ["ring_group", "ring_groups", "strategy IN ('simultaneous', 'sequential')"],
    ["queue", "call_queues", "strategy = 'ring_all'"],
    ["ivr", "ivr_menus", "is_active = true"],
    ["time_condition", "time_conditions", "tenant_id = $2"],
  ] as const)(
    "accepts a tenant-owned %s destination",
    async (routeType, table, activeCondition) => {
      db.query
        .mockResolvedValueOnce({ rows: [membership("admin")] })
        .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
        .mockResolvedValueOnce({ rows: [{ id: 44 }] })
        .mockResolvedValueOnce({ rows: [{ role: "admin" }] })
        .mockResolvedValueOnce({ rows: [{ id: 23 }] })
        .mockResolvedValueOnce({ rows: [{ id: 44 }] });

      await expect(
        pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
          id: 44,
          assignedRouteType: routeType,
          assignedRouteId: 23,
        }),
      ).resolves.toEqual({ success: true });

      expect(db.query.mock.calls[4][0]).toContain(`FROM ${table}`);
      expect(db.query.mock.calls[4][0]).toContain(activeCondition);
      expect(db.query.mock.calls[4][0]).toContain("LIMIT 1 FOR SHARE");
      expect(db.query.mock.calls[4][1]).toEqual([23, 7]);
      if (routeType === "extension") {
        expect(db.query.mock.calls[4][0]).toContain(
          "sa.tenant_id = e.tenant_id",
        );
        expect(db.query.mock.calls[4][0]).toContain("sa.user_id IS NOT NULL");
        expect(db.query.mock.calls[4][0]).not.toContain("FOR SHARE OF e");
      }
      expect(db.query.mock.calls[3]).toEqual([
        expect.stringContaining("FOR UPDATE OF tm, t"),
        [9, 7],
      ]);
      expect(db.query.mock.calls[5]).toEqual([
        expect.stringContaining("WHERE id = $3 AND tenant_id = $4"),
        [routeType, 23, 44, 7],
      ]);
    },
  );

  it("rejects a missing or cross-tenant destination before updating the DID", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
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
    ["extension", "extensions e JOIN sip_accounts sa"],
    ["ring_group", "ring_groups"],
    ["queue", "call_queues"],
    ["ivr", "ivr_menus"],
    ["time_condition", "time_conditions"],
  ] as const)(
    "does not assign a %s destination removed before its row lock",
    async (routeType, table) => {
      db.query
        .mockResolvedValueOnce({ rows: [membership("admin")] })
        .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
        .mockResolvedValueOnce({ rows: [{ id: 44 }] })
        .mockResolvedValueOnce({ rows: [{ role: "admin" }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(pbxRouter.createCaller(context()).phoneNumbers.assignRoute({
        id: 44,
        assignedRouteType: routeType,
        assignedRouteId: 23,
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(db.withTransaction).toHaveBeenCalledOnce();
      expect(db.query.mock.calls[4][0]).toContain(`FROM ${table}`);
      expect(db.query.mock.calls[4][0]).toContain("LIMIT 1 FOR SHARE");
      expect(db.query.mock.calls[4][1]).toEqual([23, 7]);
      expect(db.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE phone_numbers"))).toBe(false);
    },
  );

  it.each([
    ["extension", "e.type = 'user'", "sa.user_id IS NOT NULL"],
    [
      "ring_group",
      "strategy IN ('simultaneous', 'sequential')",
      "is_active = true",
    ],
    ["queue", "strategy = 'ring_all'", "is_active = true"],
  ] as const)(
    "rejects a runtime-unusable %s destination before updating the DID",
    async (routeType, requiredClause, activeClause) => {
      db.query
        .mockResolvedValueOnce({ rows: [membership("owner")] })
        .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
        .mockResolvedValueOnce({ rows: [{ id: 44 }] })
        .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
          id: 44,
          assignedRouteType: routeType,
          assignedRouteId: 23,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(db.query.mock.calls[4][0]).toContain(requiredClause);
      expect(db.query.mock.calls[4][0]).toContain(activeClause);
      expect(
        db.query.mock.calls.some(([sql]) =>
          String(sql).includes("UPDATE phone_numbers"),
        ),
      ).toBe(false);
    },
  );

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
      .mockResolvedValueOnce({ rows: phoneNumberSchemaRows })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({ rows: [{ role: "admin" }] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] });

    await expect(
      pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
        id: 44,
        assignedRouteType: null,
        assignedRouteId: null,
      }),
    ).resolves.toEqual({ success: true });
    expect(db.query.mock.calls[3]).toEqual([
      expect.stringContaining("FOR UPDATE OF tm, t"),
      [9, 7],
    ]);
    expect(db.query.mock.calls[4]).toEqual([
      expect.stringContaining("WHERE id = $3 AND tenant_id = $4"),
      [null, null, 44, 7],
    ]);
  });
});

describe("PBX site capability guard", () => {
  it.each(["list", "create"] as const)(
    "rejects %s before accessing an uncommissioned sites table",
    async (operation) => {
      db.query
        .mockResolvedValueOnce({ rows: [membership("admin")] })
        .mockResolvedValueOnce({ rows: [] });
      const caller = pbxRouter.createCaller(context());
      const request = operation === "list"
        ? caller.sites.list()
        : caller.sites.create({ name: "Bangkok" });

      await expect(request).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(String(db.query.mock.calls[1][0])).toContain("information_schema.columns");
      expect(
        db.query.mock.calls.some(([sql]) => /(?:FROM|INTO) sites\b/.test(String(sql))),
      ).toBe(false);
    },
  );
});

describe("PBX call-record isolation", () => {
  it("does not read call legs or events before confirming the record belongs to the active workspace", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("user")] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context()).callRecords.get({ id: 44 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1]).toEqual([
      expect.stringContaining(
        "FROM call_records WHERE id = $1 AND tenant_id = $2",
      ),
      [44, 7],
    ]);
    expect(
      db.query.mock.calls.some(([sql]) =>
        /FROM call_(legs|events)/.test(String(sql)),
      ),
    ).toBe(false);
  });
});

describe("PBX member self-service isolation", () => {
  it("lists only extensions assigned to the signed-in active member", async () => {
    const assigned = [
      {
        id: 41,
        extension_number: "3101",
        phone_numbers_available: false,
        phone_numbers: [],
      },
    ];
    db.query
      .mockResolvedValueOnce({ rows: [membership("user")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: assigned });

    await expect(
      pbxRouter.createCaller(context()).selfService.overview(),
    ).resolves.toEqual(assigned);

    expect(db.query.mock.calls[2]).toEqual([
      expect.stringContaining(
        "JOIN user_extensions ue ON ue.user_id = tm.user_id",
      ),
      [7, 9],
    ]);
    expect(db.query.mock.calls[2][0]).toContain("tm.status = 'active'");
    expect(db.query.mock.calls[2][0]).toContain("e.tenant_id = tm.tenant_id");
    expect(db.query.mock.calls[2][0]).not.toContain("phone_numbers pn");
    expect(db.query.mock.calls[2][0]).not.toContain("dnd_enabled");
    expect(db.query.mock.calls[2][0]).not.toContain("cfu_destination");
    expect(db.query.mock.calls[0][0]).not.toContain("tm.id");
    expect(db.query.mock.calls[0][0]).not.toContain("tm.is_default");
    expect(db.query.mock.calls[0][0]).not.toContain("t.slug");
    expect(db.query.mock.calls[0][0]).toContain("tm.user_id, tm.tenant_id");
  });

  it("scopes call activity to immutable call-time member identities", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("user")] })
      .mockResolvedValueOnce({
        rows: [
          {
            total_calls: "2",
            answered_calls: "1",
            missed_calls: "1",
            total_duration_seconds: "48",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 99, caller_number: "+6620000000" }],
      });

    await expect(
      pbxRouter.createCaller(context()).selfService.usage({ period: "week" }),
    ).resolves.toEqual({
      totalCalls: 2,
      answeredCalls: 1,
      missedCalls: 1,
      totalDurationSeconds: 48,
      calls: [{ id: 99, caller_number: "+6620000000" }],
    });

    for (const call of db.query.mock.calls.slice(1)) {
      expect(call[0]).toContain("cr.caller_user_id = $2");
      expect(call[0]).toContain("cr.callee_user_id = $2");
      expect(call[0]).toContain("JOIN extensions e");
      expect(call[0]).toContain("e.tenant_id = cl.tenant_id");
      expect(call[0]).toContain("e.deleted_at IS NULL");
      expect(call[0]).toContain("cl.tenant_id = cr.tenant_id");
      expect(call[0]).not.toContain("JOIN user_extensions ue");
      expect(call[1]).toEqual([7, 9, "7 days"]);
    }
    expect(db.query.mock.calls[2]?.[0]).toContain(
      "cr.from_number AS caller_number",
    );
    expect(db.query.mock.calls[2]?.[0]).toContain(
      "cr.to_number AS callee_number",
    );
  });
});

describe("PBX dashboard compatibility", () => {
  it("reports phone numbers unavailable without querying an uncommissioned table", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ c: "3" }] })
      .mockResolvedValueOnce({ rows: [{ c: "2" }] })
      .mockResolvedValueOnce({ rows: [{ c: "5" }] })
      .mockResolvedValueOnce({ rows: [{ c: "1" }] })
      .mockResolvedValueOnce({ rows: [{ avg: "20" }] });

    await expect(
      pbxRouter.createCaller(context()).dashboard.stats(),
    ).resolves.toMatchObject({
      totalExtensions: 3,
      activeExtensions: 2,
      phoneNumbers: 0,
      phoneNumbersAvailable: false,
    });
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("FROM phone_numbers WHERE"),
      ),
    ).toBe(false);
  });
});

describe("PBX workspace member lifecycle", () => {
  it("adds tenant-bound photos only for active members authorized by the photo route", async () => {
    const members = [
      { id: 88, name: "Nok", email: "nok@example.com", role: "user", status: "active", assigned_extension_numbers: ["1001"], profile_photo_authorized: true },
      { id: 89, name: "Mai", email: "mai@example.com", role: "user", status: "inactive", assigned_extension_numbers: ["1002"], profile_photo_authorized: true },
      { id: 90, name: "No extension", email: "open@example.com", role: "user", status: "active", assigned_extension_numbers: [], profile_photo_authorized: false },
    ];
    const photo = {
      userId: 88,
      photoUrl: "/api/profile/photo/7/88?v=11111111-1111-4111-8111-111111111111",
      photoVersion: "11111111-1111-4111-8111-111111111111",
      mimeType: "image/png",
    };
    vi.mocked(profilePhotoDescriptors).mockResolvedValueOnce(new Map([[88, photo]]));
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: members });

    await expect(pbxRouter.createCaller(context()).tenant.members()).resolves.toEqual([
      {
        id: 88,
        name: "Nok",
        email: "nok@example.com",
        role: "user",
        status: "active",
        assigned_extension_numbers: ["1001"],
        photoUrl: photo.photoUrl,
        photoVersion: photo.photoVersion,
      },
      { id: 89, name: "Mai", email: "mai@example.com", role: "user", status: "inactive", assigned_extension_numbers: ["1002"] },
      { id: 90, name: "No extension", email: "open@example.com", role: "user", status: "active", assigned_extension_numbers: [] },
    ]);
    expect(profilePhotoDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({ query: db.query }),
      7,
      [88],
    );
  });

  it.each(["owner", "admin"] as const)(
    "lists active and inactive members only in the current workspace for a %s",
    async (role) => {
      const members = [
        {
          id: 88,
          name: "Nok",
          email: "nok@example.com",
          role: "user",
          status: "active",
        },
        {
          id: 89,
          name: "Mai",
          email: "mai@example.com",
          role: "user",
          status: "inactive",
        },
      ];
      db.query
        .mockResolvedValueOnce({ rows: [membership(role)] })
        .mockResolvedValueOnce({ rows: members });

      await expect(
        pbxRouter.createCaller(context()).tenant.members(),
      ).resolves.toEqual(members);
      expect(db.query.mock.calls[1]).toEqual([
        expect.stringContaining("FROM tenant_memberships tm"),
        [7, 9],
      ]);
      expect(db.query.mock.calls[1][0]).toContain("WHERE tm.tenant_id = $1");
      expect(db.query.mock.calls[1][0]).not.toContain(
        "WHERE tm.tenant_id = $1 AND tm.status = 'active'",
      );
      expect(db.query.mock.calls[1][0]).toContain("photo_e.tenant_id = $1");
      expect(db.query.mock.calls[1][0]).not.toContain("photo_e.tenant_id = tm.tenant_id");
      expect(db.query.mock.calls[1][0]).not.toContain("secret_ciphertext");
    },
  );

  it.each(["manager", "user"] as const)(
    "denies member listing to a workspace %s",
    async (role) => {
      db.query.mockResolvedValueOnce({ rows: [membership(role)] });

      await expect(
        pbxRouter.createCaller(context()).tenant.members(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.query).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a target outside the active workspace before any membership write", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateMember({
        userId: 88,
        status: "inactive",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.query.mock.calls[2]).toEqual([
      expect.stringContaining("WHERE tm.tenant_id = $1 AND tm.user_id = $2"),
      [7, 88],
    ]);
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE tenant_memberships"),
      ),
    ).toBe(false);
  });

  it("lets an owner demote an administrator only when another active administrator remains", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 88,
            role: "admin",
            status: "active",
            name: "Nok",
            email: "nok@example.com",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ user_id: 9 }, { user_id: 88 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 88, role: "user", status: "active" }],
      });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateMember({
        userId: 88,
        role: "user",
      }),
    ).resolves.toEqual({
      success: true,
      member: { id: 88, role: "user", status: "active" },
    });
    expect(db.query.mock.calls[4]).toEqual([
      expect.stringContaining("UPDATE tenant_memberships"),
      ["user", "active", 7, 88],
    ]);
  });

  it("protects the final active workspace administrator from demotion or deactivation", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 88,
            role: "admin",
            status: "active",
            name: "Nok",
            email: "nok@example.com",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ user_id: 88 }] });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateMember({
        userId: 88,
        status: "inactive",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Keep at least one active workspace administrator.",
    });
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE tenant_memberships"),
      ),
    ).toBe(false);
  });

  it("does not let an administrator promote or change another administrator", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("admin")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 88,
            role: "user",
            status: "active",
            name: "Nok",
            email: "nok@example.com",
          },
        ],
      });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateMember({
        userId: 88,
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE tenant_memberships"),
      ),
    ).toBe(false);
  });

  it("does not mutate workspace owners through the member lifecycle API", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 88,
            role: "owner",
            status: "active",
            name: "Nok",
            email: "nok@example.com",
          },
        ],
      });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateMember({
        userId: 88,
        status: "inactive",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE tenant_memberships"),
      ),
    ).toBe(false);
  });

  it("preserves a legacy manager role when an owner only changes membership status", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership("owner")] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 88,
            role: "manager",
            status: "active",
            name: "Nok",
            email: "nok@example.com",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 88, role: "manager", status: "inactive" }],
      });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateMember({
        userId: 88,
        status: "inactive",
      }),
    ).resolves.toEqual({
      success: true,
      member: { id: 88, role: "manager", status: "inactive" },
    });
    expect(db.query.mock.calls[3]).toEqual([
      expect.stringContaining("UPDATE tenant_memberships"),
      ["manager", "inactive", 7, 88],
    ]);
  });
});
