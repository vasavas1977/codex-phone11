import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { pbxRouter } from "../server/pbx/pbx-router";
const h = vi.hoisted(() => ({ cache: vi.fn(), database: undefined as any, observers: [] as any[], failAudit: false }));
// Preserve pg's real client and the real withTransaction implementation, while
// pinning its Pool to an ownership-verified disposable local database/schema.
vi.mock("pg", async importOriginal => {
  const real = await importOriginal<typeof import("pg")>();
  return { ...real, default: { ...real.default, Pool: class {
    on() {}
    query(...args: any[]) { return h.database.query(...args); }
    async connect() {
      const client = await h.database.connect();
      return { query: async (sql: string, parameters?: any[]) => {
        if (sql.includes("INSERT INTO audit_logs")) {
          // Independent observer sees neither business nor audit row before COMMIT.
          h.observers.push(await snapshot());
          if (h.failAudit) return client.query(sql, [...parameters!.slice(0, 7), "PRIVATE_INVALID_IP", ...parameters!.slice(8)]);
        }
        return client.query(sql, parameters);
      }, release() { client.release(); } };
    }
  } } };
});
vi.mock("../server/pbx/redis", () => ({ invalidateCache: h.cache, cacheGetOrSet: vi.fn() }));
vi.mock("../server/pbx/tenant-middleware", async importOriginal => ({
  ...await importOriginal<typeof import("../server/pbx/tenant-middleware")>(),
  resolveTenantContext: vi.fn(async () => ({ tenantId: 7, role: "admin", memberships: [{ tenantId: 7, role: "admin" }] })),
  requireLiveTenantAdminMembership: vi.fn(async () => "admin"),
}));
vi.mock("../server/pbx/schema-capabilities", () => ({ schemaHasRequiredColumns: async () => true, readManagementCapabilities: async () => ({ phoneNumbers: true }) }));
vi.mock("../server/pbx/cdr-processor", () => ({ getCallStats: vi.fn(), getVoicemails: vi.fn() }));
vi.mock("../server/phone-provisioning", () => ({
  revokeExtensionSipAuth: vi.fn(async (client, extension, tenant) => {
    await client.query("UPDATE subscriber SET password='' WHERE username=(SELECT sip_username FROM extensions WHERE id=$1 AND tenant_id=$2)", [extension, tenant]);
  }), rotateExtensionSipAuth: vi.fn(), reactivateExtensionSipAuth: vi.fn(),
}));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: (username: string) => creds(username), regenerateSipCredentials: (username: string) => creds(username),
}));
function creds(sipUsername: string) { return { sipUsername, sipDomain: "sip.phone11.ai", plaintextPassword: "PRIVATE_PASSWORD", ha1: "PRIVATE_HA1", ha1b: "PRIVATE_HA1B", secretCiphertext: Buffer.from("PRIVATE_CIPHER"), secretIv: Buffer.from("PRIVATE_IV"), secretTag: Buffer.from("PRIVATE_TAG"), dekId: "PRIVATE_DEK" }; }
// No ambient URL/Pool fallback: absent means optional locally; supplied means
// validate or fail before lifecycle/Pool construction, including an empty value.
const configuredUrl = process.env.PHONE11_PBX_TEST_DATABASE_URL;
function validateFixtureUrl(value: string): string {
  const refuse = () => { throw new Error("Core atomicity tests require an explicit dedicated IPv4 loopback phone11_pbx_test URL without options"); };
  let url: URL;
  try {
    url = new URL(value);
    if (/[\0\r\n]/.test(decodeURIComponent(url.username) + decodeURIComponent(url.password))) return refuse();
  } catch { return refuse(); }
  if (/[\s?#]/.test(value) || !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" || url.pathname !== "/phone11_pbx_test" ||
      !url.username || !/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535 ||
      url.search || url.hash) return refuse();
  return value;
}
const url = configuredUrl === undefined ? undefined : validateFixtureUrl(configuredUrl);
let schema: string;
let schemaCreated = false;
let admin: Pool | undefined;
let db: Pool | undefined;
const context = { user: { id: 9 }, req: { ip: "127.0.0.1", headers: {} }, res: {} } as any;
const caller = () => pbxRouter.createCaller(context);
const tables = ["tenant_settings", "tenant_memberships", "extensions", "sip_accounts", "subscriber", "user_extensions", "phone_numbers", "audit_logs"];
async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db!.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.row)])));
}
// These mocks bound the fixture to transaction/audit behavior. Tenant resolution,
// live authorization, capability readiness and credential generation/revocation
// are synthetic; existing authorization/SIP lifecycle suites cover those paths.
// Fraud uses a separate real restricted LOGIN and its native API suite instead.
describe.skipIf(url === undefined)("core PBX business/audit atomicity on dedicated PostgreSQL", () => {
beforeAll(async () => {
  schema = `core_atomic_${randomBytes(12).toString("hex")}`;
  const parsed = new URL(url!);
  // Explicit fields and password provider prevent PG*/pgpass production fallbacks,
  // including a trust-authenticated local URL with an explicitly empty password.
  const config = { host: "127.0.0.1", port: Number(parsed.port), database: "phone11_pbx_test",
    user: decodeURIComponent(parsed.username), password: () => decodeURIComponent(parsed.password),
    ssl: false as const, connectionTimeoutMillis: 5000, query_timeout: 10000 };
  admin = new Pool({ ...config, max: 1, options: "-c search_path=pg_catalog" });
  db = new Pool({ ...config, max: 3, options: `-c search_path=${schema}` });
  h.database = db;
  vi.stubEnv("PG_CONNECTION_STRING", url); vi.stubEnv("PG_SSL", "false");
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await db!.query(`
    CREATE TABLE tenants(id integer PRIMARY KEY, name text, status text);
    CREATE TABLE users(id integer PRIMARY KEY, name text, email text);
    CREATE TABLE tenant_memberships(user_id integer, tenant_id integer, role text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE tenant_settings(tenant_id integer PRIMARY KEY,business_hours_timezone text,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE extensions(id serial PRIMARY KEY,tenant_id integer,user_id integer,extension_number text,display_name text,type text,sip_username text,sip_domain text,sip_password text,caller_id_name text,caller_id_number text,transport text,status text,deleted_at timestamptz,updated_at timestamptz);
    CREATE TABLE sip_accounts(id serial PRIMARY KEY,tenant_id integer,extension_id integer,user_id integer,sip_username text,sip_domain text,ha1 text,ha1b text,secret_ciphertext bytea,secret_iv bytea,secret_tag bytea,dek_id text,transport_preference text,status text,deleted_at timestamptz,updated_at timestamptz);
    CREATE TABLE subscriber(id serial PRIMARY KEY,username text,domain text,password text,ha1 text,ha1b text,UNIQUE(username,domain));
    CREATE TABLE user_extensions(user_id integer,extension_id integer,is_primary boolean,UNIQUE(user_id,extension_id));
    CREATE TABLE phone_numbers(id serial PRIMARY KEY,tenant_id integer,number_e164 text,number_display text,country text,number_type text,provider text,status text,assigned_route_type text,assigned_route_id integer,deleted_at timestamptz,updated_at timestamptz);
    CREATE TABLE audit_logs(tenant_id integer,actor_user_id integer,action text,resource_type text,resource_id text,old_value jsonb,new_value jsonb,ip_address inet,user_agent text,request_id text,session_id text);
  `);
});
beforeEach(async () => {
  h.cache.mockReset(); h.observers = []; h.failAudit = false;
  await db!.query(`TRUNCATE ${tables.join(",")},tenants,users RESTART IDENTITY;
    INSERT INTO tenants VALUES(7,'Synthetic','active'); INSERT INTO users VALUES(33,'Synthetic','synthetic@example.invalid');
    INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES(9,7,'admin','active'),(33,7,'user','active');
    INSERT INTO tenant_settings VALUES(7,'UTC',NOW(),NOW());
    INSERT INTO extensions(id,tenant_id,user_id,extension_number,display_name,type,sip_username,sip_domain,sip_password,status) VALUES(41,7,33,'4101','Before','user','4101','sip.phone11.ai','PRIVATE_LEGACY','active');
    INSERT INTO sip_accounts(id,tenant_id,extension_id,user_id,sip_username,sip_domain,ha1,ha1b,status) VALUES(51,7,41,33,'4101','sip.phone11.ai','OLD_HA1','OLD_HA1B','active');
    INSERT INTO subscriber(username,domain,password,ha1,ha1b) VALUES('4101','sip.phone11.ai','PRIVATE_OLD_PASSWORD','OLD_HA1','OLD_HA1B');
    INSERT INTO user_extensions VALUES(33,41,true); INSERT INTO phone_numbers(id,tenant_id,status,assigned_route_type,assigned_route_id) VALUES(41,7,'active','extension',41);`);
});
afterAll(async () => {
  // Every cleanup remains attempted if setup, an assertion, pool shutdown or
  // schema deletion fails. Only the schema created by this invocation is owned.
  try { await db?.end(); }
  finally {
    try { if (schemaCreated) await admin!.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally {
      try { await admin?.end(); }
      finally { h.database = undefined; vi.unstubAllEnvs(); }
    }
  }
});
const cases = [
  ["settings", "tenant_settings", () => caller().tenant.updateSettings({ businessHoursTimezone: "Asia/Bangkok" })],
  ["member", "tenant_memberships", () => caller().tenant.updateMember({ userId: 33, status: "inactive" })],
  ["extension.create", "extensions", () => caller().extensions.create({ extensionNumber: "4102" })],
  ["extension.update", "extensions", () => caller().extensions.update({ id: 41, displayName: "After" })],
  ["extension.delete", "extensions", () => caller().extensions.delete({ id: 41 })],
  ["extension.reset", "sip_accounts", () => caller().extensions.resetPassword({ extensionId: 41 })],
  ["DID.create", "phone_numbers", () => caller().phoneNumbers.create({ number: "+6621234567" })],
  ["DID.route", "phone_numbers", () => caller().phoneNumbers.assignRoute({ id: 41, assignedRouteType: null, assignedRouteId: null })],
] as const;
it.each(cases)("%s business/audit rows are invisible before one commit and visible after", async (_name, table, invoke) => {
  const before = await snapshot(); const result = await invoke(); const after = await snapshot();
  expect(h.observers).toEqual([before]); expect(after[table]).not.toEqual(before[table]);
  expect(after.audit_logs).toHaveLength(1); expect(after.audit_logs[0]).toMatchObject({ tenant_id: 7, actor_user_id: 9 });
  expect(JSON.stringify(after.audit_logs)).not.toContain("PRIVATE_"); expect(JSON.stringify(result)).not.toContain("PRIVATE_");
});
it.each(cases)("%s strict audit rejection rolls back every business table", async (_name, _table, invoke) => {
  const before = await snapshot(); h.failAudit = true;
  const error = await invoke().catch(e => e);
  expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Could not record PBX change" });
  expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain("PRIVATE_");
  expect(await snapshot()).toEqual(before); expect(h.observers).toEqual([before]); expect(h.cache).not.toHaveBeenCalled();
});

});
