import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const sdkLock=JSON.parse(readFileSync(new URL('./sdk-lock.json',import.meta.url),'utf8'));
export function verifySdk(aar) {
  if(!aar)throw new Error('Pinned official Siprix AAR required; set PHONE11_SIPRIX_ANDROID_AAR. No download is performed.');
  const bytes=readFileSync(aar);
  if(createHash('sha256').update(bytes).digest('hex')!==sdkLock.sha256)throw new Error('Pinned Android Siprix AAR checksum mismatch');
  const entries=execFileSync('unzip',['-Z1',aar],{encoding:'utf8'}).trim().split('\n');
  for(const entry of ['classes.jar',...sdkLock.abis.flatMap(abi=>[`jni/${abi}/libsiprix.so`,`jni/${abi}/libsiprixMedia.so`])])if(!entries.includes(entry))throw new Error('Incomplete pinned Android Siprix AAR');
  return {sdkVersion:sdkLock.version,build:sdkLock.build,sha256:sdkLock.sha256,abis:sdkLock.abis,trialCallLimitSeconds:sdkLock.trialCallLimitSeconds};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(JSON.stringify(verifySdk(process.env.PHONE11_SIPRIX_ANDROID_AAR)));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
