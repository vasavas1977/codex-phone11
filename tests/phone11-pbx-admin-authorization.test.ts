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
// eslint-disable-next-line import/first
import { getCallStats } from "../server/pbx/cdr-processor";

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
  db.withTransaction.mockImplementation(async (callback) =>
    callback({ query: db.query }),
  );
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
    expect(source.match(/await getTenantAdmin(?:Mutation)?Ctx\(ctx/g)).toHaveLength(22);
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
        [7],
      ]);
      expect(db.query.mock.calls[1][0]).toContain("tm.status = 'active'");
      expect(db.query.mock.calls[1][0]).toContain("e.tenant_id = tm.tenant_id");
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
      .mockResolvedValueOnce({ rows: [membership("user")] })
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
        .mockResolvedValueOnce({ rows: [{ id: 23 }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
          id: 44,
          assignedRouteType: routeType,
          assignedRouteId: 23,
        }),
      ).resolves.toEqual({ success: true });

      expect(db.query.mock.calls[3][0]).toContain(`FROM ${table}`);
      expect(db.query.mock.calls[3][0]).toContain(activeCondition);
      expect(db.query.mock.calls[3][1]).toEqual([23, 7]);
      if (routeType === "extension") {
        expect(db.query.mock.calls[3][0]).toContain(
          "sa.tenant_id = e.tenant_id",
        );
        expect(db.query.mock.calls[3][0]).toContain("sa.user_id IS NOT NULL");
      }
      expect(db.query.mock.calls[4]).toEqual([
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
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
          id: 44,
          assignedRouteType: routeType,
          assignedRouteId: 23,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(db.query.mock.calls[3][0]).toContain(requiredClause);
      expect(db.query.mock.calls[3][0]).toContain(activeClause);
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
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      pbxRouter.createCaller(context("user")).phoneNumbers.assignRoute({
        id: 44,
        assignedRouteType: null,
        assignedRouteId: null,
      }),
    ).resolves.toEqual({ success: true });
    expect(db.query.mock.calls[3]).toEqual([
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
        [7],
      ]);
      expect(db.query.mock.calls[1][0]).toContain("WHERE tm.tenant_id = $1");
      expect(db.query.mock.calls[1][0]).not.toContain(
        "WHERE tm.tenant_id = $1 AND tm.status = 'active'",
      );
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
