import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool } from "pg";
import { createProfileService, ProfileStatusUnavailableError, ProfileWorkspaceAccessError, ProfileWorkspaceAdminAccessError } from "../server/profile/service";

const connectionString = process.env.PHONE11_PROFILE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (![
    "postgres:", "postgresql:",
  ].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/phone11_profile_test" || !url.port || url.search || url.hash) {
    throw new Error("Profile integration tests require the dedicated loopback phone11_profile_test database with explicit port");
  }
}

const pool = new Pool({ connectionString, max: 6, ssl: false });

describe.skipIf(!connectionString)("workspace profile real PostgreSQL persistence and tenant isolation", () => {
  beforeAll(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tenant_memberships (
        user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        status TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        PRIMARY KEY (user_id, tenant_id)
      );
      CREATE TABLE IF NOT EXISTS tenant_settings (
        tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id),
        business_hours_timezone TEXT
      );
    `);
    await pool.query("ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'");
    await pool.query(await readFile(new URL("../server/profile/migration.sql", import.meta.url), "utf8"));
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE phone11_workspace_profile_status, phone11_workspace_profile_status_settings, tenant_settings, tenant_memberships, users, tenants CASCADE;
      INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Other company'), (4, 'Admin'), (5, 'Manager'), (6, 'Member');
      INSERT INTO tenants VALUES (10, 'active'), (20, 'active');
      INSERT INTO tenant_memberships(user_id,tenant_id,status,role) VALUES
        (1, 10, 'active', 'owner'), (2, 10, 'active', 'user'), (3, 20, 'active', 'owner'),
        (4, 10, 'active', 'admin'), (5, 10, 'active', 'manager'), (6, 10, 'active', 'user');
      INSERT INTO tenant_settings VALUES (10, 'Asia/Bangkok');
    `);
  });

  afterAll(async () => { await pool.end(); });

  it("persists only self fields, scopes colleague reads, and clears expired values", async () => {
    const clock = await pool.query(`WITH chosen AS (SELECT clock_timestamp() AS now)
      SELECT now,
        (date_trunc('day', now AT TIME ZONE 'Asia/Bangkok') + INTERVAL '1 day')
          AT TIME ZONE 'Asia/Bangkok' AS next_local_midnight
      FROM chosen`);
    const databaseNow = new Date(clock.rows[0].now);
    const nextLocalMidnight = new Date(clock.rows[0].next_local_midnight);
    const service = createProfileService(pool, () => databaseNow);
    await service.setAdminEnabled(1, 10, true);
    const saved = await service.update(1, 10, {
      availability: { value: "busy" },
      status: { text: "In customer review", expiry: "today" },
      workLocation: "remote",
    });
    expect(saved).toMatchObject({ userId: 1, manualAvailability: "busy", statusText: "In customer review", workLocation: "remote" });
    expect(saved.manualAvailabilityExpiresAt).toEqual(new Date(databaseNow.getTime() + 24 * 60 * 60_000));
    expect(saved.statusExpiresAt).toEqual(nextLocalMidnight);
    expect(saved.manualAvailabilityExpiresAt!.getTime()).toBeGreaterThan(databaseNow.getTime());
    expect(saved.statusExpiresAt!.getTime()).toBeGreaterThan(databaseNow.getTime());

    const colleagues = await service.colleagues(1, 10, [1, 2, 3]);
    expect(colleagues.map((profile) => profile.userId)).toEqual([1, 2]);
    expect(colleagues[1]).toMatchObject({ manualAvailability: null, statusText: null, workLocation: null });

    await pool.query(`UPDATE phone11_workspace_profile_status
      SET manual_availability_expires_at = clock_timestamp() - INTERVAL '1 second',
          status_expires_at = clock_timestamp() - INTERVAL '1 second'
      WHERE tenant_id = 10 AND user_id = 1`);
    const expired = await service.self(1, 10);
    expect(expired).toMatchObject({ manualAvailability: null, manualAvailabilityExpiresAt: null, statusText: null, statusExpiresAt: null, workLocation: "remote" });
  });

  it("rejects inconsistent availability rows at the database boundary", async () => {
    await expect(pool.query(`INSERT INTO phone11_workspace_profile_status
      (tenant_id, user_id, manual_availability, manual_availability_expires_at)
      VALUES (10, 1, NULL, clock_timestamp())`)).rejects.toThrow();
    await expect(pool.query(`INSERT INTO phone11_workspace_profile_status
      (tenant_id, user_id, manual_availability, manual_availability_expires_at)
      VALUES (10, 1, 'busy', NULL)`)).rejects.toThrow();
  });

  it("rechecks active membership in the write statement after an earlier guard", async () => {
    await createProfileService(pool).setAdminEnabled(1, 10, true);
    let revoked = false;
    const fencedDatabase = {
      query: async (sql: string, values?: readonly unknown[]) => {
        if (!revoked && sql.includes("INSERT INTO phone11_workspace_profile_status")) {
          revoked = true;
          await pool.query("UPDATE tenant_memberships SET status = 'inactive' WHERE user_id = 1 AND tenant_id = 10");
        }
        return pool.query(sql, values as unknown[] | undefined);
      },
    };
    const service = createProfileService(fencedDatabase as never, () => new Date("2026-09-20T10:00:00Z"));
    await expect(service.update(1, 10, { workLocation: "office" })).rejects.toBeInstanceOf(ProfileWorkspaceAccessError);
    expect((await pool.query("SELECT * FROM phone11_workspace_profile_status")).rows).toEqual([]);
  });

  it("does not insert a first profile row when an administrator disables status before the write", async () => {
    const liveService = createProfileService(pool);
    await liveService.setAdminEnabled(1, 10, true);
    let disabled = false;
    const fencedDatabase = {
      query: async (sql: string, values?: readonly unknown[]) => {
        if (!disabled && sql.includes("INSERT INTO phone11_workspace_profile_status\n")) {
          disabled = true;
          await liveService.setAdminEnabled(1, 10, false);
        }
        return pool.query(sql, values as unknown[] | undefined);
      },
    };
    const service = createProfileService(fencedDatabase as never);
    await expect(service.update(2, 10, { workLocation: "remote" })).rejects.toBeInstanceOf(ProfileWorkspaceAccessError);
    expect(disabled).toBe(true);
    expect((await pool.query("SELECT * FROM phone11_workspace_profile_status WHERE tenant_id = 10 AND user_id = 2")).rows).toEqual([]);
  });

  it("does not restore a stale expiry when another writer changes it before an omitted-expiry text update", async () => {
    await createProfileService(pool).setAdminEnabled(1, 10, true);
    const clock = new Date((await pool.query("SELECT clock_timestamp() AS now")).rows[0].now);
    const originalExpiry = new Date(clock.getTime() + 60 * 60_000);
    const concurrentExpiry = new Date(clock.getTime() + 4 * 60 * 60_000);
    await pool.query(`INSERT INTO phone11_workspace_profile_status
      (tenant_id, user_id, status_text, status_expires_at)
      VALUES (10, 1, 'Original', $1)`, [originalExpiry]);
    let injected = false;
    const racedDatabase = {
      query: async (sql: string, values?: readonly unknown[]) => {
        if (!injected && sql.includes("INSERT INTO phone11_workspace_profile_status")) {
          injected = true;
          await pool.query(`UPDATE phone11_workspace_profile_status SET status_expires_at=$1
            WHERE tenant_id=10 AND user_id=1`, [concurrentExpiry]);
        }
        return pool.query(sql, values as unknown[] | undefined);
      },
    };
    const racedService = createProfileService(racedDatabase as never, () => clock);
    const saved = await racedService.update(1, 10, { status: { text: "Edited" } });
    expect(saved).toMatchObject({ statusText: "Edited", statusExpiresAt: concurrentExpiry });

    const cleared = await createProfileService(pool, () => clock).update(1, 10, { status: { text: null } });
    expect(cleared).toMatchObject({ statusText: null, statusExpiresAt: null });
  });

  it("replaces an expired status with visible text when no new expiry is chosen", async () => {
    const service = createProfileService(pool);
    await service.setAdminEnabled(1, 10, true);
    await pool.query(`INSERT INTO phone11_workspace_profile_status(tenant_id, user_id, status_text, status_expires_at)
      VALUES(10, 1, 'Old status', clock_timestamp() - INTERVAL '1 minute')`);
    await expect(service.self(1, 10)).resolves.toMatchObject({ statusText: null, statusExpiresAt: null });
    const saved = await service.update(1, 10, { status: { text: "New status" } });
    expect(saved).toMatchObject({ statusText: "New status", statusExpiresAt: null });
    expect((await pool.query("SELECT status_text, status_expires_at FROM phone11_workspace_profile_status WHERE tenant_id = 10 AND user_id = 1")).rows[0])
      .toEqual({ status_text: "New status", status_expires_at: null });
  });

  it("keeps workspace status disabled by default, owner/admin scoped, and preserves user rows when disabled", async () => {
    const service = createProfileService(pool);
    await expect(service.adminSettings(1, 10)).resolves.toMatchObject({ tenantId: 10, enabled: false, updatedBy: null });
    await expect(service.self(1, 10)).rejects.toBeInstanceOf(ProfileStatusUnavailableError);
    await expect(service.update(2, 10, { workLocation: "remote" })).rejects.toBeInstanceOf(ProfileStatusUnavailableError);

    for (const actorId of [2, 5, 3]) {
      await expect(service.setAdminEnabled(actorId, 10, true)).rejects.toBeInstanceOf(ProfileWorkspaceAdminAccessError);
      await expect(service.adminSettings(actorId, 10)).rejects.toBeInstanceOf(ProfileWorkspaceAdminAccessError);
    }
    await expect(service.setAdminEnabled(4, 10, true)).resolves.toMatchObject({ enabled: true, updatedBy: 4 });
    const saved = await service.update(2, 10, { availability: { value: "dnd", expiresInMinutes: 60 }, workLocation: "remote" });
    expect(saved).toMatchObject({ manualAvailability: "dnd", workLocation: "remote" });
    await expect(service.self(3, 20)).rejects.toBeInstanceOf(ProfileStatusUnavailableError);

    await service.setAdminEnabled(1, 10, false);
    await expect(service.self(2, 10)).rejects.toBeInstanceOf(ProfileStatusUnavailableError);
    expect((await pool.query(`SELECT manual_availability,work_location FROM phone11_workspace_profile_status
      WHERE tenant_id=10 AND user_id=2`)).rows[0]).toEqual({ manual_availability: "dnd", work_location: "remote" });
    await service.setAdminEnabled(1, 10, true);
    await expect(service.self(2, 10)).resolves.toMatchObject({ manualAvailability: "dnd", workLocation: "remote" });
  });

  it("rechecks live admin membership in the setting write statement", async () => {
    let revoked = false;
    const fencedDatabase = {
      query: async (sql: string, values?: readonly unknown[]) => {
        if (!revoked && sql.includes("INSERT INTO phone11_workspace_profile_status_settings")) {
          revoked = true;
          await pool.query("UPDATE tenant_memberships SET status = 'inactive' WHERE user_id = 4 AND tenant_id = 10");
        }
        return pool.query(sql, values as unknown[] | undefined);
      },
    };
    const service = createProfileService(fencedDatabase as never);
    await expect(service.setAdminEnabled(4, 10, true)).rejects.toBeInstanceOf(ProfileWorkspaceAdminAccessError);
    expect((await pool.query("SELECT * FROM phone11_workspace_profile_status_settings")).rows).toEqual([]);
  });

  it("keeps profile settings tables inaccessible to PUBLIC and records only scoped setting metadata", async () => {
    const result = await pool.query(`SELECT c.relname, COALESCE(bool_or(privilege.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE') AND privilege.grantee=0),FALSE) AS public_access
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) privilege
      WHERE c.relnamespace='public'::regnamespace
        AND c.relname IN ('phone11_workspace_profile_status','phone11_workspace_profile_status_settings')
      GROUP BY c.relname`);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.public_access === false)).toBe(true);
    await createProfileService(pool).setAdminEnabled(1, 10, true);
    expect((await pool.query("SELECT tenant_id,enabled,updated_by FROM phone11_workspace_profile_status_settings")).rows)
      .toEqual([{ tenant_id: 10, enabled: true, updated_by: 1 }]);
  });

  it("fingerprints only the two profile tables and their catalog metadata", async () => {
    const verifier = await readFile(new URL("../server/profile/catalog-verification.sql", import.meta.url), "utf8");
    const result = await pool.query(verifier);
    const tables = result.rows
      .filter((row) => row.object_kind === "table")
      .map((row) => (row.object as Record<string, unknown>).name)
      .sort();
    expect(tables).toEqual([
      "phone11_workspace_profile_status",
      "phone11_workspace_profile_status_settings",
    ]);
    expect(result.rows.some((row) => row.object_kind === "constraint"
      && String((row.object as Record<string, unknown>).definition ?? "").includes("ON DELETE CASCADE"))).toBe(true);
    expect(result.rows.some((row) => row.object_kind === "column"
      && (row.object as Record<string, unknown>).table === "phone11_workspace_profile_status_settings"
      && (row.object as Record<string, unknown>).name === "enabled")).toBe(true);
  });
});
