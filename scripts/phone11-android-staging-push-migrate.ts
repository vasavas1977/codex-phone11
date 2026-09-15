import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { getPool } from "../server/pbx/db";

const expected = {
  database: "phone11_wake_stage",
  project: "phone11-stage-20260914",
  instance: "phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg",
} as const;
const required = [
  "users",
  "tenants",
  "extensions",
  "user_extensions",
  "sip_accounts",
  "phone11_auth_user",
  "phone11_auth_session",
  "phone11_auth_identity",
] as const;

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "confirm-staging": { type: "boolean", default: false },
    project: { type: "string" },
    instance: { type: "string" },
    database: { type: "string" },
  },
});

async function main() {
  const pool = getPool();
  try {
    if (
      values.project !== expected.project ||
      values.instance !== expected.instance ||
      values.database !== expected.database
    )
      throw new Error("exact isolated staging target is required");
    if (values.apply && !values["confirm-staging"])
      throw new Error("--confirm-staging is required");
    const current = await pool.query<{ database: string }>(
      "SELECT current_database() AS database",
    );
    if (current.rows[0]?.database !== expected.database)
      throw new Error("connected database mismatch");
    const relations = await pool.query<{ name: string }>(
      "SELECT name FROM unnest($1::text[]) AS names(name) WHERE to_regclass(name) IS NOT NULL",
      [required],
    );
    if (relations.rows.length !== required.length)
      throw new Error("canonical or Better Auth schema is incomplete");
    const files = [
      "server/push/migration.sql",
      "server/push/wake-migration.sql",
    ];
    const migrations = await Promise.all(
      files.map(async (file) => {
        const sql = await readFile(file, "utf8");
        return {
          file,
          sql,
          sha256: createHash("sha256").update(sql).digest("hex"),
        };
      }),
    );
    if (!values.apply) {
      console.info(
        JSON.stringify({
          event: "phone11.android.staging.push-migration.plan",
          database: expected.database,
          migrations: migrations.map(({ file, sha256 }) => ({ file, sha256 })),
        }),
      );
      console.info(
        "Plan only. Re-run with --apply --confirm-staging after review.",
      );
      return;
    }
    for (const migration of migrations) await pool.query(migration.sql);
    const proof = await pool.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM information_schema.tables
       WHERE table_schema='public' AND table_name IN
       ('phone11_push_devices','phone11_wake_bindings','phone11_wake_calls','phone11_wake_terminals')
    `);
    if (proof.rows[0]?.count !== 4)
      throw new Error("push and wake migration proof failed");
    console.info(
      JSON.stringify({
        event: "phone11.android.staging.push-migration.applied",
        database: expected.database,
        tables: 4,
      }),
    );
  } catch {
    console.error(
      "Android staging push migration failed closed. No credentials were logged.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
