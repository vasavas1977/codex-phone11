import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createCanonicalAssignmentResolver, type IdentityReadPin } from "../server/pbx/trusted-caller-identity";

// Inert unless the owner supplies the existing dedicated generated-lab URL.
// This suite must never discover credentials, reuse a production role or SET ROLE.
const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const target = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" ||
      !target.port || target.pathname !== "/phone11_pbx_test" || target.search || target.hash) {
    throw new Error("Caller identity rehearsal requires the dedicated generated loopback database");
  }
}

// Deliberately omit SIP-tuple, assignee and membership uniqueness constraints in
// this generated fixture, so the actual SQL must reject drift/corruption states.
// ID primary keys remain. Production provisioning/schema is not modified.
export const GENERATED_CALLER_IDENTITY_FIXTURE_SQL = `
CREATE TABLE users(id integer PRIMARY KEY);
CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL);
CREATE TABLE extensions(id integer PRIMARY KEY,tenant_id integer,user_id integer,
  extension_number text,sip_username text,sip_domain text,status text,deleted_at timestamptz);
CREATE TABLE sip_accounts(id integer PRIMARY KEY,tenant_id integer,extension_id integer,user_id integer,
  sip_username text,sip_domain text,status text,deleted_at timestamptz,ha1 text);
CREATE TABLE subscriber(id integer PRIMARY KEY,username text,domain text,password text,ha1 text);
CREATE TABLE user_extensions(id integer PRIMARY KEY,user_id integer,extension_id integer);
CREATE TABLE tenant_memberships(user_id integer,tenant_id integer,status text);
INSERT INTO users VALUES(30),(31);
INSERT INTO tenants VALUES(7,'active'),(8,'active');
INSERT INTO extensions VALUES(20,7,30,'3001','digest-user','generated.invalid','active',NULL);
INSERT INTO sip_accounts VALUES(10,7,20,30,'digest-user','generated.invalid','active',NULL,'GENERATED_HASH_NOT_GRANTED');
INSERT INTO subscriber VALUES(40,'digest-user','generated.invalid','GENERATED_PASSWORD_NOT_GRANTED','GENERATED_HASH_NOT_GRANTED');
INSERT INTO user_extensions VALUES(50,30,20);
INSERT INTO tenant_memberships VALUES(30,7,'active');
`;

type Fixture = {
  admin: Pool;
  reader: Pool;
  pin: IdentityReadPin;
  resolve: ReturnType<typeof createCanonicalAssignmentResolver>;
};
async function fixture(run: (f: Fixture) => Promise<void>) {
  const nonce = randomBytes(8).toString("hex"), schema = `caller_${nonce}`, role = `caller_read_${nonce}`;
  const password = randomBytes(32).toString("hex");
  const target = new URL(connectionString!);
  const admin = new Pool({ connectionString, ssl: false, max: 1, options: `-c search_path=${schema}` });
  let reader: Pool | undefined, madeSchema = false, madeRole = false;
  try {
    const generatedTarget = (await admin.query("SELECT current_database() AS database,(current_setting('server_version_num')::integer/10000)::integer AS major")).rows[0];
    expect(generatedTarget).toEqual({ database: "phone11_pbx_test", major: 16 });
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT PASSWORD '${password}'`);
    madeRole = true;
    await admin.query(`ALTER ROLE ${role} SET default_transaction_read_only=on`);
    await admin.query(`CREATE SCHEMA ${schema}`); madeSchema = true;
    await admin.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
    await admin.query(GENERATED_CALLER_IDENTITY_FIXTURE_SQL);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role};
      GRANT SELECT(id) ON ${schema}.users TO ${role};
      GRANT SELECT(id,status) ON ${schema}.tenants TO ${role};
      GRANT SELECT(id,tenant_id,user_id,extension_number,sip_username,sip_domain,status,deleted_at) ON ${schema}.extensions TO ${role};
      GRANT SELECT(id,tenant_id,extension_id,user_id,sip_username,sip_domain,status,deleted_at) ON ${schema}.sip_accounts TO ${role};
      GRANT SELECT(username,domain) ON ${schema}.subscriber TO ${role};
      GRANT SELECT(user_id,extension_id) ON ${schema}.user_extensions TO ${role};
      GRANT SELECT(user_id,tenant_id,status) ON ${schema}.tenant_memberships TO ${role}`);
    const pins = (await admin.query(`SELECT current_database() AS database,
      (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=$1) AS role_oid,
      (SELECT oid::text FROM pg_catalog.pg_namespace WHERE nspname=$2) AS schema_oid`, [role, schema])).rows[0];
    reader = new Pool({ host: "127.0.0.1", port: Number(target.port), database: "phone11_pbx_test",
      user: role, password, ssl: false, max: 1, connectionTimeoutMillis: 2000, query_timeout: 3000,
      statement_timeout: 2000, idle_in_transaction_session_timeout: 3000, options: "-c search_path=pg_catalog" });
    const login = (await reader.query("SELECT current_user, session_user, current_setting('default_transaction_read_only') AS read_only")).rows[0];
    expect(login).toEqual({ current_user: role, session_user: role, read_only: "on" });
    const pin: IdentityReadPin = { tenantId: 7, database: pins.database, login: role,
      roleOid: pins.role_oid, schema, schemaOid: pins.schema_oid };
    const execute = async (sql: string, values: readonly unknown[]) => {
      const client = await reader!.connect();
      try { return await client.query(sql, [...values]); }
      finally { client.release(); }
    };
    await run({ admin, reader, pin, resolve: createCanonicalAssignmentResolver(pin, execute) });
  } finally {
    if (reader) await reader.end();
    if (madeSchema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    if (madeRole) await admin.query(`DROP ROLE ${role}`);
    await admin.end();
  }
}
const resolve = (f: Fixture) => f.resolve("digest-user", "generated.invalid");

describe.skipIf(!connectionString)("canonical caller identity on actual generated read-only LOGIN", () => {
  it("admits the unique current subscriber/account/extension/user/membership using exact production resolver SQL", () => fixture(async f => {
    expect(await resolve(f)).toEqual([{ tenant_id: 7, extension_tenant_id: 7, extension_id: 20,
      sip_username: "digest-user", sip_domain: "generated.invalid", account_status: "active", account_deleted_at: null,
      extension_status: "active", extension_deleted_at: null, tenant_status: "active" }]);
  }));
  it.each(["generated.invalid", null, ""])("rejects foreign legacy extension with no account and effective realm %s", domain => fixture(async f => {
    await f.admin.query(`INSERT INTO extensions VALUES(21,8,31,'digest-user',NULL,$1,'active',NULL)`, [domain]);
    expect(await resolve(f)).toEqual([]);
  }));
  it.each(["disabled", "deleted"])("rejects %s legacy extension conflict without status/deletion prefilter", state => fixture(async f => {
    await f.admin.query(`INSERT INTO extensions VALUES(21,8,31,'legacy','digest-user','generated.invalid',$1,$2)`,
      [state === "disabled" ? "suspended" : "active", state === "deleted" ? new Date("2026-01-01T00:00:00Z") : null]);
    expect(await resolve(f)).toEqual([]);
  }));
  it("does not confuse a distinct explicit realm or case-folded username with an effective tuple collision", () => fixture(async f => {
    await f.admin.query(`INSERT INTO extensions VALUES(21,8,31,'legacy','digest-user','other.invalid','active',NULL),
      (22,8,31,'legacy2','Digest-User','generated.invalid','active',NULL)`);
    expect(await resolve(f)).toHaveLength(1);
    expect(await f.resolve("Digest-User", "generated.invalid")).toEqual([]);
  }));
  it.each([
    ["SIP account", "INSERT INTO sip_accounts VALUES(11,8,21,31,'digest-user','generated.invalid','active',NULL,NULL)"],
    ["extension account with another tuple", "INSERT INTO sip_accounts VALUES(11,7,20,30,'other-user','generated.invalid','active',NULL,NULL)"],
    ["subscriber", "INSERT INTO subscriber VALUES(41,'digest-user','generated.invalid',NULL,NULL)"],
    ["assignee", "INSERT INTO user_extensions VALUES(51,31,20)"],
    ["membership", "INSERT INTO tenant_memberships VALUES(30,7,'active')"],
  ])("rejects duplicate %s in actual SQL results", (_name, sql) => fixture(async f => {
    await f.admin.query(sql); expect(await resolve(f)).toEqual([]);
  }));
  it.each([
    "UPDATE sip_accounts SET status='suspended'", "UPDATE sip_accounts SET deleted_at=NOW()",
    "UPDATE extensions SET status='inactive'", "UPDATE extensions SET deleted_at=NOW()",
    "UPDATE tenants SET status='inactive' WHERE id=7", "UPDATE tenant_memberships SET status='inactive'",
    "UPDATE extensions SET tenant_id=8", "UPDATE extensions SET user_id=31", "DELETE FROM subscriber", "DELETE FROM users WHERE id=30",
  ])("rejects lifecycle/ownership mutation %s without cached acceptance", sql => fixture(async f => {
    expect(await resolve(f)).toHaveLength(1); await f.admin.query(sql); expect(await resolve(f)).toEqual([]);
  }));
  it("rejects wrong tenant/role/schema/database pins and a privileged executor instead of the real LOGIN", () => fixture(async f => {
    const execute = (sql: string, values: readonly unknown[]) => f.reader.query(sql, [...values]);
    const changes: Partial<IdentityReadPin>[] = [{ tenantId: 8 }, { login: "wrong_login" },
      { roleOid: String(Number(f.pin.roleOid) + 1) }, { schemaOid: String(Number(f.pin.schemaOid) + 1) },
      { database: "wrong_database" }, { schema: "missing_generated_schema" }];
    for (const change of changes) expect(await createCanonicalAssignmentResolver({ ...f.pin, ...change }, execute)("digest-user", "generated.invalid")).toEqual([]);
    const privileged = (sql: string, values: readonly unknown[]) => f.admin.query(sql, [...values]);
    expect(await createCanonicalAssignmentResolver(f.pin, privileged)("digest-user", "generated.invalid")).toEqual([]);
  }));
  it("cannot read credentials or mutate registry/storage through the identity LOGIN", () => fixture(async f => {
    for (const sql of [`SELECT password FROM ${f.pin.schema}.subscriber`, `SELECT ha1 FROM ${f.pin.schema}.sip_accounts`,
      `UPDATE ${f.pin.schema}.extensions SET status='inactive'`, `DELETE FROM ${f.pin.schema}.subscriber`]) {
      await expect(f.reader.query(sql)).rejects.toBeDefined();
    }
    expect(await resolve(f)).toHaveLength(1);
  }));
});
