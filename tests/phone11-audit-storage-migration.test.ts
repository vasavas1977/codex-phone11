import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";

const source = new URL("../server/pbx/audit-storage-migration.sql", import.meta.url);
const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/phone11_pbx_test" || !url.port || url.search || url.hash) {
    throw new Error("Audit migration tests require dedicated loopback phone11_pbx_test with explicit port");
  }
}

describe("maintained audit storage source", () => {
  it("pins the selected PostgreSQL16/17 major, target/schema/session and table identity before DDL", async () => {
    const sql = await readFile(source, "utf8");
    for (const item of ["BEGIN ISOLATION LEVEL READ COMMITTED", "COMMIT;", "phone11.expected_database", "phone11.expected_schema",
      "selected IS DISTINCT FROM ns", "phone11.expected_server_major", "NOT IN ('16','17')", "session_replication_role", "pg_event_trigger",
      "lock_timeout = '5s'", "statement_timeout = '30s'", "ACCESS EXCLUSIVE", "SHARE ROW EXCLUSIVE"]) expect(sql).toContain(item);
    expect(sql).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+audit_logs|DELETE\s+FROM|CREATE\s+ROLE|GRANT|CREATE\s+POLICY)\b/i);
    expect(sql).not.toContain("7638134557377753122"); // No clone SID placeholder promotion.
  });
  it("matches all eleven insertion columns and keeps generated/default fields server-owned", async () => {
    const sql = await readFile(source, "utf8");
    const caller = await readFile(new URL("../server/pbx/audit.ts", import.meta.url), "utf8");
    for (const column of ["tenant_id", "actor_user_id", "action", "resource_type", "resource_id", "old_value", "new_value", "ip_address", "user_agent", "request_id", "session_id"]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`)); expect(caller).toContain(column);
    }
    expect(sql).toContain("id bigint GENERATED ALWAYS AS IDENTITY NOT NULL");
    expect(sql).toContain("created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY"); expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ON DELETE RESTRICT ON UPDATE NO ACTION NOT DEFERRABLE");
  });
  it("refuses inherited nonowner table, column and identity-sequence ACLs before storage commit", async () => {
    const sql = await readFile(source, "utf8");
    for (const item of ["pg_catalog.aclexplode", "pg_catalog.acldefault('r',c.relowner)", "pg_catalog.acldefault('S',c.relowner)",
      "pg_catalog.aclexplode(a.attacl)", "acl.grantee<>c.relowner OR acl.grantor<>c.relowner", "audit_logs ownership ACL is incompatible"]) expect(sql).toContain(item);
    expect(sql.indexOf("audit_logs ownership ACL is incompatible")).toBeLessThan(sql.indexOf("\nCOMMIT;"));
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
  });
  it("refuses incompatible existing storage instead of repairing it or granting access", async () => {
    const sql = await readFile(source, "utf8");
    for (const item of ["actual.default_expr IS DISTINCT FROM expected.default_expr", "actual.attidentity IS DISTINCT FROM expected.attidentity",
      "column ABI is incompatible", "CHECK ABI is incompatible", "index ABI is incompatible", "tenant FK is incompatible",
      "identity sequence is incompatible", "existing policies or triggers need separate review", "seqcache=1", "deptype='i'"]) expect(sql).toContain(item);
  });
});

describe.skipIf(!connectionString)("maintained audit storage on disposable native PostgreSQL (version-qualified)", () => {
  async function fixture(run: (db: Pool, sql: string) => Promise<void>) {
    const schema = `audit_${randomBytes(8).toString("hex")}`;
    const admin = new Pool({ connectionString, ssl: false });
    const db = new Pool({ connectionString, ssl: false, max: 1, options: `-c search_path=${schema}` });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await db.query("CREATE TABLE tenants(id integer PRIMARY KEY); INSERT INTO tenants VALUES(7),(8)");
      const target = (await db.query("SELECT current_database() AS name,(current_setting('server_version_num')::integer/10000)::text AS major")).rows[0];
      await db.query("SELECT set_config('phone11.expected_database',$1,false),set_config('phone11.expected_schema',$2,false),set_config('phone11.expected_server_major',$3,false)", [target.name, schema, target.major]);
      await run(db, await readFile(source, "utf8"));
    } finally {
      await db.query("ROLLBACK").catch(() => {}); await db.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
    }
  }
  it("is idempotent, creates no customer audit rows, and enables forced default-deny RLS", async () => fixture(async (db, sql) => {
    await db.query(sql); await db.query(sql);
    // Owner/superuser execution here proves structure only, never runtime acceptance.
    expect((await db.query("SELECT count(*)::integer AS n FROM audit_logs")).rows[0].n).toBe(0);
    const state = (await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='audit_logs'::regclass")).rows[0];
    expect(state).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await db.query("SELECT count(*)::integer AS n FROM pg_policy WHERE polrelid='audit_logs'::regclass")).rows[0].n).toBe(0);
  }));
  it.each([
    ["partial", "DROP TABLE audit_logs; CREATE TABLE audit_logs(tenant_id integer)"],
    ["extra NOT NULL", "ALTER TABLE audit_logs ADD COLUMN extra text NOT NULL DEFAULT ''"],
    ["permissive policy", "CREATE POLICY unexpected ON audit_logs USING(true) WITH CHECK(true)"],
    ["disabled RLS", "ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY"],
    ["missing PK", "ALTER TABLE audit_logs DROP CONSTRAINT phone11_audit_pkey"],
    ["missing FK", "ALTER TABLE audit_logs DROP CONSTRAINT phone11_audit_tenant_fk"],
    ["wrong default", "ALTER TABLE audit_logs ALTER COLUMN created_at SET DEFAULT '2000-01-01'::timestamptz"],
    ["wrong sequence cache", "ALTER SEQUENCE audit_logs_id_seq CACHE 2"],
  ])("refuses %s atomically with no temporary model leftovers", async (_name, change) => fixture(async (db, sql) => {
    await db.query(sql); await db.query(change!);
    await expect(db.query(sql)).rejects.toMatchObject({ code: "55000" }); await db.query("ROLLBACK");
    expect((await db.query("SELECT to_regclass('pg_temp.phone11_audit_expected') AS model")).rows[0].model).toBeNull();
  }));
  it.each([
    ["table", "GRANT TRUNCATE,TRIGGER ON TABLES TO PUBLIC"],
    ["sequence", "GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO PUBLIC"],
  ])("rolls back first creation under unexpected default %s ACLs", async (_kind, grant) => fixture(async (db, sql) => {
    const schema = (await db.query("SELECT current_schema() AS name")).rows[0].name as string;
    // Schema was generated by this fixture; quote identifier without SQL interpolation of external input.
    await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema.replaceAll('"', '""')}" ${grant}`);
    await expect(db.query(sql)).rejects.toMatchObject({ code: "55000" }); await db.query("ROLLBACK");
    expect((await db.query("SELECT to_regclass('audit_logs') AS table_oid,to_regclass('audit_logs_id_seq') AS sequence_oid")).rows[0])
      .toEqual({ table_oid: null, sequence_oid: null });
  }));
  it("refuses unexpected existing column ACL without repairing the grant", async () => fixture(async (db, sql) => {
    await db.query(sql); await db.query("GRANT SELECT(actor_user_id) ON audit_logs TO PUBLIC");
    await expect(db.query(sql)).rejects.toMatchObject({ code: "55000" }); await db.query("ROLLBACK");
    expect((await db.query("SELECT EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid='audit_logs'::regclass AND a.attname='actor_user_id' AND acl.grantee=0 AND acl.privilege_type='SELECT') AS retained")).rows[0].retained).toBe(true);
  }));
  it("refuses wrong target before storage creation", async () => fixture(async (db, sql) => {
    await db.query("SELECT set_config('phone11.expected_database','unselected',false)");
    await expect(db.query(sql)).rejects.toMatchObject({ code: "55000" }); await db.query("ROLLBACK");
    expect((await db.query("SELECT to_regclass('audit_logs') AS rel")).rows[0].rel).toBeNull();
  }));
});
