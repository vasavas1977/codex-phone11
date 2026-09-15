/**
 * Real Android FCM evidence lane. The default command performs read-only local
 * preflight and records BLOCKED L3 rows. It can contact the isolated staging
 * backend only with --execute plus a short-lived commissioning manifest and
 * explicit execution ID. Synthetic/local broadcasts can never satisfy this lane.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sanitize} from './core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const expectedPackage='ai.phone11.mobile.staging';
const rows=['PUSH-01','PUSH-02','PUSH-03','PUSH-04','PUSH-05','PUSH-06','PUSH-07','PUSH-08','PUSH-09','LIFE-04','LIFE-05','PERM-02','PERM-03'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex=(size)=>(value)=>new RegExp(`^[a-f0-9]{${size}}$`,'i').test(value||'');
const staging=/(^|[.-])(staging|stage|sandbox|nonprod)([.-]|$)/i;
const placeholder=/(example|placeholder|changeme|replace[-_]?me|your[-_]|dummy|sample)/i;
const dataKeys=['bindingId','callUUID','expiresAt','v'];
const delivered=['pending_created','fcm_provider_accepted','fcm_data_envelope','native_push_received','wake_owner_verified','notification_posted','notification_actions_verified','sip_invite_delivered','answer_action_accepted','call_connected','call_terminated','history_reconciled'];
const requirements={
  'PUSH-01':['app_background',...delivered],
  'PUSH-02':['device_locked',...delivered],
  'PUSH-03':['device_doze_idle',...delivered],
  'PUSH-04':['fcm_provider_accepted','duplicate_delivery','one_native_call','one_notification','one_history_entry'],
  'PUSH-05':['fcm_provider_accepted','native_push_received','server_cancelled','notification_cleared','no_ghost_call'],
  'PUSH-06':['wake_expired','no_notification','no_ghost_call'],
  'PUSH-07':['token_rotated_register_first','old_binding_rejected','new_binding_received'],
  'PUSH-08':['owner_changed','wake_owner_rejected','no_sensitive_history'],
  'PUSH-09':['provider_unavailable','bounded_expiry','no_late_call'],
  'LIFE-04':['process_absent','package_not_force_stopped','process_started',...delivered],
  'LIFE-05':['package_force_stopped','fcm_provider_accepted','no_push_delivery','explicit_relaunch','enrollment_restored'],
  'PERM-02':['notifications_denied','fcm_provider_accepted','native_push_received','permission_fallback_observed','no_forced_permission_change'],
  'PERM-03':['full_screen_denied','fcm_provider_accepted','native_push_received','notification_posted','notification_actions_verified','notification_fallback_observed','no_background_activity_start'],
};

export class Blocked extends Error { constructor(reasons){super(reasons.join('; '));this.reasons=reasons;} }
const readJson=(file,label)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Blocked([`${label} is missing or invalid JSON`]);}};
const realFile=(value,label)=>{
  if(!value)return {error:`${label} is not configured`};
  try {const file=fs.realpathSync(path.resolve(root,value));return fs.statSync(file).isFile()?{file}:{error:`${label} is not a file`};}
  catch{return {error:`${label} is missing`};}
};
const strictHttps=(value,label)=>{
  try {const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!staging.test(url.hostname)||placeholder.test(url.hostname))throw new Error();return url;}
  catch{throw new Blocked([`${label} must be an isolated HTTPS staging URL`]);}
};

export function validateCommissioning(source=process.env,now=Date.now()){
  const missing=[];
  for(const name of ['LAB_PUSH_LIVE_COMMISSIONING_FILE','LAB_PUSH_LIVE_TRIGGER_SECRET_FILE','LAB_EMULATOR_SERIAL','LAB_EXPECTED_APK_SHA256','LAB_EXPECTED_SOURCE_COMMIT'])
    if(!source[name])missing.push(`${name} is not configured`);
  if(missing.length)throw new Blocked(missing);
  if(!/^emulator-\d+$/.test(source.LAB_EMULATOR_SERIAL))throw new Blocked(['LAB_EMULATOR_SERIAL must select the dedicated emulator; physical devices are forbidden']);
  if(!hex(64)(source.LAB_EXPECTED_APK_SHA256))throw new Blocked(['LAB_EXPECTED_APK_SHA256 is invalid']);
  if(!hex(40)(source.LAB_EXPECTED_SOURCE_COMMIT))throw new Blocked(['LAB_EXPECTED_SOURCE_COMMIT is invalid']);
  const manifestFile=realFile(source.LAB_PUSH_LIVE_COMMISSIONING_FILE,'commissioning manifest');
  const secretFile=realFile(source.LAB_PUSH_LIVE_TRIGGER_SECRET_FILE,'trigger secret');
  const fileErrors=[manifestFile.error,secretFile.error].filter(Boolean);if(fileErrors.length)throw new Blocked(fileErrors);
  const document=readJson(manifestFile.file,'commissioning manifest');
  const reasons=[];
  if(document.version!==1)reasons.push('commissioning manifest version must be 1');
  if(document.environment!=='staging')reasons.push('commissioning environment must be staging');
  if(document.packageName!==expectedPackage)reasons.push(`commissioned package must be ${expectedPackage}`);
  if(document.apk?.sha256!==source.LAB_EXPECTED_APK_SHA256||document.apk?.sourceCommit!==source.LAB_EXPECTED_SOURCE_COMMIT)reasons.push('commissioned APK identity does not match the requested exact build');
  const project=document.firebase?.projectId,sender=String(document.firebase?.senderId??''),appId=document.firebase?.appId;
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project||'')||!staging.test(project)||placeholder.test(project))reasons.push('Firebase project is not an isolated staging project');
  if(!/^\d{6,20}$/.test(sender)||/^(\d)\1+$/.test(sender))reasons.push('Firebase sender ID is invalid');
  const appMatch=/^1:(\d{6,20}):android:[a-f0-9]{16,64}$/i.exec(appId||'');
  if(!appMatch||appMatch[1]!==sender)reasons.push('Firebase Android app ID does not match the sender');
  let backend;
  try {backend=strictHttps(document.backend?.origin,'backend origin');}catch(error){reasons.push(...error.reasons);}
  // The ordinary /wake/offer route is proxy-only and does not originate a SIP
  // call. L3 requires a separate isolated driver that creates a real pending
  // lab SIP call before the provider submission.
  if(document.backend?.triggerPath!=='/api/phone11/lab/fcm-scenario')reasons.push('backend trigger path is not the isolated real-SIP FCM scenario route');
  if(!/^\/api\/phone11\/lab\/wake-evidence$/.test(document.backend?.evidencePath||''))reasons.push('backend evidence path is missing the isolated read-only evidence route');
  if(!hex(40)(document.backend?.sourceCommit))reasons.push('backend exact source commit is missing');
  if(document.provider?.transport!=='FCM_V1'||document.provider?.credentialMode!=='adc-service-account'||document.provider?.projectId!==project)reasons.push('backend FCM v1 credential/project attestation is missing');
  if(!Array.isArray(document.capabilities)||rows.some(id=>!document.capabilities.includes(id)))reasons.push('commissioning manifest does not authorize every requested L3 case');
  if(!uuid.test(document.authorization?.executionId||'')||document.authorization?.executionId!==source.LAB_PUSH_LIVE_EXECUTION_ID)reasons.push('short-lived execution ID is absent or does not match');
  if(!Number.isSafeInteger(document.authorization?.expiresAt)||document.authorization.expiresAt<=now||document.authorization.expiresAt>now+3_600_000)reasons.push('commissioning authorization is expired or exceeds one hour');
  let secret='';try{secret=fs.readFileSync(secretFile.file,'utf8').trim();}catch{}
  if(secret.length<32||secret.length>512||placeholder.test(secret))reasons.push('trigger secret is absent, placeholder, or outside the accepted length');
  if(reasons.length)throw new Blocked(reasons);
  return {document,manifestFile:manifestFile.file,secretFile:secretFile.file,secret,backend};
}

export function validateDeviceEvidence(value,commissioning){
  const reasons=[];
  if(value?.serial!==commissioning.serial||!/^emulator-\d+$/.test(value?.serial||''))reasons.push('selected device is not the exact commissioned emulator');
  if(value?.avdName!=='Phone11_Lab_API35'||value?.apiLevel!==35||value?.abi!=='arm64-v8a')reasons.push('emulator image/API/ABI identity mismatch');
  if(value?.googlePlayServicesPresent!==true)reasons.push('Google Play services is unavailable');
  if(value?.packageName!==expectedPackage||value?.installedApkSha256!==commissioning.apkSha256)reasons.push('installed package/APK hash mismatch');
  if(value?.sourceCommit!==commissioning.sourceCommit)reasons.push('installed APK source commit mismatch');
  if(value?.firebaseProjectId!==commissioning.projectId||String(value?.firebaseSenderId)!==String(commissioning.senderId)||value?.firebaseAppId!==commissioning.firebaseAppId)reasons.push('installed Firebase resource identity mismatch');
  if(value?.wakeServiceEnabled!==true||value?.firebaseServiceEnabled!==true)reasons.push('commissioned native wake services are not enabled');
  if(value?.debuggable===true||value?.testOnly===true)reasons.push('debuggable/test-only APK cannot establish release-like L3 evidence');
  if(reasons.length)throw new Blocked(reasons);return true;
}

export function validateAttestation(value,commissioning,now=Date.now()){
  const reasons=[];
  if(value?.v!==1||value?.environment!=='staging')reasons.push('backend attestation version/environment mismatch');
  for(const [key,expected] of [['packageName',commissioning.packageName],['projectId',commissioning.firebase.projectId],['senderId',String(commissioning.firebase.senderId)],['firebaseAppId',commissioning.firebase.appId],['backendCommit',commissioning.backend.sourceCommit]])
    if(String(value?.[key]??'')!==String(expected))reasons.push(`backend attestation ${key} mismatch`);
  if(value?.provider?.transport!=='FCM_V1'||value?.provider?.credentialProjectId!==commissioning.firebase.projectId||value?.provider?.ready!==true)reasons.push('backend provider is not attested ready for the exact Firebase project');
  if(value?.enrollment?.packageName!==commissioning.packageName||value?.enrollment?.tokenType!=='fcm'||value?.enrollment?.platform!=='android'||value?.enrollment?.registered!==true)reasons.push('current Android FCM token enrollment is not attested');
  if(!uuid.test(value?.enrollment?.bindingId||'')||!Number.isSafeInteger(value?.enrollment?.bindingExpiresAt)||value.enrollment.bindingExpiresAt<=now)reasons.push('current authenticated wake binding is absent or expired');
  if('token' in (value?.enrollment||{})||'grant' in (value?.enrollment||{})||'sessionBinding' in (value?.enrollment||{}))reasons.push('backend attestation exposed a secret identifier');
  if(reasons.length)throw new Blocked(reasons);return value;
}

export function validateCaseEvidence(testId,value,identity){
  if(!rows.includes(testId))throw new Error('Unknown live FCM case');
  const reasons=[];
  if(value?.source!=='real_fcm_v1'||value?.simulated===true||value?.localBroadcast===true)reasons.push('evidence is not an actual FCM v1 delivery');
  if(value?.testId!==testId||value?.executionId!==identity.executionId||!uuid.test(value?.correlationId||''))reasons.push('case correlation identity mismatch');
  if(value?.apkSha256!==identity.apkSha256||value?.packageName!==expectedPackage||value?.projectId!==identity.projectId||String(value?.senderId)!==String(identity.senderId))reasons.push('case APK/Firebase identity mismatch');
  if(!Array.isArray(value?.events))reasons.push('sanitized event list is missing');
  const events=Array.isArray(value?.events)?value.events:[];
  const names=new Set(events.map(event=>event?.event));
  for(const event of requirements[testId])if(!names.has(event))reasons.push(`missing event ${event}`);
  if(!names.has('cleanup_completed'))reasons.push('case cleanup was not proved complete');
  if(events.some(event=>event?.source==='synthetic'||event?.source==='local_broadcast'||event?.token||event?.grant||event?.authorization))reasons.push('event stream contains fake evidence or secret material');
  for(const event of events)if(!Number.isSafeInteger(event?.timestampMs)||event.timestampMs<=0||event.correlationId!==value.correlationId)reasons.push('event timing/correlation is invalid');
  const envelope=events.find(event=>event.event==='fcm_data_envelope');
  if(envelope&&JSON.stringify([...(envelope.keys||[])].sort())!==JSON.stringify(dataKeys))reasons.push('FCM data envelope is not the exact four-field data-only contract');
  const accepted=events.find(event=>event.event==='fcm_provider_accepted');
  if(accepted&&(!hex(64)(accepted.messageNameHash)||accepted.transport!=='FCM_V1'))reasons.push('provider acceptance lacks a sanitized FCM v1 message identity');
  if(reasons.length)throw new Blocked(reasons);return true;
}

const bounded=async(run,timeoutMs)=>{
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30_000)throw new Error('Invalid live request timeout');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await run(controller.signal);}finally{clearTimeout(timer);}
};
const responseJson=async(response,label)=>{
  if(!response?.ok)throw new Blocked([`${label} returned ${Number(response?.status)||'an invalid response'}`]);
  try{return await response.json();}catch{throw new Blocked([`${label} did not return JSON`]);}
};

/** Network controller for a separately approved run. No method is called by default. */
export function createStagingController(config,fetchFn=fetch){
  const origin=config.backend.origin.replace(/\/$/,'');
  const headers={'content-type':'application/json','x-phone11-lab-secret':config.secret,'x-phone11-execution-id':config.document.authorization.executionId};
  const call=async(pathname,options,label)=>responseJson(await bounded(signal=>fetchFn(origin+pathname,{...options,headers:{...headers,...options?.headers},signal}),10_000),label);
  return {
    async attestation(){return validateAttestation(await call(config.document.backend.evidencePath,{method:'GET'},'staging attestation'),config.document);},
    async trigger(testId,correlationId){
      if(!rows.includes(testId)||!uuid.test(correlationId))throw new Error('Invalid live case identity');
      const body={v:1,executionId:config.document.authorization.executionId,testId,correlationId,apkSha256:config.document.apk.sha256};
      const value=await call(config.document.backend.triggerPath,{method:'POST',body:JSON.stringify(body)},'staging scenario trigger');
      if(value?.accepted!==true||value?.testId!==testId||value?.correlationId!==correlationId)throw new Blocked(['staging scenario was not accepted with the exact correlation']);
      return value;
    },
    async evidence(testId,correlationId){
      const query=new URLSearchParams({executionId:config.document.authorization.executionId,testId,correlationId});
      const value=await call(`${config.document.backend.evidencePath}?${query}`,{method:'GET'},'staging case evidence');
      validateCaseEvidence(testId,value,{executionId:config.document.authorization.executionId,apkSha256:config.document.apk.sha256,projectId:config.document.firebase.projectId,senderId:config.document.firebase.senderId});
      return sanitize(value,[config.secret]);
    },
  };
}

export const liveFcmSampleCount=testId=>['PUSH-01','PUSH-02','PUSH-03'].includes(testId)?20:rows.includes(testId)?1:0;

function publicPreflight(source,error){
  return sanitize({at:new Date().toISOString(),command:'lab:test:push:live',networkContacted:false,providerSendAttempted:false,
    configuredNames:Object.keys(source).filter(name=>name.startsWith('LAB_PUSH_LIVE_')||name.startsWith('LAB_EXPECTED_')).sort(),
    blockers:error instanceof Blocked?error.reasons:['Live FCM preflight failed']});
}
function appendBlocked(out,preflight){
  const ledger=path.join(out,'attempts-push-live.json');let previous=[];try{previous=JSON.parse(fs.readFileSync(ledger,'utf8'));if(!Array.isArray(previous))previous=[];}catch{}
  const signature=createHash('sha256').update(JSON.stringify(preflight.blockers)).digest('hex').slice(0,16);
  if(previous.some(row=>row.run_id===`push-live-preflight-${signature}`))return previous;
  const run=`push-live-preflight-${signature}`;
  for(const testId of rows){const attempt=1+Math.max(0,...previous.filter(row=>row.test_id===testId).map(row=>row.attempt||0));if(attempt>3)continue;
    previous.push({test_id:testId,run_id:run,attempt,evidence_level:'L3',mode:'real',result:'BLOCKED',reason:preflight.blockers.join('; '),execution_started:false,
      assertions:[],artifacts:[`push-live/${signature}/preflight.json`],cleanup_result:'completed',scope:'Read-only real-FCM preflight; no provider send or device mutation'});}
  fs.writeFileSync(ledger,JSON.stringify(previous,null,2),{mode:0o600});return previous;
}
function recordBlocked(out,source,error){
  const result=publicPreflight(source,error);const signature=createHash('sha256').update(JSON.stringify(result.blockers)).digest('hex').slice(0,16);
  const dir=path.join(out,'push-live',signature);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'preflight.json'),JSON.stringify(result,null,2),{mode:0o600});appendBlocked(out,result);return result;
}

export async function main(source=process.env){
  process.chdir(root);const out=path.join(root,'.lab');fs.mkdirSync(path.join(out,'push-live'),{recursive:true,mode:0o700});
  try{validateCommissioning(source);}catch(error){
    const result=recordBlocked(out,source,error);
    console.log(`BLOCKED L3: ${result.blockers.join('; ')}. No provider request or device mutation occurred.`);process.exitCode=2;return result;
  }
  // Commissioning alone is insufficient. Execution additionally requires an
  // exact installed APK and a real backend attestation. These checks are kept
  // behind --execute so the ordinary command remains read-only and offline.
  if(!process.argv.includes('--execute')){
    const error=new Blocked(['commissioning validated, but --execute was not supplied']);const result=recordBlocked(out,source,error);console.log(`BLOCKED L3: ${error.message}. No provider request or device mutation occurred.`);process.exitCode=2;return result;
  }
  const error=new Blocked(['real provider execution requires the isolated staging evidence endpoint and scenario driver; no send was attempted']);
  const result=recordBlocked(out,source,error);console.log(`BLOCKED L3: ${error.message}.`);process.exitCode=2;return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{
  console.error(`BLOCKED L3: ${error instanceof Blocked?error.message:'live FCM harness failed safely'}. No production target was contacted.`);process.exitCode=2;
});

export const liveFcmCases=rows;
