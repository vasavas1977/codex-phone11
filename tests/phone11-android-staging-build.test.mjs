import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {commissionedStagingEnv,commissionedStagingNames} from '../lab/android/staging-build-env.mjs';

const senderId='123456789012',appId=`1:${senderId}:android:0123456789abcdef`;
const cleanLabEnv={PATH:process.env.PATH,PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_PHONE11_ANDROID_LAB:'1',
 EXPO_PUBLIC_SIP_ENGINE:'siprix',EXPO_PUBLIC_API_BASE_URL:'http://10.0.2.2:18080',EXPO_NO_DOTENV:'1'};
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phone11-staging-build-')),file=path.join(dir,'google-services.json');
 fs.writeFileSync(file,JSON.stringify({project_info:{project_number:senderId,project_id:'phone11-staging-lab'},
  client:[{client_info:{mobilesdk_app_id:appId,android_client_info:{package_name:'ai.phone11.mobile.staging'}}}]}));
 return {dir,file,source:{
  PHONE11_ANDROID_WAKE_COMMISSIONED:'1',PHONE11_ANDROID_FIREBASE_COMMISSIONED:'1',
  PHONE11_ANDROID_WAKE_ENVIRONMENT:'staging',PHONE11_ANDROID_LAB_PACKAGE:'ai.phone11.mobile.staging',
  PHONE11_ANDROID_FIREBASE_PROJECT_ID:'phone11-staging-lab',PHONE11_ANDROID_FIREBASE_SENDER_ID:senderId,
  PHONE11_ANDROID_FIREBASE_APP_ID:appId,PHONE11_ANDROID_GOOGLE_SERVICES_FILE:file,
  PHONE11_ANDROID_SIP_HOST:'sip.staging.phone11.invalid',PHONE11_ANDROID_SIP_PORT:'15061',
  PHONE11_ANDROID_SIP_ACCOUNT_EXTENSIONS:'8101',PHONE11_ANDROID_SIP_DESTINATIONS:'8102,8190',
  EXPO_PUBLIC_API_BASE_URL:'https://api.staging.phone11.invalid',
 }};
}

test('commissioned build preserves only explicit staging inputs over the scrubbed lab environment',()=>{
 const value=fixture();try{
  const source={...value.source,PHONE11_PRODUCTION_SECRET:'must-not-pass',EXPO_PUBLIC_OWNER_TOKEN:'must-not-pass'};
  const result=commissionedStagingEnv(source,cleanLabEnv,value.dir);
  assert.equal(result.packageName,'ai.phone11.mobile.staging');
  assert.equal(result.settings.gate,'1');assert.equal(result.settings.firebaseGate,'1');
  for(const name of commissionedStagingNames)assert.equal(result.env[name],value.source[name]);
  assert.equal(result.env.PHONE11_PRODUCTION_SECRET,undefined);assert.equal(result.env.EXPO_PUBLIC_OWNER_TOKEN,undefined);
  assert.equal(result.env.PHONE11_ANDROID_LAB,'1');assert.equal(result.env.EXPO_PUBLIC_SIP_ENGINE,'siprix');
 }finally{fs.rmSync(value.dir,{recursive:true,force:true});}
});

test('commissioned build refuses missing, partial, production, and non-staging package inputs',()=>{
 const value=fixture();try{
  for(const changes of [
   {PHONE11_ANDROID_FIREBASE_COMMISSIONED:undefined},
   {PHONE11_ANDROID_WAKE_COMMISSIONED:'0'},
   {PHONE11_ANDROID_LAB_PACKAGE:'ai.phone11.mobile'},
   {EXPO_PUBLIC_API_BASE_URL:'https://api.phone11.ai'},
   {PHONE11_ANDROID_SIP_HOST:'sip.phone11.ai'},
  ]){
   const source={...value.source,...changes};
   for(const [name,item] of Object.entries(changes))if(item===undefined)delete source[name];
   assert.throws(()=>commissionedStagingEnv(source,cleanLabEnv,value.dir));
  }
 }finally{fs.rmSync(value.dir,{recursive:true,force:true});}
});

test('CLI keeps staging artifacts separate and verifies the final APK package without exposing Firebase values',()=>{
 const source=fs.readFileSync(path.join(path.resolve(new URL('..',import.meta.url).pathname),'lab/android/cli.mjs'),'utf8');
 assert.match(source,/staging-apk\.json/);assert.match(source,/Phone11-Android-Staging/);
 assert.match(source,/manifest','application-id'/);assert.match(source,/commissionedStagingEnv\(process\.env,labEnv\(\),root\)/);
 assert.match(source,/build\/generated\/autolinking/);
 assert.doesNotMatch(source,/console\.log\([^\n]*(FIREBASE|GOOGLE_SERVICES|process\.env)/);
 const scripts=JSON.parse(fs.readFileSync(path.join(path.resolve(new URL('..',import.meta.url).pathname),'package.json'),'utf8')).scripts;
 assert.equal(scripts['lab:android:build:staging'],'node lab/android/cli.mjs setup && node lab/android/cli.mjs build-staging');
});
