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
const stagingPackage='ai.phone11.mobile.staging';
const stagingNamePattern=/(^|[.-])(staging|stage|sandbox|nonprod)([.-]|$)/;
const placeholderPattern=/(example|placeholder|changeme|replace[-_]?me|your[-_]|dummy|sample)/i;
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

function required(source,name){
 const value=source[name]?.trim();
 if(!value)throw new Error(`Commissioned Android wake requires ${name}`);
 if(placeholderPattern.test(value))throw new Error(`${name} must not be a placeholder`);
 return value;
}
function stagingHost(value,name,{https=false}={}){
 let host=value;
 if(https){
  let parsed;
  try{parsed=new URL(value);}catch{throw new Error(`${name} must be a valid HTTPS staging origin`);}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)
   throw new Error(`${name} must be a valid HTTPS staging origin`);
  host=parsed.hostname;
 }
 host=host.toLowerCase();
 if(!hostPattern.test(host)||host.includes('..')||!stagingNamePattern.test(host))
  throw new Error(`${name} must identify an isolated staging host`);
 return value;
}
function firebaseSettings(source,packageName,projectRoot){
 if(packageName!==stagingPackage)throw new Error(`Commissioned Android wake requires package ${stagingPackage}`);
 const projectId=required(source,'PHONE11_ANDROID_FIREBASE_PROJECT_ID');
 if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||!stagingNamePattern.test(projectId))
  throw new Error('Firebase project ID must identify an isolated staging project');
 const senderId=required(source,'PHONE11_ANDROID_FIREBASE_SENDER_ID');
 if(!/^\d{6,20}$/.test(senderId)||/^(\d)\1+$/.test(senderId))throw new Error('Invalid Firebase sender ID');
 const appId=required(source,'PHONE11_ANDROID_FIREBASE_APP_ID');
 const appMatch=/^1:(\d{6,20}):android:([0-9a-f]{16,64})$/i.exec(appId);
 if(!appMatch||appMatch[1]!==senderId)throw new Error('Firebase app ID must be an Android app for the declared sender ID');
 const configuredFile=required(source,'PHONE11_ANDROID_GOOGLE_SERVICES_FILE');
 const candidate=path.resolve(projectRoot,configuredFile);
 let file;
 try{
  if(!fs.statSync(candidate).isFile())throw new Error();
  file=fs.realpathSync(candidate);
 }catch{throw new Error('Android google-services.json is missing or is not a file');}
 let document;
 try{document=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Android google-services.json is not valid JSON');}
 if(document?.project_info?.project_id!==projectId)throw new Error('google-services.json project ID does not match commissioning');
 if(String(document?.project_info?.project_number??'')!==senderId)throw new Error('google-services.json sender ID does not match commissioning');
 const clients=Array.isArray(document?.client)?document.client:[];
 if(clients.length!==1||clients[0]?.client_info?.android_client_info?.package_name!==stagingPackage)
  throw new Error(`google-services.json must contain only the ${stagingPackage} Android client`);
 if(clients[0]?.client_info?.mobilesdk_app_id!==appId)throw new Error('google-services.json app ID does not match commissioning');
 return {projectId,senderId,appId,googleServicesFile:file};
}

function androidWakeBuildSettings(source=process.env,{packageName=source.PHONE11_ANDROID_LAB_PACKAGE,projectRoot=process.cwd()}={}){
 const gate=source.PHONE11_ANDROID_WAKE_COMMISSIONED??'0';
 const firebaseGate=source.PHONE11_ANDROID_FIREBASE_COMMISSIONED??'0';
 const environment=source.PHONE11_ANDROID_WAKE_ENVIRONMENT;
 if(!['0','1'].includes(gate))throw new Error('Android wake gate must be 0 or 1');
 if(!['0','1'].includes(firebaseGate))throw new Error('Android Firebase gate must be 0 or 1');
 if(gate!==firebaseGate)throw new Error('Android wake and Firebase commission flags must agree');
 if(gate==='1'&&(source.PHONE11_ANDROID_LAB!=='1'||source.EXPO_PUBLIC_PHONE11_ANDROID_LAB!=='1'
  ||source.EXPO_PUBLIC_SIP_ENGINE!=='siprix'||environment!=='staging')){
  throw new Error('Android wake commissioning requires the isolated Siprix lab and staging environment');
 }
 const firebaseNames=['PHONE11_ANDROID_FIREBASE_PROJECT_ID','PHONE11_ANDROID_FIREBASE_APP_ID',
  'PHONE11_ANDROID_FIREBASE_SENDER_ID','PHONE11_ANDROID_GOOGLE_SERVICES_FILE'];
 if(gate==='0'){
  if(environment!==undefined||firebaseNames.some(name=>source[name]!==undefined))
   throw new Error('Uncommissioned Android wake must not declare staging or Firebase configuration');
  return {gate,firebaseGate,environment:undefined,firebase:undefined,apiBaseUrl:undefined};
 }
 const apiBaseUrl=stagingHost(required(source,'EXPO_PUBLIC_API_BASE_URL'),'EXPO_PUBLIC_API_BASE_URL',{https:true});
 stagingHost(required(source,'PHONE11_ANDROID_SIP_HOST'),'PHONE11_ANDROID_SIP_HOST');
 return {gate,firebaseGate,environment,firebase:firebaseSettings(source,packageName,projectRoot),apiBaseUrl};
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
   'android:exported':'false','tools:ignore':'Instantiatable','tools:replace':'android:enabled'},
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
 const wake=androidWakeBuildSettings(process.env,{packageName:config.android?.package,projectRoot:process.cwd()});
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
withPhone11AndroidLab.stagingAndroidPackage = stagingPackage;
module.exports = withPhone11AndroidLab;
