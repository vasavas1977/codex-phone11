import { randomUUID } from 'node:crypto';
import { getPool } from '../pbx/db';
import { createCloudRecordingRepository } from './repository';
import type { CaptureLedger,CaptureLease } from './capture';
const channel=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Persistent leases and exact pre-answer authenticated route identity. */
export function createCaptureLedger(db= getPool(),repo=createCloudRecordingRepository(db)):CaptureLedger & { stopRequested(lease:CaptureLease):Promise<void>; stopped(lease:CaptureLease):Promise<void>; pendingUploads():Promise<Array<{channelUuid:string;path:string}>> } {
 const path=(tenant:number,token:string)=>`/var/lib/freeswitch/recordings/phone11/${tenant}/${token}.wav`;
 function lease(r:any):CaptureLease{return {channelUuid:r.call_uuid,callUuid:r.call_uuid,tenantId:Number(r.tenant_id),extensionId:Number(r.extension_id),token:r.capture_token,path:path(Number(r.tenant_id),r.capture_token),...(r.recording_status==='ready'&&r.storage_key?{storageKey:r.storage_key}:{}),...(r.capture_upload_lease_token?{uploadLeaseToken:r.capture_upload_lease_token}:{})};}
 const route=`JOIN phone11_recording_routes rr ON rr.channel_uuid::text=r.call_uuid AND rr.tenant_id=r.tenant_id AND rr.extension_id=r.extension_id`;
 return {
  async reserve(id,request){
   if(!channel.test(id))return null;
   const mapping=await db.query(`SELECT r.call_uuid FROM phone11_cloud_recordings r ${route} WHERE r.call_uuid=$1`,[id]);if(mapping.rows.length!==1)return null;
   const reservation=await repo.reserveCapture(id,request.kind==='manual'?request.actorUserId:undefined);if(!reservation)return null;
   return {channelUuid:id,callUuid:id,tenantId:reservation.tenantId,extensionId:reservation.extensionId,token:reservation.captureToken,path:path(reservation.tenantId,reservation.captureToken)};
  },
  permitted:l=>repo.capturePermitted(l.callUuid,l.token),
  async started(l){if(!await repo.markCapturing(l.callUuid,l.token))throw new Error('Capture authorization changed');},
  async failed(l){await repo.failCapture(l.callUuid,l.token);},
  async active(id,user){
   const result=await db.query(`SELECT r.* FROM phone11_cloud_recordings r ${route}
    JOIN user_extensions ue ON ue.extension_id=r.extension_id
    JOIN tenant_memberships tm ON tm.user_id=ue.user_id AND tm.tenant_id=r.tenant_id AND tm.status='active'
    JOIN extensions e ON e.id=r.extension_id AND e.tenant_id=r.tenant_id
    JOIN tenants t ON t.id=r.tenant_id WHERE r.call_uuid=$1 AND ue.user_id=$2 AND r.recording_status='recording'
    AND r.capture_stop_requested_at IS NULL AND r.capture_stopped_at IS NULL
    AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[id,user]);
   return result.rows.length===1?lease(result.rows[0]):null;
  },
  async stopRequested(l){
   const result=await db.query(`UPDATE phone11_cloud_recordings r SET capture_stop_requested_at=COALESCE(capture_stop_requested_at,clock_timestamp())
    WHERE r.call_uuid=$1 AND r.tenant_id=$2 AND r.extension_id=$3 AND r.capture_token=$4 AND r.recording_status='recording'
    AND EXISTS(SELECT 1 FROM phone11_recording_routes rr WHERE rr.channel_uuid::text=r.call_uuid AND rr.tenant_id=r.tenant_id AND rr.extension_id=r.extension_id)
    RETURNING r.call_uuid`,[l.callUuid,l.tenantId,l.extensionId,l.token]);
   if(result.rows.length!==1)throw new Error('Recording stop state changed');
  },
  async stopped(l){
   const result=await db.query(`UPDATE phone11_cloud_recordings r SET capture_stop_requested_at=COALESCE(capture_stop_requested_at,clock_timestamp()),capture_stopped_at=COALESCE(capture_stopped_at,clock_timestamp())
    WHERE r.call_uuid=$1 AND r.tenant_id=$2 AND r.extension_id=$3 AND r.capture_token=$4 AND r.recording_status IN ('recording','ready')
    AND EXISTS(SELECT 1 FROM phone11_recording_routes rr WHERE rr.channel_uuid::text=r.call_uuid AND rr.tenant_id=r.tenant_id AND rr.extension_id=r.extension_id)
    RETURNING r.call_uuid`,[l.callUuid,l.tenantId,l.extensionId,l.token]);
   if(result.rows.length!==1)throw new Error('Recording stop state changed');
  },
  async complete(id,file){
   const match=/^\/var\/lib\/freeswitch\/recordings\/phone11\/([1-9][0-9]*)\/([0-9a-f-]{36})\.wav$/i.exec(file);if(!channel.test(id)||!match)return null;
   const token=randomUUID();
   const result=await db.query(`UPDATE phone11_cloud_recordings r SET capture_stop_requested_at=COALESCE(capture_stop_requested_at,clock_timestamp()),capture_stopped_at=COALESCE(capture_stopped_at,clock_timestamp()),capture_upload_lease_token=$4,capture_upload_lease_until=clock_timestamp()+interval '60 seconds'
    WHERE r.call_uuid=$1 AND r.tenant_id=$2 AND r.capture_token=$3 AND r.recording_status IN ('recording','ready') AND r.capture_cleaned_at IS NULL
    AND EXISTS(SELECT 1 FROM phone11_recording_routes rr WHERE rr.channel_uuid::text=r.call_uuid AND rr.tenant_id=r.tenant_id AND rr.extension_id=r.extension_id)
    AND (r.capture_upload_lease_until IS NULL OR r.capture_upload_lease_until<clock_timestamp()) RETURNING r.*`,[id,Number(match[1]),match[2],token]);
   return result.rows.length===1?lease(result.rows[0]):null;
  },
  async uploaded(l,key){
   // HTTP ingestion already authenticated and finalized storage. Only acknowledge
   // the exact fenced completion; never guess a path or enqueue AI twice.
   const r=await db.query(`SELECT call_uuid FROM phone11_cloud_recordings WHERE call_uuid=$1 AND capture_token=$2 AND capture_upload_lease_token=$3 AND recording_status='ready' AND capture_upload_lease_until>clock_timestamp() AND storage_key=$4`,[l.callUuid,l.token,l.uploadLeaseToken,key]);
   if(r.rows.length!==1)throw new Error('Recording completion changed');
  },
  async cleaned(l){
   const r=await db.query(`UPDATE phone11_cloud_recordings SET capture_cleaned_at=clock_timestamp(),capture_upload_lease_token=NULL,capture_upload_lease_until=NULL WHERE call_uuid=$1 AND capture_token=$2 AND capture_upload_lease_token=$3 AND recording_status='ready' AND capture_upload_lease_until>clock_timestamp() RETURNING call_uuid`,[l.callUuid,l.token,l.uploadLeaseToken]);if(r.rows.length!==1)throw new Error('Cleanup lease changed');
  },
  async releaseCompletion(l){await db.query(`UPDATE phone11_cloud_recordings SET capture_upload_lease_token=NULL,capture_upload_lease_until=NULL WHERE call_uuid=$1 AND capture_token=$2 AND capture_upload_lease_token=$3`,[l.callUuid,l.token,l.uploadLeaseToken]);},
  async pendingUploads(){
   const r=await db.query(`SELECT r.* FROM phone11_cloud_recordings r ${route} WHERE r.recording_status IN ('recording','ready') AND r.capture_cleaned_at IS NULL AND r.capture_stopped_at IS NOT NULL AND (r.capture_upload_lease_until IS NULL OR r.capture_upload_lease_until<clock_timestamp()) ORDER BY r.capture_stopped_at LIMIT 20`);
   return r.rows.map(r=>({channelUuid:r.call_uuid,path:path(Number(r.tenant_id),r.capture_token)}));
  },
 };
}
