import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createCanonicalAssignmentResolver } from "../server/pbx/trusted-caller-identity";
import type { CanonicalIdentityDbConfig } from "../server/pbx/canonical-identity-db";

// Driver doubles only: no network, actual LOGIN, TLS session or production data.
const f=vi.hoisted(()=>({configs:[] as any[],events:[] as string[],clients:[] as any[],rows:[] as unknown[],row:{} as any,
  fail:"",forceNative:false,JsClient:class{},NativeClient:class{},connect:vi.fn(),endPool:vi.fn(),poolError:(()=>{}) as ()=>void,blockRead:undefined as undefined|(()=>Promise<any>),endClient:undefined as undefined|(()=>Promise<void>)}));
vi.mock("pg/lib/client.js",()=>({default:f.JsClient}));
vi.mock("pg",()=>({default:{get Client(){return f.forceNative?f.NativeClient:f.JsClient;},Pool:class{
  constructor(config:unknown){f.configs.push(config);}
  on(_event:string,handler:()=>void){f.poolError=handler;}
  connect=f.connect;
  end=f.endPool;
}}}));
vi.mock("../server/pbx/db",()=>{throw Error("SHARED_POOL_FORBIDDEN");});
const config=():CanonicalIdentityDbConfig=>({host:"postgres",port:5432,database:"phone11ai",login:"phone11_identity_read_v1",password:"c".repeat(64),
  tlsCaPem:"-----BEGIN CERTIFICATE-----\nSYNTHETIC_SHAPE_ONLY\n-----END CERTIFICATE-----",tenantId:1,roleOid:"27003",schema:"public",schemaOid:"2200",serverMajor:"16",
  relationOids:{extensions:"24602",sip_accounts:"24635",subscriber:"16386",tenant_memberships:"24985",tenants:"24590",user_extensions:"24619",users:"24685"}});
const safeRow=()=>({database_name:"phone11ai",session_name:"phone11_identity_read_v1",current_name:"phone11_identity_read_v1",role_oid:"27003",schema_oid:"2200",server_major:"16",
  session_safe:true,role_safe:true,authority_safe:true,registry_safe:true,privileges_safe:true});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function client(){
  const c=new EventEmitter() as any;
  c.query=vi.fn(async(text:string,values?:unknown[])=>{
    const phase=text.startsWith("BEGIN")?"BEGIN":text.startsWith("WITH expected_relation")?"ATTEST":text==="COMMIT"?"COMMIT":"READ";
    f.events.push(phase);
    if(f.fail===phase)throw Error("PRIVATE_SQL_PASSWORD_"+phase);
    if(phase==="ATTEST")return{rows:[f.row]};
    if(phase==="READ" && f.blockRead)return f.blockRead();
    return{rows:phase==="READ"?f.rows:[]};
  });
  c.release=vi.fn((destroy?:boolean)=>{f.events.push(destroy?"RELEASE_DESTROY":"RELEASE");if(f.fail==="RELEASE")throw Error("PRIVATE_RELEASE_PASSWORD");});
  c.end=vi.fn(async()=>{f.events.push("CLIENT_END_START");if(f.endClient)await f.endClient();f.events.push("CLIENT_END_DONE");c.emit("end");});
  f.clients.push(c);return c;
}
async function request(pin=config()){
  let text="",values:readonly unknown[]=[];
  await createCanonicalAssignmentResolver(pin,async(sql,parameters)=>{text=sql;values=parameters;return{rows:[]};})("1001","sip.example.invalid");
  return{text,values};
}
const load=()=>import("../server/pbx/canonical-identity-db");
function sanitized(error:unknown){
  expect(error).toMatchObject({code:"CANONICAL_IDENTITY_UNAVAILABLE",message:"Caller identity is unavailable"});
  expect(error).not.toHaveProperty("cause");expect(JSON.stringify(error)).not.toMatch(/PRIVATE|password|SELECT|postgres/);
}
beforeEach(()=>{
  vi.resetModules();Object.assign(f,{configs:[],events:[],clients:[],rows:[],row:safeRow(),fail:"",forceNative:false,blockRead:undefined,endClient:undefined});
  f.connect.mockReset().mockImplementation(async()=>{f.events.push("CONNECT");if(f.fail==="CONNECT")throw Error("PRIVATE_CONNECT_PASSWORD");return client();});
  f.endPool.mockReset().mockImplementation(async()=>{f.events.push("POOL_END");if(f.fail==="POOL_END")throw Error("PRIVATE_POOL_PASSWORD");});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});

describe("explicit detached identity transport",()=>{
  it("refuses native-driver selection before a credential-bearing pool or connection exists",async()=>{
    vi.stubEnv("NODE_PG_FORCE_NATIVE","1");f.forceNative=true;const q=await request(),db=(await load()).createCanonicalIdentityDb(config());
    sanitized(await db.execute(q.text,q.values).catch(e=>e));expect(f.configs).toEqual([]);expect(f.connect).not.toHaveBeenCalled();await db.close();
  });
  it("uses the maintained resolver statement and releases after readonly commit before return",async()=>{
    const q=await request();const db=(await load()).createCanonicalIdentityDb(config());f.rows=[{account_id:1}];
    expect(await db.execute(q.text,q.values)).toEqual({rows:[{account_id:1}]});
    expect(f.events).toEqual(["CONNECT","BEGIN","ATTEST","READ","COMMIT","RELEASE"]);
    expect(f.clients[0].query.mock.calls[0][0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
    expect(f.clients[0].query.mock.calls[2]).toEqual([q.text,[...q.values]]);await db.close();
  });
  it("has no environment or privileged/policy transport fallback and uses verified explicit TLS",async()=>{
    vi.stubEnv("PGOPTIONS","-c search_path=PRIVATE");vi.stubEnv("PGPASSWORD","PRIVATE");vi.stubEnv("DATABASE_URL","postgres://PRIVATE");vi.stubEnv("PGREPLICATION","database");vi.stubEnv("PGCLIENT_ENCODING","LATIN1");
    const q=await request(),db=(await load()).createCanonicalIdentityDb(config());await db.execute(q.text,q.values);
    const c=f.configs[0];expect(c.Client).toBe(f.JsClient);expect(c).toMatchObject({host:"postgres",port:5432,database:"phone11ai",user:"phone11_identity_read_v1",password:"c".repeat(64),max:4,
      connectionTimeoutMillis:500,query_timeout:600,statement_timeout:600,lock_timeout:100,idle_in_transaction_session_timeout:1000,ssl:{rejectUnauthorized:true,ca:config().tlsCaPem}});
    expect(c).not.toHaveProperty("connectionString");
    const Parameters=createRequire(import.meta.url)("pg/lib/connection-parameters");expect(new Parameters(c).options).toBe(c.options);expect(c.options).not.toContain("PRIVATE");
    expect(new Parameters(c).replication).toBe("false");expect(new Parameters(c).client_encoding).toBe("UTF8");
    expect(c.ssl.checkServerIdentity("localhost",{subjectaltname:"DNS:postgres"})).toBeUndefined();
    expect(c.ssl.checkServerIdentity("other",{subjectaltname:"DNS:other"})).toMatchObject({code:"ERR_TLS_CERT_ALTNAME_INVALID"});
    const source=readFileSync(new URL("../server/pbx/canonical-identity-db.ts",import.meta.url),"utf8");
    expect(source).not.toMatch(/process\.env|from ["']\.\/db["']|from ["']\.\/fraud-policy-db["']|SET ROLE|GENERATED_LAB/);await db.close();
  });
  it.each([
    {login:"phone11_fraud_api_v1"},{login:"phone11ai"},{roleOid:"10"},{host:"/tmp"},{host:"postgres sslmode=disable"},{host:"::1"},{port:0},{port:65536},
    {password:"short"},{password:"C".repeat(64)},{tlsCaPem:"PRIVATE KEY"},{serverMajor:"17"},{schema:"pg_catalog"},{schemaOid:"0"},{tenantId:0},{roleOid:"027003"},
    {connectionString:"postgres://PRIVATE"},{GENERATED_LAB:"1"},{relationOids:{...config().relationOids,users:"24590"}},
  ])("refuses unsupported explicit config before constructing a pool: %j",async delta=>{
    const module=await load();expect(()=>module.createCanonicalIdentityDb({...config(),...delta} as CanonicalIdentityDbConfig)).toThrow("Caller identity is unavailable");expect(f.configs).toEqual([]);
  });
  it("requires every configuration field",async()=>{
    const module=await load();for(const k of Object.keys(config())){const c:any=config();delete c[k];expect(()=>module.createCanonicalIdentityDb(c)).toThrow("Caller identity is unavailable");}
    expect(f.configs).toEqual([]);
  });
  it("snapshots nested inputs immutably and never constructs a pool just for configuration",async()=>{
    const input:any=config(),q=await request(),db=(await load()).createCanonicalIdentityDb(input);expect(f.configs).toEqual([]);
    input.host="evil.invalid";input.password="d".repeat(64);input.relationOids.users="99999";await db.execute(q.text,q.values);
    expect(f.configs[0].host).toBe("postgres");expect(f.configs[0].password).toBe("c".repeat(64));expect(f.clients[0].query.mock.calls[1][1]).toEqual(["public","phone11_identity_read_v1","24602","24635","16386","24985","24590","24619","24685"]);await db.close();
  });
  it("rejects altered SQL, extra statements and every mismatched metadata parameter before connect",async()=>{
    const q=await request(),db=(await load()).createCanonicalIdentityDb(config());
    for(const text of ["SELECT 1",q.text+"; SELECT 1",q.text.replace("LIMIT 2","LIMIT 3"),q.text.replace('"public".','"other".')])sanitized(await db.execute(text,q.values).catch(e=>e));
    for(let i=0;i<7;i++){const p=[...q.values];p[i]=i<2?"bad,user":"wrong";sanitized(await db.execute(q.text,p).catch(e=>e));}
    for(const p of [q.values.slice(1),[...q.values,"extra"],[{},...q.values.slice(1)]])sanitized(await db.execute(q.text,p).catch(e=>e));
    expect(f.connect).not.toHaveBeenCalled();await db.close();
  });
  it("normalizes only the configured schema in an otherwise exact maintained statement",async()=>{
    const pin={...config(),schema:"commissioned"},q=await request(pin),db=(await load()).createCanonicalIdentityDb(pin);f.row.schema_oid=pin.schemaOid;await db.execute(q.text,q.values);await db.close();
  });
});

describe("fresh same-client identity and effective ACL attestation",()=>{
  it.each(["database_name","session_name","current_name","role_oid","schema_oid","server_major","session_safe","role_safe","authority_safe","registry_safe","privileges_safe"])("refuses drift in %s before canonical rows",async key=>{
    f.row[key]=key.endsWith("safe")?false:"wrong";const q=await request(),db=(await load()).createCanonicalIdentityDb(config());sanitized(await db.execute(q.text,q.values).catch(e=>e));
    expect(f.events).not.toContain("READ");expect(f.clients[0].release).toHaveBeenCalledWith(true);expect(f.events.indexOf("CLIENT_END_DONE")).toBeLessThan(f.events.indexOf("RELEASE_DESTROY")+2);await db.close();
  });
  it("attests each lease and rejects null/truthy-string instead of true",async()=>{
    const q=await request(),db=(await load()).createCanonicalIdentityDb(config());await db.execute(q.text,q.values);f.row.privileges_safe="true";sanitized(await db.execute(q.text,q.values).catch(e=>e));
    expect(f.events.filter(x=>x==="ATTEST")).toHaveLength(2);await db.close();
  });
  it("checks exact26 column ABI and global effective-only SELECT/no grant/definer/sequence authority without reading credentials",async()=>{
    const q=await request(),db=(await load()).createCanonicalIdentityDb(config());await db.execute(q.text,q.values);const sql=f.clients[0].query.mock.calls[1][0] as string;
    const abi=sql.slice(sql.indexOf("expected_column"),sql.indexOf("SELECT pg_catalog.current_database"));expect((abi.match(/\('[a-z_]+','[a-z_]+',\d+,-?\d+,(true|false)\)/g)||[])).toHaveLength(26);
    for(const fragment of ["pg_catalog.pg_stat_ssl","transaction_read_only","pg_catalog.pg_auth_members","pg_catalog.pg_shdepend","p.prosecdef","SELECT WITH GRANT OPTION","pg_catalog.has_sequence_privilege","a.atttypmod IS DISTINCT FROM ec.mod","c.relrowsecurity","pg_catalog.pg_inherits"])expect(sql).toContain(fragment);
    expect(sql).not.toMatch(/\b(?:FROM|JOIN)\s+pg_catalog\.pg_authid\b|rolpassword|'ha1'|'password'|SELECT \*/);await db.close();
  });
  it("denies a result beyond the maintained LIMIT2 bound",async()=>{
    f.rows=[{},{},{}];const q=await request(),db=(await load()).createCanonicalIdentityDb(config());sanitized(await db.execute(q.text,q.values).catch(e=>e));expect(f.events).not.toContain("COMMIT");await db.close();
  });
});

describe("bounded ownership and lifecycle",()=>{
  it.each(["CONNECT","BEGIN","ATTEST","READ","COMMIT","RELEASE"])("sanitizes %s failure and never returns early success",async phase=>{
    f.fail=phase;const q=await request(),db=(await load()).createCanonicalIdentityDb(config());sanitized(await db.execute(q.text,q.values).catch(e=>e));
    if(phase!=="CONNECT"){expect(f.clients[0].end).toHaveBeenCalledOnce();expect(f.events).toContain("CLIENT_END_DONE");}
    if(phase==="RELEASE"){expect(f.clients[0].release).toHaveBeenCalledOnce();sanitized(await db.execute(q.text,q.values).catch(e=>e));}
    await db.close();
  });
  it("holds failure until asynchronous client closure confirms cleanup",async()=>{
    const ending=deferred<void>();f.endClient=()=>ending.promise;f.fail="READ";const q=await request(),db=(await load()).createCanonicalIdentityDb(config());let settled=false;
    const result=db.execute(q.text,q.values).catch(e=>{settled=true;return e;});await flush();expect(settled).toBe(false);ending.resolve();sanitized(await result);expect(f.events).toContain("CLIENT_END_DONE");await db.close();
  });
  it("aborts active work by destroying its client, with no commit or later success",async()=>{
    const reading=deferred<any>();f.blockRead=()=>reading.promise;const controller=new AbortController(),q=await request(),db=(await load()).createCanonicalIdentityDb(config());
    const result=db.execute(q.text,q.values,controller.signal).catch(e=>e);await flush();expect(f.events).toContain("READ");controller.abort();sanitized(await result);expect(f.clients[0].release).toHaveBeenCalledWith(true);expect(f.events).not.toContain("COMMIT");reading.resolve({rows:[]});await db.close();
  });
  it("cleans a connection that arrives after abort without running any SQL",async()=>{
    const waiting=deferred<any>();f.connect.mockImplementation(()=>waiting.promise);const controller=new AbortController(),q=await request(),db=(await load()).createCanonicalIdentityDb(config());
    const result=db.execute(q.text,q.values,controller.signal).catch(e=>e);controller.abort();await flush();const late=client();waiting.resolve(late);sanitized(await result);expect(late.query).not.toHaveBeenCalled();expect(late.end).toHaveBeenCalledOnce();expect(late.release).toHaveBeenCalledWith(true);await db.close();
  });
  it("retains and cleans a connection arriving after the bounded abort-cleanup window",async()=>{
    vi.useFakeTimers();const waiting=deferred<any>();f.connect.mockImplementation(()=>waiting.promise);const controller=new AbortController(),q=await request(),db=(await load()).createCanonicalIdentityDb(config());
    const result=db.execute(q.text,q.values,controller.signal).catch(e=>e);controller.abort();await flush();await vi.advanceTimersByTimeAsync(500);sanitized(await result);
    const closing=db.close();await flush();expect(f.endPool).not.toHaveBeenCalled();const late=client();waiting.resolve(late);await closing;expect(late.query).not.toHaveBeenCalled();expect(late.end).toHaveBeenCalledOnce();
  });
  it("refuses an already aborted call before allocating anything",async()=>{
    const controller=new AbortController();controller.abort();const q=await request(),db=(await load()).createCanonicalIdentityDb(config());sanitized(await db.execute(q.text,q.values,controller.signal).catch(e=>e));expect(f.connect).not.toHaveBeenCalled();await db.close();
  });
  it("enforces a whole-operation deadline even for a hung driver query",async()=>{
    vi.useFakeTimers();f.blockRead=()=>new Promise(()=>{});const q=await request(),db=(await load()).createCanonicalIdentityDb(config());const result=db.execute(q.text,q.values).catch(e=>e);await flush();await vi.advanceTimersByTimeAsync(1000);sanitized(await result);expect(f.events).not.toContain("COMMIT");expect(f.events).toContain("CLIENT_END_DONE");await db.close();
  });
  it("retains an uncertain-cleanup slot and poisons admission until actual late cleanup settles",async()=>{
    vi.useFakeTimers();const ending=deferred<void>();f.endClient=()=>ending.promise;f.fail="READ";const q=await request(),db=(await load()).createCanonicalIdentityDb(config());
    const result=db.execute(q.text,q.values).catch(e=>e);await flush();await vi.advanceTimersByTimeAsync(500);sanitized(await result);sanitized(await db.execute(q.text,q.values).catch(e=>e));
    const closing=db.close();await flush();expect(f.endPool).not.toHaveBeenCalled();ending.resolve();await closing;expect(f.endPool).toHaveBeenCalledOnce();
  });
  it("never claims drained after a failed client shutdown, and retains its error handler",async()=>{
    vi.useFakeTimers();f.endClient=async()=>{throw Error("PRIVATE_END_PASSWORD");};f.fail="READ";const q=await request(),db=(await load()).createCanonicalIdentityDb(config());
    sanitized(await db.execute(q.text,q.values).catch(e=>e));expect(f.clients[0].listenerCount("error")).toBe(1);
    const closing=db.close().catch(e=>e);await vi.advanceTimersByTimeAsync(1600);sanitized(await closing);expect(f.endPool).not.toHaveBeenCalled();
  });
  it("cancels on a checked-out client error without logging the native error",async()=>{
    const reading=deferred<any>();f.blockRead=()=>reading.promise;const q=await request(),db=(await load()).createCanonicalIdentityDb(config());const result=db.execute(q.text,q.values).catch(e=>e);
    await flush();f.clients[0].emit("error",Error("PRIVATE_NATIVE_CREDENTIAL"));sanitized(await result);expect(f.events).toContain("CLIENT_END_DONE");expect(f.events).not.toContain("COMMIT");reading.resolve({rows:[]});await db.close();
  });
  it("does not destroy a returned idle client if cancellation occurs during release",async()=>{
    const controller=new AbortController(),q=await request(),db=(await load()).createCanonicalIdentityDb(config());f.connect.mockImplementation(async()=>{const c=client();c.release.mockImplementation(()=>controller.abort());return c;});
    sanitized(await db.execute(q.text,q.values,controller.signal).catch(e=>e));expect(f.clients[0].release).toHaveBeenCalledOnce();expect(f.clients[0].end).not.toHaveBeenCalled();await db.close();
  });
  it("admits at most4 operations, retains work and drains before the single pool end",async()=>{
    const reading=deferred<any>();f.blockRead=()=>reading.promise;const q=await request(),db=(await load()).createCanonicalIdentityDb(config());const pending=Array.from({length:4},()=>db.execute(q.text,q.values));await flush();
    sanitized(await db.execute(q.text,q.values).catch(e=>e));expect(f.connect).toHaveBeenCalledTimes(4);const closing=db.close();expect(db.close()).toBe(closing);await flush();expect(f.endPool).not.toHaveBeenCalled();
    sanitized(await db.execute(q.text,q.values).catch(e=>e));reading.resolve({rows:[]});await Promise.all(pending);await closing;expect(f.endPool).toHaveBeenCalledOnce();expect(f.events.filter(x=>x==="RELEASE")).toHaveLength(4);
  });
  it("sanitizes and caches a failed pool-close result without retry",async()=>{
    const q=await request(),db=(await load()).createCanonicalIdentityDb(config());await db.execute(q.text,q.values);f.fail="POOL_END";const closing=db.close();sanitized(await closing.catch(e=>e));expect(db.close()).toBe(closing);expect(f.endPool).toHaveBeenCalledOnce();
  });
  it("bounds an unresponsive pool close without retry or accepting new work",async()=>{
    vi.useFakeTimers();const q=await request(),db=(await load()).createCanonicalIdentityDb(config());await db.execute(q.text,q.values);f.endPool.mockImplementation(()=>new Promise(()=>{}));
    const closing=db.close().catch(e=>e);await vi.advanceTimersByTimeAsync(1600);sanitized(await closing);sanitized(await db.execute(q.text,q.values).catch(e=>e));expect(f.endPool).toHaveBeenCalledOnce();
  });
  it("poisons admission on an idle-pool error without exporting native errors",async()=>{
    const q=await request(),db=(await load()).createCanonicalIdentityDb(config());await db.execute(q.text,q.values);f.poolError();sanitized(await db.execute(q.text,q.values).catch(e=>e));expect(f.connect).toHaveBeenCalledOnce();await db.close();
  });
});
