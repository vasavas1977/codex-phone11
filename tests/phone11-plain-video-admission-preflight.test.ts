import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { applyAuthMigration } from "../server/_core/phone11-auth-admin";
import {
  checkIndexes,
  formatPreflightReport,
  inspectPlainVideoAdmissionSchema,
  prerequisiteSchema,
  targetSchema,
} from "../scripts/phone11-plain-video-admission-preflight";

function columnRows(
  schema: Record<
    string,
    Record<string, { types: readonly string[]; nullable?: boolean }>
  >,
) {
  return Object.entries(schema).flatMap(([table_name, columns]) =>
    Object.entries(columns).map(([column_name, spec]) => ({
      table_name,
      column_name,
      data_type: spec.types[0],
      is_nullable: spec.nullable === false ? "NO" : "YES",
    })),
  );
}

function mockDatabase({ partialTarget = false } = {}) {
  const prerequisiteColumns = columnRows(prerequisiteSchema);
  const targetColumns = partialTarget
    ? columnRows({
        phone11_plain_video_admission_rooms:
          targetSchema.phone11_plain_video_admission_rooms,
      })
    : [];
  const query = vi.fn(async (sql: string) => {
    if (sql === "BEGIN TRANSACTION READ ONLY" || sql === "ROLLBACK")
      return { rows: [] };
    if (sql === "SELECT current_schema() AS schema_name")
      return { rows: [{ schema_name: "public" }] };
    if (sql.includes("FROM pg_catalog.pg_class c")) {
      return {
        rows: [
          { table_name: "users" },
          { table_name: "tenants" },
          { table_name: "tenant_memberships" },
          { table_name: "phone11_auth_identity" },
          ...(partialTarget
            ? [{ table_name: "phone11_plain_video_admission_rooms" }]
            : []),
        ],
      };
    }
    if (sql.includes("FROM pg_catalog.pg_attribute a"))
      return { rows: [...prerequisiteColumns, ...targetColumns] };
    if (sql.includes("FROM pg_catalog.pg_index idx")) return { rows: [] };
    if (sql.includes("con.contype='f'")) {
      return {
        rows: [
          {
            constraint_oid: "1", local_schema: "public", foreign_schema: "public",
            table_name: "tenant_memberships",
            columns: ["user_id"],
            foreign_table_name: "users",
            foreign_columns: ["id"],
          },
          {
            constraint_oid: "2", local_schema: "public", foreign_schema: "public",
            table_name: "tenant_memberships",
            columns: ["tenant_id"],
            foreign_table_name: "tenants",
            foreign_columns: ["id"],
          },
          {
            constraint_oid: "3", local_schema: "public", foreign_schema: "public",
            table_name: "phone11_auth_identity",
            columns: ["legacy_user_id"],
            foreign_table_name: "users",
            foreign_columns: ["id"],
          },
        ],
      };
    }
    if (sql.includes("con.contype='p'")) {
      return {
        rows: [
          { table_name: "users", columns: ["id"] },
          { table_name: "tenants", columns: ["id"] },
          {
            table_name: "tenant_memberships",
            columns: ["user_id", "tenant_id"],
          },
          { table_name: "phone11_auth_identity", columns: ["auth_user_id"] },
        ],
      };
    }
    if (sql.includes("FROM pg_catalog.pg_trigger tg")) return { rows: [] };
    if (sql.includes("FROM pg_catalog.pg_proc p")) return { rows: [] };
    throw new Error(`Unexpected SQL in mocked preflight: ${sql}`);
  });
  return { query };
}

describe("plain-video admission schema preflight", () => {
  it("accepts PostgreSQL 17 text casts but rejects a widened pending predicate", () => {
    const indexes = [
      ["phone11_plain_video_admission_rooms_tenant", "phone11_plain_video_admission_rooms", "(tenant_id, state, created_at DESC)", ""],
      ["phone11_plain_video_admission_members_lookup", "phone11_plain_video_admission_members", "(tenant_id, user_id, meeting_id)", "WHERE (revoked_at IS NULL)"],
      ["phone11_plain_video_admission_leases_pending", "phone11_plain_video_admission_leases", "(tenant_id, meeting_id, user_id, expires_at)", "WHERE (state = 'pending'::text)"],
      ["phone11_plain_video_eviction_operations_pending", "phone11_plain_video_eviction_operations", "(tenant_id, meeting_id, user_id, created_at)", "WHERE (state = 'pending'::text)"],
    ].map(([indexname, tablename, shape, predicate]) => ({
      indexname, tablename,
      indexdef: `CREATE INDEX ${indexname} ON public.${tablename} USING btree ${shape} ${predicate}`,
    }));
    expect(checkIndexes(indexes)).toEqual([]);
    const widened = indexes.map((row) => ({ ...row }));
    widened[2].indexdef += " OR state = 'issued'";
    expect(checkIndexes(widened)).toContain("phone11_plain_video_admission_leases_pending:definition");
  });

  it("passes a compatible prerequisite schema with no target migration objects", async () => {
    const database = mockDatabase();
    const result = await inspectPlainVideoAdmissionSchema(database as never);

    expect(result).toMatchObject({
      readOnly: true,
      pass: true,
      outcome: "ready_for_migration",
      prerequisites: { status: "compatible", issues: [] },
      migration: { state: "not_applied", presentTables: [], issues: [] },
      note: "migration_not_executed",
    });
    expect(formatPreflightReport(result)).toContain(
      "No migration SQL was executed.",
    );
    expect(database.query.mock.calls[0][0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    for (const [sql] of database.query.mock.calls.slice(1, -1))
      expect(sql.trim()).toMatch(/^SELECT/i);
  });

  it("keeps BEGIN, every catalog read, and ROLLBACK on one acquired pool client", async () => {
    const connection = mockDatabase();
    const release = vi.fn();
    const poolQuery = vi.fn(async () => { throw new Error("Pool.query must not run inside inspection"); });
    const connect = vi.fn(async () => ({ ...connection, release }));
    const result = await inspectPlainVideoAdmissionSchema({
      query: poolQuery,
      connect,
    } as never);
    expect(result.outcome).toBe("ready_for_migration");
    expect(connect).toHaveBeenCalledOnce();
    expect(poolQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(connection.query.mock.calls[0][0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(connection.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("rolls back and releases the same client when catalog inspection fails", async () => {
    const statements: string[] = [];
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql === "SELECT current_schema() AS schema_name")
        throw new Error("catalog unavailable");
      return { rows: [] };
    });
    const poolQuery = vi.fn(async () => { throw new Error("pool query forbidden"); });
    await expect(inspectPlainVideoAdmissionSchema({
      query: poolQuery,
      connect: async () => ({ query, release }),
    } as never)).rejects.toThrow("catalog unavailable");
    expect(statements).toEqual([
      "BEGIN TRANSACTION READ ONLY",
      "SELECT current_schema() AS schema_name",
      "ROLLBACK",
    ]);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails a partial target schema and never attempts to apply it", async () => {
    const database = mockDatabase({ partialTarget: true });
    const result = await inspectPlainVideoAdmissionSchema(database as never);

    expect(result.pass).toBe(false);
    expect(result.outcome).toBe("blocked");
    expect(result.migration.state).toBe("partial_or_incompatible");
    expect(result.migration.issues).toEqual(
      expect.arrayContaining([
        "phone11_plain_video_admission_members.meeting_id:missing",
        "phone11_plain_video_admission_rooms_tenant:missing",
      ]),
    );
    expect(
      database.query.mock.calls.every(
        ([sql]) => !/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql),
      ),
    ).toBe(true);
  });
});

const postgres17Available = (() => {
  try {
    return /PostgreSQL\) 17\./.test(
      execFileSync("postgres", ["--version"], { encoding: "utf8" }),
    );
  } catch {
    return false;
  }
})();

describe("plain-video admission catalog under a SELECT-only role", () => {
  it.runIf(postgres17Available)(
    "reports owner and SELECT-only outcomes equally, then rejects widened and wrong indexes",
    async () => {
      const root = process.cwd();
      // PostgreSQL Unix socket paths have a short platform limit on macOS.
      const temp = mkdtempSync("/tmp/p11-pv-catalog-");
      const data = join(temp, "data");
      const socket = join(temp, "socket");
      const log = join(temp, "postgres.log");
      const port = 55441;
      const owner = userInfo().username;
      const database = "phone11_plain_video_catalog_rehearsal";
      const probe = "phone11_catalog_probe";
      let started = false;
      let ownerPool: Pool | undefined;
      let probePool: Pool | undefined;
      const run = (command: string, args: string[]) =>
        execFileSync(command, args, { stdio: "pipe", timeout: 30_000 });
      try {
        mkdirSync(socket);
        run("initdb", ["-A", "trust", "-U", owner, "--no-instructions", "-D", data]);
        run("pg_ctl", ["-D", data, "-l", log, "-o",
          `-c listen_addresses='' -c unix_socket_directories='${socket}' -p ${port}`,
          "-w", "start"]);
        started = true;
        run("createdb", ["-h", socket, "-p", String(port), "-U", owner, database]);
        ownerPool = new Pool({ host: socket, port, user: owner, database, max: 2 });
        const identity = await ownerPool.query(`SELECT current_database() AS db,
          inet_server_addr() IS NULL AS socket_only,
          current_setting('server_version_num')::integer AS version`);
        expect(identity.rows[0]).toMatchObject({
          db: database, socket_only: true, version: expect.any(Number),
        });
        expect(identity.rows[0].version).toBeGreaterThanOrEqual(170000);
        expect(identity.rows[0].version).toBeLessThan(180000);

        for (const file of [
          "server/meetings/rehearsal-foundation.sql",
          "server/cloud-recordings/prerequisites.sql",
        ]) await ownerPool.query(readFileSync(join(root, file), "utf8"));
        await applyAuthMigration(ownerPool, {
          baseURL: "http://localhost:19441",
          secret: "disposable-phone11-plain-video-catalog-only-2026",
          trustedOrigins: ["http://localhost:19441"],
        });
        await ownerPool.query(`CREATE ROLE ${probe} LOGIN`);
        await ownerPool.query(`GRANT CONNECT ON DATABASE ${database} TO ${probe}`);
        await ownerPool.query(`GRANT USAGE ON SCHEMA public TO ${probe}`);
        await ownerPool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${probe}`);
        probePool = new Pool({ host: socket, port, user: probe, database, max: 1 });

        const beforeOwner = await inspectPlainVideoAdmissionSchema(ownerPool);
        const beforeProbe = await inspectPlainVideoAdmissionSchema(probePool);
        expect(beforeOwner.outcome).toBe("ready_for_migration");
        expect(beforeProbe).toEqual(beforeOwner);
        const privileges = await probePool.query(`SELECT
          has_table_privilege(current_user,'public.tenant_memberships','SELECT') AS can_select,
          has_table_privilege(current_user,'public.tenant_memberships','UPDATE') AS can_update,
          has_table_privilege(current_user,'public.tenant_memberships','INSERT') AS can_insert`);
        expect(privileges.rows[0]).toMatchObject({
          can_select: true, can_update: false, can_insert: false,
        });

        await ownerPool.query(readFileSync(join(root,
          "server/meetings/plain-video-admission-migration.sql"), "utf8"));
        await ownerPool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${probe}`);
        const hidden = await probePool.query(`SELECT count(*)::integer AS count
          FROM information_schema.triggers
          WHERE trigger_schema='public' AND trigger_name='phone11_plain_video_admission_room_revision'`);
        expect(hidden.rows[0].count).toBe(0);
        const afterOwner = await inspectPlainVideoAdmissionSchema(ownerPool);
        const afterProbe = await inspectPlainVideoAdmissionSchema(probePool);
        expect(afterOwner.outcome).toBe("already_applied");
        expect(afterProbe).toEqual(afterOwner);

        const assertRejected = async (issue: string) => {
          const ownerResult = await inspectPlainVideoAdmissionSchema(ownerPool!);
          const probeResult = await inspectPlainVideoAdmissionSchema(probePool!);
          expect(probeResult).toEqual(ownerResult);
          expect(ownerResult.outcome).toBe("blocked");
          expect([...ownerResult.prerequisites.issues, ...ownerResult.migration.issues])
            .toContain(issue);
        };
        const roomBinding = await ownerPool.query(`SELECT conname,
            pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conrelid='public.phone11_plain_video_admission_members'::regclass
            AND confrelid='public.phone11_plain_video_admission_rooms'::regclass
            AND contype='f'`);
        expect(roomBinding.rows).toHaveLength(1);
        const constraintName = `"${String(roomBinding.rows[0].conname).replaceAll('"', '""')}"`;
        const restoreRoomBinding = async () => ownerPool!.query(`ALTER TABLE
          phone11_plain_video_admission_members ADD CONSTRAINT ${constraintName}
          ${roomBinding.rows[0].definition}`);
        const missingRoomBinding = "phone11_plain_video_admission_members.(meeting_id,tenant_id)->phone11_plain_video_admission_rooms.(id,tenant_id):foreign_key";

        // Both column pairs exist, but neither is the composite tenant binding.
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_members
          DROP CONSTRAINT ${constraintName}`);
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_rooms
          ADD CONSTRAINT phone11_test_unique_room_tenant UNIQUE (tenant_id)`);
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_members
          ADD CONSTRAINT phone11_test_split_room_id FOREIGN KEY (meeting_id)
          REFERENCES phone11_plain_video_admission_rooms(id)`);
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_members
          ADD CONSTRAINT phone11_test_split_room_tenant FOREIGN KEY (tenant_id)
          REFERENCES phone11_plain_video_admission_rooms(tenant_id)`);
        await assertRejected(missingRoomBinding);
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_members
          DROP CONSTRAINT phone11_test_split_room_id,
          DROP CONSTRAINT phone11_test_split_room_tenant`);
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_rooms
          DROP CONSTRAINT phone11_test_unique_room_tenant`);
        await restoreRoomBinding();

        // Identical names and columns in a different schema cannot bind public.
        await ownerPool.query(`CREATE SCHEMA shadow`);
        await ownerPool.query(`CREATE TABLE shadow.phone11_plain_video_admission_rooms
          (id uuid NOT NULL, tenant_id integer NOT NULL, PRIMARY KEY (id, tenant_id))`);
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_members
          DROP CONSTRAINT ${constraintName}`);
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_members
          ADD CONSTRAINT phone11_test_shadow_room FOREIGN KEY (meeting_id, tenant_id)
          REFERENCES shadow.phone11_plain_video_admission_rooms(id, tenant_id)`);
        await assertRejected(missingRoomBinding);
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_members
          DROP CONSTRAINT phone11_test_shadow_room`);
        await restoreRoomBinding();

        // A shadow-first search path must not make a shadow copy look release-ready.
        await ownerPool.query(`GRANT USAGE ON SCHEMA shadow TO ${probe}`);
        for (const pool of [ownerPool, probePool]) {
          const connection = await pool.connect();
          try {
            await connection.query(`SET search_path=shadow,public`);
            const result = await inspectPlainVideoAdmissionSchema(connection);
            expect(result.outcome).toBe("blocked");
            expect(result.prerequisites.issues).toContain("schema:public_required");
          } finally {
            await connection.query(`RESET search_path`);
            connection.release();
          }
        }

        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_rooms
          DISABLE TRIGGER phone11_plain_video_admission_room_revision`);
        await assertRejected("phone11_plain_video_admission_rooms:phone11_plain_video_admission_room_revision:definition");
        await ownerPool.query(`ALTER TABLE phone11_plain_video_admission_rooms
          ENABLE TRIGGER phone11_plain_video_admission_room_revision`);
        await ownerPool.query(`DROP TRIGGER phone11_plain_video_admission_room_revision
          ON phone11_plain_video_admission_rooms`);
        await ownerPool.query(`CREATE TRIGGER phone11_plain_video_admission_room_revision
          AFTER INSERT ON phone11_plain_video_admission_rooms FOR EACH ROW
          EXECUTE FUNCTION phone11_plain_video_admission_touch_revision()`);
        await assertRejected("phone11_plain_video_admission_rooms:phone11_plain_video_admission_room_revision:definition");
        await ownerPool.query(`DROP TRIGGER phone11_plain_video_admission_room_revision
          ON phone11_plain_video_admission_rooms`);
        await ownerPool.query(`CREATE TRIGGER phone11_plain_video_admission_room_revision
          BEFORE UPDATE ON phone11_plain_video_admission_rooms FOR EACH ROW
          EXECUTE FUNCTION phone11_plain_video_admission_touch_revision()`);
        await ownerPool.query(`CREATE OR REPLACE FUNCTION phone11_plain_video_admission_touch_revision()
          RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`);
        await assertRejected("phone11_plain_video_admission_touch_revision:definition");
        await ownerPool.query(readFileSync(join(root,
          "server/meetings/plain-video-admission-migration.sql"), "utf8"));
        expect((await inspectPlainVideoAdmissionSchema(ownerPool)).outcome)
          .toBe("already_applied");

        await ownerPool.query(`DROP INDEX phone11_plain_video_admission_leases_pending`);
        await ownerPool.query(`CREATE INDEX phone11_plain_video_admission_leases_pending
          ON phone11_plain_video_admission_leases(tenant_id,meeting_id,user_id,expires_at)
          WHERE state IN ('pending','issued')`);
        await ownerPool.query(`DROP INDEX phone11_plain_video_eviction_operations_pending`);
        await ownerPool.query(`CREATE INDEX phone11_plain_video_eviction_operations_pending
          ON phone11_plain_video_eviction_operations(meeting_id,tenant_id,user_id,created_at)
          WHERE state='pending'`);
        const wrongOwner = await inspectPlainVideoAdmissionSchema(ownerPool);
        const wrongProbe = await inspectPlainVideoAdmissionSchema(probePool);
        expect(wrongProbe).toEqual(wrongOwner);
        expect(wrongProbe.outcome).toBe("blocked");
        expect(wrongProbe.migration.issues).toEqual(expect.arrayContaining([
          "phone11_plain_video_admission_leases_pending:definition",
          "phone11_plain_video_eviction_operations_pending:definition",
        ]));
        const userPk = await ownerPool.query(`SELECT conname FROM pg_constraint
          WHERE conrelid='public.users'::regclass AND contype='p'`);
        expect(userPk.rows).toHaveLength(1);
        await ownerPool.query(`ALTER TABLE users DROP CONSTRAINT
          "${String(userPk.rows[0].conname).replaceAll('"', '""')}" CASCADE`);
        await assertRejected("users:primary_key");
      } finally {
        await probePool?.end();
        await ownerPool?.end();
        if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
        rmSync(temp, { recursive: true, force: true });
      }
    },
    120_000,
  );
});

describe("plain-video admission catalog on disposable PostgreSQL 16", () => {
  it.runIf(process.env.PHONE11_PG16_CATALOG_TEST === "1")(
    "matches owner and SELECT-only reports on the release database major version",
    async () => {
      // Opt-in only. The caller must start a fresh synthetic PostgreSQL 16
      // container on this fixed loopback port; the identity guard runs before
      // any schema mutation and never accepts a caller-supplied database URL.
      const connection = {
        host: "127.0.0.1", port: 55442, user: "postgres",
        database: "phone11_plain_video_catalog_rehearsal", max: 2,
      };
      const ownerPool = new Pool(connection);
      let probePool: Pool | undefined;
      try {
        const identity = await ownerPool.query(`SELECT current_database() AS db,
          current_setting('server_version_num')::integer AS version`);
        expect(identity.rows[0]?.db).toBe(connection.database);
        expect(identity.rows[0]?.version).toBeGreaterThanOrEqual(160000);
        expect(identity.rows[0]?.version).toBeLessThan(170000);
        for (const file of [
          "server/meetings/rehearsal-foundation.sql",
          "server/cloud-recordings/prerequisites.sql",
        ]) await ownerPool.query(readFileSync(join(process.cwd(), file), "utf8"));
        await applyAuthMigration(ownerPool, {
          baseURL: "http://localhost:19442",
          secret: "disposable-phone11-plain-video-pg16-only-2026",
          trustedOrigins: ["http://localhost:19442"],
        });
        await ownerPool.query(`CREATE ROLE phone11_catalog_probe LOGIN`);
        await ownerPool.query(`GRANT CONNECT ON DATABASE ${connection.database} TO phone11_catalog_probe`);
        await ownerPool.query(`GRANT USAGE ON SCHEMA public TO phone11_catalog_probe`);
        await ownerPool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO phone11_catalog_probe`);
        probePool = new Pool({ ...connection, user: "phone11_catalog_probe", max: 1 });
        expect(await inspectPlainVideoAdmissionSchema(probePool)).toEqual(
          await inspectPlainVideoAdmissionSchema(ownerPool),
        );
        expect((await inspectPlainVideoAdmissionSchema(probePool)).outcome)
          .toBe("ready_for_migration");
        await ownerPool.query(readFileSync(join(process.cwd(),
          "server/meetings/plain-video-admission-migration.sql"), "utf8"));
        await ownerPool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO phone11_catalog_probe`);
        const appliedOwner = await inspectPlainVideoAdmissionSchema(ownerPool);
        expect(appliedOwner.outcome).toBe("already_applied");
        expect(await inspectPlainVideoAdmissionSchema(probePool)).toEqual(appliedOwner);
        await ownerPool.query(`DROP INDEX phone11_plain_video_admission_leases_pending`);
        await ownerPool.query(`CREATE INDEX phone11_plain_video_admission_leases_pending
          ON phone11_plain_video_admission_leases(tenant_id,meeting_id,user_id,expires_at)
          WHERE state IN ('pending','issued')`);
        await ownerPool.query(`DROP INDEX phone11_plain_video_eviction_operations_pending`);
        await ownerPool.query(`CREATE INDEX phone11_plain_video_eviction_operations_pending
          ON phone11_plain_video_eviction_operations(meeting_id,tenant_id,user_id,created_at)
          WHERE state='pending'`);
        const wrongOwner = await inspectPlainVideoAdmissionSchema(ownerPool);
        const wrongProbe = await inspectPlainVideoAdmissionSchema(probePool);
        expect(wrongProbe).toEqual(wrongOwner);
        expect(wrongProbe.migration.issues).toEqual(expect.arrayContaining([
          "phone11_plain_video_admission_leases_pending:definition",
          "phone11_plain_video_eviction_operations_pending:definition",
        ]));
        await ownerPool.query(`CREATE OR REPLACE FUNCTION phone11_plain_video_admission_touch_revision()
          RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`);
        const inertOwner = await inspectPlainVideoAdmissionSchema(ownerPool);
        const inertProbe = await inspectPlainVideoAdmissionSchema(probePool);
        expect(inertProbe).toEqual(inertOwner);
        expect(inertProbe.migration.issues)
          .toContain("phone11_plain_video_admission_touch_revision:definition");
      } finally {
        await probePool?.end();
        await ownerPool.end();
      }
    },
    120_000,
  );
});
