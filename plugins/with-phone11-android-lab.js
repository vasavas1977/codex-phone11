const { withAppBuildGradle, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const entryName = entry => entry?.$?.['android:name'];
const replaceNamedEntry = (entries = [], name, replacement) => [
 ...entries.filter(entry => entryName(entry) !== name),
 replacement,
];

const packagePattern=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const hostPattern=/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const userPattern=/^[A-Za-z0-9_+*#.-]{1,64}$/;
function list(value,name,min=1){
 const items=value.split(',');
 if(items.length<min||items.some(item=>item!==item.trim()||!userPattern.test(item))||new Set(items).size!==items.length)throw new Error(`Invalid ${name}`);
 return items;
}
function labSipSettings(packageName,source=process.env){
 const host=(source.PHONE11_ANDROID_SIP_HOST??'10.0.2.2').trim().toLowerCase();
 const port=Number(source.PHONE11_ANDROID_SIP_PORT??'15060');
 const accountExtensions=list(source.PHONE11_ANDROID_SIP_ACCOUNT_EXTENSIONS??'7101','Android lab SIP account extensions');
 const destinations=list(source.PHONE11_ANDROID_SIP_DESTINATIONS??'7102,7190,7191','Android lab SIP destinations',2);
 if(!packagePattern.test(packageName??''))throw new Error('Invalid Android lab package');
 if(!hostPattern.test(host)||host.includes('..'))throw new Error('Invalid Android lab SIP host');
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid Android lab SIP port');
 return {packageName,host,port,accountExtensions,destinations};
}

function androidWakeBuildSettings(source=process.env){
 const gate=source.PHONE11_ANDROID_WAKE_COMMISSIONED??'0';
 const environment=source.PHONE11_ANDROID_WAKE_ENVIRONMENT;
 if(!['0','1'].includes(gate))throw new Error('Android wake gate must be 0 or 1');
 if(gate==='1'&&(source.PHONE11_ANDROID_LAB!=='1'||source.EXPO_PUBLIC_PHONE11_ANDROID_LAB!=='1'
  ||source.EXPO_PUBLIC_SIP_ENGINE!=='siprix'||environment!=='staging')){
  throw new Error('Android wake commissioning requires the isolated Siprix lab and staging environment');
 }
 if(gate==='0'&&environment!==undefined)throw new Error('Uncommissioned Android wake must not declare an environment');
 return {gate,environment:gate==='1'?environment:undefined};
}

function configureLabManifest(manifest,settings=labSipSettings('ai.phone11.mobile.lab'),wake={gate:'0',environment:undefined}) {
 manifest.$['xmlns:tools']='http://schemas.android.com/tools';
 const application=manifest.application[0];
 application.$['android:allowBackup']='false';
 application.$['android:networkSecurityConfig']='@xml/phone11_lab_network';
 application['meta-data']=replaceNamedEntry(
  application['meta-data'],
  'com.siprix.SkipPermissionRequest',
  {$:{'android:name':'com.siprix.SkipPermissionRequest','android:value':'true'}},
 );
 for(const [name,value] of Object.entries({
  'ai.phone11.siprix.ANDROID_LAB_ENABLED':'true',
  'ai.phone11.siprix.PACKAGE':settings.packageName,
  'ai.phone11.siprix.SIP_HOST':settings.host,
  'ai.phone11.siprix.SIP_PORT':String(settings.port),
  'ai.phone11.siprix.ACCOUNT_EXTENSIONS':settings.accountExtensions.join(','),
  'ai.phone11.siprix.DESTINATIONS':settings.destinations.join(','),
 }))application['meta-data']=replaceNamedEntry(application['meta-data'],name,{$:{'android:name':name,'android:value':value}});
 application['meta-data']=replaceNamedEntry(application['meta-data'],'ai.phone11.androidWakeCommissioned',{$:{
  'android:name':'ai.phone11.androidWakeCommissioned','android:value':wake.gate==='1'?'true':'false',
 }});
 application['meta-data']=(application['meta-data']??[]).filter(entry=>entryName(entry)!=='ai.phone11.androidWakeEnvironment');
 if(wake.environment)application['meta-data'].push({$:{'android:name':'ai.phone11.androidWakeEnvironment','android:value':wake.environment}});
 application.service=replaceNamedEntry(application.service,'ai.phone11.siprix.Phone11IncomingCallService',{$:{
  'android:name':'ai.phone11.siprix.Phone11IncomingCallService','android:enabled':wake.gate==='1'?'true':'false',
  'android:exported':'false','android:stopWithTask':'false',
 }});
 application.service=replaceNamedEntry(application.service,'ai.phone11.siprix.Phone11FirebaseMessagingService',{
 $:{'android:name':'ai.phone11.siprix.Phone11FirebaseMessagingService','android:enabled':wake.gate==='1'?'true':'false',
   'android:exported':'false','tools:ignore':'Instantiatable'},
  'intent-filter':[{$:{},action:[{$:{'android:name':'com.google.firebase.MESSAGING_EVENT'}}]}],
 });
 // FCM resolves one MESSAGING_EVENT owner. The commissioned service subclasses
 // Expo's service and forwards non-Phone11 messages, preserving generic alerts.
 application.service=replaceNamedEntry(application.service,'expo.modules.notifications.service.ExpoFirebaseMessagingService',{
  $:{'android:name':'expo.modules.notifications.service.ExpoFirebaseMessagingService',
   'android:enabled':wake.gate==='1'?'false':'true','android:exported':'false'},
  'intent-filter':[{$:{'android:priority':'-1'},action:[{$:{'android:name':'com.google.firebase.MESSAGING_EVENT'}}]}],
 });
 manifest['uses-permission']=replaceNamedEntry(
  manifest['uses-permission'],
  'android.permission.CAMERA',
  {$:{'android:name':'android.permission.CAMERA','tools:node':'remove'}},
 );
 return manifest;
}

const withPhone11AndroidLab = config => {
 if (process.env.PHONE11_ANDROID_LAB !== '1') throw new Error('Android lab plugin requires explicit flag');
 const settings=labSipSettings(config.android?.package);
 const wake=androidWakeBuildSettings();
 config = withAndroidManifest(config, c => {
  configureLabManifest(c.modResults.manifest,settings,wake);
  return c;
 });
 config = withDangerousMod(config,['android',async c=>{
  const dir=path.join(c.modRequest.platformProjectRoot,'app/src/main/res/xml');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'phone11_lab_network.xml'),`<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">10.0.2.2</domain><domain includeSubdomains="false">127.0.0.1</domain><domain includeSubdomains="false">localhost</domain></domain-config></network-security-config>`);
  return c;
 }]);
 return withAppBuildGradle(config,c=>{
  const line=`\ndependencies { implementation files("../../modules/phone11-siprix/vendor/android/siprix_voip_sdk.aar") }\n`;
  if(!c.modResults.contents.includes('vendor/android/siprix_voip_sdk.aar')) c.modResults.contents+=line;
  if(!c.modResults.contents.includes('// Phone11 lab ABI')) c.modResults.contents+='\n// Phone11 lab ABI: all bundled native dependencies must match the dedicated image.\nandroid { defaultConfig { ndk { abiFilters.clear(); abiFilters.add("arm64-v8a") } } }\n';
  return c;
 });
};

withPhone11AndroidLab.configureLabManifest = configureLabManifest;
withPhone11AndroidLab.labSipSettings = labSipSettings;
withPhone11AndroidLab.androidWakeBuildSettings = androidWakeBuildSettings;
module.exports = withPhone11AndroidLab;
