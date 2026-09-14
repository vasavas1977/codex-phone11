import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertSanitizedDeviceEvidence,collectDeviceEvidence} from '../lab/android/device-evidence.mjs';
import {validateDeviceEvidence} from '../lab/android/push-live.mjs';

const packageName='ai.phone11.mobile.staging',senderId='123456789012';
const appId=`1:${senderId}:android:0123456789abcdef`,projectId='phone11-staging-lab';
const manifest=`<manifest package="${packageName}"><application><service android:name="ai.phone11.siprix.Phone11IncomingCallService" android:enabled="true"/><service android:name="ai.phone11.siprix.Phone11FirebaseMessagingService" android:enabled="true"/></application></manifest>`;
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phone11-device-evidence-')),apk=path.join(dir,'staging.apk');fs.writeFileSync(apk,'exact-apk');
 const sha=createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),commit='a'.repeat(40);
 fs.writeFileSync(path.join(dir,'identity.json'),JSON.stringify({apk,sha256:sha,commit,sourceDirty:false,packageName}));
 const calls=[];const execute=(_command,args)=>{calls.push(args);
  const value=args.join(' ');
  if(value.includes('emu avd name'))return 'Phone11_Lab_API35\nOK\n';
  if(value.includes('ro.build.version.sdk'))return '35\n';if(value.includes('ro.product.cpu.abi'))return 'arm64-v8a\n';
  if(value.includes('pm path com.google.android.gms'))return 'package:/product/priv-app/GmsCore/base.apk\n';
  if(value.includes(`pm path ${packageName}`))return `package:/data/app/isolated/${packageName}/base.apk\n`;
  if(value.includes('sha256sum'))return `${sha}  /data/app/isolated/${packageName}/base.apk\n`;
  if(value.includes('manifest application-id'))return `${packageName}\n`;if(value.includes('manifest print'))return manifest;
  if(value.includes('dumpsys package'))return `Package [${packageName}] flags=[ HAS_CODE ]\n User 0: installed=true enabled=0\n`;
  if(value.includes('query-services'))return `${packageName}/ai.phone11.siprix.Phone11FirebaseMessagingService\n`;
  if(value.includes('--name google_app_id'))return `${appId}\n`;if(value.includes('--name gcm_defaultSenderId'))return `${senderId}\n`;
  if(value.includes('--name project_id'))return `${projectId}\n`;throw new Error(`unexpected command ${value}`);
 };
 return {dir,sha,commit,calls,execute,source:{LAB_EMULATOR_SERIAL:'emulator-5580',LAB_STAGING_APK_IDENTITY_FILE:'identity.json',ANDROID_HOME:'/sdk'}};
}

test('collector emits the exact sanitized schema accepted by live FCM device validation',()=>{
 const value=fixture();try{const evidence=collectDeviceEvidence({source:value.source,execute:value.execute,projectRoot:value.dir});
  assert.deepEqual(evidence,{serial:'emulator-5580',avdName:'Phone11_Lab_API35',apiLevel:35,abi:'arm64-v8a',googlePlayServicesPresent:true,packageName,
   installedApkSha256:value.sha,sourceCommit:value.commit,firebaseProjectId:projectId,firebaseSenderId:senderId,firebaseAppId:appId,
   wakeServiceEnabled:true,firebaseServiceEnabled:true,debuggable:false,testOnly:false});
  assert.equal(validateDeviceEvidence(evidence,{serial:'emulator-5580',apkSha256:value.sha,sourceCommit:value.commit,projectId,senderId,firebaseAppId:appId}),true);
  assert.equal(value.calls.some(args=>args.includes('google_api_key')),false);assert.equal(value.calls.some(args=>args.some(arg=>/token/i.test(arg))),false);
 }finally{fs.rmSync(value.dir,{recursive:true,force:true});}
});

test('collector rejects APK drift, disabled services, debug flags, and inconsistent Firebase identity',()=>{
 for(const mutation of ['hash','service','debug','firebase']){const value=fixture();try{
  const base=value.execute;value.execute=(command,args)=>{
   const output=base(command,args),joined=args.join(' ');
   if(mutation==='hash'&&joined.includes('sha256sum'))return `${'f'.repeat(64)}  base.apk\n`;
   if(mutation==='service'&&joined.includes('manifest print'))return manifest.replace(`android:name="ai.phone11.siprix.Phone11IncomingCallService" android:enabled="true"`,`android:name="ai.phone11.siprix.Phone11IncomingCallService" android:enabled="false"`);
   if(mutation==='debug'&&joined.includes('dumpsys package'))return output.replace('HAS_CODE','HAS_CODE DEBUGGABLE');
   if(mutation==='firebase'&&joined.includes('--name gcm_defaultSenderId'))return '987654321098\n';return output;
  };
  if(mutation==='service'||mutation==='debug'){
   const evidence=collectDeviceEvidence({source:value.source,execute:value.execute,projectRoot:value.dir});
   assert.throws(()=>validateDeviceEvidence(evidence,{serial:'emulator-5580',apkSha256:value.sha,sourceCommit:value.commit,projectId,senderId,firebaseAppId:appId}));
  }else assert.throws(()=>collectDeviceEvidence({source:value.source,execute:value.execute,projectRoot:value.dir}));
 }finally{fs.rmSync(value.dir,{recursive:true,force:true});}}
});

test('sanitizer rejects extra provider fields and API-key-shaped values',()=>{
 const value=fixture();try{const evidence=collectDeviceEvidence({source:value.source,execute:value.execute,projectRoot:value.dir});
  assert.throws(()=>assertSanitizedDeviceEvidence({...evidence,token:'provider-value'}));
  assert.throws(()=>assertSanitizedDeviceEvidence({...evidence,firebaseProjectId:'AIzaSy012345678901234567890123456789012'}));
 }finally{fs.rmSync(value.dir,{recursive:true,force:true});}
});
