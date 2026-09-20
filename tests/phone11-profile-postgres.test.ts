import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool } from "pg";
import { createProfileService, ProfileWorkspaceAccessError } from "../server/profile/service";

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
        PRIMARY KEY (user_id, tenant_id)
      );
      CREATE TABLE IF NOT EXISTS tenant_settings (
        tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id),
        business_hours_timezone TEXT
      );
    `);
    await pool.query(await readFile(new URL("../server/profile/migration.sql", import.meta.url), "utf8"));
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE phone11_workspace_profile_status, tenant_settings, tenant_memberships, users, tenants CASCADE;
      INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Other company');
      INSERT INTO tenants VALUES (10, 'active'), (20, 'active');
      INSERT INTO tenant_memberships VALUES (1, 10, 'active'), (2, 10, 'active'), (3, 20, 'active');
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
});
