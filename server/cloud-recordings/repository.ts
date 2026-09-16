import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { TRPCError } from "@trpc/server";
import type { CloudRecording, CloudRecordingDetail, CloudRecordingPolicy, RecordingPolicyMode } from "../../shared/cloud-recordings";
import { getPool } from "../pbx/db";
import { recordingFailureCode, recordingRetryDelaySeconds, type RecordingFailure } from "./failure";
import { completeRecordingAnalysis, type RecordingAnalysis } from "./gemini";
import { parseVerifiedStereoSpeakerIdentity } from "./speaker-identity";

type DB = Pick<Pool, "connect" | "query">;
const uuid = /^[a-zA-Z0-9_-]{1,128}$/;
const analysisAvailable=()=>process.env.PHONE11_RECORDING_AI_ENABLED==='true' && Boolean(process.env.GEMINI_API_KEY) && /^[a-zA-Z0-9._-]{1,100}$/.test(process.env.PHONE11_RECORDING_GEMINI_MODEL??'');
const unavailable = () => new TRPCError({code:"NOT_FOUND",message:"Recording not found"});
const owned = `EXISTS (SELECT 1 FROM extensions e JOIN user_extensions ue ON ue.extension_id=e.id
 JOIN tenants t ON t.id=e.tenant_id WHERE e.id=r.extension_id AND e.tenant_id=r.tenant_id
 AND ue.user_id=$1 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active')`;
export interface RecordingJob { callUuid:string; tenantId:number; storageKey:string; leaseToken:string }
export function createCloudRecordingRepository(db:DB = getPool(), captureAvailable = () => process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED === "true") {
 async function transaction<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T> {
  const c=await db.connect(); try {await c.query("BEGIN"); const value=await fn(c); await c.query("COMMIT"); return value;}
  catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
 async function membership(c:Pick<PoolClient,"query">,userId:number,tenantId:number,admin=false){
  const r=await c.query(`SELECT tm.role FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id
   WHERE tm.user_id=$1 AND tm.tenant_id=$2 AND tm.status='active' AND t.status='active'
   ${admin ? "AND tm.role IN ('owner','admin')" : ""} FOR SHARE OF tm,t`,[userId,tenantId]);
  if(!r.rows.length)throw new TRPCError({code:"FORBIDDEN",message:"Workspace permission required"});
  return r.rows.some(row=>["owner","admin"].includes(row.role));
 }
 function dto(r:any):CloudRecording {
  // A ready status without a complete, structured payload is an old or corrupt
  // row, not a usable AI summary. Do not advertise it as ready in Recents.
  const analysis=completeRecordingAnalysis({transcript:r.transcript,summary:r.summary});
  const summaryStatus=r.summary_status==='ready'&&!analysis?'failed':r.summary_status;
  return {callUuid:r.call_uuid,tenantId:Number(r.tenant_id),...(r.native_history_id?{nativeHistoryId:r.native_history_id}:{}),
   number:r.number,direction:r.direction,startedAt:new Date(r.started_at).getTime(),
   ...(r.ended_at?{endedAt:new Date(r.ended_at).getTime()}:{}),recordingStatus:r.recording_status,summaryStatus,
   ...(r.recording_status==='recording'&&(r.capture_stop_requested_at||r.capture_stopped_at)?{recordingFinalizing:true}:{})};
 }
 return {
  async getPolicy(userId:number,tenantId:number):Promise<CloudRecordingPolicy>{
   return transaction(async c=>{const canEdit=await membership(c,userId,tenantId); const r=await c.query("SELECT * FROM phone11_recording_policies WHERE tenant_id=$1",[tenantId]);
    return {tenantId,canEdit,mode:r.rows[0]?.mode??"off",aiEnabled:r.rows[0]?.ai_enabled??false,retentionDays:r.rows[0]?.retention_days??30,captureAvailable:captureAvailable(),analysisAvailable:analysisAvailable()};});
  },
  async updatePolicy(userId:number,input:{tenantId:number;mode:RecordingPolicyMode;aiEnabled:boolean;retentionDays:number}):Promise<CloudRecordingPolicy>{
   return transaction(async c=>{await membership(c,userId,input.tenantId,true);
    await c.query(`INSERT INTO phone11_recording_policies(tenant_id,mode,ai_enabled,retention_days,updated_by) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(tenant_id) DO UPDATE SET mode=$2,ai_enabled=$3,retention_days=$4,updated_by=$5,updated_at=clock_timestamp()`,
     [input.tenantId,input.mode,input.aiEnabled,input.retentionDays,userId]);
    // Policy revocation invalidates outstanding leases; completed artifacts retain their expiry.
    // Capture service observes policy revocation and stops/deletes before failCapture clears its token.
    if(input.mode==='off'||!input.aiEnabled){
     await c.query(`UPDATE phone11_recording_jobs j SET state='failed',lease_token=NULL,lease_until=NULL,worker_id=NULL,failure_code='policy_disabled'
      FROM phone11_cloud_recordings r WHERE r.call_uuid=j.call_uuid AND r.tenant_id=$1 AND j.state IN ('queued','processing')`,[input.tenantId]);
     await c.query("UPDATE phone11_cloud_recordings SET summary_status='off' WHERE tenant_id=$1 AND summary_status IN ('queued','processing')",[input.tenantId]);
    }
    return {...input,canEdit:true,captureAvailable:captureAvailable(),analysisAvailable:analysisAvailable()};});
  },
  async list(userId:number,input:{tenantId?:number;limit?:number}={}):Promise<{items:CloudRecording[];captureAvailable:boolean}>{
   const r=await db.query(`SELECT r.* FROM phone11_cloud_recordings r WHERE ${owned} AND r.expires_at>clock_timestamp()
    AND ($2::integer IS NULL OR r.tenant_id=$2) ORDER BY r.started_at DESC,r.call_uuid LIMIT $3`,[userId,input.tenantId??null,Math.min(100,Math.max(1,input.limit??50))]);
   return {items:r.rows.map(dto),captureAvailable:captureAvailable()};
  },
  async detail(userId:number,callUuid:string):Promise<CloudRecordingDetail>{
   if(!uuid.test(callUuid))throw unavailable();
   const result=await db.query(`SELECT r.*
    FROM phone11_cloud_recordings r
    WHERE ${owned} AND r.call_uuid=$2 AND r.expires_at>clock_timestamp()`,[userId,callUuid]);
   const r=result.rows[0]; if(!r)throw unavailable();
   const record=dto(r);
   const speakerRoles=parseVerifiedStereoSpeakerIdentity(r.speaker_identity,callUuid);
   return {...record,...(r.recording_status==='ready'?{playbackPath:`/api/recordings/play/${encodeURIComponent(callUuid)}`} : {}),
    ...(speakerRoles?{speakerRoles}:{}),
    ...(record.summaryStatus==='ready'?{transcript:r.transcript,summary:r.summary}: {})};
  },
  /** Internal only: trusted PBX adapter supplies IDs, never a mobile request. Verifies explicit assigned leg. */
  async registerCall(callUuid:string):Promise<boolean>{
   if(!uuid.test(callUuid))throw unavailable();
   return transaction(async c=>{
    const result=await c.query(`SELECT cr.*,cl.extension_id FROM call_records cr JOIN call_legs cl ON cl.call_record_id=cr.id AND cl.tenant_id=cr.tenant_id
     JOIN extensions e ON e.id=cl.extension_id AND e.tenant_id=cr.tenant_id JOIN tenants t ON t.id=e.tenant_id
     WHERE cr.call_uuid=$1 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'
     AND cr.direction IN ('inbound','outbound') ORDER BY cl.id`,[callUuid]);
    // Ambiguous multi-extension records need a deliberate per-participant model, never pick the first.
    const rows=result.rows;if(!rows.length||new Set(rows.map(r=>r.extension_id)).size!==1)return false;
    const r=rows[0];
    const p=await c.query("SELECT * FROM phone11_recording_policies WHERE tenant_id=$1 FOR SHARE",[r.tenant_id]);
    const policy=p.rows[0];
    const native=await c.query(`SELECT DISTINCT wc.id FROM phone11_wake_calls wc JOIN phone11_wake_bindings wb ON wb.id=wc.binding_id
     JOIN call_legs cl ON cl.sip_call_id=wc.sip_call_id WHERE cl.call_record_id=$1 AND cl.tenant_id=$2
     AND wb.tenant_id=$2 AND wb.extension_id=$3
     UNION SELECT w.wake_uuid AS id FROM phone11_recording_wake_links w JOIN call_legs cl ON cl.sip_call_id=w.sip_call_id
     WHERE cl.call_record_id=$1 AND cl.tenant_id=$2 AND w.tenant_id=$2 AND w.extension_id=$3`,[r.id,r.tenant_id,r.extension_id]);
    await c.query(`INSERT INTO phone11_cloud_recordings(call_uuid,tenant_id,extension_id,native_history_id,number,direction,started_at,ended_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7::timestamptz+($9::integer*interval '1 day')) ON CONFLICT(call_uuid) DO UPDATE SET ended_at=GREATEST(phone11_cloud_recordings.started_at,EXCLUDED.ended_at),
      native_history_id=COALESCE(phone11_cloud_recordings.native_history_id,EXCLUDED.native_history_id)
      WHERE phone11_cloud_recordings.tenant_id=EXCLUDED.tenant_id AND phone11_cloud_recordings.extension_id=EXCLUDED.extension_id`,
     [callUuid,r.tenant_id,r.extension_id,native.rows.length===1?`native-wake:${native.rows[0].id}`:null,r.direction==='inbound'?r.from_number:r.to_number,r.direction,r.started_at,r.ended_at,policy?.retention_days??30]);
    return true;
   });
  },
  async reserveCapture(callUuid:string,manualActorUserId?:number):Promise<{captureToken:string;tenantId:number;extensionId:number}|null>{
   if(!captureAvailable())return null;
   return transaction(async c=>{
    const found=await c.query(`SELECT r.*,p.mode FROM phone11_cloud_recordings r JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id
     WHERE r.call_uuid=$1 AND r.expires_at>clock_timestamp() FOR UPDATE OF p,r`,[callUuid]);
    const r=found.rows[0];if(!r||!['off','failed'].includes(r.recording_status)||r.mode==='off')return null;
    const active=await c.query("SELECT 1 FROM extensions e JOIN tenants t ON t.id=e.tenant_id WHERE e.id=$1 AND e.tenant_id=$2 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'",[r.extension_id,r.tenant_id]);if(!active.rows.length)return null;
    if(r.mode==='manual'||manualActorUserId!==undefined){
     const allowed=await c.query(`SELECT 1 FROM extensions e JOIN user_extensions ue ON ue.extension_id=e.id JOIN tenants t ON t.id=e.tenant_id
      WHERE e.id=$1 AND e.tenant_id=$2 AND ue.user_id=$3 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[r.extension_id,r.tenant_id,manualActorUserId??null]);
     if(!allowed.rows.length)return null;
    }
    const token=randomUUID();await c.query("UPDATE phone11_cloud_recordings SET recording_status='pending',capture_token=$2,manual_actor_user_id=$3,capture_pending_until=clock_timestamp()+interval '60 seconds' WHERE call_uuid=$1",[callUuid,token,manualActorUserId??null]);
    return {captureToken:token,tenantId:Number(r.tenant_id),extensionId:Number(r.extension_id)};
   });
  },
  async markCapturing(callUuid:string,captureToken:string):Promise<boolean>{
   if(!captureAvailable())return false;
   const r=await db.query(`UPDATE phone11_cloud_recordings r SET recording_status='recording',capture_pending_until=NULL FROM phone11_recording_policies p
    WHERE p.tenant_id=r.tenant_id AND p.mode<>'off' AND r.call_uuid=$1 AND r.capture_token=$2 AND r.recording_status='pending'
    AND (r.manual_actor_user_id IS NULL OR EXISTS(SELECT 1 FROM user_extensions ue WHERE ue.extension_id=r.extension_id AND ue.user_id=r.manual_actor_user_id)) AND r.capture_pending_until>clock_timestamp() AND r.expires_at>clock_timestamp() RETURNING r.call_uuid`,[callUuid,captureToken]);return r.rows.length===1;
  },
  /** Called only after trusted authenticated ingestion has finalized a private WAV. */
  async recordingStored(callUuid:string,storageKey:string,captureToken:string):Promise<boolean>{
   return transaction(async c=>{
    const result=await c.query(`SELECT r.*,p.mode,p.ai_enabled FROM phone11_cloud_recordings r JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id
     WHERE r.call_uuid=$1 AND r.expires_at>clock_timestamp() FOR UPDATE OF p,r`,[callUuid]);
    const r=result.rows[0]; if(!r||r.mode==='off'||!captureAvailable()||r.capture_token!==captureToken||!['recording','ready'].includes(r.recording_status))return false;
    if(r.recording_status==='ready')return r.storage_key===storageKey;
    // Storage identity must come from authenticated storage metadata, not caller-selected paths.
    const stored=await c.query("SELECT 1 FROM call_records WHERE call_uuid=$1 AND tenant_id=$2 AND recording_url=$3",[callUuid,r.tenant_id,storageKey]);
    if(!stored.rows.length)return false;
    await c.query("UPDATE phone11_cloud_recordings SET recording_status='ready',storage_key=$2,summary_status=$3 WHERE call_uuid=$1",[callUuid,storageKey,r.ai_enabled?'queued':'off']);
    if(r.ai_enabled)await c.query("INSERT INTO phone11_recording_jobs(call_uuid) VALUES($1) ON CONFLICT(call_uuid) DO NOTHING",[callUuid]);
    return true;
   });
  },
  async claimJob(workerId:string):Promise<RecordingJob|null>{
   if(!/^[a-zA-Z0-9_-]{1,80}$/.test(workerId))throw new Error('Invalid worker');
   return transaction(async c=>{
    // Lock policy first so revocation serializes with claiming/finishing.
    const candidates=await c.query(`SELECT p.tenant_id FROM phone11_recording_policies p WHERE p.mode<>'off' AND p.ai_enabled ORDER BY p.tenant_id FOR SHARE`);
    if(!candidates.rows.length)return null;
    await c.query(`WITH exhausted AS (UPDATE phone11_recording_jobs SET state='failed',lease_token=NULL,lease_until=NULL,worker_id=NULL,failure_code='lease_exhausted'
     WHERE state='processing' AND attempts>=3 AND lease_until<clock_timestamp() RETURNING call_uuid)
     UPDATE phone11_cloud_recordings SET summary_status='failed' WHERE call_uuid IN (SELECT call_uuid FROM exhausted)`);
    const result=await c.query(`SELECT j.call_uuid,r.tenant_id,r.storage_key FROM phone11_recording_jobs j JOIN phone11_cloud_recordings r USING(call_uuid)
     WHERE EXISTS(SELECT 1 FROM extensions e JOIN tenants t ON t.id=e.tenant_id WHERE e.id=r.extension_id AND e.tenant_id=r.tenant_id AND e.status='active' AND e.deleted_at IS NULL AND t.status='active') AND r.tenant_id=ANY($1::integer[]) AND r.expires_at>clock_timestamp() AND r.recording_status='ready' AND r.storage_key IS NOT NULL
     AND j.attempts<3 AND ((j.state='queued' AND j.available_at<=clock_timestamp()) OR (j.state='processing' AND j.lease_until<clock_timestamp()))
     ORDER BY j.available_at FOR UPDATE OF j,r SKIP LOCKED LIMIT 1`,[candidates.rows.map(r=>r.tenant_id)]);
    const r=result.rows[0];if(!r)return null;const token=randomUUID();
    await c.query("UPDATE phone11_recording_jobs SET state='processing',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '5 minutes',worker_id=$3 WHERE call_uuid=$1",[r.call_uuid,token,workerId]);
    await c.query("UPDATE phone11_cloud_recordings SET summary_status='processing' WHERE call_uuid=$1",[r.call_uuid]);
    return {callUuid:r.call_uuid,tenantId:Number(r.tenant_id),storageKey:r.storage_key,leaseToken:token};
   });
  },
  async capturePermitted(callUuid:string,captureToken:string):Promise<boolean>{
   if(!captureAvailable())return false;
   const r=await db.query(`SELECT 1 FROM phone11_cloud_recordings r JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id
    JOIN extensions e ON e.id=r.extension_id AND e.tenant_id=r.tenant_id JOIN tenants t ON t.id=e.tenant_id
    WHERE r.call_uuid=$1 AND r.capture_token=$2 AND r.recording_status IN ('pending','recording') AND r.expires_at>clock_timestamp()
    AND (r.manual_actor_user_id IS NULL OR EXISTS(SELECT 1 FROM user_extensions ue WHERE ue.extension_id=r.extension_id AND ue.user_id=r.manual_actor_user_id)) AND (r.recording_status<>'pending' OR r.capture_pending_until>clock_timestamp()) AND p.mode<>'off' AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,[callUuid,captureToken]);return r.rows.length===1;
  },
  async failCapture(callUuid:string,captureToken:string):Promise<boolean>{
   const r=await db.query("UPDATE phone11_cloud_recordings SET recording_status='failed',capture_token=NULL,capture_pending_until=NULL WHERE call_uuid=$1 AND capture_token=$2 AND recording_status IN ('pending','recording') RETURNING call_uuid",[callUuid,captureToken]);return r.rows.length===1;
  },
  async claimPurge():Promise<{callUuid:string;tenantId:number;storageKey:string|null;purgeToken:string}|null>{
   return transaction(async c=>{
    const found=await c.query(`SELECT * FROM phone11_cloud_recordings WHERE expires_at<=clock_timestamp() AND recording_status NOT IN ('pending','recording') AND (capture_token IS NULL OR capture_cleaned_at IS NOT NULL)
     AND (purge_until IS NULL OR purge_until<clock_timestamp()) ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    const r=found.rows[0];if(!r)return null;const token=randomUUID();
    await c.query("UPDATE phone11_cloud_recordings SET purge_token=$2,purge_until=clock_timestamp()+interval '5 minutes',transcript=NULL,summary=NULL,speaker_identity=NULL,summary_status='off' WHERE call_uuid=$1",[r.call_uuid,token]);
    await c.query("UPDATE phone11_recording_jobs SET state='failed',lease_token=NULL,lease_until=NULL,worker_id=NULL,failure_code='expired' WHERE call_uuid=$1",[r.call_uuid]);
    return {callUuid:r.call_uuid,tenantId:Number(r.tenant_id),storageKey:r.storage_key,purgeToken:token};
   });
  },
  async completePurge(callUuid:string,purgeToken:string):Promise<boolean>{
   // Keep an expired tombstone: deleting metadata would reopen legacy playback.
   const r=await db.query("UPDATE phone11_cloud_recordings SET storage_key=NULL,recording_status='off',capture_token=NULL,purge_token=NULL,purge_until='infinity'::timestamptz WHERE call_uuid=$1 AND purge_token=$2 AND purge_until>clock_timestamp() AND expires_at<=clock_timestamp() RETURNING call_uuid",[callUuid,purgeToken]);return r.rows.length===1;
  },
  async validateJob(job:RecordingJob):Promise<boolean>{
   const r=await db.query(`SELECT 1 FROM phone11_recording_jobs j JOIN phone11_cloud_recordings r USING(call_uuid)
    JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id
    JOIN extensions e ON e.id=r.extension_id AND e.tenant_id=r.tenant_id JOIN tenants t ON t.id=e.tenant_id
    WHERE j.call_uuid=$1 AND r.tenant_id=$2 AND j.lease_token=$3 AND j.state='processing' AND j.lease_until>clock_timestamp()
    AND r.storage_key=$4 AND r.recording_status='ready' AND r.expires_at>clock_timestamp()
    AND p.mode<>'off' AND p.ai_enabled AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'`,
    [job.callUuid,job.tenantId,job.leaseToken,job.storageKey]);return r.rows.length===1;
  },
  async finishJob(job:RecordingJob,result:RecordingAnalysis|null,failure?:RecordingFailure):Promise<boolean>{
   return transaction(async c=>{
    const policy=await c.query("SELECT 1 FROM phone11_recording_policies WHERE tenant_id=$1 AND mode<>'off' AND ai_enabled FOR SHARE",[job.tenantId]);
    if(!policy.rows.length)return false;
    const found=await c.query(`SELECT j.attempts FROM phone11_recording_jobs j JOIN phone11_cloud_recordings r USING(call_uuid)
     WHERE j.call_uuid=$1 AND r.tenant_id=$2 AND j.lease_token=$3 AND j.state='processing' AND j.lease_until>clock_timestamp()
     AND EXISTS(SELECT 1 FROM extensions e JOIN tenants t ON t.id=e.tenant_id WHERE e.id=r.extension_id AND e.tenant_id=r.tenant_id AND e.status='active' AND e.deleted_at IS NULL AND t.status='active') AND r.expires_at>clock_timestamp() AND r.recording_status='ready' AND r.storage_key=$4 FOR UPDATE OF j,r`,[job.callUuid,job.tenantId,job.leaseToken,job.storageKey]);
    if(!found.rows.length)return false;
    const complete=result?completeRecordingAnalysis(result):null;
    // An invalid internal result follows the normal bounded retry path rather
    // than producing a ready badge that opens an incomplete summary.
    const completionFailure=result&&!complete?{code:'invalid_result',stage:'parse'} as RecordingFailure:failure;
    const state=complete?'ready':found.rows[0].attempts<3?'queued':'failed';
    const failureCode=complete?null:recordingFailureCode(completionFailure);
    const retryDelaySeconds=complete?0:recordingRetryDelaySeconds(completionFailure,Number(found.rows[0].attempts));
    await c.query(`UPDATE phone11_recording_jobs SET state=$2,lease_token=NULL,lease_until=NULL,worker_id=NULL,
     available_at=clock_timestamp()+$4::integer*interval '1 second',failure_code=$3 WHERE call_uuid=$1`,[job.callUuid,state,failureCode,retryDelaySeconds]);
    await c.query("UPDATE phone11_cloud_recordings SET summary_status=$2,transcript=$3,summary=$4 WHERE call_uuid=$1",[job.callUuid,state,complete?.transcript??null,complete?JSON.stringify(complete.summary):null]);return true;
   });
  }
 };
}
