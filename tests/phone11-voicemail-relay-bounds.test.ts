import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,readdir,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {relayOnce,runBoundedOnce} from '../scripts/phone11-voicemail-relay';
const uuid=(i: number)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
async function fixture(count=1){
 const root=await mkdtemp(path.join(tmpdir(),'phone11-relay-bounds-'));
 const source=path.join(root,'source'),outbox=path.join(root,'outbox');
 await mkdir(source,{mode:0o700});await mkdir(outbox,{mode:0o700});
 const wav=Buffer.from('RIFF0000WAVEfixture');
 for(let i=0;i<count;i++){
  await writeFile(path.join(source,`${i}.wav`),wav,{mode:0o600});
  await writeFile(path.join(outbox,`${uuid(i)}.json`),JSON.stringify({message_uuid:uuid(i),tenant_id:1,extension:'100',relative_wav_path:`${i}.wav`}),{mode:0o600});
 }
 const config={sourceRoot:source,outboxRoot:outbox,uploadUrl:'https://fixture.invalid/api/recordings/voicemail',integrationSecret:'offline-synthetic-only'.repeat(2)};
 return{root,source,outbox,config,wav,close:()=>rm(root,{recursive:true,force:true})};
}
test('bounded fair cursor reaches later messages despite persistent early retries',async()=>{
 const f=await fixture(7),seen: string[]=[];
 try{
  for(let pass=0;pass<4;pass++)await relayOnce(f.config,async(url)=>{const id=new URL(String(url)).searchParams.get('message_uuid');seen.push(id!);return new Response(null,{status:[uuid(0),uuid(1)].includes(id!)?503:200});},{maxEntries:2});
  assert.equal(new Set(seen).size,7);assert.equal(seen.length,8);
  assert.deepEqual((await readdir(f.outbox)).filter(n=>n.endsWith('.json')&&!n.startsWith('.')).sort(),[uuid(0)+'.json',uuid(1)+'.json']);
  assert.equal((await readdir(f.source)).length,7);
 }finally{await f.close();}
});
test('default pass attempts at most eight',async()=>{
 const f=await fixture(10);let sent=0;
 try{const result=await relayOnce(f.config,async()=>{sent++;return new Response(null,{status:503});});assert.equal(sent,8);assert.equal(result.retry,8);assert.equal((await readdir(f.source)).length,10);}
 finally{await f.close();}
});
test('HTTP success removes manifest only, keeping source WAV unchanged',async()=>{
 const f=await fixture();try{const result=await runBoundedOnce(f.config,async()=>new Response(null,{status:201}));assert.equal(result.delivered,1);assert.deepEqual(await readFile(path.join(f.source,'0.wav')),f.wav);await assert.rejects(readFile(path.join(f.outbox,uuid(0)+'.json')),{code:'ENOENT'});}
 finally{await f.close();}
});
test('lost response/network failure retains private manifest and WAV',async()=>{
 const f=await fixture();try{const before=await readFile(path.join(f.outbox,uuid(0)+'.json'));const result=await relayOnce(f.config,async()=>{throw Error('fixture only');});assert.equal(result.retry,1);assert.deepEqual(await readFile(path.join(f.outbox,uuid(0)+'.json')),before);assert.deepEqual(await readFile(path.join(f.source,'0.wav')),f.wav);}
 finally{await f.close();}
});
test('elapsed cooperative deadline after successful HTTP retains unknown manifest',async()=>{
 const f=await fixture();try{let sent=0;const result=await relayOnce(f.config,async()=>{sent++;await new Promise(r=>setTimeout(r,120));return new Response(null,{status:200});},{passMs:100});assert.equal(sent,1);assert.equal(result.delivered,0);assert.equal(result.retry,1);assert.ok(await readFile(path.join(f.outbox,uuid(0)+'.json')));assert.deepEqual(await readFile(path.join(f.source,'0.wav')),f.wav);}
 finally{await f.close();}
});
test('native wall watchdog exits UNKNOWN without removing pending fixture',async()=>{
 const f=await fixture();try{
  const code=`import relay from ${JSON.stringify(new URL('../scripts/phone11-voicemail-relay.ts',import.meta.url).href)};await relay.runBoundedOnce(${JSON.stringify(f.config)},()=>new Promise(()=>{}),{wallMs:100});`;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{timeout:3000,encoding:'utf8'});
  assert.equal(child.error,undefined);assert.equal(child.status,70);assert.equal(child.stdout,'');assert.equal(child.stderr,'Voicemail relay wall deadline reached; outcome unknown\n');assert.ok(await readFile(path.join(f.outbox,uuid(0)+'.json')));assert.deepEqual(await readFile(path.join(f.source,'0.wav')),f.wav);
 }finally{await f.close();}
});
test('known400 quarantine preserves inode link and WAV',async()=>{
 const f=await fixture();try{const name=uuid(0)+'.json';const before=await stat(path.join(f.outbox,name));const result=await relayOnce(f.config,async()=>new Response(null,{status:409}));assert.equal(result.quarantined,1);const after=await stat(path.join(f.outbox,'quarantine',name));assert.equal(after.ino,before.ino);assert.equal(after.nlink,1);assert.deepEqual(await readFile(path.join(f.source,'0.wav')),f.wav);}
 finally{await f.close();}
});
test('cursor corruption and symlink refuse without upload',async()=>{
 for(const mode of ['corrupt','symlink']){
  const f=await fixture();try{let sent=0;
   if(mode==='corrupt')await writeFile(path.join(f.outbox,'.relay-cursor.json'),'{',{mode:0o600});
   if(mode==='symlink')await symlink(path.join(f.root,'outside'),path.join(f.outbox,'.relay-cursor.json'));
   if(mode==='crash')await writeFile(path.join(f.outbox,'.relay-cursor.new'),'incomplete',{mode:0o600});
   await assert.rejects(relayOnce(f.config,async()=>{sent++;return new Response(null,{status:200});}));assert.equal(sent,0);assert.ok(await readFile(path.join(f.outbox,uuid(0)+'.json')));assert.deepEqual(await readFile(path.join(f.source,'0.wav')),f.wav);
  }finally{await f.close();}
 }
});
test('interrupted cursor temporary recovers under owned custody without touching queue evidence',async()=>{
 const f=await fixture(3);try{
  const seen: string[]=[];const send=async (url: Parameters<typeof fetch>[0])=>{seen.push(new URL(String(url)).searchParams.get('message_uuid')!);return new Response(null,{status:503});};
  await relayOnce(f.config,send,{maxEntries:1});
  const previous=await readFile(path.join(f.outbox,'.relay-cursor.json'));
  await writeFile(path.join(f.outbox,'.relay-cursor.new'),'',{mode:0o600});
  await relayOnce(f.config,send,{maxEntries:1});
  assert.deepEqual(seen,[uuid(0),uuid(1)]);assert.notDeepEqual(await readFile(path.join(f.outbox,'.relay-cursor.json')),previous);
  await writeFile(path.join(f.outbox,'.relay-cursor.new'),'incomplete',{mode:0o600});
  await relayOnce(f.config,send,{maxEntries:1});assert.deepEqual(seen,[uuid(0),uuid(1),uuid(2)]);
  await assert.rejects(stat(path.join(f.outbox,'.relay-cursor.new')),{code:'ENOENT'});
  for(let i=0;i<3;i++){assert.ok(await readFile(path.join(f.outbox,uuid(i)+'.json')));assert.deepEqual(await readFile(path.join(f.source,`${i}.wav`)),f.wav);}
 }finally{await f.close();}
});
test('unsafe temporary cursor is never removed or uploaded past',async()=>{
 for(const mode of ['symlink','hardlink','permissions']){
  const f=await fixture();try{const temp=path.join(f.outbox,'.relay-cursor.new');const other=path.join(f.root,'control');await writeFile(other,'owned',{mode:0o600});
   if(mode==='symlink')await symlink(other,temp);
   if(mode==='hardlink')await link(other,temp);
   if(mode==='permissions')await writeFile(temp,'owned',{mode:0o644});
   let sent=0;await assert.rejects(relayOnce(f.config,async()=>{sent++;return new Response(null,{status:200});}));assert.equal(sent,0);assert.ok((await readdir(f.outbox)).includes('.relay-cursor.new'));assert.ok(await readFile(path.join(f.outbox,uuid(0)+'.json')));
  }finally{await f.close();}
 }
});
test('complete atomic cursor advances after process restart with only retry inputs',async()=>{
 const f=await fixture(3);try{
  const seen: string[]=[];const send=async (url: Parameters<typeof fetch>[0])=>{seen.push(new URL(String(url)).searchParams.get('message_uuid')!);return new Response(null,{status:503});};
  await relayOnce(f.config,send,{maxEntries:1});const c=JSON.parse(await readFile(path.join(f.outbox,'.relay-cursor.json'),'utf8'));assert.equal(c.after,uuid(0)+'.json');assert.equal((await stat(path.join(f.outbox,'.relay-cursor.json'))).mode&0o777,0o600);
  await relayOnce(f.config,send,{maxEntries:1});assert.deepEqual(seen,[uuid(0),uuid(1)]);await assert.rejects(stat(path.join(f.outbox,'.relay-cursor.new')),{code:'ENOENT'});
 }finally{await f.close();}
});
test('manifest symlink, wrong UUID and WAV symlink cannot bypass existing custody',async()=>{
 for(const mode of ['manifest','uuid','wav']){
  const f=await fixture();try{let sent=0;const manifest=path.join(f.outbox,uuid(0)+'.json');
   if(mode==='manifest'){await rm(manifest);await symlink(path.join(f.root,'outside'),manifest);}
   if(mode==='uuid')await writeFile(manifest,JSON.stringify({message_uuid:uuid(1),tenant_id:1,extension:'100',relative_wav_path:'0.wav'}));
   if(mode==='wav'){await rm(path.join(f.source,'0.wav'));await writeFile(path.join(f.root,'outside.wav'),f.wav);await symlink(path.join(f.root,'outside.wav'),path.join(f.source,'0.wav'));}
   const result=await relayOnce(f.config,async()=>{sent++;return new Response(null,{status:200});});assert.equal(result.retry,1);assert.equal(sent,0);
  }finally{await f.close();}
 }
});
test('producer retained hardlink remains admitted exactly as baseline',async()=>{
 const f=await fixture();try{await link(path.join(f.outbox,uuid(0)+'.json'),path.join(f.outbox,'.'+uuid(0)+'.tmp'));const result=await relayOnce(f.config,async()=>new Response(null,{status:200}));assert.equal(result.delivered,1);assert.ok(await readFile(path.join(f.outbox,'.'+uuid(0)+'.tmp')));assert.deepEqual(await readFile(path.join(f.source,'0.wav')),f.wav);}
 finally{await f.close();}
});
test('exact4096 preexisting entries keep progressing after cursor creation',async()=>{
 const f=await fixture(2);try{
  // The native lock and other data/control lanes still count in the original budget.
  await writeFile(path.join(f.outbox,'.relay.lock'),'');
  await Promise.all(Array.from({length:4093},(_,i)=>writeFile(path.join(f.outbox,`extra-${i}`),'')));
  const seen: string[]=[];const send=async (url: Parameters<typeof fetch>[0])=>{seen.push(new URL(String(url)).searchParams.get('message_uuid')!);return new Response(null,{status:503});};
  await relayOnce(f.config,send,{maxEntries:1});
  assert.equal((await readdir(f.outbox)).length,4097);
  await relayOnce(f.config,send,{maxEntries:1});assert.deepEqual(seen,[uuid(0),uuid(1)]);
  assert.ok(await readFile(path.join(f.outbox,uuid(0)+'.json')));assert.ok(await readFile(path.join(f.outbox,uuid(1)+'.json')));
 }finally{await f.close();}
});
test('more than4096 directory entries refuses census before upload',async()=>{
 const f=await fixture();try{await Promise.all(Array.from({length:4096},(_,i)=>writeFile(path.join(f.outbox,`extra-${i}`),'')));let sent=0;await assert.rejects(relayOnce(f.config,async()=>{sent++;return new Response(null,{status:200});}),/census exceeds bound/);assert.equal(sent,0);assert.ok(await readFile(path.join(f.outbox,uuid(0)+'.json')));}
 finally{await f.close();}
});
