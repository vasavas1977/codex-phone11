import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256,explicitEmulator,aggregate,renderReport,junit,sanitize} from './core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
process.chdir(root);
const out=path.join(root,'.lab');fs.mkdirSync(out,{recursive:true,mode:0o700});
const sdk=process.env.ANDROID_HOME||path.join(os.homedir(),'Library/Android/sdk');
const adb=path.join(sdk,'platform-tools/adb');
const lock=JSON.parse(fs.readFileSync('lab/android/sdk-lock.json'));
export const labEnv=()=>Object.fromEntries([...Object.entries(process.env).filter(([k])=>!k.startsWith('EXPO_PUBLIC_')&&!k.startsWith('PHONE11_')&&!/^(VITE_|OWNER_|OAUTH_)/.test(k)),...Object.entries({PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_PHONE11_ANDROID_LAB:'1',EXPO_PUBLIC_SIP_ENGINE:'siprix',EXPO_PUBLIC_API_BASE_URL:'http://10.0.2.2:18080',EXPO_NO_DOTENV:'1',ANDROID_HOME:sdk,CI:'1',NODE_ENV:'production',EAS_BUILD_GIT_COMMIT_HASH:run('git',['rev-parse','HEAD']).trim()})]);
function run(cmd,args,options={}) {return execFileSync(cmd,args,{encoding:'utf8',timeout:120000,cwd:root,...options});}
const probe=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8',timeout:20000});return r.status===0?{ok:true,output:((r.stdout||'')+(r.stderr||'')).trim()}:{ok:false,reason:'Missing tool or probe failed',code:r.status??null};};
function device(){const serial=explicitEmulator(process.env.LAB_EMULATOR_SERIAL,run(adb,['devices']));const name=run(adb,['-s',serial,'emu','avd','name']).split('\n')[0].trim();if(name!=='Phone11_Lab_API35')throw new Error('Selected AVD is not Phone11_Lab_API35');return serial;}
async function main(){switch(process.argv[2]){
 case 'doctor':{
  const d={at:new Date().toISOString(),os:os.platform(),arch:os.arch(),node:process.version,pnpm:probe('pnpm',['--version']),java:probe('java',['-version']),sdk,adb:probe(adb,['version']),devices:probe(adb,['devices']),emulator:probe(path.join(sdk,'emulator/emulator'),['-version']),acceleration:probe(path.join(sdk,'emulator/emulator'),['-accel-check']),avds:probe(path.join(sdk,'emulator/emulator'),['-list-avds']),images:fs.existsSync(path.join(sdk,'system-images'))?fs.readdirSync(path.join(sdk,'system-images')):[],docker:probe('docker',['info','--format','{{.ServerVersion}}']),disk:probe('df',['-h',root]),network:{sip:'NOT_PROBED: run lab:test:sip',rtp:'NOT_PROBED: requires decoded audio'},hostAudio:'NOT_TESTED: microphone remains disabled; operator consent needed for live speech'};
  fs.writeFileSync(path.join(out,'doctor.json'),JSON.stringify(d,null,2));console.log(JSON.stringify(d,null,2));break;
 }
 case 'setup':{
  const dest=path.join(root,'modules/phone11-siprix/vendor/android/siprix_voip_sdk.aar');
  if(!fs.existsSync(dest)||sha256(fs.readFileSync(dest))!==lock.sha256){const response=await fetch(`https://raw.githubusercontent.com/siprix/SampleJava/${lock.revision}/${lock.path}`,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error('SDK fetch failed');const data=Buffer.from(await response.arrayBuffer());if(sha256(data)!==lock.sha256)throw new Error('SDK checksum mismatch');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);}
  console.log('Pinned Siprix Android AAR verified. Tool installation is explicit; see runbook.');break;
 }
 case 'build':{
  if(fs.existsSync('.env'))throw new Error('Refusing lab build with an inherited .env file');
  const aar='modules/phone11-siprix/vendor/android/siprix_voip_sdk.aar';if(!fs.existsSync(aar)||sha256(fs.readFileSync(aar))!==lock.sha256)throw new Error('Run lab:setup first');
  const env=labEnv();const stamp=new Date().toISOString().replace(/[:.]/g,'-');const log=fs.openSync(path.join(out,`build-${stamp}.log`),'wx',0o600);
  try{
   run('pnpm',['exec','expo','prebuild','--platform','android','--no-install'],{env,stdio:['ignore',log,log],timeout:180000});
   run('./gradlew',[':app:assembleRelease','--no-daemon','--max-workers=2','-PreactNativeArchitectures=arm64-v8a','-Dorg.gradle.internal.http.connectionTimeout=15000','-Dorg.gradle.internal.http.socketTimeout=30000'],{cwd:path.join(root,'android'),env,stdio:['ignore',log,log],timeout:1800000});
  }finally{fs.closeSync(log);}
  const apk='android/app/build/outputs/apk/release/app-release.apk';
  const inventory=run('unzip',['-l',apk]);for(const name of ['libsiprix.so','libsiprixMedia.so','assets/index.android.bundle'])if(!inventory.includes(name))throw new Error('Missing APK component '+name);
  if(/lib(?:pjsip|pjsua)/i.test(inventory))throw new Error('Competing SIP library');
  const abis=new Set([...inventory.matchAll(/lib\/([^/\s]+)\/[^\s]+\.so/g)].map(m=>m[1]));
  if(abis.size!==1||!abis.has('arm64-v8a'))throw new Error('Lab APK must contain only the complete ARM64 ABI');
  for(const name of ['lib/arm64-v8a/libreactnative.so','lib/arm64-v8a/libhermes.so'])if(!inventory.includes(name))throw new Error('Incomplete React Native ABI');
  const identity={apk:path.join(root,apk),sha256:sha256(fs.readFileSync(apk)),commit:run('git',['rev-parse','HEAD']).trim(),sourceDirty:!!run('git',['status','--porcelain']).trim(),sdk:lock,at:new Date().toISOString()};fs.writeFileSync(path.join(out,'apk.json'),JSON.stringify(identity,null,2));console.log(JSON.stringify(identity,null,2));break;
 }
 case 'install':{
  const serial=device(),id=JSON.parse(fs.readFileSync(path.join(out,'apk.json')));if(sha256(fs.readFileSync(id.apk))!==id.sha256)throw new Error('APK hash changed');
  console.log(run(adb,['-s',serial,'install','-r',id.apk],{timeout:180000}));break;
 }
 case 'logic':case 'push-contract':{
  const files=process.argv[2]==='logic'?['tests/phone11-siprix-engine.test.ts','tests/phone11-siprix-selection.test.ts']:['tests/phone11-wake-service.test.ts','tests/phone11-wake-client.test.ts','tests/phone11-wake-routes.test.ts'];
  const result=spawnSync('pnpm',['exec','vitest','run',...files],{cwd:root,encoding:'utf8',timeout:180000,env:{...labEnv(),NODE_ENV:'test'}});
  const name=`${process.argv[2]}-${Date.now()}.log`;fs.writeFileSync(path.join(out,name),(result.stdout||'')+(result.stderr||''));console.log(result.stdout);process.exitCode=result.status??1;break;
 }
 case 'report':{
  const attempts=fs.existsSync(path.join(out,'attempts.json'))?JSON.parse(fs.readFileSync(path.join(out,'attempts.json'))):[];
  const fixture=fs.existsSync(path.join(out,'fixture.json'))?JSON.parse(fs.readFileSync(path.join(out,'fixture.json'))):null;
  const secrets=fixture?Object.values(fixture.accounts).map(a=>a.password):[];
  const report=sanitize(aggregate(attempts),secrets);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(sanitize(report),null,2));fs.writeFileSync(path.join(out,'report.html'),renderReport(report));fs.writeFileSync(path.join(out,'junit.xml'),junit(report));console.log(JSON.stringify({status:report.status,counts:report.counts,path:path.join(out,'report.html')},null,2));break;
 }
 case 'up':case 'down':{console.log(run(process.execPath,['lab/android/fixture.mjs',process.argv[2]],{timeout:300000}));break;}
 case 'sip':{console.log(run(process.execPath,['lab/android/sip-test.mjs'],{timeout:1200000}));break;}
 case 'push-live':{
  console.log('BLOCKED L3: no lab Firebase client/sender, Android native authenticated wake receiver, or tested pending-call delivery adapter. No push sent. L0 mocks are separate.');process.exitCode=2;break;
 }
 default:throw new Error('Unknown lab command');
}}
main().catch(()=>{console.error('Lab command failed; inspect the private evidence or run lab:doctor. No production operation was attempted.');process.exitCode=1;});
