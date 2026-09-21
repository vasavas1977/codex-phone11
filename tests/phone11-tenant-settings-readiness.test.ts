import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Pool } from "pg";

const db = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn() }));
const audit = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));

vi.mock("../server/pbx/db", () => db);
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
  invalidateCache: vi.fn(),
}));
vi.mock("../server/pbx/audit", () => ({
  writeAuditLog: audit.writeAuditLog,
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

import {
  pbxRouter,
  upsertBusinessHoursTimezone,
} from "../server/pbx/pbx-router";
import { inspectTenantSettings } from "../scripts/phone11-tenant-settings-preflight";

const context = () =>
  ({
    user: { id: 9, role: "user" },
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
  }) as any;

const membership = (tenantId = 7, role = "admin") => ({
  user_id: 9,
  tenant_id: tenantId,
  role,
  is_default: null,
  tenant_name: `Tenant ${tenantId}`,
  tenant_slug: null,
  tenant_status: "active",
});

const schemaRows = [
  "tenant_id",
  "business_hours_timezone",
  "created_at",
  "updated_at",
].map((column_name) => ({ table_name: "tenant_settings", column_name }));

beforeEach(() => {
  vi.clearAllMocks();
  db.withTransaction.mockImplementation(async (callback) =>
    callback({ query: db.query }),
  );
});

describe("workspace setting API", () => {
  it("reads the supported setting only from the authenticated workspace", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership()] })
      .mockResolvedValueOnce({ rows: schemaRows })
      .mockResolvedValueOnce({
        rows: [
          { id: 7, name: "Tenant 7", business_hours_timezone: "Asia/Bangkok" },
        ],
      });

    await expect(
      pbxRouter.createCaller(context()).tenant.get(),
    ).resolves.toMatchObject({
      id: 7,
      settingsAvailable: true,
      supportedSettings: ["businessHoursTimezone"],
      business_hours_timezone: "Asia/Bangkok",
    });
    expect(db.query.mock.calls[2]).toEqual([
      expect.stringContaining("WHERE t.id = $1"),
      [7],
    ]);
    expect(String(db.query.mock.calls[2][0])).not.toMatch(
      /default_caller_id|recording_default_policy|max_ring_timeout_seconds/,
    );
  });

  it("upserts a normalized time zone through a locked active admin membership", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership()] })
      .mockResolvedValueOnce({ rows: schemaRows })
      .mockResolvedValueOnce({
        rows: [{ business_hours_timezone: "Asia/Bangkok" }],
      });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateSettings({
        tenantId: 7,
        businessHoursTimezone: "  Asia/Bangkok  ",
      }),
    ).resolves.toEqual({
      success: true,
      businessHoursTimezone: "Asia/Bangkok",
    });

    expect(db.query.mock.calls[2]).toEqual([
      expect.stringContaining("FOR UPDATE OF tm, t"),
      [7, "Asia/Bangkok", 9],
    ]);
    expect(String(db.query.mock.calls[2][0])).toContain(
      "ON CONFLICT (tenant_id)",
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 7,
        actorUserId: 9,
        resourceType: "tenant_settings",
        newValue: { tenantId: 7, businessHoursTimezone: "Asia/Bangkok" },
      }),
    );
  });

  it("rejects unsupported and invalid settings before database access", async () => {
    await expect(
      pbxRouter.createCaller(context()).tenant.updateSettings({
        tenantId: 7,
        defaultCallerId: "+6620000000",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      pbxRouter.createCaller(context()).tenant.updateSettings({
        tenantId: 7,
        businessHoursTimezone: "not/a real zone",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("rejects a requested workspace outside the actor's memberships", async () => {
    db.query.mockResolvedValueOnce({ rows: [membership(7, "owner")] });
    await expect(
      pbxRouter.createCaller(context()).tenant.updateSettings({
        tenantId: 8,
        businessHoursTimezone: "UTC",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("fails closed when membership changes before the fenced upsert", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership()] })
      .mockResolvedValueOnce({ rows: schemaRows })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      pbxRouter.createCaller(context()).tenant.updateSettings({
        tenantId: 7,
        businessHoursTimezone: "UTC",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it("keeps an incomplete table unavailable before an upsert can reference it", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [membership()] })
      .mockResolvedValueOnce({
        rows: schemaRows.filter(({ column_name }) => column_name !== "created_at"),
      });

    await expect(
      pbxRouter.createCaller(context()).tenant.updateSettings({
        tenantId: 7,
        businessHoursTimezone: "UTC",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });
});

const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/phone11_pbx_test" ||
    !url.port ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Tenant-settings integration requires a dedicated loopback phone11_pbx_test database with explicit port",
    );
}

describe.skipIf(!connectionString)(
  "tenant-settings isolated PostgreSQL",
  () => {
    const schema = `tenant_settings_${randomBytes(8).toString("hex")}`;
    const admin = new Pool({ connectionString, ssl: false });
    const database = new Pool({
      connectionString,
      ssl: false,
      options: `-c search_path=${schema}`,
    });
    const execute = (sql: string, parameters: unknown[]) =>
      database.query(sql, parameters);

    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await database.query(`CREATE TABLE tenants (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE tenant_memberships (
      user_id INTEGER NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (user_id, tenant_id)
    )`);
      await database.query(
        "INSERT INTO tenants VALUES (7, 'active'), (8, 'active')",
      );
      await database.query(`INSERT INTO tenant_memberships VALUES
      (9,7,'admin','active'),
      (9,8,'user','active'),
      (10,8,'owner','active')`);
      const migration = await readFile(
        new URL("../server/pbx/tenant-settings-migration.sql", import.meta.url),
        "utf8",
      );
      await database.query(migration);
      await database.query(migration);
    });

    afterAll(async () => {
      await database.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    });

    it("applies twice, persists each workspace separately, and passes preflight", async () => {
      expect(
        (
          await database.query(
            "SELECT count(*)::int AS count FROM tenant_settings",
          )
        ).rows[0].count,
      ).toBe(0);
      await upsertBusinessHoursTimezone(execute, 7, 9, "Asia/Bangkok");
      await upsertBusinessHoursTimezone(execute, 7, 9, "Asia/Tokyo");
      await upsertBusinessHoursTimezone(execute, 8, 10, "UTC");
      expect(
        (
          await database.query(
            "SELECT tenant_id,business_hours_timezone FROM tenant_settings ORDER BY tenant_id",
          )
        ).rows,
      ).toEqual([
        { tenant_id: 7, business_hours_timezone: "Asia/Tokyo" },
        { tenant_id: 8, business_hours_timezone: "UTC" },
      ]);
      const client = await database.connect();
      try {
        await expect(inspectTenantSettings(client)).resolves.toMatchObject({
          readOnly: true,
          status: "compatible",
          issues: [],
        });
      } finally {
        client.release();
      }
    });

    it("returns no row for a non-admin or a cross-workspace actor", async () => {
      expect(
        (await upsertBusinessHoursTimezone(execute, 8, 9, "Asia/Bangkok")).rows,
      ).toEqual([]);
      expect(
        (await upsertBusinessHoursTimezone(execute, 7, 10, "Asia/Bangkok"))
          .rows,
      ).toEqual([]);
      expect(
        (
          await database.query(
            "SELECT business_hours_timezone FROM tenant_settings WHERE tenant_id=8",
          )
        ).rows[0].business_hours_timezone,
      ).toBe("UTC");
    });

    it("rejects blank values and removes settings with their tenant", async () => {
      await expect(
        database.query(
          "INSERT INTO tenant_settings(tenant_id,business_hours_timezone) VALUES (7,'') ON CONFLICT (tenant_id) DO UPDATE SET business_hours_timezone=EXCLUDED.business_hours_timezone",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await database.query("DELETE FROM tenant_memberships WHERE tenant_id=8");
      await database.query("DELETE FROM tenants WHERE id=8");
      expect(
        (
          await database.query(
            "SELECT count(*)::int AS count FROM tenant_settings WHERE tenant_id=8",
          )
        ).rows[0].count,
      ).toBe(0);
    });

    it("rejects a composite tenant key in both migration and read-only preflight", async () => {
      const invalidSchema = `tenant_settings_invalid_${randomBytes(8).toString("hex")}`;
      const invalid = new Pool({
        connectionString,
        ssl: false,
        options: `-c search_path=${invalidSchema}`,
      });
      const migration = await readFile(
        new URL("../server/pbx/tenant-settings-migration.sql", import.meta.url),
        "utf8",
      );
      await admin.query(`CREATE SCHEMA ${invalidSchema}`);
      try {
        await invalid.query(`CREATE TABLE tenants (
          id INTEGER PRIMARY KEY,
          status TEXT NOT NULL
        );
        CREATE TABLE tenant_settings (
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          business_hours_timezone VARCHAR(64) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, updated_at),
          CONSTRAINT phone11_tenant_settings_timezone_nonempty CHECK (
            business_hours_timezone = btrim(business_hours_timezone)
            AND char_length(business_hours_timezone) BETWEEN 1 AND 64
          )
        )`);
        await expect(invalid.query(migration)).rejects.toThrow(
          "tenant_settings requires a primary key",
        );
        const client = await invalid.connect();
        try {
          await expect(inspectTenantSettings(client)).resolves.toMatchObject({
            readOnly: true,
            status: "incompatible",
            issues: expect.arrayContaining(["tenant_id:primary_key"]),
          });
        } finally {
          client.release();
        }
      } finally {
        await invalid.end();
        await admin.query(`DROP SCHEMA IF EXISTS ${invalidSchema} CASCADE`);
      }
    });

    async function expectTimezoneCheckRejected(
      suffix: string,
      constraint: string,
    ) {
      const invalidSchema = `tenant_settings_${suffix}_${randomBytes(8).toString("hex")}`;
      const invalid = new Pool({
        connectionString,
        ssl: false,
        options: `-c search_path=${invalidSchema}`,
      });
      const migration = await readFile(
        new URL("../server/pbx/tenant-settings-migration.sql", import.meta.url),
        "utf8",
      );
      await admin.query(`CREATE SCHEMA ${invalidSchema}`);
      try {
        await invalid.query(`CREATE TABLE tenants (
          id INTEGER PRIMARY KEY,
          status TEXT NOT NULL
        );
        CREATE TABLE tenant_settings (
          tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          business_hours_timezone VARCHAR(64) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await invalid.query(`ALTER TABLE tenant_settings ADD CONSTRAINT phone11_tenant_settings_timezone_nonempty ${constraint}`);
        await expect(invalid.query(migration)).rejects.toThrow(
          "tenant_settings requires the reviewed timezone constraint",
        );
        const client = await invalid.connect();
        try {
          await expect(inspectTenantSettings(client)).resolves.toMatchObject({
            readOnly: true,
            status: "incompatible",
            issues: expect.arrayContaining(["business_hours_timezone:check"]),
          });
        } finally {
          client.release();
        }
      } finally {
        await invalid.end();
        await admin.query(`DROP SCHEMA IF EXISTS ${invalidSchema} CASCADE`);
      }
    }

    it("rejects a same-name timezone check that accepts every value", async () => {
      await expectTimezoneCheckRejected("check_true", "CHECK (true)");
    });

    it("rejects a same-name timezone check that PostgreSQL has not validated", async () => {
      await expectTimezoneCheckRejected(
        "check_not_valid",
        "CHECK (business_hours_timezone = btrim(business_hours_timezone) AND char_length(business_hours_timezone) BETWEEN 1 AND 64) NOT VALID",
      );
    });
  },
);

describe("tenant-settings migration and preflight", () => {
  it("keeps the migration explicit, rerunnable, guarded, and free of calling defaults", async () => {
    const sql = await readFile(
      new URL("../server/pbx/tenant-settings-migration.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toMatch(/the\n-- application never runs this file/);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS tenant_settings");
    expect(sql).toContain(
      "existing tenant_settings is partial or incompatible",
    );
    expect(sql).toContain("REFERENCES tenants(id) ON DELETE CASCADE");
    expect(sql).toContain("business_hours_timezone VARCHAR(64) NOT NULL");
    expect(sql).toContain("c.convalidated");
    expect(sql).toContain("pg_get_expr(c.conbin, c.conrelid, true)");
    expect(sql).not.toMatch(
      /default_caller_id|emergency_address_required|recording_default_policy|voicemail_default_enabled|max_ring_timeout_seconds/,
    );
  });

  it("classifies absent and compatible schemas in a rolled-back read-only transaction", async () => {
    const absentQuery = vi.fn(async (sql: string) => ({
      rows: sql.includes("to_regclass")
        ? [
            {
              relation: null,
              column_name: null,
              data_type: null,
              is_nullable: null,
            },
          ]
        : [],
    }));
    await expect(
      inspectTenantSettings({ query: absentQuery } as never),
    ).resolves.toEqual({
      event: "phone11.tenant-settings.preflight",
      readOnly: true,
      status: "absent",
      issues: [],
    });
    expect(absentQuery.mock.calls[0][0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(absentQuery.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");

    const compatibleQuery = vi.fn(async (sql: string) => {
      if (sql.includes("exact_primary_key"))
        return {
          rows: [
            {
              exact_primary_key: true,
              exact_foreign_key: true,
              reviewed_timezone_check: true,
            },
          ],
        };
      if (sql.includes("to_regclass"))
        return {
          rows: [
            {
              relation: "tenant_settings",
              column_name: "tenant_id",
              data_type: "integer",
              is_nullable: "NO",
            },
            {
              relation: "tenant_settings",
              column_name: "business_hours_timezone",
              data_type: "character varying",
              is_nullable: "NO",
            },
            {
              relation: "tenant_settings",
              column_name: "created_at",
              data_type: "timestamp with time zone",
              is_nullable: "NO",
            },
            {
              relation: "tenant_settings",
              column_name: "updated_at",
              data_type: "timestamp with time zone",
              is_nullable: "NO",
            },
          ],
        };
      return { rows: [] };
    });
    await expect(
      inspectTenantSettings({ query: compatibleQuery } as never),
    ).resolves.toMatchObject({
      readOnly: true,
      status: "compatible",
      issues: [],
    });
    expect(compatibleQuery.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("reports a partial table as incompatible", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("exact_primary_key"))
        return {
          rows: [
            {
              exact_primary_key: false,
              exact_foreign_key: false,
              reviewed_timezone_check: false,
            },
          ],
        };
      if (sql.includes("to_regclass"))
        return {
          rows: [
            {
              relation: "tenant_settings",
              column_name: "tenant_id",
              data_type: "integer",
              is_nullable: "YES",
            },
          ],
        };
      return { rows: [] };
    });
    await expect(
      inspectTenantSettings({ query } as never),
    ).resolves.toMatchObject({
      status: "incompatible",
      issues: expect.arrayContaining([
        "business_hours_timezone:missing",
        "tenant_id:foreign_key",
        "tenant_id:nullable",
        "tenant_id:primary_key",
      ]),
    });
  });
});
