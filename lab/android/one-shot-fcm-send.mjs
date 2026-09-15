import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const commissioned=Object.freeze({
  projectId:'phone11-stage-20260914',
  senderId:'413228367517',
  appId:'1:413228367517:android:f41353883923fc15911e74',
  packageName:'ai.phone11.mobile.staging',
  serviceAccount:'phone11-fcm-lab@phone11-stage-20260914.iam.gserviceaccount.com',
  avdName:'Phone11_Lab_API35',
  apiLevel:35,
  abi:'arm64-v8a',
});
const envelopeKeys=Object.freeze(['bindingId','callUUID','expiresAt','v']);
const hex=size=>value=>new RegExp(`^[a-f0-9]{${size}}$`,'i').test(value||'');
const sha=value=>createHash('sha256').update(value).digest('hex');
const runSecret=(command,args,options={})=>execFileSync(command,args,{cwd:root,encoding:'utf8',timeout:30_000,maxBuffer:8*1024*1024,...options});
const xmlDecode=value=>value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

function exactKeys(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))
    throw new Error(`${label} fields are not the public allowlist`);
}

export function assertSanitizedOneShotEvidence(value,secrets=[]){
  exactKeys(value,['version','source','environment','sentAt','provider','device','envelope'],'One-shot evidence');
  exactKeys(value.provider,['transport','projectId','httpStatus','accepted','messageNameHash','responseBodyHash'],'Provider evidence');
  exactKeys(value.device,['serial','packageName','installedApkSha256','sourceCommit','firebaseSenderId','firebaseAppId','tokenFingerprint'],'Device evidence');
  exactKeys(value.envelope,['keys','expiresAt','callUUIDHash','bindingIdHash'],'Envelope evidence');
  if(value.version!==1||value.source!=='real_fcm_v1'||value.environment!=='staging'||value.provider.transport!=='FCM_V1')throw new Error('One-shot evidence identity is invalid');
  if(value.provider.projectId!==commissioned.projectId||value.device.packageName!==commissioned.packageName||String(value.device.firebaseSenderId)!==commissioned.senderId||value.device.firebaseAppId!==commissioned.appId)throw new Error('One-shot evidence is not the commissioned staging identity');
  if(!Number.isInteger(value.sentAt)||value.sentAt<=0||!Number.isInteger(value.envelope.expiresAt)||value.envelope.expiresAt<=value.sentAt)throw new Error('One-shot evidence timestamps are invalid');
  if(!Number.isInteger(value.provider.httpStatus)||value.provider.httpStatus<0||value.provider.httpStatus>599||typeof value.provider.accepted!=='boolean')throw new Error('One-shot provider status is invalid');
  if(value.provider.messageNameHash!==null&&!hex(64)(value.provider.messageNameHash))throw new Error('Provider message hash is invalid');
  if(!hex(64)(value.provider.responseBodyHash)||!hex(64)(value.device.installedApkSha256)||!hex(40)(value.device.sourceCommit)||!hex(16)(value.device.tokenFingerprint)||!hex(64)(value.envelope.callUUIDHash)||!hex(64)(value.envelope.bindingIdHash))throw new Error('One-shot evidence hash is invalid');
  if(JSON.stringify(value.envelope.keys)!==JSON.stringify(envelopeKeys))throw new Error('One-shot envelope keys are invalid');
  const encoded=JSON.stringify(value);
  if(/"(?:token|accessToken|credential|secret|authorization|callUUID|bindingId)"\s*:/i.test(encoded))throw new Error('One-shot evidence contains forbidden provider material');
  for(const secret of secrets)if(typeof secret==='string'&&secret.length>=16&&encoded.includes(secret))throw new Error('One-shot evidence contains transient provider material');
  return value;
}

export function parseRegistrationToken(xml,senderId=commissioned.senderId){
  if(typeof xml!=='string'||xml.length<1||xml.length>8*1024*1024)throw new Error('Firebase registration state is unavailable');
  const tokens=new Set();
  for(const match of xml.matchAll(/<string\s+name="([^"]+)"\s*>([\s\S]*?)<\/string>/g)){
    const name=xmlDecode(match[1]);
    if(!name.includes('|T|')||!name.includes(senderId))continue;
    try{
      const parsed=JSON.parse(xmlDecode(match[2]));
      if(typeof parsed?.token==='string'&&/^[A-Za-z0-9_:.=-]{64,4096}$/.test(parsed.token))tokens.add(parsed.token);
    }catch{}
  }
  if(tokens.size!==1)throw new Error('Exactly one commissioned Firebase registration token is required');
  return [...tokens][0];
}

export function buildFcmRequest({registrationToken,callUUID,bindingId,expiresAt}){
  if(!/^[A-Za-z0-9_:.=-]{64,4096}$/.test(registrationToken||''))throw new Error('Firebase registration token is invalid');
  for(const [label,value] of [['call UUID',callUUID],['binding ID',bindingId]])if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||''))throw new Error(`${label} is invalid`);
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=0)throw new Error('Envelope expiry is invalid');
  return {message:{token:registrationToken,data:{v:'1',callUUID,bindingId,expiresAt:String(expiresAt)},android:{priority:'HIGH',ttl:'0s',direct_boot_ok:true}}};
}

export function readCommissionedDeviceEvidence(projectRoot=root,source=process.env){
  const file=fs.realpathSync(path.resolve(projectRoot,source.LAB_STAGING_DEVICE_EVIDENCE_FILE??'.lab/push-live/device-evidence.json'));
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value.serial!==source.LAB_EMULATOR_SERIAL||value.avdName!==commissioned.avdName||value.apiLevel!==commissioned.apiLevel||value.abi!==commissioned.abi||value.googlePlayServicesPresent!==true||value.packageName!==commissioned.packageName||value.firebaseProjectId!==commissioned.projectId||String(value.firebaseSenderId)!==commissioned.senderId||value.firebaseAppId!==commissioned.appId||value.wakeServiceEnabled!==true||value.firebaseServiceEnabled!==true||value.debuggable!==false||value.testOnly!==false||!hex(64)(value.installedApkSha256)||!hex(40)(value.sourceCommit))throw new Error('Current device evidence does not match the commissioned staging target');
  return value;
}

function readLiveRegistrationToken({source,execute,device}){
  const androidHome=source.ANDROID_HOME??path.join(os.homedir(),'Library/Android/sdk');
  const adb=path.join(androidHome,'platform-tools/adb'),base=['-s',device.serial];
  const adbRun=(...args)=>execute(adb,[...base,...args]).trim();
  if(adbRun('emu','avd','name').split(/\r?\n/).find(Boolean)!==commissioned.avdName||Number(adbRun('shell','getprop','ro.build.version.sdk'))!==commissioned.apiLevel||adbRun('shell','getprop','ro.product.cpu.abi')!==commissioned.abi)throw new Error('Live emulator identity no longer matches device evidence');
  if(!/^uid=0\b/.test(adbRun('shell','id')))throw new Error('ADB must already have controlled root access to read private Firebase state');
  const installed=adbRun('shell','pm','path',commissioned.packageName).split(/\r?\n/).map(line=>line.replace(/^package:/,'')).find(value=>/\/base\.apk$/.test(value));
  if(!installed||!/^[A-Za-z0-9_~+./=-]+$/.test(installed))throw new Error('Commissioned staging package is not installed');
  if(adbRun('shell','sha256sum',installed).split(/\s+/)[0]!==device.installedApkSha256)throw new Error('Installed staging APK changed after device evidence collection');
  const prefs=`/data/user/0/${commissioned.packageName}/shared_prefs/com.google.android.gms.appid.xml`;
  return parseRegistrationToken(execute(adb,[...base,'exec-out','cat',prefs]),commissioned.senderId);
}

function mintAccessToken(execute){
  const token=execute('gcloud',['auth','print-access-token',`--impersonate-service-account=${commissioned.serviceAccount}`,`--project=${commissioned.projectId}`,'--quiet']).trim();
  if(!/^[A-Za-z0-9._~+\/-]{100,4096}$/.test(token))throw new Error('Short-lived impersonated access token is unavailable');
  return token;
}

export async function sendOneShot({source=process.env,projectRoot=root,execute=runSecret,fetchFn=fetch,now=Date.now,uuid=randomUUID}={}){
  if(source.PHONE11_FCM_ONE_SHOT_ENABLED!=='1')throw new Error('PHONE11_FCM_ONE_SHOT_ENABLED=1 is required');
  if(!/^emulator-\d+$/.test(source.LAB_EMULATOR_SERIAL||''))throw new Error('LAB_EMULATOR_SERIAL must select the dedicated emulator');
  const bindingId=source.PHONE11_FCM_ONE_SHOT_BINDING_ID;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bindingId||''))
    throw new Error('PHONE11_FCM_ONE_SHOT_BINDING_ID must select the reviewed live wake binding');
  const device=readCommissionedDeviceEvidence(projectRoot,source);
  const directory=path.join(projectRoot,'.lab/push-live');fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
  const output=path.join(directory,`first-provider-send-${device.sourceCommit.slice(0,7)}.json`),lock=`${output}.lock`;
  if(fs.existsSync(output))throw new Error('A provider-send evidence file already exists for this exact build');
  const lockFd=fs.openSync(lock,'wx',0o600);fs.closeSync(lockFd);fs.chmodSync(lock,0o600);
  let requestStarted=false,responseReceived=false;
  try{
    const registrationToken=readLiveRegistrationToken({source,execute,device});
    const accessToken=mintAccessToken(execute);
    const sentAt=now(),expiresAt=sentAt+60_000,callUUID=uuid();
    const body=buildFcmRequest({registrationToken,callUUID,bindingId,expiresAt});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
    let response,responseText;
    try{
      requestStarted=true;
      response=await fetchFn(`https://fcm.googleapis.com/v1/projects/${commissioned.projectId}/messages:send`,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      responseText=await response.text();responseReceived=true;
    }finally{clearTimeout(timer);}
    const responseBodyHash=sha(responseText);let messageName=null;
    if(response.ok)try{messageName=JSON.parse(responseText)?.name??null;}catch{}
    const validName=typeof messageName==='string'&&messageName.startsWith(`projects/${commissioned.projectId}/messages/`);
    const evidence={version:1,source:'real_fcm_v1',environment:'staging',sentAt,provider:{transport:'FCM_V1',projectId:commissioned.projectId,httpStatus:Number(response.status)||0,accepted:response.ok&&validName,messageNameHash:validName?sha(messageName):null,responseBodyHash},device:{serial:device.serial,packageName:device.packageName,installedApkSha256:device.installedApkSha256,sourceCommit:device.sourceCommit,firebaseSenderId:String(device.firebaseSenderId),firebaseAppId:device.firebaseAppId,tokenFingerprint:sha(registrationToken).slice(0,16)},envelope:{keys:[...envelopeKeys],expiresAt,callUUIDHash:sha(callUUID),bindingIdHash:sha(bindingId)}};
    assertSanitizedOneShotEvidence(evidence,[registrationToken,accessToken,callUUID,bindingId,messageName].filter(Boolean));
    fs.writeFileSync(output,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});fs.chmodSync(output,0o600);fs.unlinkSync(lock);
    return {evidence,output};
  }catch(error){
    if(!requestStarted||responseReceived)try{fs.unlinkSync(lock);}catch{}
    throw error;
  }
}

export async function main(source=process.env,args=process.argv.slice(2)){
  if(!args.includes('--execute'))throw new Error('The one-shot provider sender requires --execute');
  const {evidence,output}=await sendOneShot({source});
  console.log(JSON.stringify({status:evidence.provider.accepted?'ACCEPTED':'REJECTED',httpStatus:evidence.provider.httpStatus,providerMessageNameHash:evidence.provider.messageNameHash,tokenFingerprint:evidence.device.tokenFingerprint,evidenceFile:output},null,2));
  if(!evidence.provider.accepted)process.exitCode=2;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('One-shot FCM send stopped without exposing provider, device or correlation material. Inspect the private lock/evidence state before any retry.');process.exitCode=2;
});

export {commissioned};
