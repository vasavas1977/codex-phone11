import {URL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {createChatNotificationRepository,enqueueChatNotifications} from '../server/chat-notifications/repository';
import {createChatNotificationDispatcher} from '../server/chat-notifications/dispatcher';
import {createChatService} from '../server/chat/service';
import {PushProviderError} from '../server/push/apns';
const connectionString=process.env.PHONE11_CHAT_NOTIFICATION_TEST_DATABASE_URL;
const socket=process.env.PHONE11_CHAT_NOTIFICATION_TEST_SOCKET;
if(connectionString){const u=new URL(connectionString);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!u.port||u.pathname!=='/phone11_chat_notification_test'||u.search||u.hash)throw new Error('Dedicated isolated notification test DB required');}
if(socket&&!socket.startsWith('/'))throw new Error('Private absolute test socket required');
const pool=new Pool(socket?{host:socket,user:'phone11_test',database:'phone11_chat_notification_test',ssl:false,max:12}:{connectionString,ssl:false,max:12});
async function tx<T>(fn:(db:PoolClient)=>Promise<T>){const db=await pool.connect();try{await db.query('BEGIN');const v=await fn(db);await db.query('COMMIT');return v;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
const repo=createChatNotificationRepository(tx),chat=createChatService(tx);
const device={tenantId:10,deviceId:'00000000-0000-4000-8000-000000000009',token:'a'.repeat(64),bundleId:'test.phone11',environment:'production' as const};
let conversation:string;
async function message(){return chat.send(1,10,conversation,randomUUID(),'Private test message');}
async function count(){return Number((await pool.query('SELECT count(*) n FROM phone11_chat_notification_outbox')).rows[0].n);}
describe.skipIf(!socket&&!connectionString)('ordinary notifications real isolated PostgreSQL',()=>{
 beforeAll(async()=>{
  await pool.query(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE tenants(id INTEGER PRIMARY KEY,name TEXT,status TEXT);
   CREATE TABLE extensions(id INTEGER PRIMARY KEY,tenant_id INTEGER REFERENCES tenants(id),status TEXT,deleted_at TIMESTAMPTZ,extension_number TEXT);
   CREATE TABLE user_extensions(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id),extension_id INTEGER REFERENCES extensions(id),is_primary BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW());
   CREATE TABLE phone11_auth_session(id TEXT PRIMARY KEY,"userId" TEXT,"expiresAt" TIMESTAMPTZ);
   CREATE TABLE phone11_auth_identity(auth_user_id TEXT PRIMARY KEY,legacy_user_id INTEGER REFERENCES users(id),disabled_at TIMESTAMPTZ);`);
  await pool.query(await readFile(new URL('../server/chat/migration.sql',import.meta.url),'utf8'));
  const sql=await readFile(new URL('../server/chat-notifications/migration.sql',import.meta.url),'utf8');await pool.query(sql);await pool.query(sql);
 });
 beforeEach(async()=>{
  vi.stubEnv('PHONE11_CHAT_NOTIFICATIONS_ENABLED','1');
  await pool.query(`TRUNCATE users,tenants,extensions,user_extensions,phone11_auth_session,phone11_auth_identity,phone11_chat_conversations CASCADE;
   INSERT INTO users VALUES(1,'sender'),(2,'recipient'),(3,'outsider');INSERT INTO tenants VALUES(10,'first','active'),(20,'other','active');
   INSERT INTO extensions VALUES(1,10,'active',NULL,'1001'),(2,10,'active',NULL,'1002'),(3,20,'active',NULL,'2001');
   INSERT INTO user_extensions(user_id,extension_id)VALUES(1,1),(2,2),(3,3);
   INSERT INTO phone11_auth_identity VALUES('auth1',1,NULL),('auth2',2,NULL),('auth3',3,NULL);
   INSERT INTO phone11_auth_session VALUES('s1','auth1',NOW()+INTERVAL '1 day'),('s2','auth2',NOW()+INTERVAL '1 day'),('s3','auth3',NOW()+INTERVAL '1 day');`);
  conversation=(await chat.create(1,10,'direct','test',[2])).id;
 });
 afterAll(async()=>{vi.unstubAllEnvs();await pool.end();});
 it('registers separate APNs devices and rejects foreign session/tenant',async()=>{
  await repo.register(2,'s2',device);await expect(repo.register(2,'s3',device)).rejects.toThrow();await expect(repo.register(2,'s2',{...device,tenantId:20})).rejects.toThrow();
  expect((await pool.query('SELECT count(*) n FROM phone11_chat_notification_devices')).rows[0].n).toBe('1');
 });
 it('enqueues only once for concurrent same-message retries and never notifies sender',async()=>{
  await repo.register(2,'s2',device);await repo.register(1,'s1',{...device,deviceId:randomUUID(),token:'b'.repeat(64)});
  const id=randomUUID();const rows=await Promise.all([chat.send(1,10,conversation,id,'same'),chat.send(1,10,conversation,id,'same')]);expect(rows[0].id).toBe(rows[1].id);expect(await count()).toBe(1);
  await expect(chat.send(1,10,conversation,id,'different')).rejects.toThrow();expect(await count()).toBe(1);
 });
 it('outbox and message roll back together on transactional failure',async()=>{
  await repo.register(2,'s2',device);
  await expect(tx(async db=>{const id=randomUUID();await db.query(`INSERT INTO phone11_chat_messages(id,tenant_id,conversation_id,sender_id,client_id,content) VALUES($1,10,$2,1,$3,'rollback')`,[id,conversation,randomUUID()]);await enqueueChatNotifications(db,id);throw new Error('abort');})).rejects.toThrow('abort');
  expect(await count()).toBe(0);expect((await pool.query('SELECT count(*) n FROM phone11_chat_messages')).rows[0].n).toBe('0');
 });
 it('gate off performs ordinary chat commit with no notification rows',async()=>{vi.stubEnv('PHONE11_CHAT_NOTIFICATIONS_ENABLED','0');await repo.register(2,'s2',device);await message();expect(await count()).toBe(0);});
 it('claims once across concurrent workers, never reclaims attempted rows',async()=>{await repo.register(2,'s2',device);await message();const claims=await Promise.all(Array.from({length:8},()=>repo.claim()));expect(claims.filter(Boolean)).toHaveLength(1);expect(await repo.claim()).toBeNull();});
 it.each(["DELETE FROM phone11_auth_session WHERE id='s2'","UPDATE phone11_auth_session SET \"expiresAt\"=NOW()-INTERVAL '1 second' WHERE id='s2'","UPDATE phone11_auth_identity SET disabled_at=NOW() WHERE legacy_user_id=2","DELETE FROM user_extensions WHERE user_id=2","DELETE FROM phone11_chat_members WHERE user_id=2","UPDATE tenants SET status='inactive' WHERE id=10"])( 'rechecks dispatch/tap access after revocation: %s',async sql=>{
  await repo.register(2,'s2',device);await message();const claim=(await repo.claim())!;expect(await repo.current(claim)).toBe(true);await pool.query(sql);expect(await repo.current(claim)).toBe(false);expect(await repo.resolve(2,'s2',claim.id)).toBeNull();
 });
 it('tap requires exact recipient and auth session plus unexpired event',async()=>{
  await repo.register(2,'s2',device);await message();const claim=(await repo.claim())!;
  expect(await repo.resolve(2,'s2',claim.id)).toEqual({tenantId:10,conversationId:conversation});expect(await repo.resolve(1,'s1',claim.id)).toBeNull();expect(await repo.resolve(2,'s1',claim.id)).toBeNull();
  await pool.query(`UPDATE phone11_chat_notification_outbox SET expires_at=NOW()-INTERVAL '1 second'`);expect(await repo.resolve(2,'s2',claim.id)).toBeNull();
 });
 it('fresh same-token registration survives delayed old APNs410 with microsecond precision',async()=>{
  await repo.register(2,'s2',device);await message();const claim=(await repo.claim())!;await repo.register(2,'s2',device);
  await repo.removeInvalid(claim,Date.now());expect((await pool.query('SELECT count(*) n FROM phone11_chat_notification_devices')).rows[0].n).toBe('1');
  const fresh=(await pool.query('SELECT registered_at::text v FROM phone11_chat_notification_devices')).rows[0].v;
  await repo.removeInvalid({...claim,registeredVersion:fresh},Date.now()+1000);expect((await pool.query('SELECT count(*) n FROM phone11_chat_notification_devices')).rows[0].n).toBe('0');
 });
 it('provider tuple change invalidates captured delivery even when token/session match',async()=>{
  await repo.register(2,'s2',device);await message();const claim=(await repo.claim())!;await repo.register(2,'s2',{...device,environment:'sandbox'});expect(await repo.current(claim)).toBe(false);
 });
 it('same-owner re-login preserves new registration when old session unregisters/logs out',async()=>{
  await repo.register(2,'s2',device);await message();await pool.query(`INSERT INTO phone11_auth_session VALUES('s-new','auth2',NOW()+INTERVAL '1 day')`);
  await repo.register(2,'s-new',device);await repo.unregister(2,'s2',device.deviceId);await pool.query("DELETE FROM phone11_auth_session WHERE id='s2'");
  expect((await pool.query('SELECT session_id FROM phone11_chat_notification_devices')).rows[0].session_id).toBe('s-new');expect(await count()).toBe(0);
 });
 it('read messages do not dispatch later stale alerts',async()=>{await repo.register(2,'s2',device);const m=await message();await chat.read(2,10,conversation,m.sequence);expect(await repo.claim()).toBeNull();});
 it('uncertain provider acceptance never retries or changes persisted message',async()=>{
  await repo.register(2,'s2',device);const msg=await message();const send=vi.fn(async()=>{throw new PushProviderError('transport');});const dispatch=createChatNotificationDispatcher(repo,send,()=>true);
  expect(await dispatch()).toBe(true);expect(await dispatch()).toBe(false);expect(send).toHaveBeenCalledOnce();expect((await chat.history(1,10,conversation)).messages[0].id).toBe(msg.id);
 });
 it('missing notification migration fails before message commit when enrollment is enabled',async()=>{
  await pool.query('ALTER TABLE phone11_chat_notification_outbox RENAME TO notification_outbox_test_missing');
  try{await expect(message()).rejects.toThrow();expect((await pool.query('SELECT count(*) n FROM phone11_chat_messages')).rows[0].n).toBe('0');}
  finally{await pool.query('ALTER TABLE notification_outbox_test_missing RENAME TO phone11_chat_notification_outbox');}
 });
 it('missing provider cannot undo a committed message or replay an attempted alert',async()=>{
  await repo.register(2,'s2',device);const saved=await message();const send=vi.fn(async()=>{throw new PushProviderError('configuration');});
  const dispatch=createChatNotificationDispatcher(repo,send,()=>true);await dispatch();await dispatch();expect(send).toHaveBeenCalledOnce();
  expect((await chat.history(1,10,conversation)).messages[0].id).toBe(saved.id);
 });
 it('disabled worker does not claim or contact provider',async()=>{await repo.register(2,'s2',device);await message();const send=vi.fn();expect(await createChatNotificationDispatcher(repo,send,()=>false)()).toBe(false);expect(send).not.toHaveBeenCalled();expect((await pool.query('SELECT state FROM phone11_chat_notification_outbox')).rows[0].state).toBe('pending');});
 it('bounded advisory lock contention fails instead of wedging enrollment',async()=>{
  const blocker=await pool.connect();try{await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(731104,2)');const started=Date.now();await expect(repo.register(2,'s2',device)).rejects.toThrow();expect(Date.now()-started).toBeLessThan(4000);}finally{await blocker.query('ROLLBACK');blocker.release();}
 });
});
