import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const servicePath=path.join(root,'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11IncomingCallService.java');
const manifestPath=path.join(root,'android/app/src/main/AndroidManifest.xml');

test('incoming-call notice keeps immutable owner actions and permission-safe fallbacks',()=>{
 const source=readFileSync(servicePath,'utf8');
 assert.match(source,/Notification\.CallStyle\.forIncomingCall/);
 assert.match(source,/NotificationManager\.IMPORTANCE_HIGH/);
 assert.match(source,/\.setOngoing\(true\)/);
 assert.match(source,/\.setTimeoutAfter\(/);
 assert.match(source,/PendingIntent\.FLAG_UPDATE_CURRENT \| PendingIntent\.FLAG_IMMUTABLE/);
 assert.match(source,/ACTION_OPEN/);assert.match(source,/ACTION_ANSWER/);assert.match(source,/ACTION_DECLINE/);
 assert.match(source,/Manifest\.permission\.POST_NOTIFICATIONS/);
 assert.match(source,/Manifest\.permission\.USE_FULL_SCREEN_INTENT/);
 assert.match(source,/notifications\.canUseFullScreenIntent\(\)/);
 assert.match(source,/catch \(SecurityException denied\)/);
 assert.doesNotMatch(readFileSync(manifestPath,'utf8'),/android\.permission\.USE_FULL_SCREEN_INTENT/,
  'current uncommissioned build deliberately remains heads-up only');
});

test('pure JVM notice owner rejects stale actions and defines terminal cleanup',()=>{
 const out=mkdtempSync(path.join(tmpdir(),'phone11-notice-jvm-'));
 try{
  const sources=[
   path.join(root,'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11PendingWakeStore.java'),
   path.join(root,'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11IncomingCallNoticeOwner.java'),
   path.join(root,'lab/android/java-tests/IncomingCallNoticeOwnerTest.java'),
  ];
  const compile=spawnSync('javac',['-d',out,...sources],{encoding:'utf8',timeout:120000});
  assert.equal(compile.status,0,compile.error?.message??compile.stderr);
  const run=spawnSync('java',['-ea','-cp',out,'ai.phone11.siprix.IncomingCallNoticeOwnerTest'],{encoding:'utf8',timeout:120000});
  assert.equal(run.status,0,run.error?.message??run.stderr);
  assert.match(run.stdout,/PASS: 11 incoming-call notice ownership assertions/);
 }finally{rmSync(out,{recursive:true,force:true});}
});
