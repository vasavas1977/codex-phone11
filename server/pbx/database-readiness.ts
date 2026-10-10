import { isIP } from "node:net";
import type { Pool, PoolClient } from "pg";
import { getPool, type query } from "./db";
import { requireLiveTenantAdminMembership } from "./tenant-middleware";

export const READINESS_TABLES = ["tenants", "extensions", "ivr_menus", "ivr_actions", "ring_groups", "ring_group_members", "call_queues", "queue_agents", "queue_stats", "time_conditions", "time_condition_rules"] as const;
const BOOLEAN_KEYS = ["databaseMatch", "serverMatch", "versionMatch", "schemaMatch", "readOnly", "repeatableRead", "roleIsLogin", "sessionMatchesConnectionUser", "loginCanLogin", "loginSuperuser", "loginCreateRole", "loginCreateDb", "loginReplication", "loginBypassRls", "currentSuperuser", "currentCreateRole", "currentCreateDb", "currentReplication", "currentBypassRls", "databaseConnect", "schemaUsage", "schemaCreate"] as const;
const TABLE_FLAGS = ["present", "select", "insert", "update", "delete"] as const;
type Observation = Record<typeof BOOLEAN_KEYS[number], boolean> & { tables: Record<typeof READINESS_TABLES[number], Record<typeof TABLE_FLAGS[number], boolean>> };
export type PbxReadiness = { status: "observed"; scope: "checkedOutPbxPoolConnection"; tenantId: number; observation: Observation } | { status: "unavailable"; reason: "NOT_COMMISSIONED" | "OBSERVATION_FAILED" | "IDENTITY_MISMATCH" } | { status: "forbidden" };

/** Nonsecret deployment commissioning input, never a request-provided target. */
export function readinessServerAddress(env: Record<string, string | undefined> = process.env): string | undefined {
  const address = env.PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS;
  return address && isIP(address) === 4 ? address : undefined;
}

export const READINESS_SQL = `WITH fixed(table_name) AS (SELECT pg_catalog.unnest(ARRAY['tenants','extensions','ivr_menus','ivr_actions','ring_groups','ring_group_members','call_queues','queue_agents','queue_stats','time_conditions','time_condition_rules']::pg_catalog.text[])),
table_flags AS (SELECT f.table_name, c.oid FROM fixed f LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public' LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=f.table_name AND c.relkind IN ('r','p'))
SELECT pg_catalog.json_build_object(
'databaseMatch', pg_catalog.current_database()='phone11ai' AND (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())=$2,
'serverMatch', pg_catalog.host(pg_catalog.inet_server_addr())=$1 AND pg_catalog.inet_server_port()=5432,
'versionMatch', pg_catalog.current_setting('server_version_num')=$3,
'schemaMatch', pg_catalog.current_schema()='public',
'readOnly', pg_catalog.current_setting('transaction_read_only')='on',
'repeatableRead', pg_catalog.current_setting('transaction_isolation')='repeatable read',
'roleIsLogin', current_user=session_user,
'sessionMatchesConnectionUser', session_user=$4,
'loginCanLogin', l.rolcanlogin,
'loginSuperuser', l.rolsuper, 'loginCreateRole', l.rolcreaterole, 'loginCreateDb', l.rolcreatedb, 'loginReplication', l.rolreplication, 'loginBypassRls', l.rolbypassrls,
'currentSuperuser', r.rolsuper, 'currentCreateRole', r.rolcreaterole, 'currentCreateDb', r.rolcreatedb, 'currentReplication', r.rolreplication, 'currentBypassRls', r.rolbypassrls,
'databaseConnect', pg_catalog.has_database_privilege(pg_catalog.current_database(),'CONNECT'),
'schemaUsage', pg_catalog.has_schema_privilege('public','USAGE'), 'schemaCreate', pg_catalog.has_schema_privilege('public','CREATE'),
'tables', (SELECT pg_catalog.json_object_agg(table_name, pg_catalog.json_build_object('present',oid IS NOT NULL,'select',CASE WHEN oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(oid,'SELECT') END,'insert',CASE WHEN oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(oid,'INSERT') END,'update',CASE WHEN oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(oid,'UPDATE') END,'delete',CASE WHEN oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(oid,'DELETE') END) ORDER BY table_name) FROM table_flags)
) AS observation FROM pg_catalog.pg_roles l CROSS JOIN pg_catalog.pg_roles r WHERE l.rolname=session_user AND r.rolname=current_user`;

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
}

/** Shape validation is separate from identity/admission; SET ROLE is observable. */
export function decodeReadiness(value: unknown): Observation {
  if (!exactKeys(value, [...BOOLEAN_KEYS, "tables"])) throw new Error("Invalid readiness observation");
  for (const key of BOOLEAN_KEYS) if (typeof value[key] !== "boolean") throw new Error("Invalid readiness observation");
  if (!exactKeys(value.tables, READINESS_TABLES)) throw new Error("Invalid readiness observation");
  for (const table of READINESS_TABLES) {
    if (!exactKeys(value.tables[table], TABLE_FLAGS)) throw new Error("Invalid readiness observation");
    for (const flag of TABLE_FLAGS) if (typeof value.tables[table][flag] !== "boolean") throw new Error("Invalid readiness observation");
  }
  return JSON.parse(JSON.stringify(value)) as Observation;
}

type Dependencies = { pool?: Pick<Pool, "connect">; serverAddress?: string };

/** Samples only the app-owned pool client, without resolving/reading credentials. */
export async function readPbxDatabaseReadiness(actorUserId: number, tenantId: number, dependencies: Dependencies = {}): Promise<PbxReadiness> {
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0 || !Number.isSafeInteger(tenantId) || tenantId <= 0) return { status: "forbidden" };
  const serverAddress = dependencies.serverAddress ?? readinessServerAddress();
  let client: PoolClient | undefined, released = false, expired = false, acquireExpired = false;
  let overallTimer: ReturnType<typeof setTimeout> | undefined, acquireTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; });
  // Attach a handler immediately, including while acquisition is pending.
  void stop.catch(() => {});
  const release = (broken: boolean) => {
    if (!client || released) return;
    released = true;
    if (!broken) client.removeListener("error", onError);
    try { client.release(broken ? new Error("PBX readiness unavailable") : undefined); }
    catch { released = false; throw new Error("PBX readiness unavailable"); }
  };
  const onError = () => {
    expired = true;
    try { release(true); } catch { /* No private driver error output. */ }
    rejectStop(new Error("PBX readiness unavailable"));
  };
  const step = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (expired) throw new Error("PBX readiness unavailable");
    const result = await Promise.race([fn(), stop]);
    if (expired) throw new Error("PBX readiness unavailable");
    return result;
  };
  try {
    overallTimer = setTimeout(onError, 45000);
    const pool = dependencies.pool ?? getPool();
    const pending = pool.connect().then(value => {
      if (expired || acquireExpired) {
        // A pool waiter cannot be canceled; discard a client arriving too late.
        value.on("error", () => {});
        value.release(new Error("PBX readiness acquisition expired"));
        throw new Error("PBX readiness unavailable");
      }
      client = value;
      client.on("error", onError);
      return value;
    });
    const acquireStop = new Promise<never>((_, reject) => {
      acquireTimer = setTimeout(() => { acquireExpired = true; reject(new Error("PBX readiness unavailable")); }, 5000);
    });
    await Promise.race([pending, acquireStop, stop]);
    clearTimeout(acquireTimer);
    const leased = client!;
    const execute = leased.query.bind(leased) as typeof query;
    // Fresh authority after waiting, before metadata. Not the membership cache.
    await step(() => requireLiveTenantAdminMembership(actorUserId, tenantId, execute));
    // Even uncommissioned diagnostics require bounded fresh admin authority.
    if (!serverAddress || isIP(serverAddress) !== 4) {
      release(false);
      return { status: "unavailable", reason: "NOT_COMMISSIONED" };
    }
    const startupUser = (leased as PoolClient & { user?: unknown }).user;
    if (typeof startupUser !== "string" || !startupUser) throw new Error("PBX readiness unavailable");
    await step(() => leased.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    await step(() => leased.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='30s'"));
    const result = await step(() => leased.query(READINESS_SQL, [serverAddress, 16384, "160013", startupUser]));
    if (result.rows.length !== 1 || !exactKeys(result.rows[0], ["observation"])) throw new Error("PBX readiness unavailable");
    const observation = decodeReadiness(result.rows[0].observation);
    await step(() => leased.query("ROLLBACK"));
    // New autocommit snapshot: RR must not freeze authority through publication.
    await step(() => requireLiveTenantAdminMembership(actorUserId, tenantId, execute));
    if (!["databaseMatch", "serverMatch", "versionMatch", "schemaMatch", "readOnly", "repeatableRead", "sessionMatchesConnectionUser", "loginCanLogin"].every(key => observation[key as keyof Omit<Observation, "tables">])) {
      release(false);
      return { status: "unavailable", reason: "IDENTITY_MISMATCH" };
    }
    release(false);
    return { status: "observed", scope: "checkedOutPbxPoolConnection", tenantId, observation };
  } catch (error) {
    expired = true;
    const denied = error !== null && typeof error === "object" && "code" in error && error.code === "FORBIDDEN";
    return denied ? { status: "forbidden" } : { status: "unavailable", reason: "OBSERVATION_FAILED" };
  } finally {
    clearTimeout(overallTimer); clearTimeout(acquireTimer);
    try { release(true); } catch { /* Discard failure never exposes private causes. */ }
  }
}
