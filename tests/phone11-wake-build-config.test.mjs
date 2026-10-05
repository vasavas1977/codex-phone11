import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
const require=createRequire(import.meta.url);
const {getConfig}=createRequire(require.resolve('expo/package.json'))('@expo/config');
const root=new URL('..',import.meta.url).pathname;
const profiles=require('../eas.json').build;
function profile(name) {const own=profiles[name];const base=own.extends?profile(own.extends):{};return {...base,...own,env:{...base.env,...own.env}};}
async function withProfile(name,run) {
  const saved={...process.env};
  try {
    delete process.env.PHONE11_APNS_ENVIRONMENT;
    delete process.env.PHONE11_VOIP_WAKE_COMMISSIONED;
    delete process.env.PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED;
    Object.assign(process.env,profile(name).env);
    process.env.PHONE11_SIPRIX_LICENSE='';
    const {exp}=getConfig(root,{isModdedConfig:true});
    return await run(exp);
  } finally {for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
}
async function mod(config,name,initial={}) {
  const result=await config.mods.ios[name]({...config,modResults:initial,modRequest:{projectRoot:root,platform:'ios',modName:name,introspect:true}});
  return result.modResults;
}
const ruby=`require 'json'
module Pod
 class Config
  def self.instance; new; end
  def installation_root; ENV.fetch('TEST_IOS_DIR'); end
 end
 class Spec
  attr_reader :values
  def initialize; @values={}; end
  def self.new; value=allocate; value.send(:initialize); yield(value); puts JSON.generate(value.values); value; end
  def method_missing(name,*args)
   if name.to_s.end_with?('='); @values[name.to_s.delete_suffix('=')]=args.first
   elsif @values.key?(name.to_s); @values[name.to_s]
   end
  end
 end
end
load ARGV.fetch(0)
`;
function pod(properties,overrides={}) {
  const scratch=mkdtempSync(join(tmpdir(),'phone11-pod-config-'));
  try {
    if(properties!==null)writeFileSync(join(scratch,'Podfile.properties.json'),JSON.stringify(properties));
    const result=spawnSync('ruby',['-e',ruby,join(root,'modules/phone11-siprix/Phone11Siprix.podspec')],{encoding:'utf8',env:{...process.env,...overrides,TEST_IOS_DIR:scratch}});
    return result;
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
test('actual default Expo mods and evaluated pod keep native wake disabled',async()=>withProfile('preview-ios-siprix',async config=>{
  assert.equal(config.extra.phone11ApnsEnvironment,undefined);
  assert.equal(config.extra.phone11ChatNotificationsEnabled,false);
  assert.equal(config.ios.infoPlist.Phone11ChatNotificationsCommissioned,0);
  assert.equal(config.runtimeVersion,'1.0.0-siprix-chat-media-2');
  const properties=await mod(config,'podfileProperties');
  assert.equal(properties['phone11.voipWakeCommissioned'],'0');
  assert.equal(properties['phone11.apnsEnvironment'],undefined);
  assert.equal((await mod(config,'infoPlist')).Phone11WakeCommissioned,0);
  const result=pod(properties);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).pod_target_xcconfig.GCC_PREPROCESSOR_DEFINITIONS,'$(inherited) PHONE11_VOIP_WAKE_COMMISSIONED=0');
}));
test('resolved pilot profile generates matching production entitlement, JS config and whole-pod compile flag',async()=>withProfile('preview-ios-siprix-wake-pilot',async config=>{
  assert.equal(config.extra.phone11ApnsEnvironment,'production');
  assert.equal(config.runtimeVersion,'1.0.0-siprix-wake-pilot-chat-media-2');
  assert.equal(config.extra.phone11ChatNotificationsEnabled,false);
  assert.equal(config.ios.infoPlist.Phone11ChatNotificationsCommissioned,0);
  assert.notEqual(profile('preview-ios-siprix-wake-pilot').channel,profile('preview-ios-siprix').channel);
  assert.equal(profile('preview-ios-siprix-wake-pilot').env.PHONE11_BUNDLE_ID,profile('preview-ios-siprix').env.PHONE11_BUNDLE_ID);
  const properties=await mod(config,'podfileProperties');
  assert.equal(properties['phone11.voipWakeCommissioned'],'1');
  assert.equal(properties['phone11.apnsEnvironment'],'production');
  assert.equal((await mod(config,'infoPlist')).Phone11WakeCommissioned,1);
  assert.equal((await mod(config,'entitlements'))['aps-environment'],'production');
  const result=pod(properties);assert.equal(result.status,0,result.stderr);
  const xcconfig=JSON.parse(result.stdout).pod_target_xcconfig;
  assert.equal(xcconfig.DEFINES_MODULE,'YES');
  assert.equal(xcconfig.GCC_PREPROCESSOR_DEFINITIONS,'$(inherited) PHONE11_VOIP_WAKE_COMMISSIONED=1');
  await assert.rejects(()=>mod(config,'entitlements',{'aps-environment':'development'}),/conflicts/);
  for(const props of [null,{}, {...properties,'phone11.voipWakeCommissioned':'0'}, {...properties,'phone11.apnsEnvironment':'sandbox'}]) {
    assert.notEqual(pod(props).status,0,'Missing or mismatched prebuild properties must prevent gate1');
  }
  for(const env of [{PHONE11_VOIP_WAKE_COMMISSIONED:'true'},{PHONE11_APNS_ENVIRONMENT:'sandbox'},{EXPO_PUBLIC_SIP_ENGINE:'pjsip'}]) assert.notEqual(pod(properties,env).status,0);
}));

test('explicit daily pilot isolates ordinary alerts and preserves production call signing',async()=>withProfile('preview-ios-siprix-daily-pilot',async config=>{
  assert.equal(config.extra.phone11ChatNotificationsEnabled,true);
  assert.equal(config.ios.infoPlist.Phone11ChatNotificationsCommissioned,1);
  assert.equal(config.extra.phone11ApnsEnvironment,'production');
  assert.equal(config.runtimeVersion,'1.0.0-siprix-daily-pilot-chat-media-2');
  assert.notEqual(profile('preview-ios-siprix-daily-pilot').channel,profile('preview-ios-siprix-wake-pilot').channel);
  assert.equal(profile('preview-ios-siprix-daily-pilot').env.PHONE11_BUNDLE_ID,profile('preview-ios-siprix').env.PHONE11_BUNDLE_ID);
  assert.equal((await mod(config,'entitlements'))['aps-environment'],'production');
  assert.equal((await mod(config,'infoPlist')).Phone11WakeCommissioned,1);
  for(const value of ['true','false','2']) {
    process.env.PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED=value;
    assert.throws(()=>getConfig(root,{isModdedConfig:true}),/Invalid chat notification build flag/);
  }
  process.env.PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED='1';
  process.env.PHONE11_VOIP_WAKE_COMMISSIONED='0';
  delete process.env.PHONE11_APNS_ENVIRONMENT;
  assert.throws(()=>getConfig(root,{isModdedConfig:true}),/production incoming-call pilot/);
}));

test('App Store config fails closed without a license and resolves as licensed with the protected secret',()=>{
  const store=profile('production-ios-siprix-store');
  const evaluate=`const {createRequire}=require('node:module');const load=createRequire(require.resolve('expo/package.json'));const {exp}=load('@expo/config').getConfig(process.cwd(),{isPublicConfig:true});process.stdout.write(JSON.stringify(exp));`;
  const command=['-e',evaluate];
  const baseEnv={...process.env,...store.env,CI:'1',EXPO_NO_TELEMETRY:'1'};
  const missing=spawnSync(process.execPath,command,{cwd:root,encoding:'utf8',env:{...baseEnv,PHONE11_SIPRIX_LICENSE:''}});
  assert.notEqual(missing.status,0);
  assert.match(`${missing.stdout}\n${missing.stderr}`,/production Siprix license/);
  const configured=spawnSync(process.execPath,command,{cwd:root,encoding:'utf8',env:{...baseEnv,PHONE11_SIPRIX_LICENSE:'fake-native-license-test-only'}});
  assert.equal(configured.status,0,configured.stderr || configured.stdout);
  const resolved=JSON.parse(configured.stdout);
  assert.equal(resolved.ios.bundleIdentifier,store.env.PHONE11_BUNDLE_ID);
  assert.equal(resolved.ios.entitlements['aps-environment'],'production');
  assert.equal(resolved.extra.phone11ChatNotificationsEnabled,true);
  assert.equal(resolved.extra.buildInfo.appStoreBuild,true);
  assert.equal(resolved.extra.buildInfo.sipSdkVersion,'1.0.40-licensed');
  assert.ok(!configured.stdout.includes('fake-native-license-test-only'));
});

// Evaluate the actual config and settings functions with only synthetic inputs.
// In particular, never run load-env.js or allow a plugin to read local SDK files.
function syntheticConfig(env) {
  const typescript=require('typescript');
  const source=readFileSync(join(root,'app.config.ts'),'utf8');
  const compiled=typescript.transpileModule(source,{compilerOptions:{module:typescript.ModuleKind.CommonJS,target:typescript.ScriptTarget.ES2022}}).outputText;
  const pluginApi={withInfoPlist:config=>config,withAppDelegate:config=>config,withEntitlementsPlist:config=>config,
    withPodfile:config=>config,withPodfileProperties:config=>config};
  const sdkLock=JSON.parse(readFileSync(join(root,'modules/phone11-siprix/android/sdk-lock.json'),'utf8'));
  function plugin(filename) {
    const module={exports:{}};
    runInNewContext(readFileSync(join(root,filename),'utf8'),{module,exports:module.exports,process:{env:{...env}},require:id=>{
      if(id==='expo/config-plugins')return pluginApi;
      if(id==='../modules/phone11-siprix/android/sdk-lock.json')return sdkLock;
      if(id==='node:fs')return new Proxy({}, {get:()=>()=>{throw new Error('Plugin file access forbidden in synthetic config test');}});
      if(id==='node:path'||id==='node:crypto')return require(id);
      throw new Error(`Unexpected plugin import: ${id}`);
    }});
    return module.exports;
  }
  const android=plugin('plugins/with-phone11-android-runtime.js');
  const wake=plugin('plugins/with-phone11-voip-wake.js');
  const screen=plugin('plugins/with-phone11-android-screen.js');
  const module={exports:{}};
  let environmentLoadBlocked=false;
  runInNewContext(compiled,{module,exports:module.exports,process:{env:{...env}},require:id=>{
    if(id==='./scripts/load-env.js'){environmentLoadBlocked=true;return {};}
    if(id==='expo/config-plugins')return pluginApi;
    if(id==='./plugins/with-phone11-android-runtime.js')return android;
    if(id==='./plugins/with-phone11-voip-wake.js')return wake;
    if(id==='./plugins/with-phone11-android-screen.js')return screen;
    throw new Error(`Unexpected config import: ${id}`);
  }});
  assert.equal(environmentLoadBlocked,true);
  return module.exports.default;
}

test('synthetic store platform guard refuses both Android store profiles before packaging',()=>{
  const reviewed={...profile('production-ios-siprix-store').env,PHONE11_SIPRIX_LICENSE:'synthetic-placeholder-only',EAS_BUILD_PLATFORM:'android'};
  for(const name of ['production','production-ios-siprix-store']) {
    const env={...reviewed,...profile(name).env};
    assert.throws(()=>syntheticConfig(env),/Android store distribution is not commissioned/);
  }
});

test('synthetic store platform guard preserves iOS and unset local resolution plus existing store prerequisites',()=>{
  for(const platform of ['ios',undefined]) {
    const env={...profile('production-ios-siprix-store').env,PHONE11_SIPRIX_LICENSE:'synthetic-placeholder-only'};
    if(platform)env.EAS_BUILD_PLATFORM=platform;
    const config=syntheticConfig(env);
    assert.equal(config.extra.buildInfo.appStoreBuild,true);
    assert.equal(config.ios.bundleIdentifier,env.PHONE11_BUNDLE_ID);
    assert.equal(config.extra.phone11ApnsEnvironment,'production');
    assert.equal(config.extra.phone11ChatNotificationsEnabled,true);
    assert.ok(!JSON.stringify(config).includes('synthetic-placeholder-only'));
    for(const [overrides,error] of [
      [{PHONE11_SIPRIX_LICENSE:''},/production Siprix license/],
      [{PHONE11_BUNDLE_ID:''},/registered bundle identifier/],
      [{EXPO_PUBLIC_SIP_ENGINE:'pjsip',PHONE11_VOIP_WAKE_COMMISSIONED:'0',PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED:'0',PHONE11_APNS_ENVIRONMENT:undefined},/reviewed Siprix calling engine/],
      [{PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED:'0'},/notification commissioning/],
    ])assert.throws(()=>syntheticConfig({...env,...overrides}),error);
  }
});

test('synthetic store platform guard leaves ordinary Android and the isolated foreground trial unchanged',()=>{
  const ordinary=syntheticConfig({EAS_BUILD_PLATFORM:'android',EXPO_PUBLIC_SIP_ENGINE:'siprix'});
  assert.equal(ordinary.android.package,'ai.phone11.mobile');
  assert.equal(ordinary.extra.buildInfo.appStoreBuild,false);
  assert.equal(ordinary.extra.buildInfo.androidForegroundTrial,undefined);
  const trial=syntheticConfig({EAS_BUILD_PLATFORM:'android',EXPO_PUBLIC_SIP_ENGINE:'siprix',
    PHONE11_ANDROID_FOREGROUND_TRIAL:'1',EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL:'1'});
  assert.equal(trial.android.package,'ai.phone11.mobile.foregroundtrial');
  assert.equal(trial.extra.buildInfo.androidForegroundTrial,true);
  assert.equal(trial.extra.buildInfo.appStoreBuild,false);
});


test('synthetic screen guard defaults OFF and accepts explicit paired OFF without source activation',()=>{
  for(const platform of ['android','ios',undefined]) {
    const env=platform?{EAS_BUILD_PLATFORM:platform}:{};
    for(const flags of [{},{PHONE11_ANDROID_SCREEN_TRANSACTION:'0',EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION:'0'}]) {
      const config=syntheticConfig({...env,...flags});
      assert.equal(config.extra.buildInfo.androidScreenTransactionSource,undefined);
      assert.equal(config.android.package,'ai.phone11.mobile');
      assert.ok(config.plugins.includes('./plugins/with-phone11-android-screen.js'));
    }
  }
});

test('synthetic screen guard preserves the actual explicit Android source-only ON setting',()=>{
  const config=syntheticConfig({EAS_BUILD_PLATFORM:'android',PHONE11_APP_STORE_BUILD:'0',
    PHONE11_ANDROID_SCREEN_TRANSACTION:'1',EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION:'1'});
  assert.equal(config.extra.buildInfo.androidScreenTransactionSource,true);
  assert.equal(config.extra.buildInfo.appStoreBuild,false);
  assert.equal(config.extra.buildInfo.androidForegroundTrial,undefined);
  assert.equal(config.android.package,'ai.phone11.mobile');
});

test('synthetic screen guard refuses mismatched flags, invalid values and unsupported ON platforms or stores',()=>{
  for(const flags of [
    {PHONE11_ANDROID_SCREEN_TRANSACTION:'1'},
    {EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION:'1'},
    {PHONE11_ANDROID_SCREEN_TRANSACTION:'true',EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION:'true'},
    {PHONE11_ANDROID_SCREEN_TRANSACTION:'2',EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION:'2'},
  ])assert.throws(()=>syntheticConfig({EAS_BUILD_PLATFORM:'android',...flags}),/matching explicit 0\/1 build flags/);
  const flags={PHONE11_ANDROID_SCREEN_TRANSACTION:'1',EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION:'1'};
  for(const environment of [{},{EAS_BUILD_PLATFORM:'ios'},{EAS_BUILD_PLATFORM:'android',PHONE11_APP_STORE_BUILD:'1'}]) {
    assert.throws(()=>syntheticConfig({...flags,...environment}),/Android source-only and unavailable to store builds/);
  }
});
