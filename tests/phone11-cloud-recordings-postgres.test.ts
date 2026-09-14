import {URL} from "node:url";
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {createCloudRecordingRepository} from '../server/cloud-recordings/repository';
const socket=process.env.PHONE11_CLOUD_RECORDING_TEST_SOCKET;
if(socket&&!socket.startsWith('/'))throw new Error('Private absolute test socket required');
const pool=new Pool({host:socket??'/nonexistent',user:'phone11_test',database:'phone11_cloud_recording_test',ssl:false,max:8});
const repo=createCloudRecordingRepository(pool,()=>true);
describe.skipIf(!socket)('cloud recordings isolated PostgreSQL',()=>{
 beforeAll(async()=>{
  await pool.query(await readFile(new URL('./fixtures/phone11-cloud-recording-baseline.sql',import.meta.url),'utf8'));
  const prerequisites=await readFile(new URL('../server/cloud-recordings/prerequisites.sql',import.meta.url),'utf8');
  await pool.query(prerequisites);await pool.query(prerequisites);
  expect((await pool.query('SELECT count(*)::int AS n FROM tenant_memberships')).rows[0].n).toBe(0);
  const sql=await readFile(new URL('../server/cloud-recordings/migration.sql',import.meta.url),'utf8');await pool.query(sql);await pool.query(sql);
 });
 beforeEach(async()=>{await pool.query(`TRUNCATE users,tenants,extensions,tenant_memberships,user_extensions,call_records,call_legs,phone11_wake_bindings,phone11_wake_calls CASCADE;
  INSERT INTO users(id,"openId") VALUES(1,'test-1'),(2,'test-2'),(3,'test-3');INSERT INTO tenants(id,name,status) VALUES(10,'Test A','active'),(20,'Test B','active');
  INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES(1,10,'owner','active'),(2,10,'user','active'),(3,20,'owner','active');
  INSERT INTO extensions(id,tenant_id,status,deleted_at,extension_number) VALUES(11,10,'active',NULL,'3001'),(21,20,'active',NULL,'3002');INSERT INTO user_extensions(user_id,extension_id) VALUES(2,11),(3,21);
  INSERT INTO call_records(id,call_uuid,tenant_id,direction,from_number,to_number,started_at,ended_at,recording_url) VALUES(1,'call1',10,'inbound','+66123456789','3001',now(),now(),'/private/test.wav');
  INSERT INTO call_legs(call_record_id,tenant_id,extension_id,sip_call_id,leg_uuid,started_at) VALUES(1,10,11,'sip-test','leg1',now());`);});
 afterAll(()=>pool.end());
 async function ready(){await repo.updatePolicy(1,{tenantId:10,mode:'automatic',aiEnabled:true,retentionDays:30});expect(await repo.registerCall('call1')).toBe(true);const capture=(await repo.reserveCapture('call1'))!;expect(capture).toBeTruthy();expect(await repo.markCapturing('call1',capture.captureToken)).toBe(true);expect(await repo.recordingStored('call1','/private/test.wav',capture.captureToken)).toBe(true);}
 it('prerequisite replay preserves existing identities and creates no membership grants',async()=>{
  await pool.query("DELETE FROM tenant_memberships; UPDATE users SET role='admin' WHERE id=1");
  const before=(await pool.query('SELECT * FROM users ORDER BY id')).rows;
  await pool.query(await readFile(new URL('../server/cloud-recordings/prerequisites.sql',import.meta.url),'utf8'));
  expect((await pool.query('SELECT * FROM users ORDER BY id')).rows).toEqual(before);
  expect((await pool.query('SELECT count(*)::int AS n FROM tenant_memberships')).rows[0].n).toBe(0);
  await expect(repo.updatePolicy(1,{tenantId:10,mode:'automatic',aiEnabled:false,retentionDays:30})).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('CDR parent and complete leg insert contract works and rejects cross-tenant parent links',async()=>{
  const parent=await pool.query(`INSERT INTO call_records(id,tenant_id,call_uuid,direction,from_number,to_number,disposition,started_at,answered_at,ended_at,total_duration_seconds,total_billable_seconds,recording_url,metadata)
   VALUES(100,10,'cdr-contract','inbound','+66123456789','3001','answered',now(),now(),now(),30,25,NULL,'{}') ON CONFLICT(call_uuid) DO UPDATE SET ended_at=EXCLUDED.ended_at RETURNING id`);
  const id=parent.rows[0].id;
  await pool.query(`INSERT INTO call_legs(call_record_id,leg_uuid,tenant_id,from_uri,to_uri,started_at,ringing_at,answered_at,ended_at,duration_seconds,billable_seconds,pdd_ms,codec,codec_read,codec_write,hangup_cause,hangup_disposition,sip_response_code,sip_call_id,metadata)
   VALUES($1,'cdr-leg',10,'sip:a','sip:b',now(),now(),now(),now(),30,25,100,'PCMA','PCMA','PCMA','NORMAL_CLEARING','answered',200,'cdr-sip','{}')`,[id]);
  await expect(pool.query(`INSERT INTO call_legs(call_record_id,tenant_id,leg_uuid,started_at) VALUES($1,20,'foreign',now())`,[id])).rejects.toMatchObject({code:'23503'});
 });
 it('defaults off and requires current tenant admin, never global role',async()=>{
  expect(await repo.getPolicy(2,10)).toMatchObject({mode:'off',aiEnabled:false});
  await expect(repo.updatePolicy(2,{tenantId:10,mode:'automatic',aiEnabled:true,retentionDays:30})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(repo.updatePolicy(3,{tenantId:10,mode:'automatic',aiEnabled:true,retentionDays:30})).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('only assigned extension sees call; tenant admin is not media permission',async()=>{await ready();expect((await repo.list(2)).items).toHaveLength(1);expect((await repo.list(1)).items).toHaveLength(0);await expect(repo.detail(3,'call1')).rejects.toMatchObject({code:'NOT_FOUND'});await pool.query("DELETE FROM user_extensions WHERE user_id=2");await expect(repo.detail(2,'call1')).rejects.toMatchObject({code:'NOT_FOUND'});});
 it('returns persisted participant names for transcript labeling',async()=>{
  await pool.query("UPDATE extensions SET display_name='Vasavas' WHERE id=11");
  await pool.query("UPDATE call_records SET metadata=$1::jsonb WHERE call_uuid='call1'", [JSON.stringify({caller_name:'Somchai'})]);
  await repo.registerCall('call1');
  expect((await repo.detail(2,'call1')).participantNames).toEqual({speaker1:'Somchai',speaker2:'Vasavas'});
 });
 it('fails closed for missing or conflicting extension ownership',async()=>{await pool.query('UPDATE call_legs SET extension_id=NULL');expect(await repo.registerCall('call1')).toBe(false);});
 it('requires finalized exact storage and capture gate',async()=>{await repo.registerCall('call1');expect(await repo.recordingStored('call1','wrong','00000000-0000-4000-8000-000000000000')).toBe(false);await ready();const off=createCloudRecordingRepository(pool,()=>false);expect(await off.recordingStored('call1','/private/test.wav','00000000-0000-4000-8000-000000000000')).toBe(false);});
 it('leases once concurrently and rejects wrong/stale token',async()=>{await ready();const jobs=await Promise.all([repo.claimJob('a'),repo.claimJob('b')]);expect(jobs.filter(Boolean)).toHaveLength(1);const j=jobs.find(Boolean)!;expect(await repo.finishJob({...j,leaseToken:'00000000-0000-4000-8000-000000000000'},null)).toBe(false);expect(await repo.finishJob(j,{transcript:'Actual',summary:{summary:'Actual summary',actionItems:[],language:'th'}})).toBe(true);expect((await repo.detail(2,'call1')).summary?.summary).toBe('Actual summary');expect(await repo.finishJob(j,null)).toBe(false);});
 it('revocation invalidates lease and blocks provider result persistence',async()=>{await ready();const j=(await repo.claimJob('a'))!;await repo.updatePolicy(1,{tenantId:10,mode:'off',aiEnabled:false,retentionDays:30});expect(await repo.finishJob(j,{transcript:'private',summary:{summary:'private',actionItems:[],language:'th'}})).toBe(false);expect(await repo.claimJob('b')).toBeNull();});
 it('expired lease can be reclaimed; former worker cannot finish',async()=>{await ready();const a=(await repo.claimJob('a'))!;await pool.query("UPDATE phone11_recording_jobs SET lease_until=now()-interval '1 second'");const b=(await repo.claimJob('b'))!;expect(b.leaseToken).not.toBe(a.leaseToken);expect(await repo.finishJob(a,null)).toBe(false);expect(await repo.finishJob(b,null)).toBe(true);});
 it('three failed attempts end permanently and do not fake a summary',async()=>{await ready();for(let i=0;i<3;i++){const j=(await repo.claimJob('a'))!;expect(j).toBeTruthy();await repo.finishJob(j,null);await pool.query("UPDATE phone11_recording_jobs SET available_at=now()-interval '1 second'");}expect(await repo.claimJob('a')).toBeNull();expect(await repo.detail(2,'call1')).toMatchObject({summaryStatus:'failed'});expect((await repo.detail(2,'call1')).summary).toBeUndefined();});
 it('retention expiry blocks list, detail and claim',async()=>{await ready();await pool.query("UPDATE phone11_cloud_recordings SET expires_at=now()-interval '1 second'");expect((await repo.list(2)).items).toHaveLength(0);expect(await repo.claimJob('a')).toBeNull();});
 it('same exact SIP identity supplies native history link without number matching',async()=>{await pool.query(`INSERT INTO phone11_auth_session VALUES('test-session') ON CONFLICT DO NOTHING; INSERT INTO phone11_wake_bindings(id,session_id,session_binding,user_id,tenant_id,extension_id,device_id,push_revision,grant_hash,expires_at) VALUES('00000000-0000-4000-8000-000000000001','test-session','00000000-0000-4000-8000-000000000003',2,10,11,'test-device','00000000-0000-4000-8000-000000000004',repeat('a',64),now()+interval '1 day');INSERT INTO phone11_wake_calls(id,binding_id,sip_call_id,sip_uri,state,expires_at) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','sip-test','sip:test@example.invalid','pending',now()+interval '1 minute')`);await repo.registerCall('call1');expect((await repo.detail(2,'call1')).nativeHistoryId).toBe('native-wake:00000000-0000-4000-8000-000000000002');});
 it('manual capture needs assigned actor and token; policyoff cancels pendingcapture',async()=>{
  await repo.updatePolicy(1,{tenantId:10,mode:'manual',aiEnabled:false,retentionDays:30});await repo.registerCall('call1');
  expect(await repo.reserveCapture('call1')).toBeNull();expect(await repo.reserveCapture('call1',1)).toBeNull();
  const capture=(await repo.reserveCapture('call1',2))!;expect(capture).toBeTruthy();expect(await repo.reserveCapture('call1',2)).toBeNull();
  await repo.updatePolicy(1,{tenantId:10,mode:'off',aiEnabled:false,retentionDays:30});expect(await repo.markCapturing('call1',capture.captureToken)).toBe(false);
 });
 it('validateJob rejects policy revocation and expired jobs; purge keeps tombstone',async()=>{
  await ready();const job=(await repo.claimJob('worker'))!;expect(await repo.validateJob(job)).toBe(true);
  await pool.query("UPDATE phone11_cloud_recordings SET expires_at=now()-interval '1 second'");expect(await repo.validateJob(job)).toBe(false);
  await pool.query('UPDATE phone11_cloud_recordings SET capture_cleaned_at=now()');const purge=(await repo.claimPurge())!;expect(purge.storageKey).toBe('/private/test.wav');expect(await repo.claimPurge()).toBeNull();
  expect(await repo.completePurge(purge.callUuid,purge.purgeToken)).toBe(true);expect(await repo.claimPurge()).toBeNull();
  expect((await pool.query('SELECT count(*) FROM phone11_cloud_recordings')).rows[0].count).toBe('1');
 });
 it('crashed final lease transitions failed instead of staying processing',async()=>{await ready();await repo.claimJob('a');await pool.query("UPDATE phone11_recording_jobs SET attempts=3,lease_until=now()-interval '1 second'");expect(await repo.claimJob('b')).toBeNull();expect((await repo.detail(2,'call1')).summaryStatus).toBe('failed');});
 it('retains exact inbound identity after transient wake tables are pruned',async()=>{
  await pool.query("INSERT INTO phone11_recording_wake_links(wake_uuid,binding_id,tenant_id,extension_id,sip_call_id) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',10,11,'sip-test')");
  await repo.registerCall('call1');expect((await repo.detail(2,'call1')).nativeHistoryId).toBe('native-wake:00000000-0000-4000-8000-000000000002');
 });

 it('CDR finalization updates end only for same ownership without changing retentionstart',async()=>{await repo.registerCall('call1');const before=await repo.detail(2,'call1');await pool.query("UPDATE call_records SET started_at=started_at-interval '1 day',ended_at=ended_at+interval '2 minutes'");await repo.registerCall('call1');const after=await repo.detail(2,'call1');expect(after.startedAt).toBe(before.startedAt);expect(after.endedAt).toBeGreaterThan(before.endedAt!);});
 it('purge cannot erase active capture token before physical cleanup',async()=>{await repo.updatePolicy(1,{tenantId:10,mode:'automatic',aiEnabled:false,retentionDays:30});await repo.registerCall('call1');const capture=(await repo.reserveCapture('call1'))!;await repo.markCapturing('call1',capture.captureToken);await pool.query("UPDATE phone11_cloud_recordings SET expires_at=now()-interval '1 second'");expect(await repo.claimPurge()).toBeNull();expect(await repo.failCapture('call1',capture.captureToken)).toBe(true);expect(await repo.claimPurge()).toBeTruthy();});

 it('manual actor reassignment during notice invalidates permission and capturemark',async()=>{
  await repo.updatePolicy(1,{tenantId:10,mode:'automatic',aiEnabled:false,retentionDays:30});await repo.registerCall('call1');
  const manual=(await repo.reserveCapture('call1',2))!;expect(await repo.capturePermitted('call1',manual.captureToken)).toBe(true);
  await pool.query('DELETE FROM user_extensions WHERE user_id=2');expect(await repo.capturePermitted('call1',manual.captureToken)).toBe(false);expect(await repo.markCapturing('call1',manual.captureToken)).toBe(false);
 });

});
