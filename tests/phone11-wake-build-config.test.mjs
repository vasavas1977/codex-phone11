import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
  assert.equal(config.runtimeVersion,'1.0.0-siprix-1');
  const properties=await mod(config,'podfileProperties');
  assert.equal(properties['phone11.voipWakeCommissioned'],'0');
  assert.equal(properties['phone11.apnsEnvironment'],undefined);
  assert.equal((await mod(config,'infoPlist')).Phone11WakeCommissioned,0);
  const result=pod(properties);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).pod_target_xcconfig.GCC_PREPROCESSOR_DEFINITIONS,'$(inherited) PHONE11_VOIP_WAKE_COMMISSIONED=0');
}));
test('resolved pilot profile generates matching production entitlement, JS config and whole-pod compile flag',async()=>withProfile('preview-ios-siprix-wake-pilot',async config=>{
  assert.equal(config.extra.phone11ApnsEnvironment,'production');
  assert.equal(config.runtimeVersion,'1.0.0-siprix-wake-pilot-1');
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
