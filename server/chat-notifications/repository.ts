import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTransaction } from '../pbx/db';
import { authorizeWorkspace } from '../chat/service';

type Transaction = typeof withTransaction;
export const chatNotificationsEnabled = () => process.env.PHONE11_CHAT_NOTIFICATIONS_ENABLED === '1';
export interface ChatDeviceInput { tenantId:number; deviceId:string; token:string; bundleId:string; environment:'production'|'sandbox'; }
export interface ChatDelivery { id:string; revision:string; token:string; bundleId:string; environment:'production'|'sandbox'; registeredAt:number; registeredVersion:string; expiresAt:number; }
const active = `JOIN phone11_auth_session a ON a.id=d.session_id AND a."expiresAt">clock_timestamp()
 JOIN phone11_auth_identity ai ON ai.auth_user_id=a."userId" AND ai.legacy_user_id=d.user_id AND ai.disabled_at IS NULL
 JOIN tenants t ON t.id=d.tenant_id AND t.status='active'`;
const assigned = `EXISTS(SELECT 1 FROM user_extensions ue JOIN extensions e ON e.id=ue.extension_id
 WHERE ue.user_id=d.user_id AND e.tenant_id=d.tenant_id AND e.status='active' AND e.deleted_at IS NULL)`;
const authorized = `${active}
 JOIN phone11_chat_messages msg ON msg.id=o.message_id AND msg.tenant_id=d.tenant_id
 JOIN phone11_chat_members m ON m.conversation_id=msg.conversation_id AND m.tenant_id=d.tenant_id AND m.user_id=d.user_id`;
const valid = `d.revision=o.device_revision AND o.expires_at>clock_timestamp() AND ${assigned}`;
/** Runs inside the message transaction. Idempotent by committed message/device;
 * provider I/O is always later, so it cannot change a successful send response. */
export async function enqueueChatNotifications(db:PoolClient,messageId:string) {
 await db.query("SET LOCAL statement_timeout = '3000ms'");
 await db.query("SET LOCAL lock_timeout = '2000ms'");
 await db.query(`INSERT INTO phone11_chat_notification_outbox(id,device_id,device_revision,message_id)
  SELECT gen_random_uuid(),d.id,d.revision,msg.id FROM phone11_chat_messages msg
  JOIN phone11_chat_members m ON m.tenant_id=msg.tenant_id AND m.conversation_id=msg.conversation_id AND m.user_id<>msg.sender_id
  JOIN phone11_chat_notification_devices d ON d.user_id=m.user_id AND d.tenant_id=m.tenant_id ${active}
  WHERE msg.id=$1 AND msg.sequence>m.last_read_sequence AND ${assigned}
  ON CONFLICT(device_id,message_id) DO NOTHING`,[messageId]);
}
export function createChatNotificationRepository(transaction:Transaction=withTransaction) {
 const bounded:Transaction=fn=>transaction(async db=>{
  await db.query("SET LOCAL statement_timeout = '3000ms'");
  await db.query("SET LOCAL lock_timeout = '2000ms'");
  return fn(db);
 });
 return {
  async register(userId:number,sessionId:string,input:ChatDeviceInput) {
   return bounded(async db=>{
    await authorizeWorkspace(db,userId,input.tenantId);
    const auth=await db.query(`SELECT a.id FROM phone11_auth_session a JOIN phone11_auth_identity ai
      ON ai.auth_user_id=a."userId" AND ai.legacy_user_id=$2 AND ai.disabled_at IS NULL
      WHERE a.id=$1 AND a."expiresAt">clock_timestamp() FOR SHARE OF a,ai`,[sessionId,userId]);
    if(auth.rows.length!==1)throw new Error('Notification session unavailable');
    const hash=createHash('sha256').update(input.token.toLowerCase()).digest('hex');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`chat-apns:${input.bundleId}:${input.environment}:${hash}`]);
    await db.query('SELECT pg_advisory_xact_lock(731104,$1)',[userId]);
    // Retired/remapped identities are already ineligible for delivery. They must
    // not consume all device slots when the owner signs in through recovery.
    await db.query(`DELETE FROM phone11_chat_notification_devices d WHERE user_id=$1 AND NOT EXISTS(
      SELECT 1 FROM phone11_auth_session a JOIN phone11_auth_identity ai ON ai.auth_user_id=a."userId"
      AND ai.legacy_user_id=d.user_id AND ai.disabled_at IS NULL
      WHERE a.id=d.session_id AND a."expiresAt">clock_timestamp())`,[userId]);
    const count=await db.query(`SELECT count(*)::integer n FROM phone11_chat_notification_devices WHERE user_id=$1 AND NOT(tenant_id=$2 AND device_id=$3)`,[userId,input.tenantId,input.deviceId]);
    if(count.rows[0].n>=10)throw new Error('Too many notification devices');
    // Authenticated account switch removes previous owner/session bindings before
    // reusing the provider token; old outbox events cascade and cannot transfer.
    await db.query(`DELETE FROM phone11_chat_notification_devices WHERE bundle_id=$1 AND environment=$2 AND token_hash=$3
      AND NOT(user_id=$4 AND tenant_id=$5 AND device_id=$6 AND session_id=$7)`,[input.bundleId,input.environment,hash,userId,input.tenantId,input.deviceId,sessionId]);
    await db.query(`INSERT INTO phone11_chat_notification_devices(id,session_id,user_id,tenant_id,device_id,token,token_hash,bundle_id,environment,revision)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,tenant_id,device_id) DO UPDATE SET
      session_id=EXCLUDED.session_id,token=EXCLUDED.token,token_hash=EXCLUDED.token_hash,bundle_id=EXCLUDED.bundle_id,environment=EXCLUDED.environment,
      revision=CASE WHEN phone11_chat_notification_devices.session_id=EXCLUDED.session_id AND phone11_chat_notification_devices.token_hash=EXCLUDED.token_hash
        AND phone11_chat_notification_devices.bundle_id=EXCLUDED.bundle_id AND phone11_chat_notification_devices.environment=EXCLUDED.environment
        THEN phone11_chat_notification_devices.revision ELSE EXCLUDED.revision END,registered_at=clock_timestamp() RETURNING id`,
      [randomUUID(),sessionId,userId,input.tenantId,input.deviceId,input.token.toLowerCase(),hash,input.bundleId,input.environment,randomUUID()]);
    return {registered:true as const};
   });
  },
  async unregister(userId:number,sessionId:string,deviceId:string) {
   await bounded(db=>db.query('DELETE FROM phone11_chat_notification_devices WHERE user_id=$1 AND session_id=$2 AND device_id=$3',[userId,sessionId,deviceId]));
  },
  async claim():Promise<ChatDelivery|null> {
   return bounded(async db=>{
    // Lock and mark before network. A crash/uncertain response is intentionally
    // not replayed: attempted rows are never reclaimed by another worker.
    const rows=await db.query(`SELECT o.id,d.revision,d.token,d.bundle_id,d.environment,d.registered_at,d.registered_at::text AS registered_version,o.expires_at
      FROM phone11_chat_notification_outbox o JOIN phone11_chat_notification_devices d ON d.id=o.device_id ${authorized}
      WHERE o.state='pending' AND ${valid} AND msg.sequence>m.last_read_sequence
      ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);
    const r=rows.rows[0];if(!r)return null;
    await db.query(`UPDATE phone11_chat_notification_outbox SET state='attempted',attempted_at=clock_timestamp() WHERE id=$1`,[r.id]);
    return {id:r.id,revision:r.revision,token:r.token,bundleId:r.bundle_id,environment:r.environment,registeredAt:new Date(r.registered_at).getTime(),registeredVersion:r.registered_version,expiresAt:new Date(r.expires_at).getTime()};
   });
  },
  async current(delivery:ChatDelivery) {
   return bounded(async db=>(await db.query(`SELECT 1 FROM phone11_chat_notification_outbox o
     JOIN phone11_chat_notification_devices d ON d.id=o.device_id ${authorized}
     WHERE o.id=$1 AND d.revision=$2 AND o.state='attempted' AND ${valid} AND msg.sequence>m.last_read_sequence`,[delivery.id,delivery.revision])).rows.length===1);
  },
  async finish(delivery:ChatDelivery,accepted:boolean) {
   await bounded(db=>db.query(`UPDATE phone11_chat_notification_outbox o SET state=$2 FROM phone11_chat_notification_devices d
    WHERE o.id=$1 AND o.device_id=d.id AND d.revision=$3 AND o.state='attempted'`,[delivery.id,accepted?'accepted':'unavailable',delivery.revision]));
  },
  async removeInvalid(delivery:ChatDelivery,invalidatedAt?:number) {
   await bounded(db=>db.query(`DELETE FROM phone11_chat_notification_devices d USING phone11_chat_notification_outbox o
    WHERE o.id=$1 AND o.device_id=d.id AND d.revision=$2 AND d.registered_at=$3::timestamptz
    AND ($4::double precision IS NULL OR d.registered_at<=to_timestamp($4/1000.0))`,[delivery.id,delivery.revision,delivery.registeredVersion,invalidatedAt??null]));
  },
  async resolve(userId:number,sessionId:string,eventId:string) {
   return bounded(async db=>{
    const r=await db.query(`SELECT msg.conversation_id,d.tenant_id FROM phone11_chat_notification_outbox o
      JOIN phone11_chat_notification_devices d ON d.id=o.device_id ${authorized}
      WHERE o.id=$1 AND d.user_id=$2 AND d.session_id=$3 AND ${valid} AND o.state IN ('attempted','accepted')`,[eventId,userId,sessionId]);
    return r.rows.length===1?{tenantId:Number(r.rows[0].tenant_id),conversationId:r.rows[0].conversation_id}:null;
   });
  },
  async prune() {
   await bounded(db=>db.query(`DELETE FROM phone11_chat_notification_outbox WHERE expires_at<clock_timestamp()-INTERVAL '1 day'`));
  },
 };
}
export const chatNotificationRepository=createChatNotificationRepository();
