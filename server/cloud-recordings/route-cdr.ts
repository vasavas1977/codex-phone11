import type {Pool} from 'pg';
import {hasExactCdrOwnership,ownershipFromTrustedRoute} from '../pbx/cdr-ownership';
/** Only authenticated ESL uuid_dump fields enter this adapter. No public RPC.
 * A live snapshot is not a completed CDR: end, disposition and duration remain
 * unknown. Route ownership and exact SIP identity are checked in one transaction.
 */
export async function persistRouteCdr(db:Pool,channelUuid:string,fields:Record<string,string>):Promise<boolean>{
 const sip=fields.variable_sip_call_id;
 const created=fields['Caller-Channel-Created-Time'];
 const epoch=created&&/^[0-9]{1,16}$/.test(created)?Math.floor(Number(created)/1_000_000):Number(fields.variable_start_epoch);
 if(fields['Unique-ID']!==channelUuid||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channelUuid)||!sip||sip.length>512||!Number.isSafeInteger(epoch)||epoch<=0||epoch>Math.floor(Date.now()/1000)+60)return false;
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  const route=await c.query(`SELECT rr.*,e.extension_number FROM phone11_recording_routes rr
   JOIN extensions e ON e.id=rr.extension_id AND e.tenant_id=rr.tenant_id
   JOIN tenants t ON t.id=rr.tenant_id WHERE rr.channel_uuid=$1 AND rr.sip_call_id=$2
   AND e.status='active' AND e.deleted_at IS NULL AND t.status='active' FOR UPDATE OF rr,e,t`,[channelUuid,sip]);
  if(route.rows.length!==1){await c.query('ROLLBACK');return false;}
  const r=route.rows[0];
  const ownership=ownershipFromTrustedRoute({tenantId:Number(r.tenant_id),extensionId:Number(r.extension_id),userId:r.owner_user_id==null?undefined:Number(r.owner_user_id),direction:r.direction});
  // Never overwrite a completed or independently received CDR.
  await c.query(`INSERT INTO call_records(call_uuid,tenant_id,direction,from_number,to_number,caller_user_id,callee_user_id,started_at,metadata)
   VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),'{"source":"authenticated_esl_snapshot","completion":"unknown"}') ON CONFLICT(call_uuid) DO NOTHING`,
   [channelUuid,r.tenant_id,r.direction,r.direction==='inbound'?r.number:r.extension_number,r.direction==='inbound'?r.extension_number:r.number,ownership.callerUserId,ownership.calleeUserId,epoch]);
  const parent=await c.query('SELECT id,tenant_id,caller_user_id,callee_user_id,metadata FROM call_records WHERE call_uuid=$1 FOR UPDATE',[channelUuid]);
  if(parent.rows.length!==1||Number(parent.rows[0].tenant_id)!==Number(r.tenant_id)||!hasExactCdrOwnership(parent.rows[0],ownership)){await c.query('ROLLBACK');return false;}
  const id=parent.rows[0].id;
  const legs=await c.query('SELECT tenant_id,extension_id,sip_call_id,caller_user_id,callee_user_id FROM call_legs WHERE call_record_id=$1 AND leg_uuid=$2',[id,channelUuid]);
  if(legs.rows.some(l=>Number(l.tenant_id)!==Number(r.tenant_id)||Number(l.extension_id)!==Number(r.extension_id)||l.sip_call_id!==sip||!hasExactCdrOwnership(l,ownership))){await c.query('ROLLBACK');return false;}
  if(!legs.rows.length&&parent.rows[0].metadata?.source!=='authenticated_esl_snapshot'){await c.query('ROLLBACK');return false;}
  if(!legs.rows.length)await c.query(`INSERT INTO call_legs(call_record_id,tenant_id,extension_id,leg_uuid,sip_call_id,caller_user_id,callee_user_id,started_at,metadata)
   VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),'{"source":"authenticated_esl_snapshot","completion":"unknown"}')`,[id,r.tenant_id,r.extension_id,channelUuid,sip,ownership.callerUserId,ownership.calleeUserId,epoch]);
  await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
