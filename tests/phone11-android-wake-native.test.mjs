import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {androidWakeBuildSettings,configureLabManifest,labSipSettings}=require('../plugins/with-phone11-android-lab.js');
const stagingPackage='ai.phone11.mobile.staging';
const senderId='123456789012';
const appId=`1:${senderId}:android:0123456789abcdef`;
const firebaseDocument=(changes={})=>({
 project_info:{project_number:senderId,project_id:'phone11-staging-lab',...(changes.project_info??{})},
 client:[{client_info:{mobilesdk_app_id:appId,android_client_info:{package_name:stagingPackage},
  ...(changes.client_info??{})}}],
 ...changes.root,
});
const commissioned=file=>({PHONE11_ANDROID_WAKE_COMMISSIONED:'1',PHONE11_ANDROID_FIREBASE_COMMISSIONED:'1',
 PHONE11_ANDROID_WAKE_ENVIRONMENT:'staging',PHONE11_ANDROID_LAB:'1',PHONE11_ANDROID_LAB_PACKAGE:stagingPackage,
 EXPO_PUBLIC_PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_SIP_ENGINE:'siprix',
 EXPO_PUBLIC_API_BASE_URL:'https://api.staging.phone11.invalid',PHONE11_ANDROID_SIP_HOST:'sip.staging.phone11.invalid',
 PHONE11_ANDROID_FIREBASE_PROJECT_ID:'phone11-staging-lab',PHONE11_ANDROID_FIREBASE_SENDER_ID:senderId,
 PHONE11_ANDROID_FIREBASE_APP_ID:appId,PHONE11_ANDROID_GOOGLE_SERVICES_FILE:file});

test('Android wake defaults to an explicit uncommissioned state and rejects partial gates',()=>{
 assert.deepEqual(androidWakeBuildSettings({}),{gate:'0',firebaseGate:'0',environment:undefined,firebase:undefined,apiBaseUrl:undefined});
 for(const env of [
  {PHONE11_ANDROID_WAKE_COMMISSIONED:'true'},
  {PHONE11_ANDROID_FIREBASE_COMMISSIONED:'1'},
  {PHONE11_ANDROID_WAKE_COMMISSIONED:'1'},
  {PHONE11_ANDROID_WAKE_ENVIRONMENT:'staging'},
  {PHONE11_ANDROID_FIREBASE_PROJECT_ID:'phone11-staging-lab'},
 ])assert.throws(()=>androidWakeBuildSettings(env));
});

test('commissioned Android wake validates isolated Firebase identity and staging endpoints',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'phone11-firebase-config-'));const file=path.join(dir,'google-services.json');
 try{
  writeFileSync(file,JSON.stringify(firebaseDocument()));
  const source=commissioned(file);
  const settings=androidWakeBuildSettings(source,{packageName:stagingPackage,projectRoot:dir});
  assert.equal(settings.gate,'1');assert.equal(settings.firebaseGate,'1');assert.equal(settings.environment,'staging');
  assert.equal(settings.apiBaseUrl,source.EXPO_PUBLIC_API_BASE_URL);
  assert.deepEqual(settings.firebase,{projectId:'phone11-staging-lab',senderId,appId,googleServicesFile:realpathSync(file)});
  for(const [change,options={}] of [
   [{PHONE11_ANDROID_LAB:'0'}],[{EXPO_PUBLIC_PHONE11_ANDROID_LAB:'0'}],[{EXPO_PUBLIC_SIP_ENGINE:'pjsip'}],
   [{PHONE11_ANDROID_WAKE_ENVIRONMENT:'production'}],[{EXPO_PUBLIC_API_BASE_URL:'https://api.phone11.ai'}],
   [{EXPO_PUBLIC_API_BASE_URL:'http://api.staging.phone11.invalid'}],[{PHONE11_ANDROID_SIP_HOST:'sip.phone11.ai'}],
   [{PHONE11_ANDROID_FIREBASE_PROJECT_ID:'phone11-production'}],[{PHONE11_ANDROID_FIREBASE_PROJECT_ID:'your-project-staging'}],
   [{PHONE11_ANDROID_FIREBASE_SENDER_ID:'000000000000'}],[{PHONE11_ANDROID_FIREBASE_APP_ID:`1:999999999999:android:0123456789abcdef`}],
   [{PHONE11_ANDROID_GOOGLE_SERVICES_FILE:'missing.json'}],
   [{},{packageName:'ai.phone11.mobile'}],[{},{packageName:'ai.phone11.mobile.lab'}],
  ])assert.throws(()=>androidWakeBuildSettings({...source,...change},{packageName:options.packageName??stagingPackage,projectRoot:dir}));

  for(const document of [
   firebaseDocument({project_info:{project_id:'other-staging-project'}}),
   firebaseDocument({project_info:{project_number:'987654321098'}}),
   firebaseDocument({client_info:{mobilesdk_app_id:`1:${senderId}:android:fedcba9876543210`}}),
   firebaseDocument({client_info:{android_client_info:{package_name:'ai.phone11.mobile'}}}),
   {...firebaseDocument(),client:[...firebaseDocument().client,...firebaseDocument().client]},
  ]){
   writeFileSync(file,JSON.stringify(document));
   assert.throws(()=>androidWakeBuildSettings(source,{packageName:stagingPackage,projectRoot:dir}));
  }
  writeFileSync(file,'not json');
  assert.throws(()=>androidWakeBuildSettings(source,{packageName:stagingPackage,projectRoot:dir}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

function manifest(){return {$:{},application:[{$:{},'meta-data':[],service:[]}],'uses-permission':[]};}
const named=(entries,name)=>(entries??[]).filter(entry=>entry.$['android:name']===name);

test('manifest has one non-exported notification service which is disabled until commissioned',()=>{
 const settings=labSipSettings('ai.phone11.mobile.lab',{});
 const value=manifest();configureLabManifest(value,settings);configureLabManifest(value,settings);
 const app=value.application[0];
 const service=named(app.service,'ai.phone11.siprix.Phone11IncomingCallService');
 assert.equal(service.length,1);assert.equal(service[0].$['android:exported'],'false');
 assert.equal(service[0].$['android:enabled'],'false');
 const fcm=named(app.service,'ai.phone11.siprix.Phone11FirebaseMessagingService');
 assert.equal(fcm.length,1);assert.equal(fcm[0].$['android:exported'],'false');
 assert.equal(fcm[0].$['android:enabled'],'false');
 assert.equal(fcm[0].$['tools:ignore'],'Instantiatable');
 assert.equal(fcm[0]['intent-filter'][0].action[0].$['android:name'],'com.google.firebase.MESSAGING_EVENT');
 assert.equal(named(app.service,'expo.modules.notifications.service.ExpoFirebaseMessagingService')[0].$['android:enabled'],'true');
 assert.equal(named(app['meta-data'],'ai.phone11.androidWakeCommissioned')[0].$['android:value'],'false');
 assert.equal(named(app['meta-data'],'ai.phone11.androidWakeEnvironment').length,0);
 configureLabManifest(value,settings,{gate:'1',environment:'staging'});
 assert.equal(named(app.service,'ai.phone11.siprix.Phone11IncomingCallService').length,1);
 assert.equal(named(app.service,'ai.phone11.siprix.Phone11IncomingCallService')[0].$['android:enabled'],'true');
 assert.equal(named(app.service,'ai.phone11.siprix.Phone11FirebaseMessagingService').length,1);
 assert.equal(named(app.service,'ai.phone11.siprix.Phone11FirebaseMessagingService')[0].$['android:enabled'],'true');
 assert.equal(named(app.service,'ai.phone11.siprix.Phone11FirebaseMessagingService')[0].$['tools:replace'],'android:enabled');
 assert.equal(named(app.service,'expo.modules.notifications.service.ExpoFirebaseMessagingService')[0].$['android:enabled'],'false');
 assert.equal(named(app['meta-data'],'ai.phone11.androidWakeCommissioned')[0].$['android:value'],'true');
 assert.equal(named(app['meta-data'],'ai.phone11.androidWakeEnvironment')[0].$['android:value'],'staging');
});

test('pure JVM FCM ingress refuses malformed, replayed and unauthenticated ownership',()=>{
 const root=path.resolve(new URL('..',import.meta.url).pathname);const out=mkdtempSync(path.join(tmpdir(),'phone11-fcm-jvm-'));
 try{
  const sources=['Phone11PendingWakeStore.java','Phone11FcmWakeEnvelope.java'].map(file=>path.join(root,
   'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix',file));
  const contract=path.join(root,'lab/android/java-tests/FcmWakeEnvelopeTest.java');
  const compile=spawnSync('javac',['-d',out,...sources,contract],{encoding:'utf8',timeout:120000});
  assert.equal(compile.status,0,compile.error?.message??compile.stderr);
  const run=spawnSync('java',['-ea','-cp',out,'ai.phone11.siprix.FcmWakeEnvelopeTest'],{encoding:'utf8',timeout:120000});
  assert.equal(run.status,0,run.error?.message??run.stderr);
  assert.match(run.stdout,/PASS: 26 Android FCM ingress assertions/);
 }finally{rmSync(out,{recursive:true,force:true});}
});

test('FCM adapter stays data-only and contains no token logging or network/send path',()=>{
 const root=path.resolve(new URL('..',import.meta.url).pathname);
 const source=require('node:fs').readFileSync(path.join(root,
  'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11FirebaseMessagingService.java'),'utf8');
 assert.match(source,/getNotification\(\) != null/);
 assert.match(source,/extends ExpoFirebaseMessagingService/);
 assert.match(source,/super\.onMessageReceived\(message\)/);
 assert.match(source,/Decision\.ACCEPTED/);
 assert.doesNotMatch(source,/\b(Log\.|System\.out|Http|URL|OkHttp|send\w*\()/);
 assert.doesNotMatch(source,/putExtra\([^\n]*(grant|password|token)/i);
 const runtime=require('node:fs').readFileSync(path.join(root,
  'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11AndroidWakeRuntime.java'),'utf8');
 assert.match(runtime,/FirebaseApp\.getInstance\(\)\.getOptions\(\)/);
 assert.match(runtime,/getApplicationId\(\).*getGcmSenderId\(\)/s);
 assert.match(runtime,/getGcmSenderId\(\).*getProjectId\(\)/s);
});

test('pure JVM persisted wake contract covers replay expiry cancellation rotation and logout',()=>{
 const root=path.resolve(new URL('..',import.meta.url).pathname);const out=mkdtempSync(path.join(tmpdir(),'phone11-wake-jvm-'));
 try{
  const source=path.join(root,'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11PendingWakeStore.java');
  const contract=path.join(root,'lab/android/java-tests/PendingWakeStoreTest.java');
  const compile=spawnSync('javac',['-d',out,source,contract],{encoding:'utf8',timeout:120000});
  assert.equal(compile.status,0,compile.error?.message??compile.stderr);
  const run=spawnSync('java',['-ea','-cp',out,'ai.phone11.siprix.PendingWakeStoreTest'],{encoding:'utf8',timeout:120000});
  assert.equal(run.status,0,run.error?.message??run.stderr);assert.match(run.stdout,/PASS: 21 persisted Android wake assertions/);
 }finally{rmSync(out,{recursive:true,force:true});}
});

test('pure JVM wake enrollment validates identity expiry rotation and public grant exclusion',()=>{
 const root=path.resolve(new URL('..',import.meta.url).pathname);const out=mkdtempSync(path.join(tmpdir(),'phone11-enrollment-jvm-'));
 try{
  const source=path.join(root,'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11WakeEnrollmentStore.java');
  const contract=path.join(root,'lab/android/java-tests/WakeEnrollmentStoreTest.java');
  const compile=spawnSync('javac',['-d',out,source,contract],{encoding:'utf8',timeout:120000});
  assert.equal(compile.status,0,compile.error?.message??compile.stderr);
  const run=spawnSync('java',['-ea','-cp',out,'ai.phone11.siprix.WakeEnrollmentStoreTest'],{encoding:'utf8',timeout:120000});
  assert.equal(run.status,0,run.error?.message??run.stderr);
  assert.match(run.stdout,/PASS: 23 Android wake enrollment assertions/);
 }finally{rmSync(out,{recursive:true,force:true});}
});

test('Android enrollment bridge uses provider token storage and encrypted grant persistence only',()=>{
 const root=path.resolve(new URL('..',import.meta.url).pathname);const fs=require('node:fs');
 const module=fs.readFileSync(path.join(root,
  'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11SiprixModule.java'),'utf8');
 const service=fs.readFileSync(path.join(root,
  'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11FirebaseMessagingService.java'),'utf8');
 const encrypted=fs.readFileSync(path.join(root,
  'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11EncryptedWakeEnrollmentPersistence.java'),'utf8');
 const wrapper=fs.readFileSync(path.join(root,'lib/push/native-voip.ts'),'utf8');
 for(const method of ['getCapabilities','start','currentToken','createDeviceId','saveWakeEnrollment','getWakeBinding','stop'])
  assert.match(module,new RegExp(`void ${method}\\(`));
 assert.match(module,/FirebaseMessaging\.getInstance\(\)\.getToken\(\)/);
 assert.match(module,/Phone11VoipTokenChanged/);
 assert.doesNotMatch(module,/Phone11VoipToken[^C]/);
 assert.match(service,/publishFirebaseToken\(token\)/);
 assert.match(encrypted,/AndroidKeyStore/);assert.match(encrypted,/AES\/GCM\/NoPadding/);
 assert.doesNotMatch(module,/SharedPreferences|putString\([^\n]*token|\b(Log\.|System\.out)/i);
 assert.doesNotMatch(service,/\b(Log\.|System\.out|putString\([^\n]*token)/i);
 assert.match(wrapper,/Platform\.OS === "android" \? NativeModules\.Phone11Siprix/);
 assert.match(wrapper,/getCurrentNativeVoipToken/);
});
