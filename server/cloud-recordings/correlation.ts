import {isIP} from 'node:net';
import {query,withTransaction} from '../pbx/db';
const channel=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const outboundNonce=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class RejectedOutboundCorrelation extends Error {}
function exactText(value:unknown,max:number):value is string{return typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);}
function exactAuthMarker(value:unknown):value is string{return exactText(value,255)&&!value.includes(',');}
function anchoredMedia(value:unknown):boolean{return value===undefined||(typeof value==='string'&&['false','0','no','off'].includes(value.toLowerCase()));}
function trustedProxy(peer:unknown,profile:unknown):peer is string{
 if(typeof peer!=='string'||!isIP(peer)||typeof profile!=='string')return false;
 const configured=process.env.PHONE11_RECORDING_TRUSTED_PROXY_IPS;
 const configuredProfile=process.env.PHONE11_RECORDING_TRUSTED_PROXY_PROFILE;
 if(!configured||!configuredProfile||!exactText(configuredProfile,80)||configuredProfile.includes(','))return false;
 const entries=configured.split(',').map(v=>v.trim());
 if(!entries.length||entries.some(v=>!v||!isIP(v)))return false;
 return entries.includes(peer)&&profile===configuredProfile;
}
type OutboundObservation={channelUuid:string;sipCallId:string;username:string;realm:string;nativeUuid:string;number:string};
async function persistObservedOutbound(observation:OutboundObservation):Promise<boolean>{
 try{return await withTransaction(async c=>{
  const found=await c.query(`SELECT e.id,e.tenant_id,s.user_id FROM sip_accounts s JOIN extensions e ON e.id=s.extension_id AND e.tenant_id=s.tenant_id AND e.user_id=s.user_id
   JOIN user_extensions ue ON ue.extension_id=e.id AND ue.user_id=s.user_id
   JOIN tenant_memberships tm ON tm.user_id=s.user_id AND tm.tenant_id=e.tenant_id AND tm.status='active'
   JOIN tenants t ON t.id=e.tenant_id WHERE s.sip_username=$1 AND s.sip_domain=$2 AND s.status='active' AND s.deleted_at IS NULL
   AND s.user_id IS NOT NULL AND e.status='active' AND e.deleted_at IS NULL AND t.status='active' FOR SHARE OF s,e,ue,tm,t`,[observation.username,observation.realm]);
  if(found.rows.length!==1)throw new RejectedOutboundCorrelation();
  const ext=found.rows[0],nativeHistoryId=`native-outbound:${observation.nativeUuid.toLowerCase()}`;
  // A transaction-scoped nonce lock closes the race between the collision check
  // and insert without adding a live schema dependency. Hash collisions only
  // serialize unrelated attempts; they cannot grant ownership.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[nativeHistoryId]);
  const routes=await c.query(`SELECT tenant_id,extension_id,owner_user_id,sip_call_id,direction FROM phone11_recording_routes
   WHERE channel_uuid=$1 FOR UPDATE`,[observation.channelUuid]);
  const byNonce=await c.query(`SELECT call_uuid,tenant_id,extension_id,native_history_id,direction FROM phone11_cloud_recordings
   WHERE native_history_id=$1 FOR UPDATE`,[nativeHistoryId]);
  const calls=await c.query(`SELECT call_uuid,tenant_id,extension_id,native_history_id,direction FROM phone11_cloud_recordings
   WHERE call_uuid=$1 FOR UPDATE`,[observation.channelUuid]);
  const exactRoute=(r:any)=>String(r.tenant_id)===String(ext.tenant_id)&&String(r.extension_id)===String(ext.id)&&String(r.owner_user_id)===String(ext.user_id)&&r.sip_call_id===observation.sipCallId&&r.direction==='outbound';
  const exactCall=(r:any)=>r.call_uuid===observation.channelUuid&&String(r.tenant_id)===String(ext.tenant_id)&&String(r.extension_id)===String(ext.id)&&r.native_history_id===nativeHistoryId&&r.direction==='outbound';
  if(routes.rows.length||byNonce.rows.length||calls.rows.length){
   if(routes.rows.length===1&&byNonce.rows.length===1&&calls.rows.length===1&&exactRoute(routes.rows[0])&&exactCall(byNonce.rows[0])&&exactCall(calls.rows[0]))return true;
   throw new RejectedOutboundCorrelation();
  }
  const route=await c.query(`INSERT INTO phone11_recording_routes(channel_uuid,tenant_id,extension_id,owner_user_id,sip_call_id,direction,number)
   VALUES($1,$2,$3,$4,$5,'outbound',$6) ON CONFLICT(channel_uuid) DO NOTHING RETURNING channel_uuid`,[observation.channelUuid,ext.tenant_id,ext.id,ext.user_id,observation.sipCallId,observation.number]);
  if(route.rows.length!==1)throw new RejectedOutboundCorrelation();
  const cloud=await c.query(`INSERT INTO phone11_cloud_recordings(call_uuid,tenant_id,extension_id,native_history_id,number,direction,started_at,expires_at)
   SELECT $1,$2,$3,$4,$5,'outbound',clock_timestamp(),clock_timestamp()+(COALESCE((SELECT retention_days FROM phone11_recording_policies WHERE tenant_id=$2),30)*interval '1 day')
   ON CONFLICT(call_uuid) DO NOTHING RETURNING call_uuid`,[observation.channelUuid,ext.tenant_id,ext.id,nativeHistoryId,observation.number]);
  if(cloud.rows.length!==1)throw new RejectedOutboundCorrelation();
  return true;
 });}catch(error){if(error instanceof RejectedOutboundCorrelation)return false;throw error;}
}

/** Authenticated ESL observation of the FreeSWITCH inbound A-leg from Kamailio.
 * The proxy address and protected auth headers are commissioned configuration;
 * missing or malformed metadata deliberately leaves the call unmapped.
 */
export async function bindObservedOutboundChannel(fields:Record<string,string>):Promise<boolean>{
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true')return false;
 const channelUuid=fields['Unique-ID'],sipCallId=fields.variable_sip_call_id;
 const username=fields.variable_phone11_authenticated_user;
 const realm=fields.variable_phone11_authenticated_realm;
 const nativeUuid=fields.variable_phone11_outbound_id;
 if(!channel.test(channelUuid)||!exactText(sipCallId,512)||fields['Call-Direction']!=='inbound'||fields.variable_call_direction!=='outbound'||
  !trustedProxy(fields.variable_sip_received_ip,fields.variable_sofia_profile_name)||!anchoredMedia(fields.variable_bypass_media)||!anchoredMedia(fields.variable_bypass_media_after_bridge)||!anchoredMedia(fields.variable_proxy_media)||
  !exactAuthMarker(username)||!exactAuthMarker(realm)||!outboundNonce.test(nativeUuid))return false;
 const destination=fields['Caller-Destination-Number'];
 const number=typeof destination==='string'&&/^\+?[0-9]{1,20}$/.test(destination)?destination:'Unknown';
 return persistObservedOutbound({channelUuid,sipCallId,username,realm,nativeUuid,number});
}
/** Called exclusively by the integration-secret-authenticated FS dialplan route.
 * sip_auth_username/realm are FS authenticated variables, never From/caller-ID.
 */
export async function bindAuthenticatedOutbound(body:Record<string,unknown>,number:string):Promise<void>{
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true')return;
 const id=body['Unique-ID'];const user=body.variable_sip_auth_username;const realm=body.variable_sip_auth_realm;
 if(typeof id!=='string'||!channel.test(id)||typeof user!=='string'||typeof realm!=='string')return;
 await withTransaction(async c=>{
  const found=await c.query(`SELECT e.id,e.tenant_id,s.user_id FROM sip_accounts s JOIN extensions e ON e.id=s.extension_id AND e.tenant_id=s.tenant_id AND e.user_id=s.user_id
   JOIN user_extensions ue ON ue.extension_id=e.id AND ue.user_id=s.user_id
   JOIN tenant_memberships tm ON tm.user_id=s.user_id AND tm.tenant_id=e.tenant_id AND tm.status='active'
   JOIN tenants t ON t.id=e.tenant_id WHERE s.sip_username=$1 AND s.sip_domain=$2 AND s.status='active' AND s.deleted_at IS NULL
   AND s.user_id IS NOT NULL AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[user,realm]);
  if(found.rows.length!==1)return;const ext=found.rows[0];
  await c.query(`INSERT INTO phone11_recording_routes(channel_uuid,tenant_id,extension_id,owner_user_id,sip_call_id,direction,number)
   VALUES($1,$2,$3,$4,$5,'outbound',$6) ON CONFLICT(channel_uuid) DO NOTHING`,[id,ext.tenant_id,ext.id,ext.user_id,typeof body.variable_sip_call_id==='string'?body.variable_sip_call_id:null,number]);
  await c.query(`INSERT INTO phone11_cloud_recordings(call_uuid,tenant_id,extension_id,number,direction,started_at,expires_at)
   SELECT channel_uuid::text,rr.tenant_id,rr.extension_id,rr.number,rr.direction,rr.created_at,rr.created_at+(COALESCE(p.retention_days,30)*interval '1 day')
   FROM phone11_recording_routes rr LEFT JOIN phone11_recording_policies p ON p.tenant_id=rr.tenant_id WHERE rr.channel_uuid=$1 ON CONFLICT(call_uuid) DO NOTHING`,[id]);
 });
}
/** No fallback to CDR-supplied extension or caller number. */
export async function trustedRecordingRoute(callUuid:string,sipCallId?:string|null):Promise<{tenantId:number;extensionId:number;userId?:number;direction?:string}|null>{
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true'||!channel.test(callUuid))return null;
 const r=await query(`SELECT rr.tenant_id,rr.extension_id,rr.owner_user_id,rr.direction FROM phone11_recording_routes rr
 JOIN extensions e ON e.id=rr.extension_id AND e.tenant_id=rr.tenant_id JOIN tenants t ON t.id=e.tenant_id
 WHERE channel_uuid=$1 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[callUuid]);
 if(r.rows.length===1){const row=r.rows[0],route:{tenantId:number;extensionId:number;userId?:number;direction?:string}={tenantId:Number(row.tenant_id),extensionId:Number(row.extension_id)};
  if(Number.isSafeInteger(Number(row.owner_user_id))&&Number(row.owner_user_id)>0){route.userId=Number(row.owner_user_id);route.direction=row.direction;}return route;}
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
  const found=await c.query(`SELECT w.*,wb.user_id FROM phone11_recording_wake_links w
   JOIN phone11_wake_bindings wb ON wb.id=w.binding_id AND wb.tenant_id=w.tenant_id AND wb.extension_id=w.extension_id
   JOIN user_extensions ue ON ue.extension_id=w.extension_id AND ue.user_id=wb.user_id
   JOIN tenant_memberships tm ON tm.user_id=wb.user_id AND tm.tenant_id=w.tenant_id AND tm.status='active'
   JOIN extensions e ON e.id=w.extension_id AND e.tenant_id=w.tenant_id AND e.user_id=wb.user_id JOIN tenants t ON t.id=e.tenant_id
   WHERE w.sip_call_id=$1 AND w.created_at>clock_timestamp()-interval '1 hour'
   AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[sipCallId]);
  if(found.rows.length!==1)return false;const w=found.rows[0];
  const number=/^\+?[0-9]{1,20}$/.test(displayNumber)?displayNumber:'Unknown';
  const inserted=await c.query(`INSERT INTO phone11_recording_routes(channel_uuid,tenant_id,extension_id,owner_user_id,sip_call_id,direction,number)
   VALUES($1,$2,$3,$4,$5,'inbound',$6) ON CONFLICT(channel_uuid) DO NOTHING RETURNING channel_uuid`,[channelUuid,w.tenant_id,w.extension_id,w.user_id,sipCallId,number]);
  if(!inserted.rows.length){const prior=await c.query("SELECT 1 FROM phone11_recording_routes WHERE channel_uuid=$1 AND tenant_id=$2 AND extension_id=$3 AND owner_user_id=$4 AND sip_call_id=$5",[channelUuid,w.tenant_id,w.extension_id,w.user_id,sipCallId]);return prior.rows.length===1;}
  await c.query(`INSERT INTO phone11_cloud_recordings(call_uuid,tenant_id,extension_id,native_history_id,number,direction,started_at,expires_at)
   SELECT $1,$2,$3,$4,$5,'inbound',clock_timestamp(),clock_timestamp()+(COALESCE((SELECT retention_days FROM phone11_recording_policies WHERE tenant_id=$2),30)*interval '1 day')
   ON CONFLICT(call_uuid) DO NOTHING`,[channelUuid,w.tenant_id,w.extension_id,`native-wake:${w.wake_uuid}`,number]);
  return true;
 });
}

/** CDR ingestion must not contradict an immutable channel's observed SIP identity. */
export async function trustedCdrRecordingRoute(callUuid:string,sipCallId?:string|null):Promise<{tenantId:number;extensionId:number;userId?:number;direction?:string}|null>{
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED==='true'&&channel.test(callUuid)){
  const known=await query('SELECT sip_call_id FROM phone11_recording_routes WHERE channel_uuid=$1',[callUuid]);
  if(known.rows.length===1&&known.rows[0].sip_call_id&&known.rows[0].sip_call_id!==sipCallId)throw new Error('Trusted channel SIP identity mismatch');
 }
 return trustedRecordingRoute(callUuid,sipCallId);
}
