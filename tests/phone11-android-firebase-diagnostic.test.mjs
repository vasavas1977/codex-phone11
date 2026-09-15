import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const nativeDir=path.join(root,'modules/phone11-siprix/android/src/main/java/ai/phone11/siprix');

test('pure JVM diagnostic exposes only a stable short SHA-256 fingerprint',()=>{
 const out=mkdtempSync(path.join(tmpdir(),'phone11-firebase-diagnostic-'));
 try{
  const compile=spawnSync('javac',['-d',out,path.join(nativeDir,'Phone11PendingWakeStore.java'),path.join(nativeDir,'Phone11FirebaseDiagnostic.java'),
   path.join(root,'lab/android/java-tests/FirebaseDiagnosticTest.java')],{encoding:'utf8',timeout:120000});
  assert.equal(compile.status,0,compile.error?.message??compile.stderr);
  const run=spawnSync('java',['-ea','-cp',out,'ai.phone11.siprix.FirebaseDiagnosticTest'],{encoding:'utf8',timeout:120000});
  assert.equal(run.status,0,run.error?.message??run.stderr);
  assert.match(run.stdout,/PASS: 46 sanitized Firebase diagnostic assertions/);
 }finally{rmSync(out,{recursive:true,force:true});}
});

test('native diagnostic gates provider access and persists no provider value',()=>{
 const module=readFileSync(path.join(nativeDir,'Phone11SiprixModule.java'),'utf8');
 const store=readFileSync(path.join(nativeDir,'Phone11FirebaseDiagnosticStore.java'),'utf8');
 const runtime=readFileSync(path.join(nativeDir,'Phone11AndroidWakeRuntime.java'),'utf8');
 const start=module.indexOf('void getFirebaseDiagnostic(');
 const end=module.indexOf('private void providerToken(',start);
 assert.notEqual(start,-1);assert.notEqual(end,-1);
 const diagnostic=module.slice(start,end);
 assert.ok(diagnostic.indexOf('UNSUPPORTED_UNCOMMISSIONED')<diagnostic.indexOf('FirebaseMessaging.getInstance().getToken()'));
 assert.ok(diagnostic.indexOf('COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS')<diagnostic.indexOf('FirebaseMessaging.getInstance().getToken()'));
 const uncommissioned=diagnostic.slice(diagnostic.indexOf('UNSUPPORTED_UNCOMMISSIONED'),diagnostic.indexOf('if(status!=',diagnostic.indexOf('UNSUPPORTED_UNCOMMISSIONED')));
 assert.match(uncommissioned,/p\.resolve\(Arguments\.makeNativeMap\(value\)\)/);
 assert.doesNotMatch(uncommissioned,/resolveFirebaseDiagnostic|Phone11FirebaseDiagnosticStore/);
 assert.match(diagnostic,/Phone11FirebaseDiagnostic\.fromProviderValue/);
 assert.doesNotMatch(diagnostic,/p\.resolve\(providerValue\)|Log\.|System\.out/);
 assert.match(store,/putBoolean\("present", value\.tokenPresent\)/);
 assert.match(store,/putString\("fingerprint", value\.tokenHash\)/);
 assert.doesNotMatch(store,/providerValue|getToken\(|FirebaseMessaging|Log\.|System\.out/);
 assert.match(runtime,/COMMISSIONED_STAGING_PACKAGE = "ai\.phone11\.mobile\.staging"/);
});

test('commissioned ingress records only bounded allowlisted receipt evidence',()=>{
 const service=readFileSync(path.join(nativeDir,'Phone11FirebaseMessagingService.java'),'utf8');
 const store=readFileSync(path.join(nativeDir,'Phone11FirebaseDiagnosticStore.java'),'utf8');
 const helper=readFileSync(path.join(nativeDir,'Phone11FirebaseDiagnostic.java'),'utf8');
 const commissioned=service.indexOf('COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS');
 const firstRecord=service.indexOf('recordIngress(receivedAt',commissioned);
 assert.ok(commissioned!==-1&&commissioned<firstRecord);
 assert.match(service,/ReceiptReason\.NOT_DATA_ONLY/);
 assert.match(service,/ReceiptReason\.INVALID_ENVELOPE/);
 assert.match(service,/ReceiptReason\.from\(decision\)/);
 assert.doesNotMatch(store,/callUUID|bindingId|providerValue|RemoteMessage/);
 assert.match(store,/ingress_count/);
 assert.match(helper,/MAX_RECEIPT_COUNT = 1000/);
 assert.doesNotMatch(helper,/callUUID|bindingId/);
});

test('lab UI renders only sanitized diagnostic fields and explicit gate state',()=>{
 const source=readFileSync(path.join(root,'app/android-lab.tsx'),'utf8');
 assert.match(source,/bridge\.getFirebaseDiagnostic\(\)/);
 assert.match(source,/firebaseDiagnostic\.tokenHash/);
 assert.match(source,/Firebase: blocked/);
 assert.match(source,/Firebase: not commissioned/);
 assert.match(source,/FCM receipt:/);
 assert.match(source,/Wake enrollment: bound/);
 assert.match(source,/Phone11FirebaseDiagnosticChanged/);
 assert.doesNotMatch(source,/bridge\.(start|currentToken)\(\)/);
});

test('lab enrollment diagnostic exposes only presence and expiry',()=>{
 const module=readFileSync(path.join(nativeDir,'Phone11SiprixModule.java'),'utf8');
 const start=module.indexOf('Map<String,Object> wakeEnrollmentDiagnostic()');
 const end=module.indexOf('@ReactMethod public void getFirebaseDiagnostic',start);
 assert.notEqual(start,-1);assert.notEqual(end,-1);
 const diagnostic=module.slice(start,end);
 assert.match(diagnostic,/"status".*"not_bound".*"bound"/s);
 assert.match(diagnostic,/"expiresAt"/);
 assert.doesNotMatch(diagnostic,/bindingId|sessionBinding|deviceId|ownerUserId|tenantId|grant|token/);
});
