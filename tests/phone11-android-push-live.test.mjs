import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Blocked,createStagingController,liveFcmCases,liveFcmSampleCount,validateAttestation,validateCaseEvidence,validateCommissioning,validateDeviceEvidence} from '../lab/android/push-live.mjs';

const sender='123456789012',project='phone11-staging-lab',appId=`1:${sender}:android:0123456789abcdef`,commit='a'.repeat(40),apk='b'.repeat(64);
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phone11-push-live-')),executionId=randomUUID();
 const manifest={version:1,environment:'staging',packageName:'ai.phone11.mobile.staging',apk:{sha256:apk,sourceCommit:commit},firebase:{projectId:project,senderId:sender,appId},
  backend:{origin:'https://api.staging.phone11.invalid',triggerPath:'/api/phone11/lab/fcm-scenario',evidencePath:'/api/phone11/lab/wake-evidence',sourceCommit:commit},
  provider:{transport:'FCM_V1',credentialMode:'adc-service-account',projectId:project},capabilities:[...liveFcmCases],authorization:{executionId,expiresAt:Date.now()+60_000}};
 const manifestFile=path.join(dir,'commissioning.json'),secretFile=path.join(dir,'trigger.secret');fs.writeFileSync(manifestFile,JSON.stringify(manifest));fs.writeFileSync(secretFile,'s'.repeat(48));
 const env={LAB_PUSH_LIVE_COMMISSIONING_FILE:manifestFile,LAB_PUSH_LIVE_TRIGGER_SECRET_FILE:secretFile,LAB_EMULATOR_SERIAL:'emulator-5580',LAB_EXPECTED_APK_SHA256:apk,LAB_EXPECTED_SOURCE_COMMIT:commit,LAB_PUSH_LIVE_EXECUTION_ID:executionId};
 return {dir,manifest,env};
}
const blocked=fn=>assert.throws(fn,error=>error instanceof Blocked&&error.reasons.length>0);

test('real FCM preflight lists all missing inputs and refuses physical devices',()=>{
 blocked(()=>validateCommissioning({}));const f=fixture();try{blocked(()=>validateCommissioning({...f.env,LAB_EMULATOR_SERIAL:'R5TESTPHONE'}));}finally{fs.rmSync(f.dir,{recursive:true});}
});
test('commissioning binds exact staging APK, Firebase sender/app, backend and short authorization',()=>{
 const f=fixture();try{const value=validateCommissioning(f.env);assert.equal(value.document.packageName,'ai.phone11.mobile.staging');
  for(const change of [
   {LAB_EXPECTED_APK_SHA256:'c'.repeat(64)},{LAB_PUSH_LIVE_EXECUTION_ID:randomUUID()},
  ])blocked(()=>validateCommissioning({...f.env,...change}));
  f.manifest.backend.origin='https://api.phone11.invalid';fs.writeFileSync(f.env.LAB_PUSH_LIVE_COMMISSIONING_FILE,JSON.stringify(f.manifest));blocked(()=>validateCommissioning(f.env));
 }finally{fs.rmSync(f.dir,{recursive:true});}
});
test('backend attestation proves exact provider project and enrolled authenticated binding without secrets',()=>{
 const f=fixture();try{const now=Date.now(),base={v:1,environment:'staging',packageName:f.manifest.packageName,projectId:project,senderId:sender,firebaseAppId:appId,backendCommit:commit,
   provider:{transport:'FCM_V1',credentialProjectId:project,ready:true},enrollment:{packageName:f.manifest.packageName,platform:'android',tokenType:'fcm',registered:true,bindingId:randomUUID(),bindingExpiresAt:now+60_000}};
  assert.equal(validateAttestation(base,f.manifest,now),base);blocked(()=>validateAttestation({...base,projectId:'other-staging'},f.manifest,now));blocked(()=>validateAttestation({...base,enrollment:{...base.enrollment,token:'secret'}},f.manifest,now));
 }finally{fs.rmSync(f.dir,{recursive:true});}
});
test('device evidence binds the Google APIs emulator, exact release-like APK, Firebase resources and enabled native services',()=>{
 const f=fixture();try{const evidence={serial:'emulator-5580',avdName:'Phone11_Lab_API35',apiLevel:35,abi:'arm64-v8a',googlePlayServicesPresent:true,packageName:f.manifest.packageName,installedApkSha256:apk,sourceCommit:commit,
  firebaseProjectId:project,firebaseSenderId:sender,firebaseAppId:appId,wakeServiceEnabled:true,firebaseServiceEnabled:true,debuggable:false,testOnly:false};
  const identity={serial:evidence.serial,apkSha256:apk,sourceCommit:commit,projectId:project,senderId:sender,firebaseAppId:appId};assert.equal(validateDeviceEvidence(evidence,identity),true);
  blocked(()=>validateDeviceEvidence({...evidence,installedApkSha256:'c'.repeat(64)},identity));blocked(()=>validateDeviceEvidence({...evidence,wakeServiceEnabled:false},identity));blocked(()=>validateDeviceEvidence({...evidence,debuggable:true},identity));
 }finally{fs.rmSync(f.dir,{recursive:true});}
});
test('L3 evidence cannot pass from simulations, local broadcasts, identity drift, missing events, or secret-bearing events',()=>{
 const correlationId=randomUUID(),executionId=randomUUID(),identity={executionId,apkSha256:apk,projectId:project,senderId:sender};
 const events=['app_background','pending_created','fcm_provider_accepted','fcm_data_envelope','native_push_received','wake_owner_verified','notification_posted','notification_actions_verified','sip_invite_delivered','answer_action_accepted','call_connected','call_terminated','history_reconciled','cleanup_completed'].map((event,index)=>({event,source:'observed',timestampMs:1000+index,correlationId,
  ...(event==='fcm_provider_accepted'?{transport:'FCM_V1',messageNameHash:'d'.repeat(64)}:{}),...(event==='fcm_data_envelope'?{keys:['v','callUUID','bindingId','expiresAt']}: {})}));
 const base={source:'real_fcm_v1',simulated:false,localBroadcast:false,testId:'PUSH-01',executionId,correlationId,apkSha256:apk,packageName:'ai.phone11.mobile.staging',projectId:project,senderId:sender,events};
 assert.equal(validateCaseEvidence('PUSH-01',base,identity),true);
 for(const bad of [{...base,source:'synthetic'},{...base,localBroadcast:true},{...base,apkSha256:'e'.repeat(64)},{...base,events:events.slice(1)},{...base,events:[...events,{event:'extra',source:'observed',timestampMs:2000,correlationId,token:'secret'}]}])blocked(()=>validateCaseEvidence('PUSH-01',bad,identity));
});
test('matrix covers background, locked, Doze, duplicates, expiry, ownership, provider failure, process death and permission fallbacks',()=>{
 assert.deepEqual(liveFcmCases,['PUSH-01','PUSH-02','PUSH-03','PUSH-04','PUSH-05','PUSH-06','PUSH-07','PUSH-08','PUSH-09','LIFE-04','LIFE-05','PERM-02','PERM-03']);
 assert.equal(liveFcmSampleCount('PUSH-01'),20);assert.equal(liveFcmSampleCount('PUSH-03'),20);assert.equal(liveFcmSampleCount('PUSH-04'),1);assert.equal(liveFcmSampleCount('unknown'),0);
});
test('staging controller uses only isolated attestation/driver routes, bounded real case correlation and sanitized evidence',async()=>{
 const f=fixture();try{const correlationId=randomUUID(),requests=[];const evidenceEvents=['app_background','pending_created','fcm_provider_accepted','fcm_data_envelope','native_push_received','wake_owner_verified','notification_posted','notification_actions_verified','sip_invite_delivered','answer_action_accepted','call_connected','call_terminated','history_reconciled','cleanup_completed'].map((event,index)=>({event,source:'observed',timestampMs:1000+index,correlationId,
  ...(event==='fcm_provider_accepted'?{transport:'FCM_V1',messageNameHash:'d'.repeat(64)}:{}),...(event==='fcm_data_envelope'?{keys:['v','callUUID','bindingId','expiresAt']}: {})}));
 const fetchFn=async(url,options)=>{requests.push({url,options});if(String(url).includes('?'))return {ok:true,json:async()=>({source:'real_fcm_v1',simulated:false,localBroadcast:false,testId:'PUSH-01',executionId:f.manifest.authorization.executionId,correlationId,apkSha256:apk,packageName:f.manifest.packageName,projectId:project,senderId:sender,events:evidenceEvents})};
  return {ok:true,json:async()=>({accepted:true,testId:'PUSH-01',correlationId})};};
 const config={document:f.manifest,secret:'z'.repeat(48),backend:new URL(f.manifest.backend.origin)};const controller=createStagingController(config,fetchFn);
 await controller.trigger('PUSH-01',correlationId);const evidence=await controller.evidence('PUSH-01',correlationId);assert.equal(evidence.testId,'PUSH-01');assert.equal(requests.length,2);
 assert.match(requests[0].url,/^https:\/\/api\.staging\.phone11\.invalid\/api\/phone11\/lab\/fcm-scenario$/);assert.match(requests[1].url,/\/api\/phone11\/lab\/wake-evidence\?/);
 assert.equal(requests[0].options.headers['x-phone11-lab-secret'],'z'.repeat(48));assert.doesNotMatch(JSON.stringify(evidence),/zzzzzz/);
 }finally{fs.rmSync(f.dir,{recursive:true});}
});
