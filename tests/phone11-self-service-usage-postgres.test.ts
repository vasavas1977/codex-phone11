import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF_SERVICE_CALL_OWNERSHIP_SQL } from "../lib/pbx/self-service-usage";

const db = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn() }));
const membershipCache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../server/pbx/db", () => db);
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: async (key: string, _ttl: number, load: () => Promise<unknown>) => {
    if (membershipCache.has(key)) return membershipCache.get(key);
    const value = await load();
    membershipCache.set(key, value);
    return value;
  },
  invalidateCache: vi.fn(),
}));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: vi.fn(), queryAuditLogs: vi.fn() }));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: vi.fn(),
  regenerateSipCredentials: vi.fn(),
  decryptSecret: vi.fn(),
}));
vi.mock("../server/pbx/cdr-processor", () => ({ getCallStats: vi.fn(), getVoicemails: vi.fn() }));

// The router must load after its database and cache modules are mocked.
// eslint-disable-next-line import/first
import { pbxRouter } from "../server/pbx/pbx-router";

const connectionString = process.env.PHONE11_MANAGEMENT_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/phone11_management_test" ||
    !url.port
  ) {
    throw new Error(
      "self-service usage tests require a dedicated loopback phone11_management_test database with an explicit port",
    );
  }
}

const schema = `self_service_usage_${randomBytes(8).toString("hex")}`;
const admin = connectionString
  ? new Pool({ connectionString, ssl: false })
  : null;
const database = connectionString
  ? new Pool({
      connectionString,
      ssl: false,
      options: `-c search_path=${schema}`,
    })
  : null;

async function visibleCallUuids(userId: number) {
  return database!.query(
    `SELECT cr.call_uuid,
            cr.from_number AS caller_number,
            cr.to_number AS callee_number
     FROM call_records cr
     WHERE cr.tenant_id = $1
       AND cr.started_at >= NOW() - interval '30 days'
       AND ${SELF_SERVICE_CALL_OWNERSHIP_SQL}
     ORDER BY cr.call_uuid`,
    [7, userId],
  );
}

describe.skipIf(!connectionString)(
  "member call activity ownership against isolated PostgreSQL",
  () => {
    beforeAll(async () => {
      await admin!.query(`CREATE SCHEMA ${schema}`);
      for (const file of [
        "tests/fixtures/phone11-cloud-recording-baseline.sql",
        "server/cloud-recordings/prerequisites.sql",
      ]) {
        await database!.query(await readFile(file, "utf8"));
      }
    });

    beforeEach(async () => {
      membershipCache.clear();
      db.query.mockClear();
      db.query.mockImplementation((sql, params) => database!.query(sql, params));
      await database!.query(`
        TRUNCATE users, tenants, extensions, call_records CASCADE;
        INSERT INTO users (id, "openId", name, role)
          VALUES (1, 'member-a', 'Member A', 'user'), (2, 'member-b', 'Member B', 'user');
        INSERT INTO tenants (id, name, status) VALUES (7, 'Workspace', 'active');
        INSERT INTO tenant_memberships (user_id, tenant_id, role, status)
          VALUES (1, 7, 'user', 'active'), (2, 7, 'user', 'active');
        INSERT INTO extensions (id, tenant_id, user_id, extension_number, status)
          VALUES (31, 7, 1, '3101', 'active');
        INSERT INTO user_extensions (user_id, extension_id, is_primary) VALUES (1, 31, true);
      `);
    });

    afterAll(async () => {
      if (admin) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await Promise.all([admin?.end(), database?.end()]);
    });

    it("does not transfer historical CDR access when an extension is reassigned", async () => {
      await database!.query(`
        INSERT INTO call_records
          (call_uuid, tenant_id, direction, from_number, to_number, caller_user_id, started_at)
          VALUES
            ('historical-a', 7, 'inbound', '+6620000001', '3101', 1, NOW()),
            ('own-b', 7, 'outbound', '3101', '+6620000002', 2, NOW()),
            ('legacy', 7, 'inbound', '+6620000003', '3101', NULL, NOW()),
            ('leg-only-b', 7, 'internal', '3101', '3102', NULL, NOW());
        INSERT INTO call_legs
          (call_record_id, tenant_id, leg_uuid, caller_user_id, extension_id, started_at)
          SELECT id, tenant_id, call_uuid || '-leg',
            CASE call_uuid
              WHEN 'historical-a' THEN 1
              WHEN 'own-b' THEN 2
              WHEN 'leg-only-b' THEN 2
              ELSE NULL
            END,
            31,
            NOW()
          FROM call_records;
        UPDATE extensions SET user_id = 2 WHERE id = 31 AND tenant_id = 7;
        DELETE FROM user_extensions WHERE extension_id = 31;
        INSERT INTO user_extensions (user_id, extension_id, is_primary) VALUES (2, 31, true);
      `);

      expect(
        (await visibleCallUuids(2)).rows.map((row) => row.call_uuid),
      ).toEqual(["leg-only-b", "own-b"]);
      expect((await visibleCallUuids(2)).rows).toContainEqual(
        expect.objectContaining({
          call_uuid: "own-b",
          caller_number: "3101",
          callee_number: "+6620000002",
        }),
      );
      expect(
        (await visibleCallUuids(1)).rows.map((row) => row.call_uuid),
      ).toEqual(["historical-a"]);

      await database!.query(
        "UPDATE extensions SET deleted_at = NOW() WHERE id = 31 AND tenant_id = 7",
      );
      expect(
        (await visibleCallUuids(2)).rows.map((row) => row.call_uuid),
      ).toEqual(["own-b"]);
    });

    it("hides summary and call rows after membership or tenant revocation despite a cached membership", async () => {
      await database!.query(`
        INSERT INTO call_records
          (call_uuid, tenant_id, direction, from_number, to_number, caller_user_id, started_at)
          VALUES ('own-a', 7, 'outbound', '3101', '+6620000001', 1, NOW());
      `);
      const caller = pbxRouter.createCaller({
        user: { id: 1, role: "user" },
        req: { ip: "127.0.0.1", headers: {} },
        res: {},
      } as any);

      const before = await caller.selfService.usage({ tenantId: 7 });
      expect(before).toMatchObject({ tenantId: 7, totalCalls: 1 });
      expect(before.calls).toHaveLength(1);
      expect(membershipCache.has("tenant:memberships:1")).toBe(true);

      await database!.query("UPDATE tenant_memberships SET status = 'inactive' WHERE user_id = 1 AND tenant_id = 7");
      const afterMembershipRevocation = await caller.selfService.usage({ tenantId: 7 });
      expect(afterMembershipRevocation).toMatchObject({ tenantId: 7, totalCalls: 0, calls: [] });

      await database!.query("UPDATE tenant_memberships SET status = 'active' WHERE user_id = 1 AND tenant_id = 7");
      await database!.query("UPDATE tenants SET status = 'inactive' WHERE id = 7");
      const afterTenantRevocation = await caller.selfService.usage({ tenantId: 7 });
      expect(afterTenantRevocation).toMatchObject({ tenantId: 7, totalCalls: 0, calls: [] });

      const membershipReads = db.query.mock.calls.filter(([sql]) => String(sql).includes("ORDER BY tm.created_at"));
      expect(membershipReads).toHaveLength(1);
    });
  },
);
