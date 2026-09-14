import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const senderId='123456789012';
const appId=`1:${senderId}:android:0123456789abcdef`;
const cleanEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([name])=>
 !name.startsWith('PHONE11_')&&!name.startsWith('EXPO_PUBLIC_')&&!/^(VITE_|OWNER_|OAUTH_)/.test(name)));
const readConfig=env=>{
 const result=spawnSync('pnpm',['exec','expo','config','--type','public','--json'],{
  cwd:root,encoding:'utf8',timeout:120000,env:{...cleanEnvironment(),EXPO_NO_DOTENV:'1',CI:'1',...env},
 });
 assert.equal(result.status,0,result.stderr||result.stdout);
 const start=result.stdout.indexOf('{"name":');
 assert.notEqual(start,-1,result.stdout);
 return JSON.parse(result.stdout.slice(start));
};

test('ordinary Android lab config compiles without Firebase configuration',()=>{
 const config=readConfig({PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_SIP_ENGINE:'siprix'});
 assert.equal(config.android.package,'ai.phone11.mobile.lab');
 assert.equal(config.android.googleServicesFile,undefined);
 assert.equal(config.extra.phone11ApiBaseUrl,'http://10.0.2.2:18080');
});

test('commissioned staging config binds only the validated Firebase file and staging API',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'phone11-app-config-'));const file=path.join(dir,'google-services.json');
 try{
  writeFileSync(file,JSON.stringify({
   project_info:{project_number:senderId,project_id:'phone11-staging-lab'},
   client:[{client_info:{mobilesdk_app_id:appId,android_client_info:{package_name:'ai.phone11.mobile.staging'}}}],
  }));
  const api='https://api.staging.phone11.invalid';
  const config=readConfig({
   PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_SIP_ENGINE:'siprix',
   PHONE11_ANDROID_WAKE_COMMISSIONED:'1',PHONE11_ANDROID_FIREBASE_COMMISSIONED:'1',
   PHONE11_ANDROID_WAKE_ENVIRONMENT:'staging',PHONE11_ANDROID_LAB_PACKAGE:'ai.phone11.mobile.staging',
   PHONE11_ANDROID_FIREBASE_PROJECT_ID:'phone11-staging-lab',PHONE11_ANDROID_FIREBASE_SENDER_ID:senderId,
   PHONE11_ANDROID_FIREBASE_APP_ID:appId,PHONE11_ANDROID_GOOGLE_SERVICES_FILE:file,
   PHONE11_ANDROID_SIP_HOST:'sip.staging.phone11.invalid',EXPO_PUBLIC_API_BASE_URL:api,
  });
  assert.equal(config.android.package,'ai.phone11.mobile.staging');
  assert.equal(config.android.googleServicesFile,realpathSync(file));
  assert.equal(config.extra.phone11ApiBaseUrl,api);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
