import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const packageName='ai.phone11.mobile.staging';
const wakeService='ai.phone11.siprix.Phone11IncomingCallService';
const firebaseService='ai.phone11.siprix.Phone11FirebaseMessagingService';
const publicResources=Object.freeze({firebaseAppId:'google_app_id',firebaseSenderId:'gcm_defaultSenderId',firebaseProjectId:'project_id'});
const outputKeys=Object.freeze(['serial','avdName','apiLevel','abi','googlePlayServicesPresent','packageName','installedApkSha256','sourceCommit','firebaseProjectId','firebaseSenderId','firebaseAppId','wakeServiceEnabled','firebaseServiceEnabled','debuggable','testOnly']);
const hex=size=>value=>new RegExp(`^[a-f0-9]{${size}}$`,'i').test(value||'');
const runFile=(command,args)=>execFileSync(command,args,{cwd:root,encoding:'utf8',timeout:30_000,maxBuffer:8*1024*1024});
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Staging APK identity is missing or invalid');}};
const attr=(attributes,name)=>new RegExp(`(?:^|\\s)android:${name}="([^"]*)"`).exec(attributes)?.[1];
const openingTags=(xml,name)=>[...xml.matchAll(new RegExp(`<${name}\\b([^>]*)>`,'g'))].map(match=>match[1]);
const serviceEnabled=(manifest,name)=>{
 const attributes=openingTags(manifest,'service').find(value=>attr(value,'name')===name);
 return attributes!==undefined&&attr(attributes,'enabled')==='true';
};

export function assertSanitizedDeviceEvidence(value){
 if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...outputKeys].sort()))throw new Error('Device evidence fields are not the public allowlist');
 const encoded=JSON.stringify(value);
 if(/"(?:token|apiKey|api_key|grant|credential|secret|authorization)"\s*:/i.test(encoded)||/AIza[0-9A-Za-z_-]{20,}/.test(encoded))
  throw new Error('Device evidence contains forbidden provider material');
 return value;
}

export function collectDeviceEvidence({source=process.env,execute=runFile,projectRoot=root}={}){
 const serial=source.LAB_EMULATOR_SERIAL;
 if(!/^emulator-\d+$/.test(serial||''))throw new Error('LAB_EMULATOR_SERIAL must select the dedicated emulator');
 const identityFile=path.resolve(projectRoot,source.LAB_STAGING_APK_IDENTITY_FILE??'.lab/staging-apk.json');
 const identity=readJson(identityFile);
 if(identity.packageName!==packageName||identity.sourceDirty!==false||!hex(64)(identity.sha256)||!hex(40)(identity.commit))
  throw new Error('Staging APK identity is not a clean exact commissioned build');
 const apk=fs.realpathSync(path.resolve(projectRoot,identity.apk));
 if(!fs.statSync(apk).isFile()||createHash('sha256').update(fs.readFileSync(apk)).digest('hex')!==identity.sha256)
  throw new Error('Retained staging APK does not match its identity');
 const androidHome=source.ANDROID_HOME??path.join(os.homedir(),'Library/Android/sdk');
 const adb=path.join(androidHome,'platform-tools/adb');
 const analyzer=path.join(androidHome,'cmdline-tools/latest/bin/apkanalyzer');
 const adbRun=(...args)=>execute(adb,['-s',serial,...args]).trim();
 const analyze=(...args)=>execute(analyzer,[...args,apk]).trim();
 const avdName=adbRun('emu','avd','name').split(/\r?\n/).find(Boolean);
 const apiLevel=Number(adbRun('shell','getprop','ro.build.version.sdk'));
 const abi=adbRun('shell','getprop','ro.product.cpu.abi');
 const googlePlayServicesPresent=/^package:\S+\.apk$/m.test(adbRun('shell','pm','path','com.google.android.gms'));
 const installedPaths=adbRun('shell','pm','path',packageName).split(/\r?\n/).map(line=>line.replace(/^package:/,'')).filter(Boolean);
 const installedApk=installedPaths.find(value=>/\/base\.apk$/.test(value));
 if(!installedApk||!/^[A-Za-z0-9_~+./=-]+$/.test(installedApk))throw new Error('Commissioned staging package is not installed');
 const installedApkSha256=adbRun('shell','sha256sum',installedApk).split(/\s+/)[0];
 if(!hex(64)(installedApkSha256))throw new Error('Installed staging APK hash is unavailable');
 const observedPackage=analyze('manifest','application-id');
 const manifest=analyze('manifest','print');
 const application=openingTags(manifest,'application')[0]??'';
 const packageDump=adbRun('shell','dumpsys','package',packageName);
 const userEnabled=Number(/User 0:[^\n]*\benabled=(\d+)/.exec(packageDump)?.[1]);
 const fcmResolvers=adbRun('shell','cmd','package','query-services','--components','-a','com.google.firebase.MESSAGING_EVENT',packageName).split(/\r?\n/);
 const resources=Object.fromEntries(Object.entries(publicResources).map(([key,name])=>[key,analyze('resources','value','--config','default','--type','string','--name',name,'--package',packageName)]));
 const appMatch=/^1:(\d{6,20}):android:[a-f0-9]{16,64}$/i.exec(resources.firebaseAppId);
 if(observedPackage!==packageName||identity.sha256!==installedApkSha256)throw new Error('Installed APK is not the exact retained staging build');
 if(avdName!=='Phone11_Lab_API35'||apiLevel!==35||abi!=='arm64-v8a')throw new Error('Device is not the commissioned Android lab image');
 if(!googlePlayServicesPresent)throw new Error('Google Play services is unavailable');
 if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(resources.firebaseProjectId)||!/(^|[.-])(staging|stage|sandbox|nonprod)([.-]|$)/.test(resources.firebaseProjectId))throw new Error('APK Firebase project is not isolated staging');
 if(!appMatch||appMatch[1]!==resources.firebaseSenderId)throw new Error('APK Firebase public identity is inconsistent');
 const wakeServiceEnabled=serviceEnabled(manifest,wakeService)&&[0,1].includes(userEnabled);
 const firebaseServiceEnabled=serviceEnabled(manifest,firebaseService)&&[0,1].includes(userEnabled)&&fcmResolvers.includes(`${packageName}/${firebaseService}`);
 const debuggable=attr(application,'debuggable')==='true'||/\bDEBUGGABLE\b/.test(packageDump);
 const testOnly=attr(application,'testOnly')==='true'||/\bTEST_ONLY\b/.test(packageDump);
 return assertSanitizedDeviceEvidence({serial,avdName,apiLevel,abi,googlePlayServicesPresent,packageName,
  installedApkSha256,sourceCommit:identity.commit,...resources,wakeServiceEnabled,firebaseServiceEnabled,debuggable,testOnly});
}

export function writeDeviceEvidence(value,projectRoot=root){
 assertSanitizedDeviceEvidence(value);
 const directory=path.join(projectRoot,'.lab/push-live');fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'device-evidence.json');fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600});fs.chmodSync(file,0o600);return file;
}

export function main(source=process.env){
 const value=collectDeviceEvidence({source});const file=writeDeviceEvidence(value);
 console.log(JSON.stringify({status:'PASS',file,apkSha256:value.installedApkSha256,sourceCommit:value.sourceCommit,packageName:value.packageName},null,2));
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){try{main();}catch{console.error('Device evidence collection failed without exposing provider material.');process.exitCode=1;}}
