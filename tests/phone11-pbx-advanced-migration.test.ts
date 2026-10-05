import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

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
    expect(sql).toContain("BEGIN ISOLATION LEVEL READ COMMITTED;");
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

    const preflight = await readFile(new URL("../scripts/phone11-pbx-schema-preflight.ts", import.meta.url), "utf8");
    const catalogQuery = (source: string) => source.slice(source.indexOf("WITH base AS ("), source.indexOf("FROM base b") + "FROM base b".length)
      .replace("INTO base_prerequisite", "")
      .replace("n.nspname=expected_schema", "n.nspname=pg_catalog.current_schema()")
      .replace(/\s+/g, " ").trim();
    expect(catalogQuery(sql)).toBe(catalogQuery(preflight));
    expect(sql.indexOf("IF base_prerequisite.tenant_column_ready")).toBeLessThan(sql.indexOf("ALTER TABLE extensions ADD COLUMN"));
    expect(sql.indexOf("LOCK TABLE %I.extensions")).toBeLessThan(sql.indexOf("WITH base AS ("));

    expect(sql).toContain("REFERENCES tenants(id) ON DELETE CASCADE");
    expect(sql).toContain("REFERENCES extensions(id) ON DELETE CASCADE");
    expect(sql).toContain("phone11_validate_advanced_pbx_member");
    expect(sql).toContain("phone11_advanced_pbx_tenant_immutable");
    expect(sql).toContain("CREATE TRIGGER phone11_ring_group_tenant_immutable");
    expect(sql).toContain("CREATE TRIGGER phone11_queue_tenant_immutable");
    expect(sql).toContain("CREATE TRIGGER phone11_extension_member_tenant_move");
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
      options: `-c search_path=${schema} -c phone11.expected_database=phone11_pbx_test -c phone11.expected_schema=${schema}`,
    });

    async function waitForBlock(blockedPid: number, blockerPid: number) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const result = await database.query<{ blockers: number[] }>(
          "SELECT pg_blocking_pids($1) AS blockers",
          [blockedPid],
        );
        if (result.rows[0].blockers.includes(blockerPid)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Expected extension row-lock contention was not observed");
    }

    async function rollbackAndRelease(client: PoolClient) {
      try { await client.query("ROLLBACK"); }
      finally { client.release(); }
    }

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

    it("refuses a wrong migration target pin before DDL", async () => {
      const client = await database.connect();
      try {
        await client.query("SET phone11.expected_schema = 'wrong_schema'");
        await expect(client.query(await readFile(migrationUrl, "utf8"))).rejects.toMatchObject({ code: "55000" });
      } finally {
        await client.query("ROLLBACK");
        await client.query("RESET phone11.expected_schema");
        client.release();
      }
    });

    it("refuses a missing target pin and an explicit temp-first path", async () => {
      const unpinned = new Pool({ connectionString, ssl: false, options: `-c search_path=${schema}` });
      try {
        await expect(unpinned.query(await readFile(migrationUrl, "utf8"))).rejects.toMatchObject({ code: "55000" });
      } finally { await unpinned.end(); }
      const client = await database.connect();
      try {
        await client.query("CREATE TEMP TABLE phone11_pin_shadow(id INTEGER)");
        await client.query(`SET search_path TO pg_temp, ${schema}`);
        await expect(client.query(await readFile(migrationUrl, "utf8"))).rejects.toMatchObject({ code: "55000" });
      } finally {
        await client.query("ROLLBACK");
        await client.query("RESET search_path");
        await client.query("DROP TABLE IF EXISTS pg_temp.phone11_pin_shadow");
        client.release();
      }
    });

    for (const isolation of ["REPEATABLE READ", "SERIALIZABLE"] as const) {
      it(`refuses migration inside a pre-existing ${isolation} transaction`, async () => {
        const client = await database.connect();
        try {
          await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          await client.query("SELECT count(*) FROM extensions");
          await expect(client.query(await readFile(migrationUrl, "utf8"))).rejects.toMatchObject({ code: "25001" });
        } finally { await rollbackAndRelease(client); }
        expect((await database.query("SELECT count(*)::int AS n FROM extensions")).rows[0].n).toBeGreaterThan(0);
      });
    }

    it("replays against the pinned schema despite a temporary extensions shadow", async () => {
      const client = await database.connect();
      try {
        await client.query("CREATE TEMP TABLE extensions(id INTEGER)");
        await client.query(await readFile(migrationUrl, "utf8"));
        expect((await client.query("SELECT count(*)::int AS n FROM pg_temp.extensions")).rows[0].n).toBe(0);
        expect((await client.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='extensions' AND column_name='first_name'`, [schema])).rows[0].n).toBe(1);
      } finally {
        await client.query("DROP TABLE IF EXISTS pg_temp.extensions");
        client.release();
      }
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

    it("rejects a parent tenant change made by another BEFORE trigger", async () => {
      const group = await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Trigger-mutated group') RETURNING id");
      await database.query(`
        CREATE FUNCTION phone11_test_change_group_tenant() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN NEW.tenant_id := 20; RETURN NEW; END $$;
        CREATE TRIGGER phone11_test_change_group_tenant
        BEFORE UPDATE OF name ON ring_groups
        FOR EACH ROW EXECUTE FUNCTION phone11_test_change_group_tenant();
      `);
      try {
        await expect(database.query("UPDATE ring_groups SET name='changed' WHERE id=$1", [group.rows[0].id])).rejects.toMatchObject({ code: "23514" });
        expect((await database.query("SELECT tenant_id FROM ring_groups WHERE id=$1", [group.rows[0].id])).rows[0].tenant_id).toBe(10);
      } finally {
        await database.query("DROP TRIGGER phone11_test_change_group_tenant ON ring_groups");
        await database.query("DROP FUNCTION phone11_test_change_group_tenant()");
      }
    });

    for (const kind of ["ring", "queue"] as const) {
      it(`validates the final ${kind} member tuple after another BEFORE trigger rewrites it`, async () => {
        const table = kind === "ring" ? "ring_group_members" : "queue_agents";
        const parent = kind === "ring"
          ? await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Rewritten ring member') RETURNING id")
          : await database.query<{ id: number }>("INSERT INTO call_queues(tenant_id,name) VALUES(10,'Rewritten queue member') RETURNING id");
        await database.query(`CREATE FUNCTION phone11_test_rewrite_member() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN NEW.extension_id := 201; RETURN NEW; END $$;
          CREATE TRIGGER phone11_test_rewrite_member BEFORE INSERT ON ${table}
          FOR EACH ROW EXECUTE FUNCTION phone11_test_rewrite_member()`);
        try {
          await expect(database.query(
            kind === "ring"
              ? "INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,101)"
              : "INSERT INTO queue_agents(queue_id,extension_id) VALUES($1,101)",
            [parent.rows[0].id],
          )).rejects.toMatchObject({ code: "23514" });
        } finally {
          await database.query(`DROP TRIGGER phone11_test_rewrite_member ON ${table}`);
          await database.query("DROP FUNCTION phone11_test_rewrite_member()");
        }
      });
    }

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

    for (const kind of ["ring", "queue"] as const) {
      it(`rejects ${kind} member validation through a forged temporary extensions table`, async () => {
        const parent = kind === "ring"
          ? await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Temp shadow ring') RETURNING id")
          : await database.query<{ id: number }>("INSERT INTO call_queues(tenant_id,name) VALUES(10,'Temp shadow queue') RETURNING id");
        const client = await database.connect();
        try {
          await client.query("BEGIN");
          await client.query("CREATE TEMP TABLE extensions(id INTEGER,tenant_id INTEGER,deleted_at TIMESTAMPTZ) ON COMMIT DROP");
          await client.query("INSERT INTO pg_temp.extensions VALUES (201,10,NULL)");
          await expect(client.query(
            kind === "ring"
              ? "INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,201)"
              : "INSERT INTO queue_agents(queue_id,extension_id) VALUES($1,201)",
            [parent.rows[0].id],
          )).rejects.toMatchObject({ code: "23514" });
        } finally { await rollbackAndRelease(client); }
      });
    }

    it("allows a nonmember extension move and refuses sequential member moves", async () => {
      await database.query("INSERT INTO extensions VALUES (301,10,'301','Free',NULL)");
      await database.query("UPDATE extensions SET tenant_id=20 WHERE id=301");
      expect((await database.query("SELECT tenant_id FROM extensions WHERE id=301")).rows[0].tenant_id).toBe(20);

      const group = await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Move guard group') RETURNING id");
      const queue = await database.query<{ id: number }>("INSERT INTO call_queues(tenant_id,name) VALUES(10,'Move guard queue') RETURNING id");
      await database.query("INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,101)", [group.rows[0].id]);
      await database.query("INSERT INTO queue_agents(queue_id,extension_id) VALUES($1,101)", [queue.rows[0].id]);
      await expect(database.query("UPDATE extensions SET tenant_id=20 WHERE id=101")).rejects.toMatchObject({ code: "23514" });
      expect((await database.query("SELECT tenant_id FROM extensions WHERE id=101")).rows[0].tenant_id).toBe(10);
    });

    it("rejects a tenant move even when temporary member tables hide real members", async () => {
      const group = await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Temp shadow move') RETURNING id");
      await database.query("INSERT INTO extensions VALUES (351,10,'351','Agent',NULL)");
      await database.query("INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,351)", [group.rows[0].id]);
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("CREATE TEMP TABLE ring_group_members(extension_id INTEGER) ON COMMIT DROP");
        await client.query("CREATE TEMP TABLE queue_agents(extension_id INTEGER) ON COMMIT DROP");
        await expect(client.query("UPDATE extensions SET tenant_id=20 WHERE id=351")).rejects.toMatchObject({ code: "23514" });
      } finally { await rollbackAndRelease(client); }
      expect((await database.query("SELECT tenant_id FROM extensions WHERE id=351")).rows[0].tenant_id).toBe(10);
    });

    for (const kind of ["ring", "queue"] as const) {
      it(`serializes ${kind} member first, then rejects a concurrent extension move`, async () => {
        const extensionId = kind === "ring" ? 311 : 312;
        const parent = kind === "ring"
          ? await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Concurrent ring A') RETURNING id")
          : await database.query<{ id: number }>("INSERT INTO call_queues(tenant_id,name) VALUES(10,'Concurrent queue A') RETURNING id");
        await database.query("INSERT INTO extensions VALUES ($1,10,$2,'Agent',NULL)", [extensionId, String(extensionId)]);
        const member = await database.connect();
        const mover = await database.connect();
        try {
          await member.query("BEGIN");
          await member.query(
            kind === "ring"
              ? "INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,$2)"
              : "INSERT INTO queue_agents(queue_id,extension_id) VALUES($1,$2)",
            [parent.rows[0].id, extensionId],
          );
          await mover.query("BEGIN");
          const memberPid = (await member.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          const moverPid = (await mover.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          const move = mover.query("UPDATE extensions SET tenant_id=20 WHERE id=$1", [extensionId]);
          const moveRejection = expect(move).rejects.toMatchObject({ code: "23514" });
          await waitForBlock(moverPid, memberPid);
          await member.query("COMMIT");
          await moveRejection;
          expect((await database.query("SELECT tenant_id FROM extensions WHERE id=$1", [extensionId])).rows[0].tenant_id).toBe(10);
        } finally {
          await rollbackAndRelease(member);
          await rollbackAndRelease(mover);
        }
      });

      it(`serializes ${kind} extension move first, then rejects a concurrent member insert`, async () => {
        const extensionId = kind === "ring" ? 321 : 322;
        const parent = kind === "ring"
          ? await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Concurrent ring B') RETURNING id")
          : await database.query<{ id: number }>("INSERT INTO call_queues(tenant_id,name) VALUES(10,'Concurrent queue B') RETURNING id");
        await database.query("INSERT INTO extensions VALUES ($1,10,$2,'Agent',NULL)", [extensionId, String(extensionId)]);
        const mover = await database.connect();
        const member = await database.connect();
        try {
          await mover.query("BEGIN");
          await mover.query("UPDATE extensions SET tenant_id=20 WHERE id=$1", [extensionId]);
          await member.query("BEGIN");
          const moverPid = (await mover.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          const memberPid = (await member.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          const insert = member.query(
            kind === "ring"
              ? "INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,$2)"
              : "INSERT INTO queue_agents(queue_id,extension_id) VALUES($1,$2)",
            [parent.rows[0].id, extensionId],
          );
          const insertRejection = expect(insert).rejects.toMatchObject({ code: "23514" });
          await waitForBlock(memberPid, moverPid);
          await mover.query("COMMIT");
          await insertRejection;
          expect((await database.query("SELECT tenant_id FROM extensions WHERE id=$1", [extensionId])).rows[0].tenant_id).toBe(20);
        } finally {
          await rollbackAndRelease(mover);
          await rollbackAndRelease(member);
        }
      });
    }

    for (const isolation of ["REPEATABLE READ", "SERIALIZABLE"] as const) {
      it(`refuses a ${isolation} tenant move with an older member snapshot`, async () => {
        const extensionId = isolation === "REPEATABLE READ" ? 331 : 332;
        const group = await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Isolation guard') RETURNING id");
        await database.query("INSERT INTO extensions VALUES ($1,10,$2,'Agent',NULL)", [extensionId, String(extensionId)]);
        const mover = await database.connect();
        try {
          await mover.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          await mover.query("SELECT count(*) FROM ring_group_members");
          await database.query("INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,$2)", [group.rows[0].id, extensionId]);
          await expect(mover.query("UPDATE extensions SET tenant_id=20 WHERE id=$1", [extensionId])).rejects.toMatchObject({ code: "23514" });
          expect((await database.query("SELECT tenant_id FROM extensions WHERE id=$1", [extensionId])).rows[0].tenant_id).toBe(10);
        } finally { await rollbackAndRelease(mover); }
      });
    }

    it("rolls back on a member-held extension lock timeout", async () => {
      const group = await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Timed lock') RETURNING id");
      await database.query("INSERT INTO extensions VALUES (341,10,'341','Agent',NULL)");
      const member = await database.connect();
      const mover = await database.connect();
      try {
        await member.query("BEGIN");
        await member.query("INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,341)", [group.rows[0].id]);
        await mover.query("BEGIN");
        await mover.query("SET LOCAL lock_timeout = '100ms'");
        await expect(mover.query("UPDATE extensions SET tenant_id=20 WHERE id=341")).rejects.toMatchObject({ code: "55P03" });
        await member.query("COMMIT");
        expect((await database.query("SELECT tenant_id FROM extensions WHERE id=341")).rows[0].tenant_id).toBe(10);
      } finally {
        await rollbackAndRelease(member);
        await rollbackAndRelease(mover);
      }
    });

    it("refuses replay if an existing member was made cross-tenant with its guard disabled", async () => {
      const group = await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Replay invalid') RETURNING id");
      await database.query("ALTER TABLE ring_group_members DISABLE TRIGGER phone11_ring_group_member_tenant");
      try {
        await database.query("INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,201)", [group.rows[0].id]);
      } finally {
        await database.query("ALTER TABLE ring_group_members ENABLE TRIGGER phone11_ring_group_member_tenant");
      }
      const migration = await readFile(migrationUrl, "utf8");
      await expect(database.query(migration)).rejects.toMatchObject({ code: "23514" });
      expect((await database.query("SELECT count(*)::int AS n FROM ring_group_members WHERE ring_group_id=$1", [group.rows[0].id])).rows[0].n).toBe(1);
      await database.query("DELETE FROM ring_group_members WHERE ring_group_id=$1", [group.rows[0].id]);
      await database.query(migration);
    });

    it("refuses replay when an inherited member child bypasses the parent FK and trigger", async () => {
      const group = await database.query<{ id: number }>(
        "INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Inherited bypass') RETURNING id",
      );
      await database.query("CREATE TABLE ring_group_members_child() INHERITS (ring_group_members)");
      try {
        await database.query(
          "INSERT INTO ring_group_members_child(ring_group_id,extension_id) VALUES($1,201)",
          [group.rows[0].id],
        );
        expect((await database.query("SELECT count(*)::int AS n FROM ONLY ring_group_members WHERE ring_group_id=$1", [group.rows[0].id])).rows[0].n).toBe(0);
        expect((await database.query("SELECT count(*)::int AS n FROM ring_group_members WHERE ring_group_id=$1", [group.rows[0].id])).rows[0].n).toBe(1);
        await expect(database.query(await readFile(migrationUrl, "utf8"))).rejects.toMatchObject({ code: "55000" });
        expect((await database.query("SELECT count(*)::int AS n FROM ring_group_members_child WHERE ring_group_id=$1", [group.rows[0].id])).rows[0].n).toBe(1);
      } finally {
        await database.query("DROP TABLE ring_group_members_child");
      }
      await database.query(await readFile(migrationUrl, "utf8"));
    });

    it("replays with an archived member, but refuses new membership on a deleted extension", async () => {
      const group = await database.query<{ id: number }>("INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Archived member') RETURNING id");
      const queue = await database.query<{ id: number }>("INSERT INTO call_queues(tenant_id,name) VALUES(10,'Archived new') RETURNING id");
      await database.query("INSERT INTO extensions VALUES (361,10,'361','Archived',NULL)");
      await database.query("INSERT INTO ring_group_members(ring_group_id,extension_id) VALUES($1,361)", [group.rows[0].id]);
      await database.query("UPDATE extensions SET deleted_at=clock_timestamp() WHERE id=361");
      await database.query(await readFile(migrationUrl, "utf8"));
      await expect(database.query("INSERT INTO queue_agents(queue_id,extension_id) VALUES($1,361)", [queue.rows[0].id])).rejects.toMatchObject({ code: "23514" });
      expect((await database.query("SELECT count(*)::int AS n FROM ring_group_members WHERE extension_id=361")).rows[0].n).toBe(1);
    });
  },
);

describe.skipIf(!connectionString)("advanced PBX migration target hardening", () => {
  async function withBaseSchema(
    run: (database: Pool, schema: string, migration: string) => Promise<void>,
  ) {
    const schema = `pbx_hardening_${randomBytes(8).toString("hex")}`;
    const admin = new Pool({ connectionString, ssl: false });
    const database = new Pool({
      connectionString,
      ssl: false,
      options: `-c search_path=${schema} -c phone11.expected_database=phone11_pbx_test -c phone11.expected_schema=${schema}`,
    });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await database.query(`
        CREATE TABLE tenants(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE extensions(
          id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          extension_number TEXT NOT NULL, deleted_at TIMESTAMPTZ);
        INSERT INTO tenants VALUES (10,'A');
        INSERT INTO extensions VALUES (101,10,'1001',NULL);
      `);
      await run(database, schema, await readFile(migrationUrl, "utf8"));
    } finally {
      await database.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  }

  async function expectUnchangedRefusal(database: Pool, schema: string, migration: string) {
    const before = (await database.query(`SELECT * FROM ${schema}.extensions`)).rows;
    const catalogCount = async () => (await database.query(`SELECT count(*)::int AS n FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname='ivr_menus'`, [schema])).rows[0].n as number;
    const beforeCatalogCount = await catalogCount();
    await expect(database.query(migration)).rejects.toMatchObject({ code: "55000" });
    expect((await database.query(`SELECT * FROM ${schema}.extensions`)).rows).toEqual(before);
    expect(await catalogCount()).toBe(beforeCatalogCount);
    const contactColumn = await database.query(`SELECT count(*)::int AS n FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname='extensions' AND a.attname='first_name'`, [schema]);
    expect(contactColumn.rows[0].n).toBe(0);
  }

  it("uses catalog operators and functions while creating in the pinned schema", async () => {
    await withBaseSchema(async (database, schema, migration) => {
      await database.query(`CREATE FUNCTION ${schema}.phone11_wrong_text_comparison(text,text)
        RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'`);
      await database.query(`CREATE OPERATOR ${schema}.<> (
        LEFTARG=text, RIGHTARG=text, PROCEDURE=${schema}.phone11_wrong_text_comparison)`);
      await database.query(`CREATE FUNCTION ${schema}.clock_timestamp()
        RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT ''2001-01-01''::timestamptz'`);
      const client = await database.connect();
      try {
        await client.query(`SET search_path TO ${schema}, pg_catalog`);
        await client.query(migration);
      } finally { client.release(); }
      const created = await database.query(`INSERT INTO ${schema}.ivr_menus(tenant_id,name)
        VALUES(10,'Trusted default') RETURNING created_at`);
      expect(new Date(created.rows[0].created_at).getUTCFullYear()).toBeGreaterThan(2025);
      const catalog = await database.query(`SELECT count(*)::int AS n FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND c.relname='ivr_menus'`, [schema]);
      expect(catalog.rows[0].n).toBe(1);
    });
  });

  it("binds the digit-length constraint to pg_catalog despite a varchar overload", async () => {
    await withBaseSchema(async (database, schema, migration) => {
      await database.query(`CREATE FUNCTION ${schema}.length(varchar)
        RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'`);
      await database.query(migration);
      const menu = await database.query<{ id: number }>(
        `INSERT INTO ${schema}.ivr_menus(tenant_id,name) VALUES(10,'Length guard') RETURNING id`,
      );
      await expect(database.query(
        `INSERT INTO ${schema}.ivr_actions(menu_id,digit,action_type)
         VALUES($1,'','hangup')`, [menu.rows[0].id],
      )).rejects.toMatchObject({ code: "23514" });
    });
  });

  for (const base of ["extensions", "tenants"] as const) {
    it(`refuses an inheritance child of ${base} before DDL`, async () => {
      await withBaseSchema(async (database, schema, migration) => {
        await database.query(`CREATE TABLE ${schema}.${base}_child() INHERITS (${schema}.${base})`);
        await expectUnchangedRefusal(database, schema, migration);
      });
    });
  }

  it("refuses a base-table inheritance child before DDL", async () => {
    await withBaseSchema(async (database, schema, migration) => {
      await database.query(`CREATE TABLE ${schema}.extensions_parent(
        id INTEGER, tenant_id INTEGER, extension_number TEXT NOT NULL, deleted_at TIMESTAMPTZ)`);
      await database.query(`ALTER TABLE ${schema}.extensions INHERIT ${schema}.extensions_parent`);
      await expectUnchangedRefusal(database, schema, migration);
    });
  });

  it("refuses a base-table partition leaf before DDL", async () => {
    await withBaseSchema(async (database, schema, migration) => {
      await database.query(`CREATE TABLE ${schema}.extensions_root(
        id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL,
        extension_number TEXT NOT NULL, deleted_at TIMESTAMPTZ) PARTITION BY RANGE(id)`);
      await database.query(`ALTER TABLE ${schema}.extensions_root ATTACH PARTITION ${schema}.extensions
        FOR VALUES FROM (0) TO (1000)`);
      await expectUnchangedRefusal(database, schema, migration);
    });
  });

  it("refuses a preexisting unlogged member table before DDL", async () => {
    await withBaseSchema(async (database, schema, migration) => {
      await database.query(`CREATE UNLOGGED TABLE ${schema}.ring_group_members(
        ring_group_id INTEGER, extension_id INTEGER)`);
      await expectUnchangedRefusal(database, schema, migration);
    });
  });

  it("refuses a preexisting advanced partition leaf before DDL", async () => {
    await withBaseSchema(async (database, schema, migration) => {
      await database.query(`CREATE TABLE ${schema}.ring_group_members_root(
        ring_group_id INTEGER, extension_id INTEGER) PARTITION BY RANGE(ring_group_id)`);
      await database.query(`CREATE TABLE ${schema}.ring_group_members PARTITION OF
        ${schema}.ring_group_members_root FOR VALUES FROM (0) TO (1000)`);
      await expectUnchangedRefusal(database, schema, migration);
    });
  });

  it("refuses a preexisting advanced view before DDL", async () => {
    await withBaseSchema(async (database, schema, migration) => {
      await database.query(`CREATE VIEW ${schema}.ivr_menus AS SELECT 1 AS id`);
      await expectUnchangedRefusal(database, schema, migration);
    });
  });

  it("times out behind a base-table reader before creating any routing objects", async () => {
    await withBaseSchema(async (database, schema, migration) => {
      const blocker = await database.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(`SELECT id FROM ${schema}.extensions LIMIT 1`);
        await expect(database.query(migration)).rejects.toMatchObject({ code: "55P03" });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const catalog = await database.query(`SELECT count(*)::int AS n FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND c.relname='ivr_menus'`, [schema]);
      expect(catalog.rows[0].n).toBe(0);
    });
  }, 15000);
});

describe.skipIf(!connectionString)("enforced base prerequisite boundary", () => {
  const admin = new Pool({ connectionString, ssl: false });
  afterAll(async () => { await admin.end(); });

  async function fixture(run: (client: PoolClient, schema: string) => Promise<void>) {
    const schema = `pbx_base_guard_${randomBytes(8).toString("hex")}`;
    const client = await admin.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema};
        SET phone11.expected_database='phone11_pbx_test'; SET phone11.expected_schema='${schema}';
        CREATE TABLE tenants(id integer PRIMARY KEY, alternate integer UNIQUE);
        CREATE TABLE extensions(id integer PRIMARY KEY, tenant_id integer NOT NULL,
          extension_number text NOT NULL, display_name text, deleted_at timestamptz,
          CONSTRAINT tenant_fk FOREIGN KEY(tenant_id) REFERENCES tenants(id));`);
      await run(client, schema);
    } finally {
      await client.query("ROLLBACK; SET session_replication_role=origin; SET search_path=public");
      await client.query(`DROP SCHEMA ${schema} CASCADE; DROP SCHEMA IF EXISTS ${schema}_other CASCADE`);
      client.release();
    }
  }

  async function baseCatalog(client: PoolClient) {
    return (await client.query(`SELECT
      (SELECT jsonb_agg(row(a.attname,a.atttypid,a.attnotnull,a.attidentity,a.attgenerated,
        pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='extensions'::regclass AND a.attnum>0 AND NOT a.attisdropped) columns,
      (SELECT jsonb_agg(row(c.oid,c.xmin::text,pg_get_constraintdef(c.oid)) ORDER BY c.oid)
        FROM pg_constraint c WHERE c.conrelid IN ('extensions'::regclass,'tenants'::regclass)) constraints,
      (SELECT jsonb_agg(row(t.oid,t.tgenabled) ORDER BY t.oid) FROM pg_trigger t
        WHERE t.tgrelid IN ('extensions'::regclass,'tenants'::regclass)) triggers`)).rows[0];
  }

  it.each([
    ["legacy default with NOT NULL", "ALTER TABLE extensions ALTER COLUMN tenant_id SET DEFAULT 1"],
    ["NOT NULL legacy default without FK", "ALTER TABLE extensions DROP CONSTRAINT tenant_fk; ALTER TABLE extensions ALTER COLUMN tenant_id SET DEFAULT 1"],
    ["nullable legacy default without FK", "ALTER TABLE extensions DROP CONSTRAINT tenant_fk; ALTER TABLE extensions ALTER COLUMN tenant_id DROP NOT NULL; ALTER TABLE extensions ALTER COLUMN tenant_id SET DEFAULT 1"],
    ["missing FK", "ALTER TABLE extensions DROP CONSTRAINT tenant_fk"],
    ["unvalidated FK", "ALTER TABLE extensions DROP CONSTRAINT tenant_fk; ALTER TABLE extensions ADD CONSTRAINT tenant_fk FOREIGN KEY(tenant_id) REFERENCES tenants(id) NOT VALID"],
    ["wrong referenced schema", "CREATE SCHEMA OTHER_SCHEMA; CREATE TABLE OTHER_SCHEMA.tenants(id integer PRIMARY KEY); ALTER TABLE extensions DROP CONSTRAINT tenant_fk; ALTER TABLE extensions ADD CONSTRAINT tenant_fk FOREIGN KEY(tenant_id) REFERENCES OTHER_SCHEMA.tenants(id)"],
    ["wrong referenced column", "ALTER TABLE extensions DROP CONSTRAINT tenant_fk; ALTER TABLE extensions ADD CONSTRAINT tenant_fk FOREIGN KEY(tenant_id) REFERENCES tenants(alternate)"],
    ["deferrable FK", "ALTER TABLE extensions ALTER CONSTRAINT tenant_fk DEFERRABLE"],
    ["cascading FK", "ALTER TABLE extensions DROP CONSTRAINT tenant_fk; ALTER TABLE extensions ADD CONSTRAINT tenant_fk FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE"],
    ["disabled child RI", "ALTER TABLE extensions DISABLE TRIGGER ALL"],
    ["disabled parent RI", "ALTER TABLE tenants DISABLE TRIGGER ALL"],
    ["replica-only RI", "DO $$DECLARE n text; BEGIN FOR n IN SELECT tgname FROM pg_trigger WHERE tgrelid='extensions'::regclass LOOP EXECUTE format('ALTER TABLE extensions ENABLE REPLICA TRIGGER %I',n); END LOOP; END$$"],
    ["duplicate tenant FK", "ALTER TABLE extensions ADD CONSTRAINT duplicate_fk FOREIGN KEY(tenant_id) REFERENCES tenants(id)"],
    ["missing extension PK", "ALTER TABLE extensions DROP CONSTRAINT extensions_pkey"],
    ["replica session", "SET session_replication_role=replica"],
  ])("preflight and raw SQL refuse %s without base repair or advanced DDL", async (_name, mutation) => {
    await fixture(async (client, schema) => {
      await client.query(mutation.replaceAll("OTHER_SCHEMA", `${schema}_other`));
      const before = await baseCatalog(client);
      const { inspectPbxSchema } = await import("../scripts/phone11-pbx-schema-preflight");
      expect((await inspectPbxSchema(client)).base.status).toBe("incompatible");
      await expect(client.query(await readFile(migrationUrl, "utf8"))).rejects.toMatchObject({ code: "55000" });
      await client.query("ROLLBACK");
      expect(await baseCatalog(client)).toEqual(before);
      expect((await client.query("SELECT to_regclass('ivr_menus') name")).rows[0].name).toBeNull();
    });
  });

  it("accepts ALWAYS-enabled RI enforcement and preserves exact valid FK on replay", async () => {
    await fixture(async (client) => {
      await client.query(`DO $$DECLARE n text; r text; BEGIN
        FOR n,r IN SELECT tgname,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          WHERE t.tgconstraint=(SELECT oid FROM pg_constraint WHERE conrelid='extensions'::regclass AND conname='tenant_fk')
        LOOP EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I',r,n); END LOOP; END$$`);
      const before = (await client.query("SELECT oid,xmin::text FROM pg_constraint WHERE conrelid='extensions'::regclass AND conname='tenant_fk'")).rows[0];
      const { inspectPbxSchema } = await import("../scripts/phone11-pbx-schema-preflight");
      expect((await inspectPbxSchema(client)).base.status).toBe("compatible");
      const sql = await readFile(migrationUrl, "utf8");
      await client.query(sql); await client.query(sql);
      expect((await client.query("SELECT oid,xmin::text FROM pg_constraint WHERE conrelid='extensions'::regclass AND conname='tenant_fk'")).rows[0]).toEqual(before);
    });
  });

  it("rechecks a concurrently committed default after waiting for the base lock", async () => {
    await fixture(async (client, schema) => {
      const mutator = await admin.connect();
      try {
        await mutator.query(`BEGIN; ALTER TABLE ${schema}.extensions ALTER COLUMN tenant_id SET DEFAULT 1`);
        const pid = (await client.query("SELECT pg_backend_pid() pid")).rows[0].pid;
        const migration = client.query(await readFile(migrationUrl, "utf8"));
        const outcome = migration.then(() => null, (error: unknown) => error);
        const deadline = Date.now() + 2500;
        let blocked = false;
        while (Date.now() < deadline) {
          const result = await mutator.query("SELECT cardinality(pg_blocking_pids($1))>0 blocked", [pid]);
          if (result.rows[0].blocked) { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await mutator.query("COMMIT");
        expect(await outcome).toMatchObject({ code: "55000" });
        await client.query("ROLLBACK");
        expect((await client.query("SELECT to_regclass('ivr_menus') name")).rows[0].name).toBeNull();
        expect((await client.query("SELECT column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name='extensions' AND column_name='tenant_id'", [schema])).rows[0].column_default).toBe("1");
      } finally { await mutator.query("ROLLBACK"); mutator.release(); }
    });
  });
});
