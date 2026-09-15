import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
const db = vi.hoisted(() => ({ pool: null as any }));
vi.mock('../server/pbx/db', () => ({
 query: (sql: string, values?: unknown[]) => db.pool.query(sql, values),
 getPool: () => db.pool,
 withTransaction: async (fn: any) => { const c=await db.pool.connect(); try { await c.query('BEGIN'); const r=await fn(c); await c.query('COMMIT'); return r; } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } },
}));
vi.mock('../server/cloud-recordings/repository', () => ({ createCloudRecordingRepository: () => ({ registerCall: async () => {} }) }));
import { processCdr } from '../server/pbx/cdr-processor';
import { persistRouteCdr } from '../server/cloud-recordings/route-cdr';
import { parseCdrBody, resolveCdrTenant } from '../server/pbx/cdr-input';
const socket=process.env.PHONE11_CDR_REVIEW_SOCKET;
const schema='phone11_cdr_review_'+randomUUID().replaceAll('-','');
const uuid='10000000-0000-4000-8000-000000000001';
const vars={uuid,sip_call_id:'exact@sip',tenant_id:'10',start_epoch:'1700000000',answer_epoch:'1700000010',end_epoch:'1700000020',billsec:'10',hangup_cause:'NORMAL_CLEARING',call_direction:'inbound'};
const snapshot={'Unique-ID':uuid,variable_sip_call_id:'exact@sip','Caller-Channel-Created-Time':'1700000000000000'};
describe.skipIf(!socket)('native CDR isolated PostgreSQL',()=>{
 beforeAll(async()=>{
  db.pool=new Pool({host:socket,port:Number(process.env.PHONE11_CDR_REVIEW_PORT??55437),user:'phone11_test',database:'phone11_cloud_recording_test',ssl:false,options:`-c search_path=${schema}`});
  await db.pool.query(`CREATE SCHEMA ${schema}`);
  for(const file of ['tests/fixtures/phone11-cloud-recording-baseline.sql','server/cloud-recordings/prerequisites.sql','server/cloud-recordings/migration.sql']) await db.pool.query(await readFile(file,'utf8'));
  await db.pool.query('CREATE TABLE call_events(id serial,tenant_id integer,call_record_id integer,call_leg_id integer,event_type text,event_timestamp timestamptz,metadata jsonb)');
  vi.stubEnv('PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED','true');
 });
 beforeEach(async()=>{
  await db.pool.query("TRUNCATE users,tenants,extensions,call_records,call_events CASCADE; INSERT INTO tenants(id,name,status) VALUES(10,'A','active'),(20,'B','active'); INSERT INTO extensions(id,tenant_id,extension_number,status) VALUES(11,10,'3001','active')");
  await db.pool.query("INSERT INTO phone11_recording_routes(channel_uuid,tenant_id,extension_id,sip_call_id,direction,number) VALUES($1,10,11,'exact@sip','inbound','+66800000000')",[uuid]);
 });
 afterAll(async()=>{if(db.pool){await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.pool.end();}vi.unstubAllEnvs();});
 it('completes the existing snapshot without replacing cloud storage',async()=>{
  await persistRouteCdr(db.pool,uuid,snapshot);
  await db.pool.query("UPDATE call_records SET recording_url='/private/proof.wav'");
  await processCdr({variables:vars});
  const row=(await db.pool.query('SELECT * FROM call_records')).rows[0];
  expect(row.answered_at).toEqual(new Date(1700000010000));expect(row.ended_at).toEqual(new Date(1700000020000));expect(row.total_billable_seconds).toBe(10);expect(row.recording_url).toBe('/private/proof.wav');expect(row.metadata.completion).toBe('complete');
  const legs=(await db.pool.query('SELECT * FROM call_legs')).rows;
  expect(legs).toHaveLength(1);expect(legs[0].ended_at).toEqual(new Date(1700000020000));
 });
 it('keeps one parent and one leg under concurrent native webhook retries',async()=>{
  const results=await Promise.all([processCdr({variables:vars}),processCdr({variables:vars}),processCdr({variables:vars})]);
  expect(new Set(results.map(r=>r.callLegId)).size).toBe(1);
  expect((await db.pool.query('SELECT * FROM call_records')).rows).toHaveLength(1);
  expect((await db.pool.query('SELECT * FROM call_legs')).rows).toHaveLength(1);
  expect((await db.pool.query('SELECT * FROM call_events')).rows).toHaveLength(3);
 });
 it('rejects cross-tenant parent collision without changing parent or adding leg',async()=>{
  await db.pool.query("INSERT INTO call_records(call_uuid,tenant_id,direction,from_number,to_number,started_at,metadata) VALUES($1,20,'inbound','','',now(),'{\"owner\":\"foreign\"}')",[uuid]);
  const before=(await db.pool.query('SELECT * FROM call_records')).rows;
  await expect(processCdr({variables:vars})).rejects.toThrow();
  expect((await db.pool.query('SELECT * FROM call_records')).rows).toEqual(before);expect((await db.pool.query('SELECT * FROM call_legs')).rows).toHaveLength(0);
 });
 it('rejects a known own channel with conflicting SIP ID',async()=>{
  const cdr=parseCdrBody({variables:{...vars,sip_call_id:'different@sip'}});
  await expect(resolveCdrTenant(cdr)).rejects.toThrow();
  await expect(processCdr(cdr)).rejects.toThrow();
  expect((await db.pool.query('SELECT * FROM call_records')).rows).toHaveLength(0);
 });
 it('rejects ambiguous legacy legs without altering their records',async()=>{
  await persistRouteCdr(db.pool,uuid,snapshot);
  await db.pool.query('INSERT INTO call_legs(call_record_id,tenant_id,extension_id,leg_uuid,sip_call_id,started_at) SELECT call_record_id,tenant_id,extension_id,leg_uuid,sip_call_id,started_at FROM call_legs');
  const parent=(await db.pool.query('SELECT * FROM call_records')).rows;
  const legs=(await db.pool.query('SELECT * FROM call_legs ORDER BY id')).rows;
  await expect(processCdr({variables:vars})).rejects.toThrow('Ambiguous');
  expect((await db.pool.query('SELECT * FROM call_records')).rows).toEqual(parent);
  expect((await db.pool.query('SELECT * FROM call_legs ORDER BY id')).rows).toEqual(legs);
 });
 it('rejects partial replay without erasing completed facts or cloud storage',async()=>{
  await processCdr({variables:vars});
  await db.pool.query("UPDATE call_records SET recording_url='/private/proof.wav'");
  const parent=(await db.pool.query('SELECT * FROM call_records')).rows;
  const legs=(await db.pool.query('SELECT * FROM call_legs')).rows;
  await expect(processCdr({variables:{uuid,tenant_id:'10',sip_call_id:'exact@sip'}})).rejects.toThrow();
  expect((await db.pool.query('SELECT * FROM call_records')).rows).toEqual(parent);
  expect((await db.pool.query('SELECT * FROM call_legs')).rows).toEqual(legs);
 });
 it('does not use an originating parent UUID as tenant ownership',async()=>{
  const cdr=parseCdrBody({variables:{uuid:'20000000-0000-4000-8000-000000000002',sip_call_id:'unknown@sip',originating_leg_uuid:uuid}});
  await expect(resolveCdrTenant(cdr)).rejects.toThrow();
 });
});
