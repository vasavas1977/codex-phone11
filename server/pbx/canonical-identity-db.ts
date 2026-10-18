/** Detached identity transport only; creates no listener or ingress authority.
 * Explicit commissioned startup inputs only. Never use the shared/policy pool.
 */
import type pg from "pg";
import { createJsPostgresPool } from "./js-postgres-driver";
import { createHash } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import type { IdentityReadPin } from "./trusted-caller-identity";

const RELATIONS = ["extensions", "sip_accounts", "subscriber", "tenant_memberships", "tenants", "user_extensions", "users"] as const;
type Relation = typeof RELATIONS[number];
export interface CanonicalIdentityDbConfig extends IdentityReadPin {
  readonly host: string;
  readonly port: number;
  readonly password: string;
  readonly tlsCaPem: string;
  readonly serverMajor: "16";
  readonly relationOids: Readonly<Record<Relation, string>>;
}
export interface CanonicalIdentityDb {
  /** Compatible with DetachedIdentityReadExecutor; optional signal is caller-owned. */
  execute(sql: string, parameters: readonly unknown[], signal?: AbortSignal): Promise<{ rows: unknown }>;
  /** Permanently stops admission, drains owned leases and ends the pool once. */
  close(): Promise<void>;
}
class IdentityUnavailable extends Error {
  readonly code = "CANONICAL_IDENTITY_UNAVAILABLE";
  constructor() { super("Caller identity is unavailable"); this.name = "IdentityUnavailable"; }
}
const unavailable = () => new IdentityUnavailable();
const name = (v: unknown): v is string => typeof v === "string" && /^[a-z_][a-z0-9_]{0,62}$/.test(v) && !v.startsWith("pg_") && v !== "information_schema";
const oid = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,9}$/.test(v) && Number(v) <= 4294967295;
const identity = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{1,64}$/.test(v) && !v.includes(",");
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
// Exact maintained resolver SELECT, with only its validated quoted schema prefix
// normalized. Changing the resolver statement requires review + this pin update.
// trusted-caller-identity.ts source at commissioning: 89ba59b3540a78c995fb415ce808fa90f3157fa0b96a873d1ecebb98f5749dbc.
const CANONICAL_SQL_SHA = "8fb3ec92509a25288d42f2a1432d8ead910996b3c872aa945e39444c4b8ac777";
const BUDGET = { connection: 500, query: 600, lock: 100, idleTransaction: 1000, operation: 1000, cleanup: 500, close: 1600 } as const;

// Source-derived 26-column ABI used by the reviewed identity column grants.
const ABI = `('extensions','id',23,-1,true),('extensions','tenant_id',23,-1,false),('extensions','user_id',23,-1,false),
('extensions','extension_number',1043,36,true),('extensions','sip_username',1043,68,false),('extensions','sip_domain',1043,132,false),
('extensions','status',1043,36,true),('extensions','deleted_at',1184,-1,false),
('sip_accounts','id',23,-1,true),('sip_accounts','tenant_id',23,-1,false),('sip_accounts','extension_id',23,-1,false),('sip_accounts','user_id',23,-1,false),
('sip_accounts','sip_username',1043,68,true),('sip_accounts','sip_domain',1043,132,true),('sip_accounts','status',1043,36,true),('sip_accounts','deleted_at',1184,-1,false),
('subscriber','username',1043,68,true),('subscriber','domain',1043,68,true),
('tenant_memberships','user_id',23,-1,true),('tenant_memberships','tenant_id',23,-1,true),('tenant_memberships','status',25,-1,true),
('tenants','id',23,-1,true),('tenants','status',1043,36,true),('user_extensions','user_id',23,-1,true),('user_extensions','extension_id',23,-1,true),('users','id',23,-1,true)`;
const ATTEST = `WITH expected_relation(tbl,oid) AS (VALUES
('extensions',$3::pg_catalog.oid),('sip_accounts',$4::pg_catalog.oid),('subscriber',$5::pg_catalog.oid),
('tenant_memberships',$6::pg_catalog.oid),('tenants',$7::pg_catalog.oid),('user_extensions',$8::pg_catalog.oid),('users',$9::pg_catalog.oid)),
expected_column(tbl,col,typ,mod,nn) AS (VALUES ${ABI})
SELECT pg_catalog.current_database() AS database_name, session_user::text AS session_name, current_user::text AS current_name,
 r.oid::text AS role_oid,n.oid::text AS schema_oid,(pg_catalog.current_setting('server_version_num')::integer/10000)::text AS server_major,
 (pg_catalog.current_setting('transaction_read_only')='on' AND pg_catalog.current_setting('search_path')='pg_catalog'
  AND pg_catalog.current_setting('session_replication_role')='origin'
  AND (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()) IS TRUE) AS session_safe,
 (r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb
  AND NOT r.rolreplication AND NOT r.rolinherit AND r.rolconfig IS NULL
  AND (r.rolvaliduntil IS NULL OR r.rolvaliduntil>CURRENT_TIMESTAMP)) AS role_safe,
 (NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid OR roleid=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::pg_catalog.regclass AND refobjid=r.oid AND deptype='o')
  AND NOT pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CREATE,CONNECT WITH GRANT OPTION,TEMP WITH GRANT OPTION')
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace ns WHERE ns.nspname !~ '^pg_' AND ns.nspname<>'information_schema'
    AND pg_catalog.has_schema_privilege(r.oid,ns.oid,'CREATE,USAGE WITH GRANT OPTION'))
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname !~ '^pg_' AND ns.nspname<>'information_schema'
    AND ((p.prosecdef AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))
      OR pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE WITH GRANT OPTION')))) AS authority_safe,
 (NOT EXISTS(SELECT 1 FROM expected_relation er LEFT JOIN pg_catalog.pg_class c ON c.oid=er.oid AND c.relname=er.tbl AND c.relnamespace=n.oid
    WHERE c.oid IS NULL OR c.relkind<>'r' OR c.relpersistence<>'p' OR c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i JOIN expected_relation er ON i.inhrelid=er.oid OR i.inhparent=er.oid)
  AND NOT EXISTS(SELECT 1 FROM expected_column ec JOIN expected_relation er ON er.tbl=ec.tbl
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=er.oid AND a.attname=ec.col AND a.attnum>0 AND NOT a.attisdropped
    WHERE a.atttypid IS DISTINCT FROM ec.typ::pg_catalog.oid OR a.atttypmod IS DISTINCT FROM ec.mod
      OR a.attnotnull IS DISTINCT FROM ec.nn OR a.attgenerated IS DISTINCT FROM '' OR a.attidentity IS DISTINCT FROM '')) AS registry_safe,
 (pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE') AND pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CONNECT')
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname !~ '^pg_' AND ns.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','f')
      AND pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE ns.nspname !~ '^pg_' AND ns.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','f')
      AND (pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') IS DISTINCT FROM
        (EXISTS(SELECT 1 FROM expected_relation er JOIN expected_column ec ON ec.tbl=er.tbl WHERE er.oid=c.oid AND ec.col=a.attname))
       OR pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')))
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname !~ '^pg_' AND ns.nspname<>'information_schema'
      AND CASE WHEN c.relkind='S' THEN pg_catalog.has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE false END)) AS privileges_safe
FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_namespace n ON n.nspname=$1 WHERE r.rolname=$2`;

function snapshot(input: CanonicalIdentityDbConfig): CanonicalIdentityDbConfig {
  if (!input || Object.keys(input).sort().join() !== ["host","port","password","tlsCaPem","serverMajor","relationOids","tenantId","database","login","roleOid","schema","schemaOid"].sort().join()
    || !name(input.database) || input.login !== "phone11_identity_read_v1" || !name(input.schema)
    || !oid(input.roleOid) || !oid(input.schemaOid) || input.roleOid === "10" || input.serverMajor !== "16"
    || !Number.isSafeInteger(input.tenantId) || input.tenantId<1 || input.tenantId>2147483647
    || typeof input.host !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(input.host)
    || !Number.isInteger(input.port) || input.port<1 || input.port>65535
    || typeof input.password !== "string" || !/^[a-f0-9]{64}$/.test(input.password)
    || typeof input.tlsCaPem !== "string" || Buffer.byteLength(input.tlsCaPem)>16384 || !input.tlsCaPem.includes("-----BEGIN CERTIFICATE-----")
    || input.tlsCaPem.includes("\0") || input.tlsCaPem.includes("PRIVATE KEY")
    || !input.relationOids || Object.keys(input.relationOids).sort().join() !== [...RELATIONS].sort().join()
    || !RELATIONS.every(k=>oid(input.relationOids[k])) || new Set(RELATIONS.map(k=>input.relationOids[k])).size!==7) throw unavailable();
  return Object.freeze({...input,relationOids:Object.freeze({...input.relationOids})});
}
function admitted(sql: string, parameters: readonly unknown[], pin: CanonicalIdentityDbConfig): boolean {
  return typeof sql === "string" && sql.length<=8192 && sha(sql.replaceAll(`"${pin.schema}".`, '"__phone11_identity_schema__".'))===CANONICAL_SQL_SHA
    && Array.isArray(parameters) && parameters.length===7 && identity(parameters[0]) && identity(parameters[1])
    && parameters[2]===pin.database && parameters[3]===pin.login && parameters[4]===pin.roleOid && parameters[5]===pin.schema && parameters[6]===pin.schemaOid;
}
async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),milliseconds);})]); }
  finally { if(timer)clearTimeout(timer); }
}

export function createCanonicalIdentityDb(input: CanonicalIdentityDbConfig): CanonicalIdentityDb {
  const pin=snapshot(input);
  let pool: pg.Pool | undefined,closing=false,poisoned=false,closePromise: Promise<void> | undefined;
  const leases=new Set<Promise<void>>();
  const config: pg.PoolConfig & {replication: string;binary: false}={host:pin.host,port:pin.port,database:pin.database,user:pin.login,password:pin.password,
    replication:"false",client_encoding:"UTF8",binary:false,
    ssl:{rejectUnauthorized:true,ca:pin.tlsCaPem,checkServerIdentity:(_name,cert)=>checkServerIdentity(pin.host,cert)},
    max:4,connectionTimeoutMillis:BUDGET.connection,idleTimeoutMillis:1000,query_timeout:BUDGET.query,statement_timeout:BUDGET.query,
    lock_timeout:BUDGET.lock,idle_in_transaction_session_timeout:BUDGET.idleTransaction,allowExitOnIdle:true,
    application_name:"phone11_canonical_identity_read",
    options:"-c search_path=pg_catalog -c default_transaction_read_only=on -c statement_timeout=600 -c lock_timeout=100 -c idle_in_transaction_session_timeout=1000"};

  async function execute(sql: string,parameters: readonly unknown[],signal?: AbortSignal): Promise<{rows: unknown}> {
    if(closing || poisoned || leases.size>=4 || (signal!==undefined && !(signal instanceof AbortSignal)) || signal?.aborted || !admitted(sql,parameters,pin))throw unavailable();
    const values=[...parameters];
    let finish!: ()=>void;
    const lease=new Promise<void>(resolve=>{finish=()=>{leases.delete(lease);resolve();};});leases.add(lease);
    let client: pg.PoolClient | undefined,acquiring: Promise<pg.PoolClient> | undefined,releaseAttempted=false,released=false;
    let stopped=false,interrupt!: ()=>void;
    const interrupted=new Promise<never>((_,reject)=>{interrupt=()=>{if(!stopped){stopped=true;reject(unavailable());}};});
    // Always handle cancellation even between driver calls.
    void interrupted.catch(()=>{});
    const timer=setTimeout(interrupt,BUDGET.operation);
    signal?.addEventListener("abort",interrupt,{once:true});
    const onClientError=()=>interrupt();
    const guard=async <T>(operation: Promise<T>): Promise<T>=>{
      if(stopped || poisoned)throw unavailable();
      const result=await Promise.race([operation,interrupted]);
      if(stopped || poisoned)throw unavailable();
      return result;
    };
    const query=(text: string,values?: unknown[])=>{
      if(stopped || poisoned || !client)throw unavailable();
      return guard(client.query(text,values));
    };
    const destroy=async (owned: pg.PoolClient): Promise<void>=>{
      // pg.Pool's default client is pg.Client; its public end() confirms socket
      // closure and force-disconnects an active query. PoolClient types omit it.
      let ended: Promise<void>;
      try { ended=(owned as pg.PoolClient & Pick<pg.Client,"end">).end(); }
      catch { poisoned=true;ended=new Promise<void>(()=>{}); }
      if(!releaseAttempted){releaseAttempted=true;try{owned.release(true);}catch{poisoned=true;}}
      await ended;owned.removeListener("error",onClientError);
    };
    let cleanup: Promise<void> | undefined;
    try {
      if(!pool){pool=createJsPostgresPool(config);pool.on("error",()=>{poisoned=true;});}
      acquiring=pool.connect();client=await guard(acquiring);client.on("error",onClientError);
      await query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
      const attested=await query(ATTEST,[pin.schema,pin.login,...RELATIONS.map(k=>pin.relationOids[k])]);
      const row=attested.rows[0];
      if(attested.rows.length!==1 || !row || row.database_name!==pin.database || row.current_name!==pin.login || row.session_name!==pin.login
        || row.role_oid!==pin.roleOid || row.schema_oid!==pin.schemaOid || row.server_major!==pin.serverMajor
        || ![row.session_safe,row.role_safe,row.authority_safe,row.registry_safe,row.privileges_safe].every(v=>v===true))throw unavailable();
      const result=await query(sql,values);
      if(!Array.isArray(result.rows) || result.rows.length>2)throw unavailable();
      await query("COMMIT");
      releaseAttempted=true;client.release();released=true;client.removeListener("error",onClientError);
      if(stopped || poisoned)throw unavailable();
      return {rows:result.rows};
    } catch {
      if(releaseAttempted && !released)poisoned=true;
      if(client && !released)cleanup=destroy(client);
      else if(!client && acquiring)cleanup=acquiring.then(owned=>{client=owned;owned.on("error",onClientError);return destroy(owned);},()=>{});
      if(cleanup){
        try{await bounded(cleanup,BUDGET.cleanup);}
        catch{
          // No success or drained claim: retain this slot until actual cleanup.
          poisoned=true;void cleanup.then(finish,()=>{});finish=()=>{};
        }
      }
      throw unavailable();
    } finally {
      clearTimeout(timer);signal?.removeEventListener("abort",interrupt);finish();
    }
  }
  function close(): Promise<void> {
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      try{await bounded((async()=>{await Promise.all([...leases]);await pool?.end();})(),BUDGET.close);}
      catch{poisoned=true;throw unavailable();}
    })();
    return closePromise;
  }
  return Object.freeze({execute,close});
}
