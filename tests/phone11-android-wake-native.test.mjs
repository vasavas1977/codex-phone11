import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {androidWakeBuildSettings,configureLabManifest,labSipSettings}=require('../plugins/with-phone11-android-lab.js');

const commissioned={PHONE11_ANDROID_WAKE_COMMISSIONED:'1',PHONE11_ANDROID_WAKE_ENVIRONMENT:'staging',
 PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_SIP_ENGINE:'siprix'};

test('Android wake defaults to an explicit uncommissioned state and rejects partial gates',()=>{
 assert.deepEqual(androidWakeBuildSettings({}),{gate:'0',environment:undefined});
 assert.deepEqual(androidWakeBuildSettings(commissioned),{gate:'1',environment:'staging'});
 for(const env of [
  {PHONE11_ANDROID_WAKE_COMMISSIONED:'true'},
  {PHONE11_ANDROID_WAKE_ENVIRONMENT:'staging'},
  {...commissioned,PHONE11_ANDROID_LAB:'0'},
  {...commissioned,EXPO_PUBLIC_PHONE11_ANDROID_LAB:'0'},
  {...commissioned,EXPO_PUBLIC_SIP_ENGINE:'pjsip'},
  {...commissioned,PHONE11_ANDROID_WAKE_ENVIRONMENT:'production'},
 ])assert.throws(()=>androidWakeBuildSettings(env));
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
 assert.equal(named(app['meta-data'],'ai.phone11.androidWakeCommissioned')[0].$['android:value'],'false');
 assert.equal(named(app['meta-data'],'ai.phone11.androidWakeEnvironment').length,0);
 configureLabManifest(value,settings,androidWakeBuildSettings(commissioned));
 assert.equal(named(app.service,'ai.phone11.siprix.Phone11IncomingCallService').length,1);
 assert.equal(named(app.service,'ai.phone11.siprix.Phone11IncomingCallService')[0].$['android:enabled'],'true');
 assert.equal(named(app['meta-data'],'ai.phone11.androidWakeCommissioned')[0].$['android:value'],'true');
 assert.equal(named(app['meta-data'],'ai.phone11.androidWakeEnvironment')[0].$['android:value'],'staging');
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
