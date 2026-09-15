import {query,withTransaction} from '../pbx/db';
const channel=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Called exclusively by the integration-secret-authenticated FS dialplan route.
 * sip_auth_username/realm are FS authenticated variables, never From/caller-ID.
 */
export async function bindAuthenticatedOutbound(body:Record<string,unknown>,number:string):Promise<void>{
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true')return;
 const id=body['Unique-ID'];const user=body.variable_sip_auth_username;const realm=body.variable_sip_auth_realm;
 if(typeof id!=='string'||!channel.test(id)||typeof user!=='string'||typeof realm!=='string')return;
 await withTransaction(async c=>{
  const found=await c.query(`SELECT e.id,e.tenant_id FROM sip_accounts s JOIN extensions e ON e.id=s.extension_id AND e.tenant_id=s.tenant_id
   JOIN tenants t ON t.id=e.tenant_id WHERE s.sip_username=$1 AND s.sip_domain=$2 AND s.status='active' AND s.deleted_at IS NULL
   AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[user,realm]);
  if(found.rows.length!==1)return;const ext=found.rows[0];
  await c.query(`INSERT INTO phone11_recording_routes(channel_uuid,tenant_id,extension_id,sip_call_id,direction,number)
   VALUES($1,$2,$3,$4,'outbound',$5) ON CONFLICT(channel_uuid) DO NOTHING`,[id,ext.tenant_id,ext.id,typeof body.variable_sip_call_id==='string'?body.variable_sip_call_id:null,number]);
  await c.query(`INSERT INTO phone11_cloud_recordings(call_uuid,tenant_id,extension_id,number,direction,started_at,expires_at)
   SELECT channel_uuid::text,rr.tenant_id,rr.extension_id,rr.number,rr.direction,rr.created_at,rr.created_at+(COALESCE(p.retention_days,30)*interval '1 day')
   FROM phone11_recording_routes rr LEFT JOIN phone11_recording_policies p ON p.tenant_id=rr.tenant_id WHERE rr.channel_uuid=$1 ON CONFLICT(call_uuid) DO NOTHING`,[id]);
 });
}
/** No fallback to CDR-supplied extension or caller number. */
export async function trustedRecordingRoute(callUuid:string,sipCallId?:string|null):Promise<{tenantId:number;extensionId:number}|null>{
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true'||!channel.test(callUuid))return null;
 const r=await query(`SELECT rr.tenant_id,rr.extension_id FROM phone11_recording_routes rr
 JOIN extensions e ON e.id=rr.extension_id AND e.tenant_id=rr.tenant_id JOIN tenants t ON t.id=e.tenant_id
 WHERE channel_uuid=$1 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[callUuid]);
 if(r.rows.length===1)return {tenantId:Number(r.rows[0].tenant_id),extensionId:Number(r.rows[0].extension_id)};
 if(!sipCallId)return null;
 const wake=await query(`SELECT DISTINCT w.tenant_id,w.extension_id FROM phone11_recording_wake_links w
  JOIN extensions e ON e.id=w.extension_id AND e.tenant_id=w.tenant_id JOIN tenants t ON t.id=e.tenant_id
  WHERE w.sip_call_id=$1 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[sipCallId]);
 // Exact observed SIP identity only. Rewritten/ambiguous FS leg IDs remain unmapped.
 return wake.rows.length===1?{tenantId:Number(wake.rows[0].tenant_id),extensionId:Number(wake.rows[0].extension_id)}:null;
}
/** Authenticated ESL CHANNEL_CREATE integration. No public RPC exposes this.
 * Only exact SIP Call-ID from the current channel can claim a persisted wake link.
 */
export async function bindIncomingChannel(channelUuid:string,sipCallId:string,displayNumber:string):Promise<boolean>{
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true'||!channel.test(channelUuid)||!sipCallId||sipCallId.length>512)return false;
 return withTransaction(async c=>{
  const found=await c.query(`SELECT w.* FROM phone11_recording_wake_links w
   JOIN extensions e ON e.id=w.extension_id AND e.tenant_id=w.tenant_id JOIN tenants t ON t.id=e.tenant_id
   WHERE w.sip_call_id=$1 AND w.created_at>clock_timestamp()-interval '1 hour'
   AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[sipCallId]);
  if(found.rows.length!==1)return false;const w=found.rows[0];
  const number=/^\+?[0-9]{1,20}$/.test(displayNumber)?displayNumber:'Unknown';
  const inserted=await c.query(`INSERT INTO phone11_recording_routes(channel_uuid,tenant_id,extension_id,sip_call_id,direction,number)
   VALUES($1,$2,$3,$4,'inbound',$5) ON CONFLICT(channel_uuid) DO NOTHING RETURNING channel_uuid`,[channelUuid,w.tenant_id,w.extension_id,sipCallId,number]);
  if(!inserted.rows.length){const prior=await c.query("SELECT 1 FROM phone11_recording_routes WHERE channel_uuid=$1 AND tenant_id=$2 AND extension_id=$3 AND sip_call_id=$4",[channelUuid,w.tenant_id,w.extension_id,sipCallId]);return prior.rows.length===1;}
  await c.query(`INSERT INTO phone11_cloud_recordings(call_uuid,tenant_id,extension_id,native_history_id,number,direction,started_at,expires_at)
   SELECT $1,$2,$3,$4,$5,'inbound',clock_timestamp(),clock_timestamp()+(COALESCE((SELECT retention_days FROM phone11_recording_policies WHERE tenant_id=$2),30)*interval '1 day')
   ON CONFLICT(call_uuid) DO NOTHING`,[channelUuid,w.tenant_id,w.extension_id,`native-wake:${w.wake_uuid}`,number]);
  return true;
 });
}

/** CDR ingestion must not contradict an immutable channel's observed SIP identity. */
export async function trustedCdrRecordingRoute(callUuid:string,sipCallId?:string|null):Promise<{tenantId:number;extensionId:number}|null>{
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED==='true'&&channel.test(callUuid)){
  const known=await query('SELECT sip_call_id FROM phone11_recording_routes WHERE channel_uuid=$1',[callUuid]);
  if(known.rows.length===1&&known.rows[0].sip_call_id&&known.rows[0].sip_call_id!==sipCallId)throw new Error('Trusted channel SIP identity mismatch');
 }
 return trustedRecordingRoute(callUuid,sipCallId);
}
