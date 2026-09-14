import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire}from'node:module';
const require=createRequire(import.meta.url);
function config(lab,engine='siprix'){process.env.PHONE11_ANDROID_LAB=lab;process.env.EXPO_PUBLIC_SIP_ENGINE=engine;delete require.cache[require.resolve('../react-native.config.js')];return require('../react-native.config.js');}
test('lab autolinks Siprix and excludes competing PJSIP and CallKeep only on Android',()=>{const d=config('1').dependencies;assert.equal(d['react-native-pjsip'].platforms.android,null);assert.equal(d['react-native-callkeep'].platforms.android,null);assert.deepEqual(d['phone11-siprix'].platforms,{});});
test('default Android integration remains disabled outside lab',()=>{const d=config('0').dependencies;assert.equal(d['phone11-siprix'].platforms.android,null);assert.deepEqual(d['react-native-callkeep'].platforms,{});assert.equal(d['react-native-pjsip'].platforms.android,undefined);});
test('PJSIP release defaults unchanged',()=>{const d=config('0','pjsip').dependencies;assert.deepEqual(d['react-native-pjsip'].platforms,{});assert.equal(d['phone11-siprix'].platforms.ios,null);});
test('Android bridge rejects wake and CallKit operations explicitly',()=>{const s=fs.readFileSync('modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11SiprixModule.java','utf8');for(const name of ['bindForegroundWakeContext','adoptIncomingWake','restoreIncomingWakeDelegate','handleNativeAudioSession'])assert.match(s,new RegExp(name+'[^\\n]+E_UNSUPPORTED'));});
test('exact vendor artifact pin and unchanged iOS pin',()=>{const lock=JSON.parse(fs.readFileSync('lab/android/sdk-lock.json'));assert.match(lock.sha256,/^[a-f0-9]{64}$/);assert.equal(lock.trialCallLimitSeconds,60);assert.ok(lock.maxConnectedSeconds<lock.trialCallLimitSeconds);const ios=fs.readFileSync('scripts/stage-siprix-sdk.mjs','utf8');assert.ok(ios.includes('53ae99e16531f64cf6e7832ed9e5d126a7e2d4ce'));});
test('lab manifest customization remains singular across repeated prebuilds',()=>{
 const {configureLabManifest}=require('../plugins/with-phone11-android-lab.js');
 const manifest={$:{},application:[{$:{},'meta-data':[
  {$:{'android:name':'unrelated','android:value':'kept'}},
  {$:{'android:name':'com.siprix.SkipPermissionRequest','android:value':'false'}},
  {$:{'android:name':'com.siprix.SkipPermissionRequest','android:value':'true'}},
 ]}],'uses-permission':[
  {$:{'android:name':'android.permission.RECORD_AUDIO'}},
  {$:{'android:name':'android.permission.CAMERA'}},
  {$:{'android:name':'android.permission.CAMERA','tools:node':'remove'}},
 ]};
 configureLabManifest(manifest);
 configureLabManifest(manifest);
 const named=(entries,name)=>entries.filter(entry=>entry.$['android:name']===name);
 assert.equal(named(manifest.application[0]['meta-data'],'com.siprix.SkipPermissionRequest').length,1);
 assert.equal(named(manifest['uses-permission'],'android.permission.CAMERA').length,1);
 assert.equal(named(manifest.application[0]['meta-data'],'unrelated').length,1);
 assert.equal(named(manifest['uses-permission'],'android.permission.RECORD_AUDIO').length,1);
 assert.equal(named(manifest.application[0]['meta-data'],'com.siprix.SkipPermissionRequest')[0].$['android:value'],'true');
 assert.equal(named(manifest['uses-permission'],'android.permission.CAMERA')[0].$['tools:node'],'remove');
});
