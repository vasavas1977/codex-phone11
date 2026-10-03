import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type QueryResultRow } from "pg";
import {
  advancedSchema,
  baseSchema,
  inspectPbxSchema,
  phoneConfigSchema,
} from "../scripts/phone11-pbx-schema-preflight";

const requiredSchema = Object.fromEntries(
  [...new Set([...Object.keys(baseSchema), ...Object.keys(phoneConfigSchema)])].map((table) => [
    table, { ...phoneConfigSchema[table], ...baseSchema[table] },
  ]),
);

function columnRows(
  schema: Record<
    string,
    Record<
      string,
      {
        types: readonly string[];
        udtNames?: readonly string[];
        nullable?: boolean;
      }
    >
  >,
) {
  return Object.entries(schema).flatMap(([table_name, columns]) =>
    Object.entries(columns).map(([column_name, spec]) => ({
      table_name,
      column_name,
      data_type: spec.types[0],
      udt_name: spec.udtNames?.[0] ?? spec.types[0],
      is_nullable: spec.nullable === false ? "NO" : "YES",
    })),
  );
}

function mockClient(
  columnResult: QueryResultRow[],
  relationOverrides: Record<string, Partial<{
    relkind: string; relpersistence: string; relispartition: boolean; has_inheritance: boolean;
  }>> = {},
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("information_schema.columns"))
      return { rows: columnResult };
    if (sql.includes("c.relkind AS relkind"))
      return { rows: [...new Set(columnResult.map((row) => row.table_name))].map((table_name) => ({
        table_name, relkind: "r", relpersistence: "p", relispartition: false,
        has_inheritance: false,
        ...relationOverrides[table_name],
      })) };
    if (sql.includes("AS valid_shape"))
      return { rows: [
        { table_name: "ring_groups", index_name: "ring_groups_tenant_extension", valid_shape: true },
        { table_name: "call_queues", index_name: "call_queues_tenant_extension", valid_shape: true },
      ] };
    return { rows: [] };
  });
  return { query };
}

describe("PBX schema preflight", () => {
  it("reports a compatible base and absent advanced schema without issuing writes", async () => {
    const database = mockClient(columnRows(requiredSchema));
    const result = await inspectPbxSchema(database as never);
    expect(result).toMatchObject({
      readOnly: true,
      overall: "ready_for_migration",
      base: { status: "compatible", issues: [] },
      phoneConfig: { status: "compatible", issues: [] },
      advanced: { status: "absent", presentTables: [], issues: [] },
    });
    expect(result.advanced.missingTables).toEqual(Object.keys(advancedSchema));
    expect(database.query.mock.calls[0][0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    for (const [sql] of database.query.mock.calls.slice(1, -1))
      expect(sql.trim()).toMatch(/^SELECT/i);
  });

  it("reports missing or mistyped base columns and a partial advanced schema as incompatible", async () => {
    const rows = columnRows(requiredSchema).filter(
      (row) => row.column_name !== "deleted_at",
    );
    rows.find(
      (row) =>
        row.table_name === "extensions" && row.column_name === "tenant_id",
    )!.data_type = "bigint";
    rows.push(...columnRows({ ivr_menus: advancedSchema.ivr_menus }));
    const result = await inspectPbxSchema(mockClient(rows) as never);
    expect(result.overall).toBe("incompatible");
    expect(result.base.issues).toEqual(
      expect.arrayContaining([
        "extensions.tenant_id:type",
        "extensions.deleted_at:missing",
      ]),
    );
    expect(result.advanced.status).toBe("incompatible");
    expect(result.advanced.presentTables).toEqual(["ivr_menus"]);
    expect(result.advanced.missingTables).toContain("call_queues");
  });

  it("blocks release when a phone config dependency is absent or mistyped", async () => {
    const rows = columnRows(requiredSchema).filter(
      (row) => row.table_name !== "subscriber" &&
        !(row.table_name === "tenant_memberships" && row.column_name === "status"),
    );
    rows.find((row) => row.table_name === "sip_accounts" && row.column_name === "secret_tag")!.data_type = "text";
    const result = await inspectPbxSchema(mockClient(rows) as never);
    expect(result.overall).toBe("incompatible");
    expect(result.phoneConfig).toMatchObject({ status: "incompatible" });
    expect(result.phoneConfig.issues).toEqual(expect.arrayContaining([
      "tenant_memberships.status:missing",
      "subscriber.password:missing",
      "sip_accounts.secret_tag:type",
    ]));
  });

  it("rejects nonpersistent, partitioned, and inherited base or advanced relations", async () => {
    const rows = columnRows({ ...requiredSchema, ...advancedSchema });
    const overrides: NonNullable<Parameters<typeof mockClient>[1]> = Object.fromEntries(Object.keys(advancedSchema).map((table) => [
      table, { relpersistence: "u" },
    ]));
    overrides.extensions = { has_inheritance: true };
    overrides.tenants = { relispartition: true };
    const result = await inspectPbxSchema(mockClient(rows, overrides) as never);
    expect(result.base.issues).toEqual(expect.arrayContaining([
      "extensions:relation", "tenants:relation",
    ]));
    for (const table of Object.keys(advancedSchema)) {
      expect(result.advanced.issues).toContain(`${table}:relation`);
    }
    expect(result.overall).toBe("incompatible");
  });

  it("rolls back and does not disclose an underlying database error", async () => {
    const privateError = new Error(
      "password=private-secret host=private.example",
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(privateError)
      .mockResolvedValueOnce({ rows: [] });
    await expect(inspectPbxSchema({ query } as never)).rejects.toBe(
      privateError,
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
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
  ) {
    throw new Error(
      "PBX preflight tests require a dedicated loopback phone11_pbx_test database with explicit port",
    );
  }
}

describe.skipIf(!connectionString)(
  "PBX schema preflight against isolated PostgreSQL",
  () => {
    const schema = `pbx_preflight_${randomBytes(8).toString("hex")}`;
    const admin = new Pool({ connectionString, ssl: false });
    const database = new Pool({
      connectionString,
      ssl: false,
      options: `-c search_path=${schema} -c phone11.expected_database=phone11_pbx_test -c phone11.expected_schema=${schema}`,
    });

    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await database.query(`
      CREATE TABLE tenants(id INTEGER PRIMARY KEY,name TEXT,plan TEXT,status TEXT);
      CREATE TABLE extensions(
        id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        org_id INTEGER,user_id INTEGER,extension_number TEXT NOT NULL,display_name TEXT,
        type TEXT,sip_username TEXT,sip_domain TEXT,sip_password TEXT,caller_id_name TEXT,
        caller_id_number TEXT,transport TEXT,status TEXT,deleted_at TIMESTAMPTZ
      );
      CREATE TABLE tenant_memberships(user_id INTEGER,tenant_id INTEGER,status TEXT);
      CREATE TABLE user_extensions(user_id INTEGER,extension_id INTEGER,is_primary BOOLEAN);
      CREATE TABLE organizations(id INTEGER,name TEXT,plan TEXT);
      CREATE TABLE sip_accounts(id INTEGER,extension_id INTEGER,tenant_id INTEGER,user_id INTEGER,
        sip_username TEXT,sip_domain TEXT,ha1 TEXT,ha1b TEXT,secret_ciphertext BYTEA,
        secret_iv BYTEA,secret_tag BYTEA,transport_preference TEXT,status TEXT,deleted_at TIMESTAMPTZ);
      CREATE TABLE subscriber(username TEXT,domain TEXT,password TEXT,ha1 TEXT,ha1b TEXT);
      CREATE TABLE did_numbers(tenant_id INTEGER,destination_type TEXT,destination_value TEXT,
        status TEXT,number TEXT,description TEXT);
    `);
    });

    afterAll(async () => {
      await database.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    });

    it("moves from ready-for-migration to compatible and remains read-only", async () => {
      const client = await database.connect();
      try {
        const before = await inspectPbxSchema(client);
        expect(before).toMatchObject({
          overall: "ready_for_migration",
          phoneConfig: { status: "compatible", issues: [] },
          advanced: { status: "absent" },
        });

        await client.query(
          await readFile(
            new URL(
              "../server/pbx/advanced-routing-migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        const after = await inspectPbxSchema(client);
        expect(after).toMatchObject({
          overall: "compatible",
          base: { status: "compatible", issues: [] },
          advanced: { status: "compatible", missingTables: [], issues: [] },
        });
      } finally {
        client.release();
      }
    });

    it("marks disabled extension and parent tenant guards incompatible", async () => {
      const client = await database.connect();
      try {
        for (const [table, trigger] of [
          ["extensions", "phone11_extension_member_tenant_move"],
          ["ring_groups", "phone11_ring_group_tenant_immutable"],
        ]) {
          await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
          try {
            const result = await inspectPbxSchema(client);
            expect(result.advanced.status).toBe("incompatible");
            expect(result.advanced.issues).toContain(`${table}:${trigger}`);
          } finally {
            await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
          }
        }
        expect((await inspectPbxSchema(client)).advanced.status).toBe("compatible");
      } finally { client.release(); }
    });

    for (const [table, indexName, unique, columns] of [
      ["ring_groups", "ring_groups_tenant_extension", false, "tenant_id,extension"],
      ["call_queues", "call_queues_tenant_extension", true, "extension,tenant_id"],
    ] as const) {
      it(`rejects a same-named malformed ${indexName} on preflight and migration replay`, async () => {
        const client = await database.connect();
        try {
          await client.query(`DROP INDEX ${schema}.${indexName}`);
          await client.query(`CREATE ${unique ? "UNIQUE " : ""}INDEX ${indexName}
            ON ${schema}.${table} (${columns}) WHERE extension IS NOT NULL`);
          const before = (await client.query<{ definition: string }>(
            "SELECT pg_catalog.pg_get_indexdef($1::pg_catalog.regclass) AS definition",
            [`${schema}.${indexName}`],
          )).rows[0].definition;
          const preflight = await inspectPbxSchema(client);
          expect(preflight.overall).toBe("incompatible");
          expect(preflight.advanced.issues).toContain(`${indexName}:index`);
          await expect(client.query(await readFile(
            new URL("../server/pbx/advanced-routing-migration.sql", import.meta.url), "utf8",
          ))).rejects.toMatchObject({ code: "55000" });
          await client.query("ROLLBACK");
          expect((await client.query<{ definition: string }>(
            "SELECT pg_catalog.pg_get_indexdef($1::pg_catalog.regclass) AS definition",
            [`${schema}.${indexName}`],
          )).rows[0].definition).toBe(before);
        } finally {
          await client.query("ROLLBACK");
          await client.query(`DROP INDEX IF EXISTS ${schema}.${indexName}`);
          await client.query(`CREATE UNIQUE INDEX ${indexName} ON ${schema}.${table}
            (tenant_id,extension) WHERE extension IS NOT NULL`);
          client.release();
        }
      });
    }

    it("rejects an inherited member child that bypasses the parent tenant guard", async () => {
      const client = await database.connect();
      try {
        await client.query("CREATE TABLE ring_group_members_child() INHERITS (ring_group_members)");
        await client.query("INSERT INTO tenants(id,name) VALUES(10,'Main tenant'),(20,'Other tenant') ON CONFLICT DO NOTHING");
        const group = await client.query<{ id: number }>(
          "INSERT INTO ring_groups(tenant_id,name) VALUES(10,'Preflight inherited bypass') RETURNING id",
        );
        await client.query("INSERT INTO extensions(id,tenant_id,extension_number) VALUES(201,20,'2001') ON CONFLICT DO NOTHING");
        await client.query("INSERT INTO ring_group_members_child(ring_group_id,extension_id) VALUES($1,201)", [group.rows[0].id]);
        const result = await inspectPbxSchema(client);
        expect(result.overall).toBe("incompatible");
        expect(result.advanced.issues).toContain("ring_group_members:relation");
        expect((await client.query("SELECT count(*)::int AS n FROM ring_group_members_child WHERE ring_group_id=$1", [group.rows[0].id])).rows[0].n).toBe(1);
      } finally {
        await client.query("DROP TABLE IF EXISTS ring_group_members_child");
        client.release();
      }
    });

    it("rejects an inherited base table even before advanced routing is considered", async () => {
      const client = await database.connect();
      try {
        await client.query("CREATE TABLE extensions_child() INHERITS (extensions)");
        const result = await inspectPbxSchema(client);
        expect(result.base.issues).toContain("extensions:relation");
        expect(result.overall).toBe("incompatible");
      } finally {
        await client.query("DROP TABLE IF EXISTS extensions_child");
        client.release();
      }
    });

    it("rejects a same-named foreign key target in another schema", async () => {
      const foreignSchema = `pbx_foreign_${randomBytes(8).toString("hex")}`;
      await admin.query(`CREATE SCHEMA ${foreignSchema}`);
      const client = await database.connect();
      try {
        await admin.query(`CREATE TABLE ${foreignSchema}.tenants(id INTEGER PRIMARY KEY)`);
        await client.query("ALTER TABLE ivr_menus DROP CONSTRAINT ivr_menus_tenant_id_fkey");
        await client.query(`ALTER TABLE ivr_menus ADD CONSTRAINT ivr_menus_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ${foreignSchema}.tenants(id)`);
        const result = await inspectPbxSchema(client);
        expect(result.advanced.status).toBe("incompatible");
        expect(result.advanced.issues).toContain("ivr_menus.tenant_id:foreign_key");
      } finally {
        await client.query("ALTER TABLE ivr_menus DROP CONSTRAINT IF EXISTS ivr_menus_tenant_id_fkey");
        await client.query("ALTER TABLE ivr_menus ADD CONSTRAINT ivr_menus_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE");
        client.release();
        await admin.query(`DROP SCHEMA ${foreignSchema} CASCADE`);
      }
    });

    it("does not synthesize a valid foreign key from duplicate constraint names", async () => {
      const client = await database.connect();
      try {
        await client.query("ALTER TABLE ivr_menus DROP CONSTRAINT ivr_menus_tenant_id_fkey");
        await client.query("ALTER TABLE ivr_menus ADD CONSTRAINT ivr_menus_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES extensions(id)");
        await client.query("ALTER TABLE ring_groups RENAME CONSTRAINT ring_groups_tenant_id_fkey TO ivr_menus_tenant_id_fkey");
        const result = await inspectPbxSchema(client);
        expect(result.advanced.status).toBe("incompatible");
        expect(result.advanced.issues).toContain("ivr_menus.tenant_id:foreign_key");
      } finally {
        await client.query("ALTER TABLE ivr_menus DROP CONSTRAINT IF EXISTS ivr_menus_tenant_id_fkey");
        await client.query("ALTER TABLE ivr_menus ADD CONSTRAINT ivr_menus_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE");
        await client.query("ALTER TABLE ring_groups RENAME CONSTRAINT ivr_menus_tenant_id_fkey TO ring_groups_tenant_id_fkey");
        client.release();
      }
    });

    it("rejects a tenant-move trigger with a no-op predicate", async () => {
      const client = await database.connect();
      try {
        await client.query("DROP TRIGGER phone11_extension_member_tenant_move ON extensions");
        await client.query(`CREATE TRIGGER phone11_extension_member_tenant_move
          AFTER UPDATE ON extensions FOR EACH ROW WHEN (false)
          EXECUTE FUNCTION phone11_validate_advanced_pbx_extension_move()`);
        const result = await inspectPbxSchema(client);
        expect(result.advanced.status).toBe("incompatible");
        expect(result.advanced.issues).toContain("extensions:phone11_extension_member_tenant_move");
      } finally {
        await client.query(await readFile(new URL("../server/pbx/advanced-routing-migration.sql", import.meta.url), "utf8"));
        client.release();
      }
    });

    it("rejects a tenant-move guard restricted to an unrelated UPDATE column", async () => {
      const client = await database.connect();
      try {
        await client.query("DROP TRIGGER phone11_extension_member_tenant_move ON extensions");
        await client.query(`CREATE TRIGGER phone11_extension_member_tenant_move
          AFTER UPDATE OF display_name ON extensions
          FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
          EXECUTE FUNCTION phone11_validate_advanced_pbx_extension_move()`);
        const result = await inspectPbxSchema(client);
        expect(result.advanced.status).toBe("incompatible");
        expect(result.advanced.issues).toContain("extensions:phone11_extension_member_tenant_move");
      } finally {
        await client.query(await readFile(new URL("../server/pbx/advanced-routing-migration.sql", import.meta.url), "utf8"));
        client.release();
      }
    });
  },
);
