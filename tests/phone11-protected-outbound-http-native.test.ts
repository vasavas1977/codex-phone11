import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { once } from "node:events";
import { URL } from "node:url";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProtectedOutboundHttpOwner, type DetachedProtectedHttpOwner } from "../server/pbx/protected-outbound-http";
import { closeFraudPolicyPool, withFraudPolicyTransaction } from "../server/pbx/fraud-policy-db";
import { protectedOutboundDenyXml } from "../server/pbx/protected-outbound-routing";

// Real HTTP, canonical SELECT, protected evaluator and dedicated policy adapter.
// Environment stubbing supplies only this generated fixture's reviewed pins.
const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const target = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" ||
      !target.port || target.pathname !== "/phone11_pbx_test" || target.search || target.hash)
    throw new Error("Raw HTTP rehearsal requires the dedicated generated loopback database");
}
afterEach(async () => { await closeFraudPolicyPool(); vi.unstubAllEnvs(); });
const endpoint = "/api/freeswitch/protected-dialplan", secret = "G".repeat(64), deny = protectedOutboundDenyXml();
const nativeForm = (destination = "+12025550123") => "hostname=generated-switch&section=dialplan&tag_name=&key_name=&key_value=&" + new URLSearchParams({
  "Caller-Context": "phone11_protected_outbound", "Caller-Destination-Number": destination, "Caller-Caller-ID-Number": "1001",
  variable_sip_from_user: "presentation", variable_domain_name: "presentation.invalid", variable_phone11_authenticated_user: "digest-user",
  variable_phone11_authenticated_realm: "generated.invalid", variable_sip_received_ip: "192.0.2.1",
  variable_sofia_profile_name: "generated_private", variable_call_direction: "outbound",
}).toString();
function post(port: number, body = nativeForm(), token = secret) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path: endpoint, method: "POST", headers: {
      "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body), "x-fs-secret": token } }, response => {
      const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() })); response.on("error", reject);
    });
    request.on("error", reject); request.end(body);
  });
}
type Fixture = {
  admin: Pool; identityPool: Pool; schema: string; identityRole: string; policyRole: string; owner: DetachedProtectedHttpOwner;
  port: number; server: Server; identityReads: () => number; assertReleased: () => Promise<void>;
};
async function fixture(run: (value: Fixture) => Promise<void>) {
  const nonce = randomBytes(8).toString("hex"), schema = `http_native_${nonce}`, policyRole = `http_policy_${nonce}`,
    helperOwner = `http_lock_${nonce}`, identityRole = `http_identity_${nonce}`;
  const policyPassword = randomBytes(32).toString("hex"), identityPassword = randomBytes(32).toString("hex"), target = new URL(connectionString!);
  const admin = new Pool({ connectionString, ssl: false, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000, options: `-c search_path=${schema}` });
  const roles: string[] = []; let madeSchema = false, identityPool: Pool | undefined, owner: DetachedProtectedHttpOwner | undefined, server: Server | undefined;
  try {
    expect((await admin.query("SELECT current_database() AS database,(current_setting('server_version_num')::integer/10000)::integer AS major")).rows[0])
      .toEqual({ database: "phone11_pbx_test", major: 16 });
    for (const [role, password] of [[policyRole, policyPassword], [identityRole, identityPassword]]) {
      await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT PASSWORD '${password}'`); roles.push(role);
    }
    await admin.query(`ALTER ROLE ${identityRole} SET default_transaction_read_only=on`);
    await admin.query(`CREATE ROLE ${helperOwner} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT`); roles.push(helperOwner);
    await admin.query(`CREATE SCHEMA ${schema}`); madeSchema = true;
    await admin.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
      CREATE TABLE users(id integer PRIMARY KEY);
      CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL,name text NOT NULL);
      CREATE TABLE tenant_memberships(user_id integer NOT NULL,tenant_id integer NOT NULL,role text NOT NULL,status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,tenant_id));
      CREATE TABLE extensions(id integer PRIMARY KEY,tenant_id integer,user_id integer,extension_number text,sip_username text,sip_domain text,status text,deleted_at timestamptz);
      CREATE TABLE sip_accounts(id integer PRIMARY KEY,tenant_id integer,extension_id integer,user_id integer,sip_username text,sip_domain text,status text,deleted_at timestamptz,ha1 text);
      CREATE TABLE subscriber(id integer PRIMARY KEY,username text,domain text,password text,ha1 text);
      CREATE TABLE user_extensions(id integer PRIMARY KEY,user_id integer,extension_id integer);
      INSERT INTO users VALUES(9),(33),(34);
      INSERT INTO tenants VALUES(7,'active','Generated One'),(8,'active','Generated Two');
      INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES(9,7,'admin','active'),(33,7,'user','active');
      INSERT INTO extensions VALUES(200,7,33,'1001','digest-user','generated.invalid','active',NULL);
      INSERT INTO sip_accounts VALUES(100,7,200,33,'digest-user','generated.invalid','active',NULL,'GENERATED_HASH_NOT_GRANTED');
      INSERT INTO subscriber VALUES(300,'digest-user','generated.invalid','GENERATED_PASSWORD_NOT_GRANTED','GENERATED_HASH_NOT_GRANTED');
      INSERT INTO user_extensions VALUES(400,33,200)`);
    for (const [key, value] of [["expected_database", "phone11_pbx_test"], ["expected_schema", schema], ["expected_server_major", "16"]])
      await admin.query("SELECT set_config($1,$2,false)", [`phone11.${key}`, value]);
    for (const file of ["fraud-controls-migration.sql", "audit-storage-migration.sql"])
      await admin.query(await readFile(new URL(`../server/pbx/${file}`, import.meta.url), "utf8"));
    const pins = (await admin.query(`SELECT 'fraud_controls'::regclass::oid::text AS fraud,'audit_logs'::regclass::oid::text AS audit,
      pg_get_serial_sequence('audit_logs','id')::regclass::oid::text AS sequence,
      (SELECT oid::text FROM pg_roles WHERE rolname=$1) AS runtime,(SELECT oid::text FROM pg_roles WHERE rolname=$2) AS helper_owner,
      (SELECT oid::text FROM pg_roles WHERE rolname=$3) AS identity`, [policyRole, helperOwner, identityRole])).rows[0];
    for (const [key, value] of [["fixed_tenant_id", "7"], ["runtime_role", policyRole], ["runtime_role_oid", pins.runtime],
      ["lock_owner_role", helperOwner], ["lock_owner_role_oid", pins.helper_owner], ["expected_fraud_oid", pins.fraud],
      ["expected_audit_oid", pins.audit], ["expected_audit_sequence_oid", pins.sequence]])
      await admin.query("SELECT set_config($1,$2,false)", [`phone11.${key}`, value]);
    await admin.query(await readFile(new URL("../server/pbx/audit-runtime-permissions.sql", import.meta.url), "utf8"));
    const helper = (await admin.query(`SELECT p.oid::text AS oid,n.oid::text AS schema_oid,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS hash
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='phone11_lock_fixed_fraud_admin'`, [schema])).rows[0];
    const settings: Record<string, string> = { HOST: "127.0.0.1", PORT: target.port, DATABASE: "phone11_pbx_test", USER: policyRole, PASSWORD: policyPassword,
      SCHEMA: schema, TENANT_ID: "7", ROLE_OID: pins.runtime, SCHEMA_OID: helper.schema_oid, HELPER_OID: helper.oid,
      HELPER_OWNER: helperOwner, HELPER_OWNER_OID: pins.helper_owner, HELPER_SHA256: helper.hash, SERVER_MAJOR: "16",
      FRAUD_OID: pins.fraud, AUDIT_OID: pins.audit, AUDIT_SEQUENCE_OID: pins.sequence, GENERATED_LAB: "1" };
    for (const [key, value] of Object.entries(settings)) vi.stubEnv(`PHONE11_FRAUD_${key}`, value);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${identityRole};
      GRANT SELECT(id) ON ${schema}.users TO ${identityRole};
      GRANT SELECT(id,status) ON ${schema}.tenants TO ${identityRole};
      GRANT SELECT(id,tenant_id,user_id,extension_number,sip_username,sip_domain,status,deleted_at) ON ${schema}.extensions TO ${identityRole};
      GRANT SELECT(id,tenant_id,extension_id,user_id,sip_username,sip_domain,status,deleted_at) ON ${schema}.sip_accounts TO ${identityRole};
      GRANT SELECT(username,domain) ON ${schema}.subscriber TO ${identityRole};
      GRANT SELECT(user_id,extension_id) ON ${schema}.user_extensions TO ${identityRole};
      GRANT SELECT(user_id,tenant_id,status) ON ${schema}.tenant_memberships TO ${identityRole};
      INSERT INTO fraud_controls(tenant_id,international_enabled,premium_rate_enabled) VALUES(7,true,true),(8,true,true)`);
    identityPool = new Pool({ host: "127.0.0.1", port: Number(target.port), database: "phone11_pbx_test", user: identityRole, password: identityPassword,
      ssl: false, max: 1, connectionTimeoutMillis: 2000, query_timeout: 2500, statement_timeout: 2000, idle_in_transaction_session_timeout: 3000, options: "-c search_path=pg_catalog" });
    expect((await identityPool.query("SELECT current_user,session_user,current_setting('default_transaction_read_only') AS read_only")).rows[0])
      .toEqual({ current_user: identityRole, session_user: identityRole, read_only: "on" });
    let identityReads = 0;
    const execute = async (sql: string, parameters: readonly unknown[]) => {
      identityReads++; const client = await identityPool!.connect();
      try { return await client.query(sql, [...parameters]); } finally { client.release(); }
    };
    owner = createProtectedOutboundHttpOwner({ ingress: { fsHttpPeerIps: ["127.0.0.1"], fsHeaderSecret: secret, kamSipPeerIps: ["192.0.2.1"], sofiaProfile: "generated_private" },
      routing: { status: "QUALIFIED", mode: "KAM_DIGEST_ASSERTED_ONLY", tenantId: 7, proxyIps: ["192.0.2.1"], sofiaProfile: "generated_private", gateway: "generated_gateway", callerIdNumber: "1996" },
      identity: { tenantId: 7, database: "phone11_pbx_test", login: identityRole, roleOid: pins.identity, schema, schemaOid: helper.schema_oid }, executeIdentityRead: execute });
    server = createServer(owner.handler); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Generated listener unavailable");
    const assertReleased = async () => {
      expect((await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=ANY($1::text[]) AND xact_start IS NOT NULL", [[policyRole, identityRole]])).rows[0].n).toBe(0);
    };
    await run({ admin, identityPool, schema, identityRole, policyRole, owner, port: address.port, server, identityReads: () => identityReads, assertReleased });
    expect(await owner.drain()).toEqual({ settled: true, pending: 0 }); await assertReleased();
  } finally {
    if (owner) await owner.drain();
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    await closeFraudPolicyPool(); if (identityPool) await identityPool.end();
    await admin.query("ROLLBACK").catch(() => {});
    if (madeSchema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    for (const role of roles) await admin.query(`DROP ROLE ${role}`);
    await admin.end();
  }
}

describe.skipIf(!connectionString)("actual protected raw HTTP and separate PostgreSQL16 LOGINs", () => {
  it("returns native product allow XML after real identity/policy SQL and committed released transactions", () => fixture(async f => {
    const identity = await withFraudPolicyTransaction(7, async client => (await client.query("SELECT current_user,session_user")).rows[0]);
    expect(identity).toEqual({ current_user: f.policyRole, session_user: f.policyRole });
    expect(f.policyRole).not.toBe(f.identityRole);
    const reply = await post(f.port); expect(reply.status).toBe(200); expect(reply.body).toContain('application="bridge" data="sofia/gateway/generated_gateway/+12025550123"');
    expect(reply.body).toContain('context name="phone11_protected_outbound"'); expect(reply.body).not.toContain("lab_route"); expect(f.identityReads()).toBe(1);
    await expect(f.identityPool.query(`SELECT password FROM ${f.schema}.subscriber`)).rejects.toBeDefined();
    await expect(withFraudPolicyTransaction(7, client => client.query(`SELECT sip_username FROM ${f.schema}.sip_accounts`))).rejects.toBeDefined();
    await f.assertReleased();
  }));
  it("reads current real policy flags on each HTTP call without cached allow", () => fixture(async f => {
    expect((await post(f.port)).body).toContain('application="bridge"');
    await f.admin.query("UPDATE fraud_controls SET international_enabled=false WHERE tenant_id=7");
    expect((await post(f.port)).body).toBe(deny);
    await f.admin.query("UPDATE fraud_controls SET international_enabled=true WHERE tenant_id=7");
    expect((await post(f.port)).body).toContain('application="bridge"'); expect(f.identityReads()).toBe(3);
  }));
  it("applies actual premium permission to plain,+66 and0066 Thai1900 core forms", () => fixture(async f => {
    for (const destination of ["1900123456", "+661900123456", "00661900123456"]) {
      await f.admin.query("UPDATE fraud_controls SET international_enabled=false,premium_rate_enabled=false WHERE tenant_id=7");
      expect((await post(f.port, nativeForm(destination))).body).toBe(deny);
      await f.admin.query("UPDATE fraud_controls SET premium_rate_enabled=true WHERE tenant_id=7");
      expect((await post(f.port, nativeForm(destination))).body).toContain('application="bridge" data="sofia/gateway/generated_gateway/+661900123456"');
    }
    // This tests the HTTP/core ABI. Frozen Python relayv3 safely refuses0066.
  }));
  it("denies a revoked real workspace membership after a prior successful request", () => fixture(async f => {
    expect((await post(f.port)).body).toContain('application="bridge"');
    await f.admin.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=33 AND tenant_id=7");
    expect((await post(f.port)).body).toBe(deny); expect(f.identityReads()).toBe(2);
  }));
  it("denies the foreign legacy extension ambiguity using actual canonical SELECT", () => fixture(async f => {
    expect((await post(f.port)).body).toContain('application="bridge"');
    await f.admin.query("INSERT INTO extensions VALUES(201,8,34,'digest-user',NULL,NULL,'active',NULL)");
    expect((await post(f.port)).body).toBe(deny);
  }));
  it("terminal-denies policy SELECT permission loss and rolls back/releases the actual transaction", () => fixture(async f => {
    expect((await post(f.port)).body).toContain('application="bridge"');
    await f.admin.query(`REVOKE SELECT ON ${f.schema}.fraud_controls FROM ${f.policyRole}`);
    expect((await post(f.port)).body).toBe(deny); await f.assertReleased();
  }));
  it("refuses malformed raw duplicate/unknown fields and bad auth before real registry or policy access", () => fixture(async f => {
    for (const body of [nativeForm() + "&Caller-Context=default", nativeForm() + "&tenant_id=7"])
      expect((await post(f.port, body)).body).toBe(deny);
    expect((await post(f.port, nativeForm(), "X".repeat(64))).body).toBe(deny); expect(f.identityReads()).toBe(0);
    expect((await f.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=$1", [f.policyRole])).rows[0].n).toBe(0);
  }));
  it("releases a real blocked identity query after HTTP abort without starting a policy connection", () => fixture(async f => {
    const lock = await f.admin.connect(); let request: ReturnType<typeof httpRequest> | undefined;
    try {
      await lock.query("BEGIN"); await lock.query(`LOCK TABLE ${f.schema}.extensions IN ACCESS EXCLUSIVE MODE`);
      let closed!: () => void; const serverClosed = new Promise<void>(resolve => { closed = resolve; });
      f.server.once("request", (_req, response) => response.once("close", closed));
      request = httpRequest({ host: "127.0.0.1", port: f.port, method: "POST", path: endpoint, headers: {
        "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(nativeForm()), "x-fs-secret": secret } });
      request.on("error", () => {}); request.end(nativeForm());
      const deadline = Date.now() + 1000;
      while (true) {
        await lock.query("SELECT pg_stat_clear_snapshot()");
        const blocked = (await lock.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'", [f.identityRole])).rows[0].n;
        if (blocked === 1) break;
        if (Date.now() >= deadline) throw new Error("Generated identity query did not reach owned lock");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      request.destroy(); await serverClosed; await lock.query("COMMIT");
    } finally { request?.destroy(); await lock.query("ROLLBACK").catch(() => {}); lock.release(); }
    expect(await f.owner.drain()).toEqual({ settled: true, pending: 0 }); expect(f.identityReads()).toBe(1);
    expect((await f.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=$1", [f.policyRole])).rows[0].n).toBe(0);
    await f.assertReleased();
  }));
});
