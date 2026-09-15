import "dotenv/config";
import { parseArgs } from "node:util";
import { getPool } from "../server/pbx/db";

const expected = {
  project: "phone11-stage-20260914",
  instance: "phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg",
  database: "phone11_wake_stage",
  runtimeUser: "phone11-android-api@phone11-stage-20260914.iam",
} as const;

const readTables = [
  "organizations",
  "tenants",
  "users",
  "extensions",
  "user_extensions",
  "sip_accounts",
  "subscriber",
  "did_numbers",
  "phone11_auth_user",
  "phone11_auth_account",
  "phone11_auth_identity",
  "phone11_auth_verification",
] as const;
const authDmlTables = [
  "phone11_auth_session",
  "phone11_auth_rate_limit",
] as const;
const enrollmentDmlTables = [
  "phone11_push_devices",
  "phone11_wake_bindings",
] as const;
const allTables = [
  ...readTables,
  ...authDmlTables,
  ...enrollmentDmlTables,
] as const;

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "confirm-staging": { type: "boolean", default: false },
    project: { type: "string" },
    instance: { type: "string" },
    database: { type: "string" },
    "runtime-user": { type: "string" },
  },
});

async function main() {
  const pool = getPool();
  try {
    if (
      values.project !== expected.project ||
      values.instance !== expected.instance ||
      values.database !== expected.database ||
      values["runtime-user"] !== expected.runtimeUser
    )
      throw new Error("exact isolated staging grant target is required");
    if (values.apply && !values["confirm-staging"])
      throw new Error("--confirm-staging is required");
    const current = await pool.query<{ database: string }>(
      "SELECT current_database() AS database",
    );
    if (current.rows[0]?.database !== expected.database)
      throw new Error("connected database mismatch");
    const relations = await pool.query<{ name: string }>(
      "SELECT name FROM unnest($1::text[]) AS names(name) WHERE to_regclass(name) IS NOT NULL",
      [allTables],
    );
    if (relations.rows.length !== allTables.length)
      throw new Error("staging schema is incomplete");
    const plan = {
      event: "phone11.android.staging.runtime-grants.plan",
      database: expected.database,
      runtimeUser: expected.runtimeUser,
      readTables: [...readTables],
      dmlTables: [...authDmlTables, ...enrollmentDmlTables],
    };
    if (!values.apply) {
      console.info(JSON.stringify(plan));
      console.info(
        "Plan only. Re-run with --apply --confirm-staging after review.",
      );
      return;
    }
    const role = `"${expected.runtimeUser}"`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `GRANT CONNECT ON DATABASE ${expected.database} TO ${role}`,
      );
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT ON ${readTables.join(",")} TO ${role}`);
      await client.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ${[
          ...authDmlTables,
          ...enrollmentDmlTables,
        ].join(",")} TO ${role}`,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.info(
      JSON.stringify({
        ...plan,
        event: "phone11.android.staging.runtime-grants.applied",
      }),
    );
  } catch {
    console.error(
      "Android staging runtime grants failed closed. No credentials were logged.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
