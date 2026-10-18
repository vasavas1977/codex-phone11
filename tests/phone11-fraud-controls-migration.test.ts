import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";

const migrationUrl = new URL("../server/pbx/fraud-controls-migration.sql", import.meta.url);
const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/phone11_pbx_test" || !url.port || url.search || url.hash) {
    throw new Error("Fraud migration tests require dedicated loopback phone11_pbx_test with explicit port");
  }
}

// These source checks run offline. Native PostgreSQL semantics are tested only
// by the separately gated disposable-database suite below.
describe("fraud storage source contract", () => {
  it("owns a bounded atomic migration with explicit selected database/schema and locked identities", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const required of ["BEGIN ISOLATION LEVEL READ COMMITTED", "COMMIT;", "lock_timeout = '5s'", "statement_timeout = '30s'",
      "phone11.expected_database", "phone11.expected_schema", "selected_schema IS DISTINCT FROM expected_schema",
      "session_replication_role", "pg_event_trigger", "SHARE ROW EXCLUSIVE", "ACCESS EXCLUSIVE", "identity changed while locking"]) expect(sql).toContain(required);
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE|INSERT\s+INTO|UPDATE\s+fraud_controls|DELETE\s+FROM|ALTER\s+TABLE)\b/i);
  });
  it("declares all twelve columns, false call defaults and nullable unconfigured fields without financial defaults", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("international_enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("premium_rate_enabled boolean NOT NULL DEFAULT false");
    for (const column of ["max_concurrent_outbound", "calls_per_minute_limit", "daily_cost_ceiling"]) expect(sql).toMatch(new RegExp(`  ${column} double precision,`));
    for (const column of ["geo_block_list", "geo_allow_list"]) expect(sql).toContain(`${column} jsonb,`);
    expect(sql).toContain("alert_email text,"); expect(sql).toContain("alert_on_daily_ceiling boolean,");
    expect(sql).toContain("auto_disable_on_ceiling boolean,"); expect(sql).toContain("tenant_id integer NOT NULL,");
    expect(sql).toContain("updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP");
  });
  it("refuses nonowner table and column ACLs atomically, including inherited creation defaults", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const item of ["pg_catalog.aclexplode", "pg_catalog.acldefault('r',c.relowner)", "pg_catalog.aclexplode(a.attacl)",
      "acl.grantee<>c.relowner OR acl.grantor<>c.relowner", "fraud_controls ownership ACL is incompatible"]) expect(sql).toContain(item);
    expect(sql.indexOf("fraud_controls ownership ACL is incompatible")).toBeLessThan(sql.indexOf("\nCOMMIT;"));
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
  });
  it("refuses partial/extra/default/type/PK/FK/check/policy incompatibilities rather than repairing them", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const required of ["FULL JOIN", "actual.atttypid IS DISTINCT FROM expected.atttypid", "actual.attnotnull IS DISTINCT FROM expected.attnotnull",
      "actual.default_expr IS DISTINCT FROM expected.default_expr", "actual.attisdropped IS DISTINCT FROM false", "convalidated", "indisvalid", "indpred IS NULL",
      "confdeltype='c'", "confupdtype='a'", "confmatchtype='s'", "relforcerowsecurity", "pg_policy", "NOT tgisinternal", "column ABI is incompatible", "CHECK ABI is incompatible"]) expect(sql).toContain(required);
  });
});

describe.skipIf(!connectionString)("fraud storage on isolated PostgreSQL (not offline proof)", () => {
  async function fixture(run: (database: Pool, sql: string) => Promise<void>) {
    const schema = `pbx_fraud_${randomBytes(8).toString("hex")}`;
    const admin = new Pool({ connectionString, ssl: false });
    const database = new Pool({ connectionString, ssl: false, max: 1, options: `-c search_path=${schema}` });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await database.query("CREATE TABLE tenants (id integer PRIMARY KEY); INSERT INTO tenants VALUES (7), (8)");
      const db = await database.query("SELECT current_database() AS name");
      await database.query("SELECT set_config('phone11.expected_database',$1,false), set_config('phone11.expected_schema',$2,false)", [db.rows[0].name, schema]);
      await run(database, await readFile(migrationUrl, "utf8"));
    } finally {
      await database.query("ROLLBACK").catch(() => {});
      await database.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
    }
  }
  it("is idempotent, never seeds, defaults both flags false and keeps all other policy fields unset", async () => fixture(async (db, sql) => {
    await db.query(sql); await db.query(sql);
    expect((await db.query("SELECT * FROM fraud_controls")).rows).toEqual([]);
    const row = (await db.query("INSERT INTO fraud_controls(tenant_id) VALUES(7) RETURNING *")).rows[0];
    expect(Object.keys(row)).toHaveLength(12);
    expect(row).toMatchObject({ tenant_id: 7, international_enabled: false, premium_rate_enabled: false,
      max_concurrent_outbound: null, calls_per_minute_limit: null, daily_cost_ceiling: null,
      geo_block_list: null, geo_allow_list: null, alert_email: null, alert_on_daily_ceiling: null, auto_disable_on_ceiling: null });
    expect(row.updated_at).toBeInstanceOf(Date);
  }));
  it("round trips fractional JS numbers and JSON arrays, enforces the tenant and call flag constraints", async () => fixture(async (db, sql) => {
    await db.query(sql);
    const row = (await db.query(`INSERT INTO fraud_controls(tenant_id,max_concurrent_outbound,calls_per_minute_limit,daily_cost_ceiling,geo_block_list,geo_allow_list)
      VALUES(7,$1,$2,$3,$4,$5) RETURNING *`, [1.5, 2.25, 0.125, JSON.stringify(["TH", '"quoted']), "[]"])).rows[0];
    expect(row).toMatchObject({ max_concurrent_outbound: 1.5, calls_per_minute_limit: 2.25, daily_cost_ceiling: 0.125, geo_block_list: ["TH", '"quoted'], geo_allow_list: [] });
    for (const [statement, code] of [
      ["INSERT INTO fraud_controls(tenant_id) VALUES(999)", "23503"],
      ["INSERT INTO fraud_controls(tenant_id) VALUES(7)", "23505"],
      ["UPDATE fraud_controls SET international_enabled=NULL", "23502"],
      ["UPDATE fraud_controls SET max_concurrent_outbound=0", "23514"],
      ["UPDATE fraud_controls SET daily_cost_ceiling='NaN'", "23514"],
      ["UPDATE fraud_controls SET geo_block_list='[1]'", "23514"],
    ]) await expect(db.query(statement!)).rejects.toMatchObject({ code });
  }));
  it("rolls back a first policy row when a subsequent strict audit insert fails", async () => fixture(async (db, sql) => {
    await db.query(sql); await db.query("CREATE TABLE audit_logs (note text NOT NULL)");
    await db.query("BEGIN");
    await db.query("INSERT INTO fraud_controls(tenant_id,alert_email) VALUES(7,'admin@example.invalid')");
    await expect(db.query("INSERT INTO audit_logs DEFAULT VALUES")).rejects.toMatchObject({ code: "23502" });
    await db.query("ROLLBACK");
    expect((await db.query("SELECT * FROM fraud_controls")).rows).toEqual([]);
  }));
  it.each([
    ["partial", "DROP TABLE fraud_controls; CREATE TABLE fraud_controls(tenant_id integer PRIMARY KEY, international_enabled boolean, premium_rate_enabled boolean)"],
    ["extra NOT NULL", "ALTER TABLE fraud_controls ADD COLUMN extra integer NOT NULL DEFAULT 1"],
    ["permissive default", "ALTER TABLE fraud_controls ALTER COLUMN international_enabled SET DEFAULT true"],
    ["integer count", "ALTER TABLE fraud_controls ALTER COLUMN max_concurrent_outbound TYPE integer"],
    ["missing CHECK", "ALTER TABLE fraud_controls DROP CONSTRAINT phone11_fraud_cost_range"],
    ["missing PK", "ALTER TABLE fraud_controls DROP CONSTRAINT phone11_fraud_controls_pkey"],
    ["missing FK", "ALTER TABLE fraud_controls DROP CONSTRAINT phone11_fraud_controls_tenant_fk"],
    ["RLS", "ALTER TABLE fraud_controls ENABLE ROW LEVEL SECURITY"],
  ])("atomically refuses %s without seed, repair or model leftovers", async (_name, change) => fixture(async (db, sql) => {
    await db.query(sql); await db.query(change!);
    await expect(db.query(sql)).rejects.toMatchObject({ code: "55000" });
    await db.query("ROLLBACK");
    expect((await db.query("SELECT count(*)::int AS n FROM fraud_controls")).rows[0].n).toBe(0);
    expect((await db.query("SELECT to_regclass('pg_temp.phone11_fraud_expected') AS model")).rows[0].model).toBeNull();
  }));
  it("rolls back first creation with unexpected default table authority", async () => fixture(async (db, sql) => {
    const schema = (await db.query("SELECT current_schema() AS name")).rows[0].name as string;
    await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema.replaceAll('"', '""')}" GRANT TRUNCATE,TRIGGER ON TABLES TO PUBLIC`);
    await expect(db.query(sql)).rejects.toMatchObject({ code: "55000" }); await db.query("ROLLBACK");
    expect((await db.query("SELECT to_regclass('fraud_controls') AS table_oid")).rows[0].table_oid).toBeNull();
  }));
  it("refuses existing column ACL without repairing it", async () => fixture(async (db, sql) => {
    await db.query(sql); await db.query("GRANT UPDATE(international_enabled) ON fraud_controls TO PUBLIC");
    await expect(db.query(sql)).rejects.toMatchObject({ code: "55000" }); await db.query("ROLLBACK");
    expect((await db.query("SELECT EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid='fraud_controls'::regclass AND a.attname='international_enabled' AND acl.grantee=0 AND acl.privilege_type='UPDATE') AS retained")).rows[0].retained).toBe(true);
  }));
  it("refuses an unselected target before creating storage", async () => fixture(async (db, sql) => {
    await db.query("SELECT set_config('phone11.expected_schema','unselected',false)");
    await expect(db.query(sql)).rejects.toMatchObject({ code: "55000" }); await db.query("ROLLBACK");
    expect((await db.query("SELECT to_regclass('fraud_controls') AS relation")).rows[0].relation).toBeNull();
  }));
});
