/** Inert private-binding library. No listener, worker, signal or CLI startup. */
import path from "node:path";
import { isIP } from "node:net";
import { configureOwnedPbxPool, getPool, closeOwnedPbxPool, withTransaction, type OwnedPbxPoolBinding } from "phone11-maintained/db";
import { getPhone11Auth, readAuthConfig } from "phone11-maintained/auth";

export interface PrivateRetainedBinding {
  /** Explicit smaller admission profile is the safe default. */
  profile?: "auth-playback" | "retained-full";
  database: OwnedPbxPoolBinding;
  databaseAuthority: {
    roleOid: number;
    databaseOid: number;
    clientAddress: string;
    serverAddress: string;
    serverPort: number;
  };
  auth: { baseURL: string; secret: string; trustedOrigins: string[] };
  recordingsPath: string;
  chatMediaPath: string;
  wake?: {
    pilotSipUris: string[];
    pushSharedSecret: string;
    apns: { keyPath: string; keyId: string; teamId: string; bundleId: string; environment: "production" | "sandbox" };
  };
}

function requiredAuthority(value: PrivateRetainedBinding["databaseAuthority"]) {
  const keys = ["roleOid", "databaseOid", "clientAddress", "serverAddress", "serverPort"];
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))
    || ![value.roleOid, value.databaseOid].every(oid => Number.isInteger(oid) && oid > 0 && oid <= 4_294_967_295)
    || typeof value.clientAddress !== "string" || !isIP(value.clientAddress)
    || typeof value.serverAddress !== "string" || !isIP(value.serverAddress)
    || !Number.isInteger(value.serverPort) || value.serverPort < 1 || value.serverPort > 65535) throw new Error();
  return Object.freeze({ ...value });
}

/** Attest only this graph's leased connection; not an object-ACL equivalence proof. */
async function attestOwnedPool(role: string, database: string, authority: ReturnType<typeof requiredAuthority>) {
  const client = await getPool().connect();
  let reusable = false;
  try {
    const result = await client.query({
      // Driver and server deadlines come from the strict owned-pool binding.
      text: `SELECT current_user=$1 AND session_user=$1 AND current_setting('role')='none' AS identity,
        r.oid=$2::oid AS role_oid, d.oid=$3::oid AND d.datname=$4 AS database,
        NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolinherit) AS flags,
        r.rolcanlogin IS TRUE AS login,
        (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()) IS TRUE AS tls,
        host(inet_client_addr())=$5 AND host(inet_server_addr())=$6 AND inet_server_port()=$7 AS addresses,
        current_setting('transaction_isolation')='read committed' AS isolation,
        current_setting('search_path')='pg_catalog,public,pg_temp' AS path,
        current_setting('statement_timeout')='10s' AS statement,
        current_setting('lock_timeout')='3s' AS lock,
        current_setting('idle_in_transaction_session_timeout')='15s' AS idle,
        current_setting('application_name')='phone11_retained_runtime' AS application,
        NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS membership,
        NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datdba=r.oid)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=r.oid)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner=r.oid)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE proowner=r.oid)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_type WHERE typowner=r.oid) AS ownership,
        NOT has_database_privilege(current_user,d.oid,'CREATE')
          AND NOT has_schema_privilege(current_user,'public','CREATE') AS ddl
        FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_database d ON d.datname=current_database()
        WHERE r.rolname=current_user`,
      values: [role, authority.roleOid, authority.databaseOid, database, authority.clientAddress, authority.serverAddress, authority.serverPort],
    });
    const expected = ["identity", "role_oid", "database", "flags", "login", "tls", "addresses", "isolation", "path", "statement", "lock", "idle", "application", "membership", "ownership", "ddl"];
    if (result.rows.length !== 1 || Object.keys(result.rows[0]).length !== expected.length
      || expected.some(key => result.rows[0][key] !== true)) throw new Error();
    reusable = true;
  } finally {
    // Discard a timed-out/refused lease, and propagate release uncertainty.
    client.release(reusable ? undefined : true);
  }
}
let setupAttempted = false;
let closed = false;

function requiredPath(value: string): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0") || value === "/" || !path.isAbsolute(value) || path.normalize(value) !== value) throw new Error();
  return value;
}

/**
 * One private setup attempt per bundled module graph. Imports that capture
 * storage environment are deliberately deferred until after this binding.
 * Same-pool identity/settings attestation precedes app return. Exact object
 * grants, schema and runtime storage/caller qualification remain separate.
 */
export async function createBoundRetainedRuntime(binding: PrivateRetainedBinding) {
  if (setupAttempted) throw new Error("RETAINED_BOUND_SETUP_REFUSED");
  setupAttempted = true;
  let poolBound = false;
  let closeWake: (() => Promise<void>) | undefined;
  try {
    if (!binding || !binding.auth || typeof binding.auth.baseURL !== "string" || !binding.auth.baseURL
      || typeof binding.auth.secret !== "string" || binding.auth.secret.length > 4096 || binding.auth.secret.includes("\0")
      || !Array.isArray(binding.auth.trustedOrigins) || binding.auth.trustedOrigins.length > 16
      || binding.auth.trustedOrigins.some(value => typeof value !== "string" || value.length > 2048)) throw new Error();
    const profile = binding.profile ?? "auth-playback";
    if (!["auth-playback", "retained-full"].includes(profile) || (profile === "auth-playback" && binding.wake !== undefined)) throw new Error();
    const selected: Record<string, string | undefined> = {
      PHONE11_AUTH_BASE_URL: binding.auth.baseURL,
      PHONE11_AUTH_SECRET: binding.auth.secret,
      PHONE11_AUTH_TRUSTED_ORIGINS: binding.auth.trustedOrigins.join(","),
      RECORDINGS_PATH: requiredPath(binding.recordingsPath),
      PHONE11_CHAT_MEDIA_PATH: requiredPath(binding.chatMediaPath),
      PHONE11_WAKE_ENABLED: "0", PHONE11_WAKE_PILOT_SIP_URI: undefined,
      PHONE11_WAKE_PILOT_SIP_URIS: undefined, PUSH_SHARED_SECRET: undefined,
      APNS_KEY_PATH: undefined, APNS_KEY_ID: undefined, APNS_TEAM_ID: undefined,
      APNS_BUNDLE_ID: undefined, APNS_ENVIRONMENT: undefined,
    };
    if (profile === "retained-full") {
      const wake = binding.wake;
      if (!wake || !Array.isArray(wake.pilotSipUris) || wake.pilotSipUris.length < 1 || wake.pilotSipUris.length > 2
        || wake.pilotSipUris.some(uri => typeof uri !== "string" || uri.length > 386 || uri.includes(","))
        || !wake.apns || typeof wake.pushSharedSecret !== "string" || wake.pushSharedSecret.length > 4096 || wake.pushSharedSecret.includes("\0")) throw new Error();
      Object.assign(selected, { PHONE11_WAKE_ENABLED: "1", PHONE11_WAKE_PILOT_SIP_URIS: wake.pilotSipUris.join(","),
        PUSH_SHARED_SECRET: wake.pushSharedSecret, APNS_KEY_PATH: requiredPath(wake.apns.keyPath),
        APNS_KEY_ID: wake.apns.keyId, APNS_TEAM_ID: wake.apns.teamId,
        APNS_BUNDLE_ID: wake.apns.bundleId, APNS_ENVIRONMENT: wake.apns.environment });
      if (Object.values(selected).some(value => value !== undefined && (typeof value !== "string" || value.length > 4096 || value.includes("\0")))) throw new Error();
    }
    // Reuse maintained validation with explicit values, never its default env.
    readAuthConfig({ ...selected, NODE_ENV: "production" });
    if (Object.entries(selected).some(([key, value]) => process.env[key] !== undefined && process.env[key] !== value)) throw new Error();
    const excludedMailer = ["PHONE11_PASSWORD_RESET_PROVIDER", "PHONE11_PASSWORD_RESET_RESEND_API_KEY", "PHONE11_PASSWORD_RESET_FROM"];
    if (excludedMailer.some(key => Boolean(process.env[key]))) throw new Error();
    configureOwnedPbxPool(binding.database);
    poolBound = true;
    const authority = requiredAuthority(binding.databaseAuthority);
    const role = binding.database.user, database = binding.database.database;
    for (const [key, value] of Object.entries(selected)) { if (value !== undefined) process.env[key] = value; }
    const available = () => !closed && Object.entries(selected).every(([key, value]) => process.env[key] === value)
      && excludedMailer.every(key => !process.env[key]);
    await attestOwnedPool(role, database, authority);
    // Both imports resolve to the SAME statically pinned graph. Importing the
    // maintained wake service constructs no provider session or background job.
    const [{ createRetainedRuntimeCandidate }, { createWakeService, wakePilots }, { readApnsConfig }, { integrationSecretStatus }] = await Promise.all([
      import("./composition"), import("phone11-maintained/wake-service"),
      import("phone11-maintained/apns"), import("phone11-maintained/integration-auth"),
    ]);
    if (!available()) throw new Error();
    if (profile === "retained-full") {
      // Actual maintained validators run against the explicit installed values.
      wakePilots(); readApnsConfig();
      if (integrationSecretStatus("PUSH_SHARED_SECRET", selected.PUSH_SHARED_SECRET) !== "ok") throw new Error();
    }
    const wake = createWakeService();
    closeWake = () => wake.close();
    let closePromise: Promise<void> | undefined;
    const close = () => {
      closed = true;
      // A rejected/expired wake drain retains the pool: an underlying statement
      // may still finish and enqueue its owned cancellation after HTTP closes.
      return closePromise ??= (async () => { await wake.close(); await closeOwnedPbxPool(); })();
    };
    const composed = createRetainedRuntimeCandidate({
      profile,
      admissionAvailable: available,
      auth: { getAuth: getPhone11Auth, getDatabase: getPool },
      wake,
      chatTransaction: withTransaction,
      closeResources: close,
    });
    return Object.freeze({ app: composed.app, plan: composed.plan, close, createShutdown: composed.createShutdown });
  } catch {
    closed = true;
    // Never retry setup or restore environment after modules may have captured
    // it. A failed pool close is retained as unknown cleanup, never swallowed.
    if (poolBound) {
      try { await closeWake?.(); await closeOwnedPbxPool(); }
      catch { throw new Error("RETAINED_BOUND_SETUP_CLEANUP_UNCONFIRMED"); }
    }
    throw new Error("RETAINED_BOUND_SETUP_REFUSED");
  }
}
