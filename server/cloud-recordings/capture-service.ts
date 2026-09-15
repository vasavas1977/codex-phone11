import { persistRouteCdr } from './route-cdr';
import { bindIncomingChannel, bindObservedOutboundChannel } from './correlation';
import { getPool } from '../pbx/db';
import { createCaptureLedger } from './capture-ledger';
import { createRecordingCapture } from './capture';
import { createEslCaptureTransport,type EslConfig } from './esl-capture';
import { createCaptureSpool } from './capture-spool';
import { constants, promises as fs } from 'node:fs';
import { join } from 'node:path';
const STOP_FINALIZATION_GRACE_MS=60_000;
async function captureFileExists(path:string):Promise<boolean>{
 try{const file=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();return stat.isFile()&&stat.size>=44;}finally{await file.close();}}
 catch{return false;}
}
/** Default uuid_dump text is URL encoded and cannot preserve literal %HH.
 * JSON serializes the original values. Decode JSON only, never URI-decode SIP IDs. */
export function parseRecordingChannelDump(body:string,channelUuid:string):Record<string,string>{
 if(body.length>512*1024)throw new Error('Invalid recording channel snapshot');
 const parsed:unknown=JSON.parse(body);
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid recording channel snapshot');
 const data=parsed as Record<string,unknown>,fields:Record<string,string>={};
 for(const key of ['Unique-ID','variable_sip_call_id','Caller-Channel-Created-Time','variable_start_epoch','Caller-Caller-ID-Number','Caller-Destination-Number','Call-Direction','variable_call_direction','variable_sip_received_ip','variable_sofia_profile_name','variable_bypass_media','variable_bypass_media_after_bridge','variable_proxy_media','variable_phone11_outbound_id','variable_phone11_authenticated_user','variable_phone11_authenticated_realm']){
  if(!Object.prototype.hasOwnProperty.call(data,key))continue;
  const value=data[key];
  if(typeof value!=='string'||value.length>512||/[\x00-\x1f\x7f]/.test(value))throw new Error('Invalid recording channel snapshot');
  fields[key]=value;
 }
 if(fields['Unique-ID']!==channelUuid||!fields.variable_sip_call_id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channelUuid))throw new Error('Invalid recording channel snapshot');
 return fields;
}
/** Explicitly started service; imports never connect to PBX or enable recording.
 * Polling exact persisted channel IDs reconciles ESL event loss without guessing
 * call identity from telephone numbers, timestamps or caller-provided tenants.
 */
export function createRecordingCaptureService(config:{esl:EslConfig;spoolDirectory:string;uploadEndpoint:string;integrationSecret:string}) {
 const db=getPool(),ledger=createCaptureLedger(db),transport=createEslCaptureTransport(config.esl);
 const spool=createCaptureSpool({directory:config.spoolDirectory,endpoint:config.uploadEndpoint,integrationSecret:config.integrationSecret});
 const capture=createRecordingCapture({ledger,transport,upload:spool});
 let running=false;
 return {
  async capabilities(channelUuid:string,actorUserId:number){
   const none={canStart:false,canStop:false};
   if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true'||!/^[0-9a-f-]{36}$/i.test(channelUuid)||!Number.isSafeInteger(actorUserId)||actorUserId<=0)return none;
   const found=await db.query(`SELECT r.recording_status,r.capture_stop_requested_at,r.capture_stopped_at,p.mode FROM phone11_cloud_recordings r
    JOIN phone11_recording_routes rr ON rr.channel_uuid::text=r.call_uuid AND rr.tenant_id=r.tenant_id AND rr.extension_id=r.extension_id
    JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id JOIN user_extensions ue ON ue.extension_id=r.extension_id
    JOIN extensions e ON e.id=r.extension_id AND e.tenant_id=r.tenant_id JOIN tenants t ON t.id=r.tenant_id
    WHERE r.call_uuid=$1 AND ue.user_id=$2 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active' AND r.expires_at>clock_timestamp()`,[channelUuid,actorUserId]);
   if(found.rows.length!==1)return none;
   try{if((await transport.api(`uuid_exists ${channelUuid}`)).trim()!=='true')return none;
    if(found.rows[0].recording_status==='recording')return {canStart:false,canStop:!found.rows[0].capture_stop_requested_at&&!found.rows[0].capture_stopped_at};
    const peer=(await transport.api(`uuid_getvar ${channelUuid} signal_bond`)).trim();
    return {canStart:found.rows[0].mode!=='off'&&['off','failed'].includes(found.rows[0].recording_status)&&/^[0-9a-f-]{36}$/i.test(peer)&&peer!==channelUuid,canStop:false};
   }catch{return none;}
  },
  /** Server-authenticated actor only; ledger verifies exact assigned extension. */
  manualStart:(channelUuid:string,actorUserId:number)=>capture.start(channelUuid,{kind:'manual',actorUserId}),
  async manualStop(id:string,actor:number){
   const lease=await ledger.active(id,actor);if(!lease)return false;
   if(!await capture.stop(id,actor))return false;
   // Persist the confirmed stop before replying to the handset. A subsequent
   // detail refresh then reports finalization and cannot expose Stop again,
   // even if upload or CDR correlation needs a durable retry. If a concurrent
   // stop callback already finalized it, the PBX-confirmed stop still succeeds.
   // The PBX accepted the exact stop command. Persist that request before the
   // response reaches the handset so a reload cannot offer a second Stop while
   // the authenticated RECORD_STOP event, WAV upload, or CDR are pending.
   // `stopRequested` is idempotent for this exact capture lease; a database
   // failure is surfaced as a failed mutation rather than pretending the UI is
   // settled.
   try{await ledger.stopRequested(lease);}catch{return false;}
   // `startRecording` already subscribed to the exact RECORD_STOP event. Do
   // not synthesize completion from this command acknowledgement: a live call
   // may keep running while FreeSWITCH flushes its recorder. The event or the
   // bounded reconciler records `capture_stopped_at` and starts upload.
   return true;
  },
  onAuthenticatedRecordStop:capture.recordingStopped,
  async tick(){
   if(running)return;
   running=true;
   try{
    // Authenticated ESL supplies exact live UUID and SIP identity. Bounded fields
    // stay in memory; no raw channel dumps or caller numbers are logged.
    const channels=JSON.parse(await transport.api('show channels as json'));
    if(Array.isArray(channels.rows)&&channels.rows.length<=100){
     for(const row of channels.rows.slice(0,20)){
      const id=row.uuid;if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))continue;
      try{
       const fields=parseRecordingChannelDump(await transport.api(`uuid_dump ${id} json`),id);
       const sip=fields.variable_sip_call_id;
       if(sip){
        if(fields.variable_call_direction==='outbound'){
         if(fields['Call-Direction']==='inbound')await bindObservedOutboundChannel(fields);
        }else await bindIncomingChannel(id,sip,fields['Caller-Caller-ID-Number']??'');
        if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED==='true')await persistRouteCdr(db,id,fields);
       }
      }catch{/* Unmapped channels remain excluded. */}
     }
    }
    const rows=await db.query(`SELECT r.call_uuid,r.tenant_id,r.extension_id,r.capture_token,r.capture_stop_requested_at,r.capture_stopped_at,r.recording_status,p.mode,(r.expires_at<=clock_timestamp()) AS expired,(r.capture_pending_until<clock_timestamp()) AS pending_expired FROM phone11_cloud_recordings r
     JOIN phone11_recording_routes rr ON rr.channel_uuid::text=r.call_uuid AND rr.tenant_id=r.tenant_id AND rr.extension_id=r.extension_id
     JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id
     WHERE r.recording_status IN ('recording','pending') OR (r.expires_at>clock_timestamp() AND r.recording_status='off' AND p.mode='automatic') ORDER BY r.started_at LIMIT 20`);
    for(const r of rows.rows){
     if(!/^[0-9a-f-]{36}$/i.test(r.call_uuid))continue;
     try{
      const exists=(await transport.api(`uuid_exists ${r.call_uuid}`)).trim();
      if(r.recording_status==='recording'&&(r.capture_stop_requested_at||r.capture_stopped_at)&&(r.mode==='off'||r.expired||process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true')){
       const lease={channelUuid:r.call_uuid,callUuid:r.call_uuid,tenantId:Number(r.tenant_id),extensionId:Number(r.extension_id),token:r.capture_token,path:`/var/lib/freeswitch/recordings/phone11/${r.tenant_id}/${r.capture_token}.wav`};await spool.discardCompleted(lease);await ledger.failed(lease,'policy_revoked');continue;
      }
      if(r.recording_status==='pending'&&r.pending_expired){
       if(exists==='true')await transport.api(`uuid_record ${r.call_uuid} stop /var/lib/freeswitch/recordings/phone11/${r.tenant_id}/${r.capture_token}.wav`);
       if(exists==='false'||exists==='true'){const lease={channelUuid:r.call_uuid,callUuid:r.call_uuid,tenantId:Number(r.tenant_id),extensionId:Number(r.extension_id),token:r.capture_token,path:`/var/lib/freeswitch/recordings/phone11/${r.tenant_id}/${r.capture_token}.wav`};await spool.discardCompleted(lease);await ledger.failed(lease,'capture_failed');}
      }else if(r.recording_status==='recording'&&exists==='true'&&r.capture_stop_requested_at&&!r.capture_stopped_at){
       // The request was committed before the handset was told it succeeded.
       // Reissue only the exact private stop while waiting for RECORD_STOP;
       // the user never needs to tap Stop again after a reconnect.
       await transport.api(`uuid_record ${r.call_uuid} stop /var/lib/freeswitch/recordings/phone11/${r.tenant_id}/${r.capture_token}.wav`);
      }else if(r.recording_status==='recording'&&exists==='true'&&(r.mode==='off'||r.expired||process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true')){
       await transport.api(`uuid_record ${r.call_uuid} stop /var/lib/freeswitch/recordings/phone11/${r.tenant_id}/${r.capture_token}.wav`);
       const lease={channelUuid:r.call_uuid,callUuid:r.call_uuid,tenantId:Number(r.tenant_id),extensionId:Number(r.extension_id),token:r.capture_token,path:`/var/lib/freeswitch/recordings/phone11/${r.tenant_id}/${r.capture_token}.wav`};await spool.discardCompleted(lease);await ledger.failed(lease,'policy_revoked');
      }else if(r.recording_status==='recording'&&exists==='false'){
       // Verified channel absence means its attached media recorder has ended.
       if(r.expired||r.mode==='off'||process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true'){
        const lease={channelUuid:r.call_uuid,callUuid:r.call_uuid,tenantId:Number(r.tenant_id),extensionId:Number(r.extension_id),token:r.capture_token,path:`/var/lib/freeswitch/recordings/phone11/${r.tenant_id}/${r.capture_token}.wav`};
        await spool.discardCompleted(lease);await ledger.failed(lease,'policy_revoked');continue;
       }
       const path=`/var/lib/freeswitch/recordings/phone11/${r.tenant_id}/${r.capture_token}.wav`;
       try{await capture.recordingStopped(r.call_uuid,path);}catch{
        // A stop event can arrive while FreeSWITCH is tearing down a failed
        // channel. Keep retrying when a private WAV exists, but release an old
        // file-less lease so the user can retry instead of seeing “recording”.
        const stopped=Date.parse(String(r.capture_stopped_at??''));
        const spoolPath=join(config.spoolDirectory,r.capture_token+'.wav');
        if(Number.isFinite(stopped)&&Date.now()-stopped>=STOP_FINALIZATION_GRACE_MS&&!await captureFileExists(path)&&!await captureFileExists(spoolPath)){
         const lease={channelUuid:r.call_uuid,callUuid:r.call_uuid,tenantId:Number(r.tenant_id),extensionId:Number(r.extension_id),token:r.capture_token,path};
         await spool.discardCompleted(lease);await ledger.failed(lease,'capture_failed');
        }
       }
      }else if(r.recording_status==='off'&&exists==='true'){
       const peer=(await transport.api(`uuid_getvar ${r.call_uuid} signal_bond`)).trim();
       if(/^[0-9a-f-]{36}$/i.test(peer)&&peer!==r.call_uuid)await capture.start(r.call_uuid,{kind:'automatic'});
      }
     }catch{/* Durable state is retained; next bounded tick reconciles. */}
    }
    for(const job of await ledger.pendingUploads()){
     try{await capture.recordingStopped(job.channelUuid,job.path);}catch{/* Durable lease release permits retry. */}
    }
   }finally{running=false;}
  },
 };
}

let service:ReturnType<typeof createRecordingCaptureService>|undefined;
export function configuredRecordingCapture(cleanupOnly=false){
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true'&&!cleanupOnly)return null;
 if(!service){
  const host=process.env.PHONE11_RECORDING_ESL_HOST,password=process.env.PHONE11_RECORDING_ESL_PASSWORD;
  const announcementPath=process.env.PHONE11_RECORDING_ANNOUNCEMENT_PATH,spoolDirectory=process.env.PHONE11_RECORDING_SPOOL_PATH;
  const uploadEndpoint=process.env.PHONE11_RECORDING_UPLOAD_URL,integrationSecret=process.env.FS_SHARED_SECRET;
  if(!host||!password||!announcementPath||!spoolDirectory||!uploadEndpoint||!integrationSecret){if(cleanupOnly&&process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=='true')return null;throw new Error('Recording capture is not configured');}
  service=createRecordingCaptureService({esl:{host,password,port:Number(process.env.PHONE11_RECORDING_ESL_PORT??8021),announcementPath},spoolDirectory,uploadEndpoint,integrationSecret});
 }
 return service;
}
export function startRecordingCaptureService():()=>void {
 let instance:ReturnType<typeof createRecordingCaptureService>|null;
 try{instance=configuredRecordingCapture(true);}catch{console.warn('[Recordings] Capture configuration unavailable');return ()=>{};}
 if(!instance)return ()=>{};
 let stopped=false;const tick=()=>{if(!stopped)void instance!.tick().catch(()=>console.warn('[Recordings] Capture reconciliation unavailable'));};
 const timer=setInterval(tick,2000);timer.unref();tick();return ()=>{stopped=true;clearInterval(timer);};
}
