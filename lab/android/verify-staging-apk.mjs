#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const STAGING_IDENTITY=Object.freeze({
 packageName:'ai.phone11.mobile.staging',
 projectId:'phone11-stage-20260914',
 senderId:'413228367517',
 appId:'1:413228367517:android:f41353883923fc15911e74',
});
const SHA256=/^[a-f0-9]{64}$/i;
const COMMIT=/^[a-f0-9]{40}$/i;
const REQUIRED_SERVICES=[
 'ai.phone11.siprix.Phone11IncomingCallService',
 'ai.phone11.siprix.Phone11FirebaseMessagingService',
];
const REQUIRED_ARM64_LIBS=['libreactnative.so','libsiprix.so','libsiprixMedia.so'];

export function sha256File(file){
 const digest=crypto.createHash('sha256');
 const descriptor=fs.openSync(file,'r');
 const buffer=Buffer.allocUnsafe(1024*1024);
 try{for(;;){const count=fs.readSync(descriptor,buffer,0,buffer.length,null);if(!count)break;digest.update(buffer.subarray(0,count));}}
 finally{fs.closeSync(descriptor);}
 return digest.digest('hex');
}

function attr(tag,name){
 const match=new RegExp(`\\bandroid:${name}="([^"]*)"`).exec(tag);
 return match?.[1]??null;
}
function elementByName(xml,element,name){
 const tags=xml.match(new RegExp(`<${element}\\b[^>]*>`, 'g'))??[];
 return tags.find(tag=>attr(tag,'name')===name)??null;
}
function analyzerCandidates(){
 const candidates=[];
 if(process.env.APKANALYZER)candidates.push(process.env.APKANALYZER);
 for(const root of [process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,
  path.join(process.env.HOME??'', 'Library/Android/sdk')]){
  if(!root)continue;
  candidates.push(path.join(root,'cmdline-tools/latest/bin/apkanalyzer'));
  const tools=path.join(root,'cmdline-tools');
  if(fs.existsSync(tools))for(const entry of fs.readdirSync(tools).sort().reverse())
   candidates.push(path.join(tools,entry,'bin/apkanalyzer'));
 }
 return [...new Set(candidates)].find(candidate=>candidate&&fs.existsSync(candidate));
}
export function createAnalyzer(binary=analyzerCandidates()){
 if(!binary)throw new Error('apkanalyzer unavailable');
 return args=>execFileSync(binary,args,{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
}

function readIdentity(file,errors){
 if(!file)return {};
 try{
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
  return {
   sha256:value.sha256??value.apkSha256??value.apk_sha256,
   sourceCommit:value.commit??value.sourceCommit??value.source_sha,
   sourceDirty:value.sourceDirty??value.source_dirty,
   apk:value.apk,
  };
 }catch{errors.push('APK identity file is missing or invalid');return {};}
}

export function verifyStagingApk(options,{runAnalyzer}={}){
 const errors=[];
 const apk=options.apkPath?path.resolve(options.apkPath):null;
 const identity=readIdentity(options.identityFile,errors);
 const expectedSha=options.expectedSha256??identity.sha256;
 const sourceCommit=options.expectedSourceCommit??identity.sourceCommit;
 if(options.expectedSha256&&identity.sha256&&options.expectedSha256!==identity.sha256)
  errors.push('Expected APK hash conflicts with identity file');
 if(options.expectedSourceCommit&&identity.sourceCommit&&options.expectedSourceCommit!==identity.sourceCommit)
  errors.push('Expected source commit conflicts with identity file');
 if(identity.sourceDirty===true)errors.push('APK identity reports a dirty source tree');
 if(identity.apk&&apk&&path.resolve(identity.apk)!==apk)errors.push('APK path conflicts with identity file');
 if(!apk||!fs.existsSync(apk)||!fs.statSync(apk).isFile())errors.push('APK file is missing');
 if(!SHA256.test(expectedSha??''))errors.push('Exact expected APK SHA-256 is required');
 if(!COMMIT.test(sourceCommit??''))errors.push('Exact 40-character source commit is required');
 let actualSha=null;
 if(apk&&fs.existsSync(apk)&&fs.statSync(apk).isFile()){
  actualSha=sha256File(apk);
  if(SHA256.test(expectedSha??'')&&actualSha!==expectedSha.toLowerCase())errors.push('APK SHA-256 mismatch');
 }

 let analyzer=runAnalyzer;
 if(!analyzer)try{analyzer=createAnalyzer();}catch{errors.push('Android apkanalyzer is unavailable');}
 const inspect=(label,args)=>{
  if(!analyzer)return null;
  try{return analyzer(args);}
  catch{errors.push(`${label} inspection failed`);return null;}
 };
 const applicationId=apk?inspect('APK package',['manifest','application-id',apk]):null;
 const manifest=apk?inspect('APK manifest',['manifest','print',apk]):null;
 const files=apk?inspect('APK native files',['files','list',apk]):null;
 const resource=name=>apk?inspect(`Firebase ${name}`,['resources','value','--config','default','--type','string','--name',name,apk]):null;
 const appId=resource('google_app_id');
 const senderId=resource('gcm_defaultSenderId');
 const projectId=resource('project_id');

 if(applicationId!==null&&applicationId.trim()!==STAGING_IDENTITY.packageName)
  errors.push(`APK package must be ${STAGING_IDENTITY.packageName}`);
 if(manifest!==null){
  const commissioned=elementByName(manifest,'meta-data','ai.phone11.androidWakeCommissioned');
  const environment=elementByName(manifest,'meta-data','ai.phone11.androidWakeEnvironment');
  if(!commissioned||attr(commissioned,'value')!=='true')errors.push('Android wake commissioning metadata is not enabled');
  if(!environment||attr(environment,'value')!=='staging')errors.push('Android wake environment is not staging');
  for(const name of REQUIRED_SERVICES){
   const service=elementByName(manifest,'service',name);
   if(!service||attr(service,'enabled')!=='true')errors.push(`${name} is not explicitly enabled`);
   if(!service||attr(service,'exported')!=='false')errors.push(`${name} is not non-exported`);
  }
 }
 let abis=[];
 if(files!==null){
  const entries=files.split(/\r?\n/).map(value=>value.replace(/^\//,'').trim()).filter(Boolean);
  abis=[...new Set(entries.map(value=>/^lib\/([^/]+)\/[^/]+\.so$/.exec(value)?.[1]).filter(Boolean))].sort();
  if(abis.length!==1||abis[0]!=='arm64-v8a')errors.push('APK native bundle must contain only arm64-v8a');
  for(const library of REQUIRED_ARM64_LIBS)
   if(!entries.includes(`lib/arm64-v8a/${library}`))errors.push(`ARM64 native library ${library} is missing`);
 }
 if(projectId!==null&&projectId!==STAGING_IDENTITY.projectId)errors.push('Firebase project identity mismatch');
 if(senderId!==null&&senderId!==STAGING_IDENTITY.senderId)errors.push('Firebase sender identity mismatch');
 if(appId!==null&&appId!==STAGING_IDENTITY.appId)errors.push('Firebase Android app identity mismatch');
 if(appId&&appId.split(':')[1]!==senderId)errors.push('Firebase app and sender identities disagree');

 return {
  ok:errors.length===0,
  errors,
  apk:{path:apk,sha256:actualSha,sourceCommit:COMMIT.test(sourceCommit??'')?sourceCommit.toLowerCase():null},
  android:{packageName:applicationId?.trim()??null,abis,services:Object.fromEntries(REQUIRED_SERVICES.map(name=>{
   const service=manifest?elementByName(manifest,'service',name):null;
   return [name,{enabled:service?attr(service,'enabled')==='true':false,exported:service?attr(service,'exported')==='true':null}];
  }))},
  firebase:{projectId:projectId||null,senderId:senderId||null,appId:appId||null},
 };
}

export function parseArgs(argv,environment=process.env){
 const values={
  apkPath:environment.LAB_STAGING_APK,
  expectedSha256:environment.LAB_EXPECTED_APK_SHA256,
  expectedSourceCommit:environment.LAB_EXPECTED_SOURCE_COMMIT,
  identityFile:environment.LAB_APK_IDENTITY_FILE,
 };
 const names={'--apk':'apkPath','--expected-sha256':'expectedSha256','--expected-source-commit':'expectedSourceCommit','--identity-file':'identityFile'};
 for(let index=0;index<argv.length;index++){
  const key=names[argv[index]];if(!key||index+1>=argv.length)throw new Error('invalid arguments');
  values[key]=argv[++index];
 }
 return values;
}

function main(){
 let options;
 try{options=parseArgs(process.argv.slice(2));}
 catch{console.error('Usage: verify-staging-apk.mjs --apk APK --expected-sha256 HEX --expected-source-commit COMMIT [--identity-file JSON]');process.exitCode=2;return;}
 let result;
 try{result=verifyStagingApk(options);}
 catch{result={ok:false,errors:['Unexpected APK verification failure']};}
 console.log(JSON.stringify(result,null,2));
 if(!result.ok)process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
