import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {persistRouteCdr} from '../server/cloud-recordings/route-cdr';
const socket=process.env.PHONE11_CLOUD_RECORDING_TEST_SOCKET;
const pool=new Pool({host:socket??'/nonexistent',user:'phone11_test',database:'phone11_cloud_recording_test',ssl:false});
const id='10000000-0000-4000-8000-000000000001';
const fields={'Unique-ID':id,variable_sip_call_id:'exact-sip','Caller-Channel-Created-Time':'1700000000000000'};
describe.skipIf(!socket)('trusted route CDR PostgreSQL',()=>{
 beforeAll(async()=>{for(const file of ['tests/fixtures/phone11-cloud-recording-baseline.sql','server/cloud-recordings/prerequisites.sql','server/cloud-recordings/migration.sql'])await pool.query(await readFile(file,'utf8'));});
 beforeEach(async()=>{await pool.query(`TRUNCATE users,tenants,extensions,call_records CASCADE;
  INSERT INTO users(id,"openId") VALUES(2,'original-owner'),(3,'new-owner');
  INSERT INTO tenants(id,name,status) VALUES(10,'A','active'),(20,'B','active');
  INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES(2,10,'user','active'),(3,10,'user','active');
  INSERT INTO extensions(id,tenant_id,user_id,extension_number,status) VALUES(11,10,2,'3001','active');
  INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES(2,11,true);`);await pool.query(`INSERT INTO phone11_recording_routes(channel_uuid,tenant_id,extension_id,sip_call_id,direction,number) VALUES($1,10,11,'exact-sip','inbound','+66800000000')`,[id]);});
 afterAll(()=>pool.end());
 it('concurrent snapshots create exactly one parent and leg without invented end facts',async()=>{
  expect(await Promise.all([persistRouteCdr(pool,id,fields),persistRouteCdr(pool,id,fields)])).toEqual([true,true]);
  const r=(await pool.query('SELECT * FROM call_records')).rows;expect(r).toHaveLength(1);expect(r[0].ended_at).toBeNull();expect(r[0].answered_at).toBeNull();expect(r[0].disposition).toBeNull();expect(r[0].metadata.completion).toBe('unknown');
  expect((await pool.query('SELECT * FROM call_legs')).rows).toHaveLength(1);
 });
 it('rejects wrong SIP, absent route, inactive tenant and absent timestamp',async()=>{
  expect(await persistRouteCdr(pool,id,{...fields,variable_sip_call_id:'wrong'})).toBe(false);
  expect(await persistRouteCdr(pool,id,{variable_sip_call_id:'exact-sip'})).toBe(false);
  expect(await persistRouteCdr(pool,'20000000-0000-4000-8000-000000000002',fields)).toBe(false);
  await pool.query("UPDATE tenants SET status='inactive' WHERE id=10");expect(await persistRouteCdr(pool,id,fields)).toBe(false);expect((await pool.query('SELECT * FROM call_records')).rows).toHaveLength(0);
 });
 it('preserves legitimate completed CDR and finalized storage on replay',async()=>{
  await persistRouteCdr(pool,id,fields);await pool.query("UPDATE call_records SET ended_at=to_timestamp(1700000020),total_duration_seconds=20,recording_url='/private/proof.wav',disposition='answered'");
  const before=(await pool.query('SELECT * FROM call_records')).rows;expect(await persistRouteCdr(pool,id,fields)).toBe(true);expect((await pool.query('SELECT * FROM call_records')).rows).toEqual(before);
 });
 it('rejects foreign source parent with no verified leg',async()=>{
  await pool.query("INSERT INTO call_records(call_uuid,tenant_id,direction,from_number,to_number,started_at) VALUES($1,10,'inbound','','',now())",[id]);expect(await persistRouteCdr(pool,id,fields)).toBe(false);expect((await pool.query('SELECT * FROM call_legs')).rows).toHaveLength(0);
 });
 it('rejects mismatched authenticated channel and conflicting leg',async()=>{
  expect(await persistRouteCdr(pool,id,{...fields,'Unique-ID':'wrong'})).toBe(false);await persistRouteCdr(pool,id,fields);await pool.query("UPDATE call_legs SET sip_call_id='foreign'");expect(await persistRouteCdr(pool,id,fields)).toBe(false);
 });
 it('rejects cross-tenant parent collision without creating leg',async()=>{
  await pool.query("INSERT INTO call_records(call_uuid,tenant_id,direction,from_number,to_number,started_at) VALUES($1,20,'inbound','','',now())",[id]);expect(await persistRouteCdr(pool,id,fields)).toBe(false);expect((await pool.query('SELECT * FROM call_legs')).rows).toHaveLength(0);
 });
 it('keeps the actual call-time participant after extension reassignment and denies the new assignee',async()=>{
  await pool.query('DELETE FROM phone11_recording_routes WHERE channel_uuid=$1',[id]);
  await pool.query(`INSERT INTO phone11_recording_routes(channel_uuid,tenant_id,extension_id,owner_user_id,sip_call_id,direction,number)
   VALUES($1,10,11,2,'exact-sip','inbound','+66800000000')`,[id]);
  expect(await persistRouteCdr(pool,id,fields)).toBe(true);
  await pool.query('DELETE FROM user_extensions WHERE user_id=2 AND extension_id=11');
  await pool.query('INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES(3,11,true)');
  await pool.query('UPDATE extensions SET user_id=3 WHERE id=11');
  const stored=(await pool.query('SELECT caller_user_id,callee_user_id FROM call_records WHERE call_uuid=$1',[id])).rows[0];
  expect(stored).toEqual({caller_user_id:null,callee_user_id:2});
  expect((await pool.query('SELECT id FROM call_records WHERE tenant_id=10 AND (caller_user_id=$1 OR callee_user_id=$1)',[2])).rows).toHaveLength(1);
  expect((await pool.query('SELECT id FROM call_records WHERE tenant_id=10 AND (caller_user_id=$1 OR callee_user_id=$1)',[3])).rows).toHaveLength(0);
  await expect(pool.query('UPDATE phone11_recording_routes SET owner_user_id=3 WHERE channel_uuid=$1',[id])).rejects.toMatchObject({code:'23514'});
 });
});
