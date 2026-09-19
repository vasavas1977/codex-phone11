import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const migrationUrl = new URL(
  "../server/pbx/advanced-routing-migration.sql",
  import.meta.url,
);
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
  ) {
    throw new Error(
      "Advanced PBX tests require a dedicated loopback phone11_pbx_test database with explicit port",
    );
  }
}

describe("advanced PBX migration contract", () => {
  it("is an explicit PostgreSQL migration with every table used by advanced routing", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/^-- Explicit reviewed migration/);
    expect(sql).toContain("Never run at\n-- application startup");
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("COMMIT;");

    for (const table of [
      "ivr_menus",
      "ivr_actions",
      "ring_groups",
      "ring_group_members",
      "call_queues",
      "queue_agents",
      "queue_stats",
      "time_conditions",
      "time_condition_rules",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }

    expect(sql).toContain("REFERENCES tenants(id) ON DELETE CASCADE");
    expect(sql).toContain("REFERENCES extensions(id) ON DELETE CASCADE");
    expect(sql).toContain("phone11_validate_advanced_pbx_member");
    expect(sql).toContain("phone11_advanced_pbx_tenant_immutable");
    expect(sql).toContain("CREATE TRIGGER phone11_ring_group_tenant_immutable");
    expect(sql).toContain("CREATE TRIGGER phone11_queue_tenant_immutable");
  });
});

describe.skipIf(!connectionString)(
  "advanced PBX migration on isolated PostgreSQL",
  () => {
    const schema = `pbx_migration_${randomBytes(8).toString("hex")}`;
    const admin = new Pool({ connectionString, ssl: false });
    const database = new Pool({
      connectionString,
      ssl: false,
      options: `-c search_path=${schema}`,
    });

    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await database.query(`
      CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE extensions (
        id INTEGER PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        extension_number TEXT NOT NULL,
        display_name TEXT,
        deleted_at TIMESTAMPTZ
      );
      INSERT INTO tenants VALUES (10, 'Tenant A'), (20, 'Tenant B');
      INSERT INTO extensions VALUES
        (101, 10, '1001', 'Agent A', NULL),
        (201, 20, '2001', 'Agent B', NULL);
    `);
      const migration = await readFile(migrationUrl, "utf8");
      await database.query(migration);
      await database.query(migration);
    });

    afterAll(async () => {
      await database.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    });

    it("creates the full schema idempotently and supports representative routing records", async () => {
      const tables = await database.query<{ table_name: string }>(
        `
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_name IN (
        'ivr_menus','ivr_actions','ring_groups','ring_group_members',
        'call_queues','queue_agents','queue_stats','time_conditions','time_condition_rules'
      ) ORDER BY table_name
    `,
        [schema],
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "call_queues",
        "ivr_actions",
        "ivr_menus",
        "queue_agents",
        "queue_stats",
        "ring_group_members",
        "ring_groups",
        "time_condition_rules",
        "time_conditions",
      ]);

      const ivr = await database.query<{ id: number }>(`
      INSERT INTO ivr_menus(tenant_id,name) VALUES(10,'Main') RETURNING id
    `);
      await database.query(
        `
      INSERT INTO ivr_actions(menu_id,digit,action_type,target)
      VALUES($1,'1','transfer_ext','1001')
    `,
        [ivr.rows[0].id],
      );

      const group = await database.query<{ id: number }>(`
      INSERT INTO ring_groups(tenant_id,name,extension) VALUES(10,'Sales','7001') RETURNING id
    `);
      await database.query(
        `
      INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,101)
    `,
        [group.rows[0].id],
      );

      const queue = await database.query<{ id: number }>(`
      INSERT INTO call_queues(tenant_id,name,extension) VALUES(10,'Support','8001') RETURNING id
    `);
      await database.query(
        `
      INSERT INTO queue_agents(queue_id,extension_id,skills,is_logged_in)
      VALUES($1,101,'["thai"]',TRUE)
    `,
        [queue.rows[0].id],
      );
      await database.query(
        `
      INSERT INTO queue_stats(queue_id,interval_start,interval_end,offered_calls,answered_calls)
      VALUES($1,clock_timestamp()-INTERVAL '1 hour',clock_timestamp(),2,1)
    `,
        [queue.rows[0].id],
      );

      const condition = await database.query<{ id: number }>(`
      INSERT INTO time_conditions(tenant_id,name) VALUES(10,'Business hours') RETURNING id
    `);
      await database.query(
        `
      INSERT INTO time_condition_rules(time_condition_id,day_of_week,start_time,end_time)
      VALUES($1,ARRAY[1,2,3,4,5],'09:00','17:00')
    `,
        [condition.rows[0].id],
      );

      expect(
        (await database.query("SELECT count(*)::int AS count FROM ivr_actions"))
          .rows[0].count,
      ).toBe(1);
      expect(
        (
          await database.query(
            "SELECT count(*)::int AS count FROM queue_agents WHERE is_logged_in",
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await database.query(
            "SELECT first_name,last_name FROM extensions WHERE id=101",
          )
        ).rows[0],
      ).toEqual({ first_name: null, last_name: null });
    });

    it("rejects parent tenant moves that would stale child memberships", async () => {
      const group = await database.query<{ id: number }>(`
      INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Immutable group') RETURNING id
    `);
      await database.query(
        `INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,101)`,
        [group.rows[0].id],
      );
      await expect(
        database.query(`UPDATE ring_groups SET tenant_id=20 WHERE id=$1`, [group.rows[0].id]),
      ).rejects.toMatchObject({ code: "23514" });

      const queue = await database.query<{ id: number }>(`
      INSERT INTO call_queues(tenant_id,name) VALUES(10,'Immutable queue') RETURNING id
    `);
      await database.query(
        `INSERT INTO queue_agents(queue_id,extension_id) VALUES($1,101)`,
        [queue.rows[0].id],
      );
      await expect(
        database.query(`UPDATE call_queues SET tenant_id=20 WHERE id=$1`, [queue.rows[0].id]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects cross-tenant members and invalid routing values", async () => {
      const group = await database.query<{ id: number }>(`
      INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Tenant-safe group') RETURNING id
    `);
      await expect(
        database.query(
          `
      INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,201)
    `,
          [group.rows[0].id],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        database.query(`
      INSERT INTO call_queues(tenant_id,name,strategy) VALUES(10,'Bad queue','unsupported')
    `),
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        database.query(`
      INSERT INTO time_condition_rules(time_condition_id,day_of_week)
      VALUES((SELECT id FROM time_conditions LIMIT 1),ARRAY[7])
    `),
      ).rejects.toMatchObject({ code: "23514" });
    });
  },
);
