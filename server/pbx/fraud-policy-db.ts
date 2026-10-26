/**
 * Dedicated, operator-bound fixed-tenant fraud-policy login. Configuration
 * availability is NOT database/runtime qualification. This module intentionally
 * never imports the privileged PBX pool or accepts connection URLs/PG_* defaults.
 *
 * Required PHONE11_FRAUD_* settings: HOST, PORT, DATABASE, USER, PASSWORD, SCHEMA,
 * TENANT_ID, ROLE_OID, SCHEMA_OID, HELPER_OID, HELPER_OWNER, HELPER_OWNER_OID,
 * HELPER_SHA256, SERVER_MAJOR, FRAUD_OID, AUDIT_OID, AUDIT_SEQUENCE_OID.
 * Pins must come from the reviewed operator permission receipt together; notably
 * HELPER_SHA256 binds the generated helper body to this exact tenant and login.
 * Optional TLS_CA_PEM adds a trusted CA; TLS always verifies the peer except an
 * explicit GENERATED_LAB=1 at exact 127.0.0.1 / phone11_pbx_test (generated lab).
 */
import type pg from "pg";
import { createJsPostgresPool } from "./js-postgres-driver";
import { checkServerIdentity } from "node:tls";

interface Binding {
  tenantId: number;
  schema: string;
  roleOid: string;
  schemaOid: string;
  helperOid: string;
  helperOwner: string;
  helperOwnerOid: string;
  helperSha256: string;
  serverMajor: string;
  fraudOid: string;
  auditOid: string;
  auditSequenceOid: string;
  pool: pg.PoolConfig;
}

export interface FraudPolicyBindingStatus { available: boolean }

class FraudPolicyUnavailableError extends Error {
  readonly code = "FRAUD_POLICY_UNAVAILABLE";
  constructor() { super("Fraud controls are unavailable"); this.name = "FraudPolicyUnavailableError"; }
}

const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
const positiveInteger = /^[1-9][0-9]*$/;
function decimal(value: string | undefined, max: number): string | undefined {
  return value && positiveInteger.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= max ? value : undefined;
}
function safeName(value: string | undefined): string | undefined {
  return value && identifier.test(value) && !value.startsWith("pg_") && value !== "information_schema" ? value : undefined;
}
function readBinding(): Binding | undefined {
  const env = (key: string) => process.env[`PHONE11_FRAUD_${key}`];
  const host = env("HOST"), port = decimal(env("PORT"), 65535), database = safeName(env("DATABASE"));
  const user = safeName(env("USER")), password = env("PASSWORD"), schema = safeName(env("SCHEMA"));
  const tenant = decimal(env("TENANT_ID"), 2147483647);
  const roleOid = decimal(env("ROLE_OID"), 4294967295), schemaOid = decimal(env("SCHEMA_OID"), 4294967295);
  const helperOid = decimal(env("HELPER_OID"), 4294967295), helperOwner = safeName(env("HELPER_OWNER"));
  const helperOwnerOid = decimal(env("HELPER_OWNER_OID"), 4294967295), helperSha256 = env("HELPER_SHA256");
  const serverMajor = env("SERVER_MAJOR"), fraudOid = decimal(env("FRAUD_OID"), 4294967295);
  const auditOid = decimal(env("AUDIT_OID"), 4294967295), auditSequenceOid = decimal(env("AUDIT_SEQUENCE_OID"), 4294967295);
  const lab = env("GENERATED_LAB"), ca = env("TLS_CA_PEM");
  // A host is a DNS name or IPv4; never a socket path, URL,
  // comma-separated failover/options string or whitespace-bearing connection DSN.
  // This runtime's identity verifier rejects IPv6 literals; do not advertise
  // them as valid bindings or replace verification with a permissive callback.
  if (!host || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host)
    || !port || !database || !user || !password || password.includes("\0") || !schema || !tenant
    || !roleOid || !schemaOid || !helperOid || !helperOwner || !helperOwnerOid
    || user === helperOwner || roleOid === helperOwnerOid || !helperSha256 || !/^[a-f0-9]{64}$/.test(helperSha256)
    || !["16", "17"].includes(serverMajor ?? "") || !fraudOid || !auditOid || !auditSequenceOid
    || new Set([fraudOid, auditOid, auditSequenceOid]).size !== 3
    || (lab !== undefined && lab !== "1")
    || (lab === "1" && (host !== "127.0.0.1" || database !== "phone11_pbx_test" || ca !== undefined))
    || (ca !== undefined && (!ca.includes("-----BEGIN CERTIFICATE-----") || ca.includes("\0")))) return undefined;
  return {
    tenantId: Number(tenant), schema, roleOid, schemaOid, helperOid, helperOwner, helperOwnerOid,
    helperSha256, serverMajor: serverMajor!, fraudOid, auditOid, auditSequenceOid,
    pool: {
      host, port: Number(port), database, user, password,
      ssl: lab === "1" ? false : {
        rejectUnauthorized: true,
        // pg does not set SNI for IP literals. Node may then verify "localhost"
        // instead of the configured address: always bind certificate identity
        // to this reviewed host, including IPv4 SANs.
        checkServerIdentity: (_reportedHost, certificate) => checkServerIdentity(host, certificate),
        ...(ca ? { ca } : {}),
      },
      max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15000,
      query_timeout: 10000, statement_timeout: 10000, lock_timeout: 3000,
      idle_in_transaction_session_timeout: 15000,
      // Suppress ambient PGOPTIONS and service-derived startup settings.
      // pg's connection parameters treat an empty string as absent and fall
      // back to PGOPTIONS. A truthy literal blocks that ambient fallback.
      options: "-c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000",
      application_name: "phone11_fixed_fraud_policy",
    },
  };
}

let configured: Binding | undefined;
let initialized = false;
let pool: pg.Pool | undefined;
let activeLeases = 0;
let closing = false;
let configurationSnapshot: string | undefined;
let configurationChanged = false;
const CONFIG_KEYS = ["HOST", "PORT", "DATABASE", "USER", "PASSWORD", "SCHEMA", "TENANT_ID", "ROLE_OID", "SCHEMA_OID",
  "HELPER_OID", "HELPER_OWNER", "HELPER_OWNER_OID", "HELPER_SHA256", "SERVER_MAJOR", "FRAUD_OID", "AUDIT_OID",
  "AUDIT_SEQUENCE_OID", "GENERATED_LAB", "TLS_CA_PEM"] as const;
function binding(): Binding | undefined {
  // Bind once to trusted startup configuration. Runtime environment mutations
  // fail closed until explicit shutdown; never reuse old credentials for a new
  // configuration. This internal snapshot is never returned or logged.
  const snapshot = JSON.stringify(CONFIG_KEYS.map(key => process.env[`PHONE11_FRAUD_${key}`]));
  if (!initialized) { configured = readBinding(); configurationSnapshot = snapshot; initialized = true; }
  else if (snapshot !== configurationSnapshot) configurationChanged = true;
  return configurationChanged ? undefined : configured;
}

/** Synchronous CONFIG ONLY availability; every lease still verifies all pins. */
export function getFraudPolicyBindingStatus(tenantId: number): FraudPolicyBindingStatus {
  const selected = binding();
  return { available: !closing && Number.isSafeInteger(tenantId) && tenantId > 0 && selected?.tenantId === tenantId };
}

/** Explicit shutdown/reconfiguration gate; callers must first drain operations. */
export async function closeFraudPolicyPool(): Promise<void> {
  if (activeLeases > 0 || closing) throw new FraudPolicyUnavailableError();
  closing = true;
  try {
    await pool?.end();
    pool = undefined;
    configured = undefined;
    initialized = false;
    configurationSnapshot = undefined;
    configurationChanged = false;
  } catch { throw new FraudPolicyUnavailableError(); }
  finally { closing = false; }
}

// All identifiers used below are constants or strictly validated startup values.
// Place pg_temp last explicitly, preventing temporary relation shadowing.
function quoteIdentifier(value: string): string { return `"${value.replace(/"/g, '""')}"`; }

const ATTEST = `SELECT
  pg_catalog.current_database() AS database_name,
  session_user::text AS session_name, current_user::text AS current_name,
  (pg_catalog.current_setting('server_version_num')::integer / 10000)::text AS server_major,
  r.oid::text AS role_oid, n.oid::text AS schema_oid,
  p.oid::text AS helper_oid, p.proowner::text AS helper_owner_oid,
  o.rolname AS helper_owner,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') AS helper_sha256,
  (r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb
    AND NOT r.rolreplication AND NOT r.rolinherit AND r.rolconfig IS NULL
    AND (r.rolvaliduntil IS NULL OR r.rolvaliduntil>CURRENT_TIMESTAMP)) AS role_safe,
  (NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolbypassrls AND NOT o.rolcreaterole AND NOT o.rolcreatedb
    AND NOT o.rolreplication AND NOT o.rolinherit AND o.rolconfig IS NULL) AS owner_safe,
  (NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member IN(r.oid,o.oid) OR roleid IN(r.oid,o.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::pg_catalog.regclass
      AND refobjid=r.oid AND deptype='o')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace ns WHERE ns.nspname !~ '^pg_' AND ns.nspname<>'information_schema'
      AND (pg_catalog.has_schema_privilege(r.oid,ns.oid,'CREATE') OR pg_catalog.has_schema_privilege(o.oid,ns.oid,'CREATE')))
    AND NOT pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CREATE')
    AND NOT pg_catalog.has_database_privilege(o.oid,pg_catalog.current_database(),'CREATE')) AS authority_safe,
  (p.proname='phone11_lock_fixed_fraud_admin' AND p.prosecdef AND NOT p.proleakproof AND p.proisstrict
    AND p.provolatile='v' AND p.proparallel='u' AND p.prokind='f' AND p.pronargs=1
    AND p.proargtypes[0]='pg_catalog.int4'::pg_catalog.regtype AND p.prorettype='pg_catalog.text'::pg_catalog.regtype
    AND l.lanname='plpgsql' AND l.lanpltrusted AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc sibling WHERE sibling.pronamespace=n.oid
      AND sibling.proname=p.proname AND sibling.oid<>p.oid)
    AND p.proacl IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee NOT IN(o.oid,r.oid)
      OR a.grantor<>o.oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
    AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')) AS helper_safe,
  (f.oid=$4::pg_catalog.oid AND f.relkind='r' AND f.relpersistence='p' AND f.relrowsecurity AND f.relforcerowsecurity
    AND a.oid=$5::pg_catalog.oid AND a.relkind='r' AND a.relpersistence='p' AND a.relrowsecurity AND a.relforcerowsecurity
    AND s.oid=$6::pg_catalog.oid AND s.relkind='S' AND s.relpersistence='p'
    AND f.relowner NOT IN(r.oid,o.oid) AND a.relowner=f.relowner AND s.relowner=f.relowner
    AND pg_catalog.pg_get_serial_sequence(pg_catalog.format('%I.audit_logs',n.nspname),'id')::pg_catalog.regclass=s.oid
    AND NOT pg_catalog.has_table_privilege(r.oid,a.oid,'SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_any_column_privilege(r.oid,a.oid,'SELECT,UPDATE,REFERENCES')
    AND NOT pg_catalog.has_table_privilege(r.oid,f.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_sequence_privilege(r.oid,s.oid,'SELECT,UPDATE')
    AND pg_catalog.current_setting('session_replication_role')='origin'
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)) AS storage_safe
FROM pg_catalog.pg_roles r
JOIN pg_catalog.pg_namespace n ON n.nspname=$1
JOIN pg_catalog.pg_proc p ON p.oid=$2::pg_catalog.oid AND p.pronamespace=n.oid
JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
JOIN pg_catalog.pg_language l ON l.oid=p.prolang
JOIN pg_catalog.pg_class f ON f.relnamespace=n.oid AND f.relname='fraud_controls'
JOIN pg_catalog.pg_class a ON a.relnamespace=n.oid AND a.relname='audit_logs'
JOIN pg_catalog.pg_class s ON s.oid=$6::pg_catalog.oid AND s.relnamespace=n.oid
WHERE r.rolname=$3`;

async function attest(client: pg.PoolClient, selected: Binding): Promise<void> {
  const result = await client.query(ATTEST, [selected.schema, selected.helperOid, selected.pool.user,
    selected.fraudOid, selected.auditOid, selected.auditSequenceOid]);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row
    || row.database_name !== selected.pool.database || row.session_name !== selected.pool.user || row.current_name !== selected.pool.user
    || row.role_oid !== selected.roleOid || row.schema_oid !== selected.schemaOid || row.server_major !== selected.serverMajor
    || row.helper_oid !== selected.helperOid || row.helper_owner_oid !== selected.helperOwnerOid
    || row.helper_owner !== selected.helperOwner || row.helper_sha256 !== selected.helperSha256
    || ![row.role_safe, row.owner_safe, row.authority_safe, row.helper_safe, row.storage_safe].every(value => value === true)) {
    throw new FraudPolicyUnavailableError();
  }
}

/**
 * One dedicated lease, one transaction, all attestation and callback statements
 * on that same client. Callbacks must finish their queries before returning and
 * must not change role/search_path or perform transaction control themselves.
 */
export async function withFraudPolicyTransaction<T>(tenantId: number, callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const selected = binding();
  if (!selected || !getFraudPolicyBindingStatus(tenantId).available) throw new FraudPolicyUnavailableError();
  let client: pg.PoolClient | undefined;
  let phase: "transport" | "callback" | "commit" = "transport";
  let transactionAttempted = false;
  let committed = false;
  let callbackFailed = false;
  let failure: unknown;
  let failed = false;
  let value: T | undefined;
  activeLeases++;
  try {
    if (!pool) {
      pool = createJsPostgresPool(selected.pool);
      // Never log driver error objects (they can include credentials/SQL data).
      pool.on("error", () => {});
    }
    client = await pool.connect();
    transactionAttempted = true;
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query(`SET LOCAL search_path = pg_catalog, ${quoteIdentifier(selected.schema)}, pg_temp`);
    await client.query("SET LOCAL statement_timeout = '10s'; SET LOCAL lock_timeout = '3s'; SET LOCAL idle_in_transaction_session_timeout = '15s'");
    await attest(client, selected);
    phase = "callback";
    value = await callback(client);
    phase = "commit";
    await client.query("COMMIT");
    committed = true;
  } catch (error) {
    failed = true;
    callbackFailed = phase === "callback";
    failure = error;
    if (client && transactionAttempted && !committed) {
      try { await client.query("ROLLBACK"); }
      catch { callbackFailed = false; }
    }
  }
  if (client) {
    try { client.release(failed && !callbackFailed); }
    catch { failed = true; callbackFailed = false; }
  }
  activeLeases--;
  if (failed) {
    // Only a callback failure with confirmed rollback/release is allowed through
    // to the caller's existing public error sanitizer. Driver/lifecycle errors
    // never escape with message, cause, SQL, credentials or connection details.
    if (callbackFailed) throw failure;
    throw new FraudPolicyUnavailableError();
  }
  return value as T;
}
