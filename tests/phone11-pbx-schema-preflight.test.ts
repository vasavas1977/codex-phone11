import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type QueryResultRow } from "pg";
import {
  advancedSchema,
  baseSchema,
  inspectPbxSchema,
} from "../scripts/phone11-pbx-schema-preflight";

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

function mockClient(columnResult: QueryResultRow[]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("information_schema.columns"))
      return { rows: columnResult };
    return { rows: [] };
  });
  return { query };
}

describe("PBX schema preflight", () => {
  it("reports a compatible base and absent advanced schema without issuing writes", async () => {
    const database = mockClient(columnRows(baseSchema));
    const result = await inspectPbxSchema(database as never);
    expect(result).toMatchObject({
      readOnly: true,
      overall: "ready_for_migration",
      base: { status: "compatible", issues: [] },
      advanced: { status: "absent", presentTables: [], issues: [] },
    });
    expect(result.advanced.missingTables).toEqual(Object.keys(advancedSchema));
    expect(database.query.mock.calls[0][0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    for (const [sql] of database.query.mock.calls.slice(1, -1))
      expect(sql.trim()).toMatch(/^SELECT/i);
  });

  it("reports missing or mistyped base columns and a partial advanced schema as incompatible", async () => {
    const rows = columnRows(baseSchema).filter(
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
      options: `-c search_path=${schema}`,
    });

    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await database.query(`
      CREATE TABLE tenants(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE extensions(
        id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        extension_number TEXT NOT NULL,display_name TEXT,deleted_at TIMESTAMPTZ
      );
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
  },
);
