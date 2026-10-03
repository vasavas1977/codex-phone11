import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({pool:null as Pool|null}));
vi.mock('../server/pbx/db',()=>({
 query:(sql:string,values?:unknown[])=>state.pool!.query(sql,values),
 getPool:()=>state.pool,
 withTransaction:async(fn:any)=>{const c=await state.pool!.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}},
}));
import {bindObservedOutboundChannel} from '../server/cloud-recordings/correlation';

const socket=process.env.PHONE11_CLOUD_RECORDING_TEST_SOCKET;
const schema='phone11_outbound_correlation_'+randomUUID().replaceAll('-','');
const first='10000000-0000-4000-8000-000000000001';
const second='20000000-0000-4000-8000-000000000002';
const nonce='30000000-0000-4000-8000-000000000003';
const observed=(channelUuid=first,nativeUuid=nonce,overrides:Record<string,string>={})=>({'Unique-ID':channelUuid,variable_sip_call_id:`sip-${channelUuid}`,'Caller-Destination-Number':'+66800000000','Call-Direction':'inbound',variable_call_direction:'outbound',variable_sip_received_ip:'10.0.0.8',variable_sofia_profile_name:'external',variable_phone11_outbound_id:nativeUuid,variable_phone11_authenticated_user:'3001',variable_phone11_authenticated_realm:'phone11.invalid',...overrides});

describe.skipIf(!socket)('observed outbound correlation PostgreSQL',()=>{
 beforeAll(async()=>{
  state.pool=new Pool({host:socket,port:Number(process.env.PHONE11_CLOUD_RECORDING_TEST_PORT??5432),user:'phone11_test',database:'phone11_cloud_recording_test',ssl:false,options:`-c search_path=${schema}`});
  await state.pool.query(`CREATE SCHEMA ${schema}`);
  for(const file of ['tests/fixtures/phone11-cloud-recording-baseline.sql','server/cloud-recordings/prerequisites.sql','server/cloud-recordings/migration.sql'])await state.pool.query(await readFile(file,'utf8'));
  await state.pool.query(`CREATE TABLE sip_accounts(id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),extension_id integer NOT NULL REFERENCES extensions(id),user_id integer REFERENCES users(id),sip_username text NOT NULL,sip_domain text NOT NULL,status text NOT NULL,deleted_at timestamptz)`);
  vi.stubEnv('PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED','true');vi.stubEnv('PHONE11_RECORDING_TRUSTED_PROXY_IPS','10.0.0.8');vi.stubEnv('PHONE11_RECORDING_TRUSTED_PROXY_PROFILE','external');
 });
 beforeEach(async()=>{
  await state.pool!.query(`TRUNCATE users,tenants,extensions,sip_accounts CASCADE;
   INSERT INTO users(id,"openId") VALUES(2,'owner-a'),(3,'owner-b');
   INSERT INTO tenants(id,name,status) VALUES(10,'A','active'),(20,'B','active');
   INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES(2,10,'user','active'),(3,20,'user','active');
   INSERT INTO extensions(id,tenant_id,user_id,extension_number,status) VALUES(11,10,2,'3001','active'),(21,20,3,'4001','active');
   INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES(2,11,true),(3,21,true);
   INSERT INTO sip_accounts(tenant_id,extension_id,user_id,sip_username,sip_domain,status) VALUES(10,11,2,'3001','phone11.invalid','active'),(20,21,3,'4001','other.invalid','active')`);
 });
 afterAll(async()=>{if(state.pool){await state.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await state.pool.end();}vi.unstubAllEnvs();});

 it('creates one exact route and cloud identity under concurrent scanner observations',async()=>{
  expect(await Promise.all([bindObservedOutboundChannel(observed()),bindObservedOutboundChannel(observed())])).toEqual([true,true]);
  expect((await state.pool!.query('SELECT channel_uuid::text,tenant_id,extension_id,owner_user_id,sip_call_id,direction FROM phone11_recording_routes')).rows).toEqual([{channel_uuid:first,tenant_id:10,extension_id:11,owner_user_id:2,sip_call_id:`sip-${first}`,direction:'outbound'}]);
  expect((await state.pool!.query('SELECT call_uuid,tenant_id,extension_id,native_history_id,direction FROM phone11_cloud_recordings')).rows).toEqual([{call_uuid:first,tenant_id:10,extension_id:11,native_history_id:`native-outbound:${nonce}`,direction:'outbound'}]);
 });

 it('rejects nonce reuse on another channel, including a foreign account, without partial writes',async()=>{
  expect(await bindObservedOutboundChannel(observed())).toBe(true);
  expect(await bindObservedOutboundChannel(observed(second,nonce))).toBe(false);
  expect(await bindObservedOutboundChannel(observed(second,nonce,{variable_phone11_authenticated_user:'4001',variable_phone11_authenticated_realm:'other.invalid'}))).toBe(false);
  expect((await state.pool!.query('SELECT count(*)::int AS n FROM phone11_recording_routes')).rows[0].n).toBe(1);
  expect((await state.pool!.query('SELECT count(*)::int AS n FROM phone11_cloud_recordings')).rows[0].n).toBe(1);
 });

 it('rejects channel replay with changed SIP or native identity and preserves the original owner',async()=>{
  expect(await bindObservedOutboundChannel(observed())).toBe(true);
  expect(await bindObservedOutboundChannel(observed(first,'40000000-0000-4000-8000-000000000004'))).toBe(false);
  expect(await bindObservedOutboundChannel(observed(first,nonce,{variable_sip_call_id:'changed-sip'}))).toBe(false);
  const row=(await state.pool!.query('SELECT rr.sip_call_id,r.native_history_id,rr.tenant_id,rr.extension_id FROM phone11_recording_routes rr JOIN phone11_cloud_recordings r ON r.call_uuid=rr.channel_uuid::text')).rows[0];
  expect(row).toEqual({sip_call_id:`sip-${first}`,native_history_id:`native-outbound:${nonce}`,tenant_id:10,extension_id:11});
 });

 it('requires one active exact account assignment',async()=>{
  await state.pool!.query("UPDATE sip_accounts SET status='inactive' WHERE sip_username='3001'");
  expect(await bindObservedOutboundChannel(observed())).toBe(false);
  expect((await state.pool!.query('SELECT count(*)::int AS n FROM phone11_recording_routes')).rows[0].n).toBe(0);
 });
 it.each([
  ['missing SIP credential owner',"UPDATE sip_accounts SET user_id=NULL WHERE sip_username='3001'"],
  ['SIP credential owner differs from extension owner',"UPDATE sip_accounts SET user_id=3 WHERE sip_username='3001'"],
  ['extension owner changed before SIP credential owner',"UPDATE extensions SET user_id=3 WHERE id=11"],
 ])('fails closed when %s',async(_label,sql)=>{
  await state.pool!.query(sql);
  expect(await bindObservedOutboundChannel(observed())).toBe(false);
  expect((await state.pool!.query('SELECT count(*)::int AS n FROM phone11_recording_routes')).rows[0].n).toBe(0);
 });
 it('fails closed when SIP and extension owners changed before assignment and membership',async()=>{
  await state.pool!.query("UPDATE sip_accounts SET user_id=3 WHERE sip_username='3001'; UPDATE extensions SET user_id=3 WHERE id=11");
  expect(await bindObservedOutboundChannel(observed())).toBe(false);
  expect((await state.pool!.query('SELECT count(*)::int AS n FROM phone11_recording_routes')).rows[0].n).toBe(0);
 });
});
