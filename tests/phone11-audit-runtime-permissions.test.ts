import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";

const permissionSource = new URL("../server/pbx/audit-runtime-permissions.sql", import.meta.url);
const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/phone11_pbx_test" || !url.port || url.search || url.hash) {
    throw new Error("Runtime permission tests require dedicated loopback phone11_pbx_test with explicit port");
  }
}

describe("fixed-tenant audit/fraud permission source", () => {
  it("refuses inherited/owner/bypass principals and binds literal session identity, never runtime GUC identity", async () => {
    const sql = await readFile(permissionSource, "utf8");
    for (const item of ["NOT rolsuper", "NOT rolbypassrls", "NOT rolinherit", "NOT rolcanlogin", "pg_auth_members", "pg_shdepend",
      "phone11.runtime_role_oid", "phone11.lock_owner_role_oid", "session_user::text=%L", "current_user::text=%L",
      "ambient authority", "phone11.expected_server_major"]) expect(sql).toContain(item);
    const policies = sql.slice(sql.indexOf("CREATE POLICY phone11_fixed_fraud_read"));
    expect(policies).not.toContain("current_setting");
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?ROLE|CREATE\s+OR\s+REPLACE\s+FUNCTION|PASSWORD\s+'|GRANT\s+ALL/i);
  });
  it("uses a fixed hardened helper with only exact key-lock privileges on its separate NOLOGIN owner", async () => {
    const sql = await readFile(permissionSource, "utf8");
    for (const item of ["VOLATILE STRICT PARALLEL UNSAFE SECURITY DEFINER", "SET search_path = pg_catalog, pg_temp",
      "INTO STRICT admitted_role", "FOR UPDATE OF tm,t", "no_data_found OR too_many_rows", "pg_catalog.sha256",
      "p.prosrc=helper_body", "p.proowner=owner_oid", "FROM PUBLIC", "UPDATE(id)", "UPDATE(user_id)"])
      expect(sql).toContain(item);
    const body = sql.slice(sql.indexOf("helper_body :="), sql.indexOf("$body$,runtime_name"));
    expect(body).not.toMatch(/EXECUTE|current_setting|set_config|INSERT INTO|UPDATE .* SET/);
    expect(body).toContain("tm.tenant_id=%s"); expect(body).toContain("session_user::text <> %L");
    expect(sql).not.toMatch(/GRANT[^;]*UPDATE\(role|GRANT[^;]*UPDATE\(status/);
  });
  it("grants two flag writes and eleven audit INSERT columns, with no audit read/update/delete or parent UPDATE for runtime", async () => {
    const sql = await readFile(permissionSource, "utf8");
    expect(sql).toContain("INSERT(tenant_id,international_enabled,premium_rate_enabled)");
    expect(sql).toContain("UPDATE(international_enabled,premium_rate_enabled,updated_at)");
    expect(sql).toContain("GRANT INSERT(tenant_id,actor_user_id,action,resource_type,resource_id,old_value,new_value,");
    expect(sql).toContain("GRANT USAGE ON SEQUENCE");
    expect(sql).not.toMatch(/GRANT\s+(?:SELECT|UPDATE|DELETE|TRUNCATE)\s+ON\s+%I\.audit_logs/);
    expect(sql).toContain("resource_type=''fraud_controls''"); expect(sql).toContain("phone11_lock_fixed_fraud_admin(actor_user_id)");
  });
});

// The operator/setup connection may create disposable roles/schema. Runtime
// assertions use a separate authenticated LOGIN connection, never SET ROLE or
// an operator/superuser session. No cluster/process is started by this suite.
describe.skipIf(!connectionString)("fixed-tenant runtime on disposable native PostgreSQL (version-qualified)", () => {
  async function fixture(run: (f: { admin: Pool; runtime: Pool; schema: string; role: string; owner: string }) => Promise<void>) {
    const nonce = randomBytes(8).toString("hex"), schema = `policy_${nonce}`;
    const role = `policy_login_${nonce}`, owner = `policy_lock_${nonce}`;
    const password = randomBytes(32).toString("hex"); // Generated fixture only; never printed.
    const admin = new Pool({ connectionString, ssl: false, max: 1, options: `-c search_path=${schema}` });
    const runtimeUrl = new URL(connectionString!); runtimeUrl.username = role; runtimeUrl.password = password;
    const runtime = new Pool({ connectionString: runtimeUrl.toString(), ssl: false, max: 1, options: `-c search_path=${schema}` });
    let createdRole = false, createdOwner = false, createdSchema = false;
    try {
      await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT PASSWORD '${password}'`); createdRole = true;
      await admin.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT`); createdOwner = true;
      await admin.query(`CREATE SCHEMA ${schema}`); createdSchema = true;
      await admin.query(`CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL);
        CREATE TABLE tenant_memberships(user_id integer NOT NULL,tenant_id integer NOT NULL,role text NOT NULL,status text NOT NULL,PRIMARY KEY(user_id,tenant_id));
        INSERT INTO tenants VALUES(7,'active'),(8,'active');
        INSERT INTO tenant_memberships VALUES(9,7,'admin','active'),(33,7,'user','active'),(42,7,'admin','inactive'),(88,8,'owner','active')`);
      const target = (await admin.query("SELECT current_database() AS name,(current_setting('server_version_num')::integer/10000)::text AS major")).rows[0];
      for (const [key, value] of [["expected_database", target.name], ["expected_schema", schema], ["expected_server_major", target.major]])
        await admin.query("SELECT set_config($1,$2,false)", [`phone11.${key}`, value]);
      await admin.query(await readFile(new URL("../server/pbx/fraud-controls-migration.sql", import.meta.url), "utf8"));
      await admin.query(await readFile(new URL("../server/pbx/audit-storage-migration.sql", import.meta.url), "utf8"));
      // Both maintained migrations restore search_path at transaction end.
      const pins = (await admin.query(`SELECT 'fraud_controls'::regclass::oid::text AS fraud,'audit_logs'::regclass::oid::text AS audit,
        pg_get_serial_sequence('audit_logs','id')::regclass::oid::text AS sequence,
        (SELECT oid::text FROM pg_roles WHERE rolname=$1) AS runtime,(SELECT oid::text FROM pg_roles WHERE rolname=$2) AS owner`, [role, owner])).rows[0];
      for (const [key, value] of [["fixed_tenant_id", "7"], ["runtime_role", role], ["runtime_role_oid", pins.runtime],
        ["lock_owner_role", owner], ["lock_owner_role_oid", pins.owner], ["expected_fraud_oid", pins.fraud],
        ["expected_audit_oid", pins.audit], ["expected_audit_sequence_oid", pins.sequence]])
        await admin.query("SELECT set_config($1,$2,false)", [`phone11.${key}`, value]);
      await admin.query(await readFile(permissionSource, "utf8"));
      const actual = (await runtime.query("SELECT session_user,current_user,(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass")).rows[0];
      expect(actual).toEqual({ session_user: role, current_user: role, bypass: false });
      await run({ admin, runtime, schema, role, owner });
    } finally {
      await runtime.query("ROLLBACK").catch(() => {}); await runtime.end();
      await admin.query("ROLLBACK").catch(() => {});
      if (createdSchema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      if (createdRole) await admin.query(`DROP ROLE ${role}`);
      if (createdOwner) await admin.query(`DROP ROLE ${owner}`);
      await admin.end();
    }
  }
  async function audit(runtime: Pool, overrides: { tenant?: number; actor?: number; action?: string } = {}) {
    return runtime.query(`INSERT INTO audit_logs(tenant_id,actor_user_id,action,resource_type,resource_id,old_value,new_value,
      ip_address,user_agent,request_id,session_id) VALUES($1,$2,$3,'fraud_controls',$4,NULL,$5,'127.0.0.1',NULL,NULL,NULL)`,
      [overrides.tenant ?? 7, overrides.actor ?? 9, overrides.action ?? "update", String(overrides.tenant ?? 7), JSON.stringify({ internationalEnabled: true, premiumRateEnabled: false })]);
  }
  it("ignores forged tenant/actor GUCs, permits only the fixed tenant and retains false defaults", async () => fixture(async ({ runtime }) => {
    await runtime.query("SELECT set_config('phone11.fixed_tenant_id','8',false),set_config('phone11.actor_user_id','88',false)");
    await expect(runtime.query("INSERT INTO fraud_controls(tenant_id,international_enabled) VALUES(8,true)")).rejects.toMatchObject({ code: "42501" });
    const row = (await runtime.query("INSERT INTO fraud_controls(tenant_id,international_enabled) VALUES(7,true) RETURNING *")).rows[0];
    expect(row).toMatchObject({ tenant_id: 7, international_enabled: true, premium_rate_enabled: false, daily_cost_ceiling: null });
    await expect(runtime.query("UPDATE fraud_controls SET tenant_id=8 WHERE tenant_id=7")).rejects.toMatchObject({ code: "42501" });
    await expect(runtime.query("UPDATE fraud_controls SET daily_cost_ceiling=100 WHERE tenant_id=7")).rejects.toMatchObject({ code: "42501" });
  }));
  it("denies direct membership/tenant writes, inherited owner access and unauthenticated actor choices", async () => fixture(async ({ runtime, owner }) => {
    for (const sql of ["UPDATE tenant_memberships SET role='owner' WHERE user_id=33", "UPDATE tenant_memberships SET user_id=34 WHERE user_id=33",
      "UPDATE tenants SET id=99 WHERE id=7", `SET ROLE ${owner}`]) await expect(runtime.query(sql)).rejects.toMatchObject({ code: "42501" });
    expect((await runtime.query("SELECT phone11_lock_fixed_fraud_admin(9) AS role")).rows[0].role).toBe("admin");
    for (const actor of [33, 42, 88, -1, 999]) await expect(runtime.query("SELECT phone11_lock_fixed_fraud_admin($1)", [actor])).rejects.toMatchObject({ code: "42501" });
  }));
  it("permits only fixed-scope append-only audit and no manual id/created_at or unauthorised actor", async () => fixture(async ({ runtime }) => {
    await audit(runtime);
    for (const statement of ["SELECT * FROM audit_logs", "UPDATE audit_logs SET action='other'", "DELETE FROM audit_logs", "TRUNCATE audit_logs",
      "INSERT INTO audit_logs(id,tenant_id,action,resource_type) OVERRIDING SYSTEM VALUE VALUES(99,7,'update','fraud_controls')",
      "INSERT INTO audit_logs(tenant_id,action,resource_type,created_at) VALUES(7,'update','fraud_controls',NOW())"])
      await expect(runtime.query(statement)).rejects.toMatchObject({ code: "42501" });
    for (const overrides of [{ tenant: 8 }, { actor: 33 }, { actor: 42 }, { actor: 88 }, { action: "delete" }])
      await expect(audit(runtime, overrides)).rejects.toMatchObject({ code: "42501" });
  }));
  it("rolls back a business insert when strict audit is refused", async () => fixture(async ({ runtime }) => {
    await runtime.query("BEGIN"); await runtime.query("SELECT phone11_lock_fixed_fraud_admin(9)");
    await runtime.query("INSERT INTO fraud_controls(tenant_id,international_enabled,premium_rate_enabled) VALUES(7,true,false)");
    await expect(audit(runtime, { action: "delete" })).rejects.toMatchObject({ code: "42501" });
    await runtime.query("ROLLBACK"); expect((await runtime.query("SELECT * FROM fraud_controls")).rows).toEqual([]);
  }));
  it("holds the actual admin membership lock until rollback and rejects subsequent revocation", async () => fixture(async ({ admin, runtime }) => {
    await runtime.query("BEGIN"); await runtime.query("SELECT phone11_lock_fixed_fraud_admin(9)");
    await admin.query("BEGIN; SET LOCAL lock_timeout='100ms'");
    await expect(admin.query("UPDATE tenant_memberships SET status='inactive' WHERE tenant_id=7 AND user_id=9")).rejects.toMatchObject({ code: "55P03" });
    await admin.query("ROLLBACK"); await runtime.query("ROLLBACK");
    await admin.query("UPDATE tenant_memberships SET status='inactive' WHERE tenant_id=7 AND user_id=9");
    await expect(runtime.query("SELECT phone11_lock_fixed_fraud_admin(9)")).rejects.toMatchObject({ code: "42501" });
  }));
});
