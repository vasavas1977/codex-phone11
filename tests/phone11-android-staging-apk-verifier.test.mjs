import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {STAGING_IDENTITY,verifyStagingApk} from '../lab/android/verify-staging-apk.mjs';

const commit='a'.repeat(40);
function fixture(){
 const directory=mkdtempSync(path.join(tmpdir(),'phone11-staging-apk-'));
 const apk=path.join(directory,'phone11-staging.apk');
 const bytes=Buffer.from('bounded synthetic APK bytes');writeFileSync(apk,bytes);
 return {directory,apk,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function outputs(changes={}){
 const service=name=>`<service android:name="${name}" android:enabled="true" android:exported="false" />`;
 const manifest=`<manifest package="${changes.packageName??STAGING_IDENTITY.packageName}"><application>
  <meta-data android:name="ai.phone11.androidWakeCommissioned" android:value="${changes.commissioned??'true'}" />
  <meta-data android:name="ai.phone11.androidWakeEnvironment" android:value="${changes.environment??'staging'}" />
  ${service('ai.phone11.siprix.Phone11IncomingCallService')}
  <service android:name="ai.phone11.siprix.Phone11FirebaseMessagingService" android:enabled="${changes.fcmEnabled??'true'}" android:exported="false" />
 </application></manifest>`;
 const files=(changes.files??[
  '/lib/arm64-v8a/libreactnative.so','/lib/arm64-v8a/libsiprix.so','/lib/arm64-v8a/libsiprixMedia.so',
 ]).join('\n');
 return args=>{
  const command=args.slice(0,-1).join(' ');
  if(command==='manifest application-id')return changes.packageName??STAGING_IDENTITY.packageName;
  if(command==='manifest print')return manifest;
  if(command==='files list')return files;
  const name=args[args.indexOf('--name')+1];
  return {google_app_id:changes.appId??STAGING_IDENTITY.appId,
   gcm_defaultSenderId:changes.senderId??STAGING_IDENTITY.senderId,
   project_id:changes.projectId??STAGING_IDENTITY.projectId}[name]??'';
 };
}
function verify(file,changes={},options={}){
 return verifyStagingApk({apkPath:file.apk,expectedSha256:file.sha256,expectedSourceCommit:commit,...options},{runAnalyzer:outputs(changes)});
}

test('accepts exact commissioned ARM64 staging APK identity without secret fields',()=>{
 const file=fixture();try{
  const result=verify(file);
  assert.equal(result.ok,true,result.errors.join('\n'));
  assert.deepEqual(result.android.abis,['arm64-v8a']);
  assert.equal(result.firebase.projectId,STAGING_IDENTITY.projectId);
  assert.equal(JSON.stringify(result).includes('api_key'),false);
 }finally{rmSync(file.directory,{recursive:true,force:true});}
});

test('rejects ordinary uncommissioned Phone11 lab APK',()=>{
 const file=fixture();try{
  const result=verify(file,{packageName:'ai.phone11.mobile.lab',commissioned:'false',environment:'',fcmEnabled:'false'});
  assert.equal(result.ok,false);
  assert.match(result.errors.join('\n'),/package must be ai\.phone11\.mobile\.staging/);
  assert.match(result.errors.join('\n'),/commissioning metadata is not enabled/);
  assert.match(result.errors.join('\n'),/Phone11FirebaseMessagingService is not explicitly enabled/);
 }finally{rmSync(file.directory,{recursive:true,force:true});}
});

test('rejects Firebase project sender and app mismatches',()=>{
 const file=fixture();try{
  const result=verify(file,{projectId:'other-stage-project',senderId:'999999999999',appId:'1:999999999999:android:aaaaaaaaaaaaaaaa'});
  assert.equal(result.ok,false);
  assert.deepEqual(result.errors.filter(value=>value.startsWith('Firebase')),['Firebase project identity mismatch','Firebase sender identity mismatch','Firebase Android app identity mismatch']);
 }finally{rmSync(file.directory,{recursive:true,force:true});}
});

test('rejects missing or mixed native ABI bundles',()=>{
 const file=fixture();try{
  const result=verify(file,{files:['/lib/arm64-v8a/libsiprix.so','/lib/x86_64/libsiprix.so']});
  assert.equal(result.ok,false);
  assert.match(result.errors.join('\n'),/only arm64-v8a/);
  assert.match(result.errors.join('\n'),/libreactnative\.so is missing/);
  assert.match(result.errors.join('\n'),/libsiprixMedia\.so is missing/);
 }finally{rmSync(file.directory,{recursive:true,force:true});}
});

test('rejects APK hash and source provenance failures',()=>{
 const file=fixture();try{
  assert.match(verify(file,{}, {expectedSha256:'b'.repeat(64)}).errors.join('\n'),/SHA-256 mismatch/);
  assert.match(verify(file,{}, {expectedSourceCommit:'short'}).errors.join('\n'),/40-character source commit is required/);
  const identity=path.join(file.directory,'identity.json');
  writeFileSync(identity,JSON.stringify({apk:file.apk,sha256:file.sha256,commit,sourceDirty:true}));
  assert.match(verify(file,{}, {identityFile:identity}).errors.join('\n'),/dirty source tree/);
 }finally{rmSync(file.directory,{recursive:true,force:true});}
});
