import { constants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { CaptureLease, CaptureUpload } from './capture';
const MAX=100*1024*1024;
async function privateRead(path:string):Promise<Buffer>{
 const file=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.size<44||stat.size>MAX)throw new Error('Invalid completed recording');
  const bytes=Buffer.alloc(stat.size);let offset=0;
  while(offset<bytes.length){const r=await file.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)throw new Error('Truncated recording');offset+=r.bytesRead;}
  const after=await file.stat();if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error('Recording still changing');
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)!==bytes.length-8)throw new Error('Invalid WAV');return bytes;
 }finally{await file.close();}
}
/** Durable bytes survive a failed upload/response loss. Exact token retries never
 * overwrite another recording. The ledger retains the completion retry job. */
export function createCaptureSpool(config:{directory:string;endpoint:string;integrationSecret:string;fetch?:typeof fetch}):CaptureUpload & {discardCompleted(lease:CaptureLease):Promise<void>} {
 const endpoint=new URL(config.endpoint);
 if(endpoint.protocol!=='https:'||endpoint.pathname!=='/api/recordings/upload'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password||!config.integrationSecret)throw new Error('Invalid recording upload configuration');
 return {async prepareCapture(lease:CaptureLease){
  if(!Number.isSafeInteger(lease.tenantId)||lease.tenantId<=0)throw new Error('Invalid capture tenant');
  const base='/var/lib/freeswitch/recordings/phone11';const st=await fs.lstat(base);
  if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(base)!==base)throw new Error('Capture mount unavailable');
  const directory=join(base,String(lease.tenantId));await fs.mkdir(directory,{mode:0o700}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
  const tenant=await fs.lstat(directory);if(!tenant.isDirectory()||tenant.isSymbolicLink()||(tenant.mode&0o777)!==0o700)throw new Error('Unsafe capture tenant directory');
 },async discardCompleted(lease:CaptureLease){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lease.token)||!Number.isSafeInteger(lease.tenantId)||lease.tenantId<=0||lease.path!==`/var/lib/freeswitch/recordings/phone11/${lease.tenantId}/${lease.token}.wav`)throw new Error('Invalid cleanup identity');
  for(const file of [join(config.directory,lease.token+'.wav'),lease.path]){
   try{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink())throw new Error('Unsafe capture cleanup');await fs.unlink(file);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  }
 },async putCompleted(lease:CaptureLease){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lease.token)||!Number.isSafeInteger(lease.tenantId)||lease.tenantId<=0||lease.path!==`/var/lib/freeswitch/recordings/phone11/${lease.tenantId}/${lease.token}.wav`)throw new Error('Invalid spool identity');
  await fs.mkdir(config.directory,{recursive:true,mode:0o700});const st=await fs.lstat(config.directory);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o777)!==0o700)throw new Error('Unsafe spool');
  const path=join(config.directory,lease.token+'.wav');let bytes:Buffer;
  try{bytes=await privateRead(path);}catch(error:any){
   if(error.code!=='ENOENT')throw error;
   bytes=await privateRead(lease.path);
   const temporary=join(config.directory,`.capture-${randomUUID()}.tmp`);
   const file=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    try{await fs.link(temporary,path);}catch(error:any){
     if(error.code!=='EEXIST')throw error;
     const existing=await privateRead(path);if(!existing.equals(bytes))throw new Error('Spool identity conflict');existing.fill(0);
    }
    const directory=await fs.open(config.directory,constants.O_RDONLY|constants.O_NOFOLLOW);try{await directory.sync();}finally{await directory.close();}
   }finally{await fs.unlink(temporary).catch(()=>{});}

  }
  const digest=createHash('sha256').update(bytes).digest('hex');const url=new URL(endpoint);url.searchParams.set('call_uuid',lease.callUuid);url.searchParams.set('tenant_id',String(lease.tenantId));url.searchParams.set('capture_token',lease.token);
  const uploadBody=new Uint8Array(bytes);
  try{
  const response=await (config.fetch??fetch)(url,{method:'POST',headers:{'content-type':'audio/wav','x-fs-secret':config.integrationSecret,'x-recording-sha256':digest},body:uploadBody,signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw new Error('Recording upload unavailable');
  const result=await response.json() as {ok?:boolean;storageKey?:string};if(result.ok!==true||typeof result.storageKey!=='string'||!result.storageKey)throw new Error('Recording upload not confirmed');
  return result.storageKey;
  }finally{bytes.fill(0);uploadBody.fill(0);}
 }};
}
