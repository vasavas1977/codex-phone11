import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {verifySdk,sdkLock} from '../android/verify-sdk.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Android preflight never downloads or accepts an unpinned SDK',()=>{
  assert.throws(()=>verifySdk(null),/No download/);
  const out=mkdtempSync(path.join(tmpdir(),'phone11-android-invalid-sdk-'));
  try{const invalid=path.join(out,'invalid.aar');writeFileSync(invalid,'not a SIP SDK');assert.throws(()=>verifySdk(invalid),/checksum mismatch/);}finally{rmSync(out,{recursive:true,force:true});}
  assert.equal(sdkLock.version,'1.1.0');assert.equal(sdkLock.trialCallLimitSeconds,60);
});
test('Android source candidate preserves default-off integration and unsupported capabilities',()=>{
  const config=readFileSync(path.join(root,'react-native.config.js'),'utf8');assert.match(config,/android: null/);
  const gradle=readFileSync(path.join(root,'android/build.gradle'),'utf8');assert.match(gradle,/compileOnly files\(sdkApiJar\)\.builtBy\(stageSdkApi\)/);assert.doesNotMatch(gradle,/compileOnly files\(sdkAar\)/);assert.match(gradle,/dependsOn verifySdk/);assert.match(gradle,/dependsOn stageSdkApi/);assert.match(gradle,/new java\.util\.zip\.ZipFile\(sdkAar\)/);assert.match(gradle,/actual != expectedApiSha/);assert.match(gradle,/compileOnly cannot supply the executable SIP runtime/);assert.match(gradle,/phone11AndroidForegroundSourceEnabled.*== 'true'/);
  const manifest=readFileSync(path.join(root,'android/src/main/AndroidManifest.xml'),'utf8');assert.match(manifest,/FOREGROUND_SOURCE_ENABLED" android:value="false"/);assert.doesNotMatch(manifest,/<service|<receiver/);
  const module=readFileSync(path.join(root,'android/src/main/java/ai/phone11/siprix/Phone11SiprixModule.java'),'utf8');assert.match(module,/if\(!BuildConfig.FOREGROUND_SOURCE_ENABLED\)/);assert.match(module,/"registrationAvailable",false/);assert.doesNotMatch(module,/@ReactMethod public void (transferCall|beginConsultation|makeVideoCall)/);
  const adapter=readFileSync(path.join(root,'android/src/main/java/ai/phone11/siprix/SiprixAndroidAdapter.java'),'utf8');assert.match(adapter,/main\.post\(\(\)->\{if\(activeCallbacks==this\)action\.run\(\);\}\)/);assert.match(adapter,/setTlsVerifyServer\(true\)/);assert.match(adapter,/setSingleCallMode\(true\)/);assert.match(adapter,/setSipPassword\(""\)/);
});
