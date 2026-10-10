#!/usr/bin/env node
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { getPool } from "../server/pbx/db";

type PreflightClient = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

type CatalogRow = {
  relation: string | null;
  column_name: string | null;
  data_type: string | null;
  is_nullable: "YES" | "NO" | null;
};

type ConstraintSummary = {
  exact_primary_key: boolean;
  exact_foreign_key: boolean;
  reviewed_timezone_check: boolean;
};

export type TenantSettingsPreflight = {
  event: "phone11.tenant-settings.preflight";
  readOnly: true;
  status: "absent" | "compatible" | "incompatible";
  issues: string[];
};

const expectedColumns = new Map([
  ["tenant_id", { types: ["integer"], nullable: "NO" }],
  [
    "business_hours_timezone",
    { types: ["character varying", "text"], nullable: "NO" },
  ],
  ["created_at", { types: ["timestamp with time zone"], nullable: "NO" }],
  ["updated_at", { types: ["timestamp with time zone"], nullable: "NO" }],
] as const);

const reviewedTimezoneCheckExpression =
  "business_hours_timezone::text = btrim(business_hours_timezone::text) AND char_length(business_hours_timezone::text) >= 1 AND char_length(business_hours_timezone::text) <= 64";

export async function inspectTenantSettings(
  client: PreflightClient,
): Promise<TenantSettingsPreflight> {
  let transactionStarted = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;
    const catalog = await client.query<CatalogRow>(`
      SELECT to_regclass(format('%I.tenant_settings', current_schema()))::text AS relation,
             columns.column_name, columns.data_type, columns.is_nullable
        FROM (SELECT 1) marker
        LEFT JOIN information_schema.columns columns
          ON columns.table_schema = current_schema()
         AND columns.table_name = 'tenant_settings'
       ORDER BY columns.ordinal_position`);
    if (!catalog.rows[0]?.relation) {
      return {
        event: "phone11.tenant-settings.preflight",
        readOnly: true,
        status: "absent",
        issues: [],
      };
    }

    const issues: string[] = [];
    const actual = new Map(catalog.rows.map((row) => [row.column_name, row]));
    for (const [name, expected] of expectedColumns) {
      const column = actual.get(name);
      if (!column) {
        issues.push(`${name}:missing`);
        continue;
      }
      if (!expected.types.includes(column.data_type as never))
        issues.push(`${name}:type`);
      if (column.is_nullable !== expected.nullable)
        issues.push(`${name}:nullable`);
    }
    for (const name of actual.keys()) {
      if (name && !expectedColumns.has(name as never))
        issues.push(`${name}:unexpected`);
    }

    const constraints = await client.query<ConstraintSummary>(`
      SELECT
        EXISTS (
          SELECT 1
            FROM pg_constraint c
           WHERE c.conrelid = to_regclass(format('%I.tenant_settings', current_schema()))
             AND c.contype = 'p'
             AND c.conkey = ARRAY[(
               SELECT attnum
                 FROM pg_attribute
                WHERE attrelid = c.conrelid
                  AND attname = 'tenant_id'
                  AND NOT attisdropped
             )]
        ) AS exact_primary_key,
        EXISTS (
          SELECT 1
            FROM pg_constraint c
           WHERE c.conrelid = to_regclass(format('%I.tenant_settings', current_schema()))
             AND c.contype = 'f'
             AND c.conkey = ARRAY[(
               SELECT attnum
                 FROM pg_attribute
                WHERE attrelid = c.conrelid
                  AND attname = 'tenant_id'
                  AND NOT attisdropped
             )]
             AND c.confrelid = to_regclass(format('%I.tenants', current_schema()))
             AND c.confkey = ARRAY[(
               SELECT attnum
                 FROM pg_attribute
                WHERE attrelid = c.confrelid
                  AND attname = 'id'
                  AND NOT attisdropped
             )]
             AND c.confdeltype = 'c'
        ) AS exact_foreign_key,
        EXISTS (
          SELECT 1
            FROM pg_constraint c
           WHERE c.conrelid = to_regclass(format('%I.tenant_settings', current_schema()))
             AND c.contype = 'c'
             AND c.conname = 'phone11_tenant_settings_timezone_nonempty'
             AND c.convalidated
             AND pg_get_expr(c.conbin, c.conrelid, true) = '${reviewedTimezoneCheckExpression}'
        ) AS reviewed_timezone_check`);
    const constraint = constraints.rows[0];
    if (constraint?.exact_primary_key !== true)
      issues.push("tenant_id:primary_key");
    if (constraint?.exact_foreign_key !== true)
      issues.push("tenant_id:foreign_key");
    if (constraint?.reviewed_timezone_check !== true)
      issues.push("business_hours_timezone:check");

    return {
      event: "phone11.tenant-settings.preflight",
      readOnly: true,
      status: issues.length === 0 ? "compatible" : "incompatible",
      issues: [...new Set(issues)].sort(),
    };
  } finally {
    if (transactionStarted) await client.query("ROLLBACK");
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
async function runPreflight() {
  const database = getPool();
  let client: PoolClient | undefined;
  try {
    client = await database.connect();
    const result = await inspectTenantSettings(client);
    console.info(JSON.stringify(result, null, 2));
    if (result.status === "incompatible") process.exitCode = 2;
  } catch {
    console.error(
      "Phone11 tenant-settings preflight failed. Check database connectivity, read permission, and schema compatibility. No credentials were logged.",
    );
    process.exitCode = 1;
  } finally {
    client?.release();
    await database.end();
  }
}

if (invokedPath === fileURLToPath(import.meta.url)) void runPreflight();
