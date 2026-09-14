import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {assertSanitizedOneShotEvidence,buildFcmRequest,commissioned,parseRegistrationToken,sendOneShot} from '../lab/android/one-shot-fcm-send.mjs';

const token=`fcm:${'a'.repeat(132)}`,access=`ya29.${'b'.repeat(180)}`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const fixture=()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phone11-fcm-one-shot-')),evidenceDir=path.join(dir,'.lab/push-live');fs.mkdirSync(evidenceDir,{recursive:true});
  const device={serial:'emulator-5580',avdName:commissioned.avdName,apiLevel:commissioned.apiLevel,abi:commissioned.abi,googlePlayServicesPresent:true,packageName:commissioned.packageName,installedApkSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40),firebaseProjectId:commissioned.projectId,firebaseSenderId:commissioned.senderId,firebaseAppId:commissioned.appId,wakeServiceEnabled:true,firebaseServiceEnabled:true,debuggable:false,testOnly:false};
  fs.writeFileSync(path.join(evidenceDir,'device-evidence.json'),JSON.stringify(device));return {dir,device};
};
const xml=value=>`<?xml version='1.0'?><map><string name="|T|${commissioned.senderId}|*">{&quot;token&quot;:&quot;${value}&quot;,&quot;timestamp&quot;:1}</string></map>`;

test('extracts only the unique token for the commissioned sender from Firebase private state',()=>{
  assert.equal(parseRegistrationToken(`<map><string name="|T|999999|*">{&quot;token&quot;:&quot;${'x'.repeat(80)}&quot;}</string><string name="|T|${commissioned.senderId}|*">{&quot;token&quot;:&quot;${token}&quot;}</string></map>`),token);
  assert.throws(()=>parseRegistrationToken(`<map><string name="|T|${commissioned.senderId}|a">{&quot;token&quot;:&quot;${token}&quot;}</string><string name="|T|${commissioned.senderId}|b">{&quot;token&quot;:&quot;${'z'.repeat(80)}&quot;}</string></map>`),/Exactly one/);
});

test('builds the exact high-priority data-only wake envelope',()=>{
  const callUUID=randomUUID(),bindingId=randomUUID(),expiresAt=123456789;
  const request=buildFcmRequest({registrationToken:token,callUUID,bindingId,expiresAt});
  assert.deepEqual(Object.keys(request.message).sort(),['android','data','token']);
  assert.deepEqual(request.message.android,{priority:'HIGH',ttl:'0s',direct_boot_ok:true});
  assert.deepEqual(request.message.data,{v:'1',callUUID,bindingId,expiresAt:String(expiresAt)});
  assert.equal('notification' in request.message,false);
});

test('keeps credentials transient and writes only fixed sanitized evidence with mode 0600',async()=>{
  const {dir,device}=fixture(),commands=[],requests=[];
  const execute=(command,args)=>{
    commands.push({command,args});
    if(command==='gcloud')return `${access}\n`;
    const tail=args.slice(2).join(' ');
    if(tail==='emu avd name')return `${commissioned.avdName}\nOK\n`;
    if(tail==='shell getprop ro.build.version.sdk')return '35\n';
    if(tail==='shell getprop ro.product.cpu.abi')return `${commissioned.abi}\n`;
    if(tail==='shell id')return 'uid=0(root) gid=0(root)\n';
    if(tail===`shell pm path ${commissioned.packageName}`)return `package:/data/app/example/base.apk\n`;
    if(tail==='shell sha256sum /data/app/example/base.apk')return `${device.installedApkSha256}  /data/app/example/base.apk\n`;
    if(tail.startsWith('exec-out cat /data/user/0/'))return xml(token);
    throw new Error(`unexpected command ${tail}`);
  };
  const fetchFn=async(url,options)=>{requests.push({url,options});return {ok:true,status:200,text:async()=>JSON.stringify({name:`projects/${commissioned.projectId}/messages/0:abc`})};};
  const generated=['10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'],uuids=[...generated];
  const {evidence,output}=await sendOneShot({source:{PHONE11_FCM_ONE_SHOT_ENABLED:'1',LAB_EMULATOR_SERIAL:device.serial,ANDROID_HOME:'/sdk'},projectRoot:dir,execute,fetchFn,now:()=>1700000000000,uuid:()=>uuids.shift()});
  assert.equal(requests.length,1);assert.match(requests[0].url,/^https:\/\/fcm\.googleapis\.com\/v1\/projects\/phone11-stage-20260914\/messages:send$/);
  assert.equal(requests[0].options.headers.authorization,`Bearer ${access}`);assert.equal(requests[0].options.redirect,'error');
  const payload=JSON.parse(requests[0].options.body);assert.equal(payload.message.token,token);assert.deepEqual(Object.keys(payload.message.data).sort(),['bindingId','callUUID','expiresAt','v']);assert.equal('notification' in payload.message,false);
  const persisted=fs.readFileSync(output,'utf8');assert.deepEqual(JSON.parse(persisted),evidence);assert.equal(fs.statSync(output).mode&0o777,0o600);
  assert.equal(persisted.includes(token),false);assert.equal(persisted.includes(access),false);assert.equal(generated.some(value=>persisted.includes(value)),false);
  assert.equal(evidence.device.tokenFingerprint,sha(token).slice(0,16));assert.equal(evidence.provider.accepted,true);assertSanitizedOneShotEvidence(evidence,[token,access]);
  assert.equal(commands.some(({args})=>args.some(arg=>arg===token||arg===access)),false);
  assert.throws(()=>fs.accessSync(`${output}.lock`));
  await assert.rejects(()=>sendOneShot({source:{PHONE11_FCM_ONE_SHOT_ENABLED:'1',LAB_EMULATOR_SERIAL:device.serial,ANDROID_HOME:'/sdk'},projectRoot:dir,execute,fetchFn}),/already exists/);
});

test('retains a private lock after an uncertain provider request to prevent duplicate sends',async()=>{
  const {dir,device}=fixture();
  const execute=(command,args)=>{
    if(command==='gcloud')return access;
    const tail=args.slice(2).join(' ');
    return tail==='emu avd name'?commissioned.avdName:tail==='shell getprop ro.build.version.sdk'?'35':tail==='shell getprop ro.product.cpu.abi'?commissioned.abi:tail==='shell id'?'uid=0(root)':tail===`shell pm path ${commissioned.packageName}`?'package:/data/app/example/base.apk':tail==='shell sha256sum /data/app/example/base.apk'?`${device.installedApkSha256} /data/app/example/base.apk`:xml(token);
  };
  await assert.rejects(()=>sendOneShot({source:{PHONE11_FCM_ONE_SHOT_ENABLED:'1',LAB_EMULATOR_SERIAL:device.serial,ANDROID_HOME:'/sdk'},projectRoot:dir,execute,fetchFn:async()=>{throw new Error('uncertain network');}}),/uncertain network/);
  const lock=path.join(dir,'.lab/push-live',`first-provider-send-${device.sourceCommit.slice(0,7)}.json.lock`);assert.equal(fs.statSync(lock).mode&0o777,0o600);
});
