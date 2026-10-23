/** Owned synthetic HTTP integration. Actual auth/context/router/SQL and exact grant manifest. */
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import express from 'express';
import { createServer,type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { router } from '../server/_core/trpc';
import { createContext } from '../server/_core/context';
import { registerAuthRoutes } from '../server/_core/auth-routes';
import { readAuthConfig } from '../server/_core/phone11-auth';
import { applyAuthMigration,createExistingUserIdentity } from '../server/_core/phone11-auth-admin';
import { getPool } from '../server/pbx/db';
import { READINESS_SQL } from '../server/pbx/database-readiness';
import { ivrRouter } from '../server/pbx/ivr-router';
import { invitationsRouter } from '../server/invitations/router';
const delivery=vi.hoisted(()=>({messages:[] as {email:string,url:string}[]}));
vi.mock('../server/pbx/redis',()=>({invalidateCache:vi.fn(async()=>{}),cacheGetOrSet:vi.fn(async(_k:string,_s:number,fn:()=>unknown)=>fn())}));
vi.mock('../server/invitations/mailer',async original=>({...await original<typeof import('../server/invitations/mailer')>(),readInvitationConfig:()=>({enabled:true,origin:'http://localhost:8081',mailer:{send:async(message:{email:string,url:string})=>{delivery.messages.push(message);return 'synthetic-delivery';}}})}));
const enabled=process.env.PHONE11_EXACT_HTTP_OWNER_SOCKET?.startsWith('/tmp/phone11-exact-http-');
(enabled?describe:describe.skip)('exact ordinary grants through real authenticated HTTP',()=>{
 let owner:Pool,server:Server,origin:string,cookie:string;const password=randomBytes(24).toString('hex');
 async function request(path:string,method='GET',body?:unknown,cookieValue=cookie){const headers:Record<string,string>={};if(cookieValue)headers.Cookie=cookieValue;if(body!==undefined)headers['Content-Type']='application/json';return fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error'});}
 async function rpc(path:string,input:unknown,method='POST',cookieValue=cookie){return request('/api/trpc/'+path+(method==='GET'?'?input='+encodeURIComponent(JSON.stringify({json:input})):''),method,method==='POST'?{json:input}:undefined,cookieValue);}
 async function login(email='owner@example.test',pass=password){const r=await request('/api/auth/sign-in/email','POST',{email,password:pass,rememberMe:false},'');expect(r.status).toBe(200);const cookies=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');expect(cookies).not.toBe('');return cookies;}
 beforeAll(async()=>{
  owner=new Pool({host:process.env.PHONE11_EXACT_HTTP_OWNER_SOCKET,port:Number(process.env.PG_PORT),user:'p11_fixture_owner',database:process.env.PG_DATABASE});
  await owner.query(`CREATE TABLE users(id serial PRIMARY KEY,"openId" text UNIQUE NOT NULL,name text,email text,"loginMethod" text,role text NOT NULL DEFAULT 'user',"createdAt" timestamptz DEFAULT now(),"updatedAt" timestamptz DEFAULT now(),"lastSignedIn" timestamptz DEFAULT now());
   CREATE TABLE tenants(id serial PRIMARY KEY,name text,status text);
   CREATE TABLE tenant_memberships(user_id integer REFERENCES users(id),tenant_id integer REFERENCES tenants(id),role text,status text,created_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,tenant_id));
   CREATE TABLE audit_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id integer,actor_user_id integer,action text,resource_type text,resource_id text,old_value jsonb,new_value jsonb,ip_address inet,user_agent text,request_id text,session_id text,created_at timestamptz DEFAULT now());
   ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
   CREATE TABLE ring_groups(id serial PRIMARY KEY,tenant_id integer,name text,description text,extension text,strategy text,ring_timeout integer,caller_id_mode text,caller_id_name text,caller_id_number text,skip_busy boolean,skip_offline boolean,enable_pickup boolean,fallback_action text,fallback_target text,moh_file text,is_active boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
   INSERT INTO users("openId",name,email,role) VALUES('synthetic-owner','Owner','owner@example.test','user');INSERT INTO tenants(id,name,status) VALUES(41,'Synthetic workspace','active'),(42,'Other synthetic workspace','active');INSERT INTO tenant_memberships VALUES(1,41,'owner','active',now());`);
  vi.stubEnv('PHONE11_AUTH_SECRET',randomBytes(48).toString('hex'));vi.stubEnv('PHONE11_AUTH_BASE_URL','http://127.0.0.1:8089');vi.stubEnv('PHONE11_AUTH_TRUSTED_ORIGINS','http://localhost:8081');
  await applyAuthMigration(owner,readAuthConfig());await createExistingUserIdentity(owner,{userId:1,email:'owner@example.test',password});
  const env={...process.env,PGHOST:process.env.PHONE11_EXACT_HTTP_OWNER_SOCKET,PGPORT:process.env.PG_PORT,PGDATABASE:process.env.PG_DATABASE,PGUSER:'p11_fixture_owner'};
  for(const file of ['migration-users-index.sql','migration.sql'])execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',['-X','-q','-v','ON_ERROR_STOP=1','-f','server/invitations/'+file],{env,stdio:'pipe'});
  execFileSync('python3',['deploy/postgres/ordinary-api/prepare-http-fixture.py'],{env,stdio:'pipe'});
  const app=express();registerAuthRoutes(app);app.use(express.json());app.use('/api/trpc',createExpressMiddleware({router:router({routing:ivrRouter,invitations:invitationsRouter}),createContext}));server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const a=server.address();if(!a||typeof a==='string')throw Error('FIXTURE_LISTENER');origin='http://127.0.0.1:'+a.port;
  vi.stubEnv('PHONE11_AUTH_BASE_URL',origin);cookie=await login();
 },30000);
 afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await getPool().end();await owner?.end();vi.unstubAllEnvs();});
 it('readiness resolves public tables with catalog-first role path and refuses a temporary shadow path',async()=>{
  const client=await getPool().connect();try{
   expect((await client.query('SELECT current_schema() AS s')).rows[0].s).toBe('pg_catalog');
   await client.query('CREATE TEMP TABLE tenants (id integer)');
   const parameters=['127.0.0.1',0,'170011','p11_management_runtime_20261023_v1'];
   expect((await client.query(READINESS_SQL,parameters)).rows[0].observation.schemaMatch).toBe(true);
   await client.query('SET search_path=pg_temp,public,pg_catalog');
   expect((await client.query(READINESS_SQL,parameters)).rows[0].observation.schemaMatch).toBe(false);
  }finally{await client.query('RESET search_path;DROP TABLE IF EXISTS pg_temp.tenants');client.release();}
 });
 it('uses the genuine nonowner restricted login for HTTP auth/session and successful audited mutation',async()=>{
  const flags=(await getPool().query('SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];expect(flags).toEqual({current_user:'p11_management_runtime_20261023_v1',session_user:'p11_management_runtime_20261023_v1',rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false});
  const me=await request('/api/auth/me');expect(me.status).toBe(200);expect((await me.json()).user.id).toBe(1);
  const r=await rpc('routing.ringGroups.create',{tenant_id:41,name:'HTTP exact grant success',fallback_action:'hangup'});expect(r.status).toBe(200);
  expect((await owner.query("SELECT count(*)::int n FROM ring_groups WHERE name='HTTP exact grant success'")).rows[0].n).toBe(1);expect((await owner.query("SELECT count(*)::int n FROM audit_logs WHERE actor_user_id=1 AND tenant_id=41")).rows[0].n).toBe(1);
 });
 it('denies cross-tenant mutation and invitation with the authenticated cookie',async()=>{
  for(const [path,input]of [['routing.ringGroups.create',{tenant_id:42,name:'cross-tenant',fallback_action:'hangup'}],['invitations.create',{tenantId:42,email:'cross@example.test',role:'user'}]]as const){const r=await rpc(path,input);expect(r.status).toBe(403);}
  expect((await owner.query("SELECT count(*)::int n FROM ring_groups WHERE tenant_id=42")).rows[0].n).toBe(0);
 });
 it('creates, inspects and accepts an invitation over HTTP then signs in the synthetic new user',async()=>{
  const created=await rpc('invitations.create',{tenantId:41,email:'new-http@example.test',role:'user'});expect(created.status).toBe(200);const delivered=delivery.messages.find(x=>x.email==='new-http@example.test');expect(delivered).toBeDefined();const token=new URLSearchParams(new URL(delivered!.url).hash.slice(1)).get('token')!;
  expect((await rpc('invitations.inspect',{token},'POST','')).status).toBe(200);
  const accepted=await rpc('invitations.accept',{token,name:'Synthetic new user',password},'POST','');expect(accepted.status).toBe(200);expect((await rpc('invitations.accept',{token,name:'Synthetic new user',password},'POST','')).status).toBe(400);
  const newCookie=await login('new-http@example.test');const me=await request('/api/auth/me','GET',undefined,newCookie);expect(me.status).toBe(200);expect((await me.json()).user.email).toBe('new-http@example.test');expect((await owner.query("SELECT role FROM users WHERE email='new-http@example.test'")).rows[0].role).toBe('user');
  expect((await owner.query("SELECT count(*)::int n FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE u.email='new-http@example.test' AND tm.tenant_id=41 AND tm.role='user'")).rows[0].n).toBe(1);
 });
 it('fresh membership revocation defeats an existing authenticated session for routing and invitations',async()=>{
  await owner.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=1");try{for(const[path,input]of [['routing.ringGroups.create',{tenant_id:41,name:'revoked',fallback_action:'hangup'}],['invitations.create',{tenantId:41,email:'revoked@example.test',role:'user'}]]as const)expect((await rpc(path,input)).status).toBe(403);}finally{await owner.query("UPDATE tenant_memberships SET status='active' WHERE user_id=1");}
 });
 it('rolls back business mutation when the mandatory audit insert fails',async()=>{
  await owner.query("CREATE FUNCTION public.synthetic_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit outage'; END $$;CREATE TRIGGER synthetic_reject BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.synthetic_reject_audit()");
  try{expect((await rpc('routing.ringGroups.create',{tenant_id:41,name:'audit must roll back',fallback_action:'hangup'})).status).toBe(500);expect((await owner.query("SELECT count(*)::int n FROM ring_groups WHERE name='audit must roll back'")).rows[0].n).toBe(0);}finally{await owner.query('DROP TRIGGER synthetic_reject ON audit_logs;DROP FUNCTION public.synthetic_reject_audit()');}
 });
 it('immediately rejects a disabled canonical mapping on the existing cookie',async()=>{
  await owner.query('UPDATE phone11_auth_identity SET disabled_at=now() WHERE legacy_user_id=1');try{expect((await request('/api/auth/me')).status).toBe(401);expect((await rpc('routing.ringGroups.create',{tenant_id:41,name:'disabled',fallback_action:'hangup'})).status).toBe(401);}finally{await owner.query('UPDATE phone11_auth_identity SET disabled_at=NULL WHERE legacy_user_id=1');}
 });
});
