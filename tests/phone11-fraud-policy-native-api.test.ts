import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

// Only membership/readiness/SIP-origin transports are supplied by the generated owner
// fixture. Fraud DML, actor lock, strict audit and the dedicated adapter are real.
const admission = vi.hoisted(() => ({
  execute: null as null | ((sql: string, values?: unknown[]) => Promise<any>),
  sharedResourceQueries: 0,
  afterLiveAdmission: null as null | (() => Promise<void>),
}));
vi.mock("../server/pbx/db", () => ({
  query: async (sql: string, values?: unknown[]) => {
    if (admission.execute && sql.includes("SELECT sa.tenant_id FROM sip_accounts sa JOIN extensions e")) {
      expect(values).toEqual(["1996", "sip.example.test"]);
      return { rows: [{ tenant_id: 7 }] };
    }
    if (!admission.execute || !sql.includes("FROM tenant_memberships tm")) {
      admission.sharedResourceQueries++;
      throw new Error("SHARED_RESOURCE_QUERY_REFUSED");
    }
    const result = await admission.execute(sql, values);
    if (sql.includes("SELECT tm.role FROM tenant_memberships tm") && admission.afterLiveAdmission) {
      const after = admission.afterLiveAdmission; admission.afterLiveAdmission = null;
      await after();
    }
    return result;
  },
  withTransaction: () => { throw new Error("SHARED_TRANSACTION_REFUSED"); },
}));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: (_key: string, _ttl: number, load: () => unknown) => load(),
  invalidateCache: vi.fn(),
  rateLimitCheck: async () => true,
}));
vi.mock("../server/pbx/schema-capabilities", () => ({
  readManagementCapabilities: async () => ({ phoneNumbers: false }),
  schemaHasRequiredColumns: async () => false,
}));
vi.mock("../server/pbx/cdr-processor", () => ({
  getCallStats: vi.fn(), getVoicemails: vi.fn(), requireVoicemailStorage: vi.fn(),
  processCdr: vi.fn(),
  VoicemailStorageUnavailableError: class extends Error {},
}));
vi.mock("../server/profile/photo", () => ({ profilePhotoDescriptors: vi.fn() }));
vi.mock("../server/phone-provisioning", () => ({
  reactivateExtensionSipAuth: vi.fn(), revokeExtensionSipAuth: vi.fn(), rotateExtensionSipAuth: vi.fn(),
}));
vi.mock("../server/cloud-recordings/correlation", () => ({ bindAuthenticatedOutbound: vi.fn() }));
vi.mock("../server/pbx/dialplan-generators", () => ({
  generateIvrDialplan: vi.fn(), generateRingGroupDialplan: vi.fn(), generateQueueDialplan: vi.fn(), evaluateTimeCondition: vi.fn(),
}));

import { closeFraudPolicyPool } from "../server/pbx/fraud-policy-db";
import { pbxRouter } from "../server/pbx/pbx-router";
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const u = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(u.protocol) || u.hostname !== "127.0.0.1" ||
      !u.port || u.pathname !== "/phone11_pbx_test" || u.search || u.hash) {
    throw new Error("Handler rehearsal requires the dedicated generated loopback database");
  }
}
afterEach(async () => {
  await closeFraudPolicyPool(); vi.unstubAllEnvs(); admission.execute = null; admission.afterLiveAdmission = null;
});

type Fixture = { admin: Pool; schema: string; role: string; owner: string };
async function fixture(run: (f: Fixture) => Promise<void>) {
  const nonce = randomBytes(8).toString("hex");
  const schema = `api_${nonce}`, role = `api_login_${nonce}`, owner = `api_lock_${nonce}`;
  const password = randomBytes(32).toString("hex"); // Never emitted in output.
  const admin = new Pool({ connectionString, ssl: false, max: 1, options: `-c search_path=${schema}` });
  let madeRole = false, madeOwner = false, madeSchema = false;
  admission.sharedResourceQueries = 0;
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT PASSWORD '${password}'`); madeRole = true;
    await admin.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT`); madeOwner = true;
    await admin.query(`CREATE SCHEMA ${schema}`); madeSchema = true;
    await admin.query(`CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL,name text NOT NULL);
      CREATE TABLE tenant_memberships(user_id integer NOT NULL,tenant_id integer NOT NULL,role text NOT NULL,status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,tenant_id));
      INSERT INTO tenants VALUES(7,'active','Generated One'),(8,'active','Generated Two');
      INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES(9,7,'admin','active'),(9,8,'owner','active'),(33,7,'user','active')`);
    const target = (await admin.query("SELECT current_database() AS name,(current_setting('server_version_num')::integer/10000)::text AS major")).rows[0];
    for (const [key, value] of [["expected_database", target.name], ["expected_schema", schema], ["expected_server_major", target.major]])
      await admin.query("SELECT set_config($1,$2,false)", [`phone11.${key}`, value]);
    for (const file of ["fraud-controls-migration.sql", "audit-storage-migration.sql"])
      await admin.query(await readFile(new URL(`../server/pbx/${file}`, import.meta.url), "utf8"));
    const pins = (await admin.query(`SELECT 'fraud_controls'::regclass::oid::text AS fraud,'audit_logs'::regclass::oid::text AS audit,
      pg_get_serial_sequence('audit_logs','id')::regclass::oid::text AS sequence,
      (SELECT oid::text FROM pg_roles WHERE rolname=$1) AS runtime,(SELECT oid::text FROM pg_roles WHERE rolname=$2) AS owner`, [role, owner])).rows[0];
    for (const [key, value] of [["fixed_tenant_id", "7"], ["runtime_role", role], ["runtime_role_oid", pins.runtime],
      ["lock_owner_role", owner], ["lock_owner_role_oid", pins.owner], ["expected_fraud_oid", pins.fraud],
      ["expected_audit_oid", pins.audit], ["expected_audit_sequence_oid", pins.sequence]])
      await admin.query("SELECT set_config($1,$2,false)", [`phone11.${key}`, value]);
    await admin.query(await readFile(new URL("../server/pbx/audit-runtime-permissions.sql", import.meta.url), "utf8"));
    const helper = (await admin.query(`SELECT p.oid::text AS oid,n.oid::text AS schema_oid,
      encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS hash
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=$1 AND p.proname='phone11_lock_fixed_fraud_admin'`, [schema])).rows[0];
    const u = new URL(connectionString!);
    const settings: Record<string, string> = {
      HOST: "127.0.0.1", PORT: u.port, DATABASE: "phone11_pbx_test", USER: role, PASSWORD: password,
      SCHEMA: schema, TENANT_ID: "7", ROLE_OID: pins.runtime, SCHEMA_OID: helper.schema_oid,
      HELPER_OID: helper.oid, HELPER_OWNER: owner, HELPER_OWNER_OID: pins.owner, HELPER_SHA256: helper.hash,
      SERVER_MAJOR: target.major, FRAUD_OID: pins.fraud, AUDIT_OID: pins.audit, AUDIT_SEQUENCE_OID: pins.sequence,
      GENERATED_LAB: "1",
    };
    for (const [key, value] of Object.entries(settings)) vi.stubEnv(`PHONE11_FRAUD_${key}`, value);
    admission.execute = (sql, values) => admin.query(sql, values);
    await run({ admin, schema, role, owner });
    expect(admission.sharedResourceQueries).toBe(0);
  } finally {
    await closeFraudPolicyPool(); admission.execute = null;
    await admin.query("ROLLBACK").catch(() => {});
    if (madeSchema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    if (madeRole) await admin.query(`DROP ROLE ${role}`);
    if (madeOwner) await admin.query(`DROP ROLE ${owner}`);
    await admin.end();
  }
}
const caller = (id: number | null = 9) => pbxRouter.createCaller({
  user: id === null ? null : { id, role: "user" }, req: { ip: "127.0.0.1", headers: {} }, res: {},
} as any);

async function policyDialplan(destination: string): Promise<string> {
  const secret = randomBytes(32).toString("hex");
  vi.stubEnv("FS_SHARED_SECRET", secret);
  const route = freeswitchRouter.stack.find((item: any) => item.route?.path === "/dialplan")!.route!;
  const req = { headers: { "x-fs-secret": secret }, body: {
    "Caller-Destination-Number": destination, "Caller-Caller-ID-Number": "1996",
    "variable_sip_from_user": "1996", "variable_domain_name": "sip.example.test",
  } };
  let admitted = false, body = "";
  const res = { type() { return this; }, send(value: string) { body = value; return this; },
    status() { return this; }, json(value: unknown) { body = JSON.stringify(value); return this; } };
  route.stack[0]!.handle(req as any, res as any, () => { admitted = true; });
  expect(admitted).toBe(true);
  await route.stack[1]!.handle(req as any, res as any, () => undefined);
  return body;
}

describe.skipIf(!connectionString)("actual fraud handlers on generated restricted LOGIN", () => {
  it("saves first-row flags and strict audit on the restricted connection, then reads back", () => fixture(async ({ admin }) => {
    expect((await caller().capabilities({ tenantId: 7 })).explicitFraudControls).toBe(true);
    expect(await caller().fraudControls.get({ tenantId: 7 })).toBeNull();
    await expect(caller().fraudControls.update({ tenantId: 7, internationalEnabled: true })).resolves.toEqual({ success: true });
    expect(await caller().fraudControls.get({ tenantId: 7 })).toMatchObject({ tenant_id: 7, international_enabled: true, premium_rate_enabled: false });
    expect((await admin.query("SELECT tenant_id,actor_user_id,action,resource_type FROM audit_logs")).rows)
      .toEqual([{ tenant_id: 7, actor_user_id: 9, action: "update", resource_type: "fraud_controls" }]);
  }));
  it("rejects another admitted tenant without shared-pool fallback", () => fixture(async ({ admin }) => {
    expect((await caller().capabilities({ tenantId: 8 })).explicitFraudControls).toBe(false);
    await expect(caller().fraudControls.get({ tenantId: 8 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller().fraudControls.update({ tenantId: 8, internationalEnabled: true })).rejects.toBeDefined();
    expect((await admin.query("SELECT count(*)::int AS n FROM fraud_controls")).rows[0].n).toBe(0);
  }));
  it("keeps prior policy when strict audit fails", () => fixture(async ({ admin, role, schema }) => {
    await caller().fraudControls.update({ tenantId: 7, internationalEnabled: false });
    await admin.query(`REVOKE INSERT(tenant_id,actor_user_id,action,resource_type,resource_id,old_value,new_value,ip_address,user_agent,request_id,session_id) ON ${schema}.audit_logs FROM ${role}`);
    await expect(caller().fraudControls.update({ tenantId: 7, internationalEnabled: true })).rejects.toBeDefined();
    expect((await admin.query("SELECT international_enabled FROM fraud_controls")).rows).toEqual([{ international_enabled: false }]);
    expect((await admin.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(1);
  }));
  it("rechecks current actor authority and rejects unauthenticated or revoked callers", () => fixture(async ({ admin }) => {
    await expect(caller(null).fraudControls.get({ tenantId: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(33).fraudControls.update({ tenantId: 7, internationalEnabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await admin.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9 AND tenant_id=7");
    await expect(caller().fraudControls.get({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().fraudControls.update({ tenantId: 7, internationalEnabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }));
  it("refuses wrong credential identity and missing binding with no privileged retry", () => fixture(async ({ admin }) => {
    vi.stubEnv("PHONE11_FRAUD_ROLE_OID", "1");
    await expect(caller().fraudControls.update({ tenantId: 7, internationalEnabled: true })).rejects.toBeDefined();
    await closeFraudPolicyPool();
    vi.stubEnv("PHONE11_FRAUD_PASSWORD", "");
    expect((await caller().capabilities({ tenantId: 7 })).explicitFraudControls).toBe(false);
    await expect(caller().fraudControls.get({ tenantId: 7 })).rejects.toBeDefined();
    expect((await admin.query("SELECT count(*)::int AS n FROM fraud_controls")).rows[0].n).toBe(0);
  }));
  it.each(["read", "write"])("the real helper rejects revocation after %s pre-admission", operation => fixture(async ({ admin }) => {
    admission.afterLiveAdmission = async () => {
      await admin.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9 AND tenant_id=7");
    };
    const attempt = operation === "read" ? caller().fraudControls.get({ tenantId: 7 })
      : caller().fraudControls.update({ tenantId: 7, internationalEnabled: true });
    await expect(attempt).rejects.toBeDefined();
    expect((await admin.query("SELECT count(*)::int AS n FROM fraud_controls")).rows[0].n).toBe(0);
    expect((await admin.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(0);
  }));
  it("rejects unsupported policy fields without partial writes", () => fixture(async ({ admin }) => {
    await expect(caller().fraudControls.update({ tenantId: 7, internationalEnabled: true, dailyCostCeiling: 100 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await admin.query("SELECT count(*)::int AS n FROM fraud_controls")).rows[0].n).toBe(0);
    expect((await admin.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(0);
  }));
  it.each(["+12025550123", "+19005550123", "1900123456", "+661900123456"])("saved policy controls the actual dynamic dialplan for %s", destination => fixture(async () => {
    await caller().fraudControls.update({ tenantId: 7, internationalEnabled: false, premiumRateEnabled: false });
    expect(await policyDialplan(destination)).not.toContain('application="bridge"');
    await caller().fraudControls.update({ tenantId: 7, internationalEnabled: destination.startsWith("+1"), premiumRateEnabled: true });
    expect(await policyDialplan(destination)).toContain('application="bridge"');
  }));
});
