import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createHandlers,CHANNELS} from '../src/ipc';
const root=join(__dirname,'..');
async function enabledHandlers() {
 // Feature-on synthetic source in memory; checked-in gate remains false.
 const bundle=await build({entryPoints:[join(root,'src/ipc.ts')],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'synthetic-inbox',setup(b){b.onLoad({filter:/[/\\]ipc\.ts$/},a=>({contents:readFileSync(a.path,'utf8').replace('VOICEMAIL_ENABLED = false','VOICEMAIL_ENABLED = true'),loader:'ts'}));}}]});
 const module={exports:{} as {createHandlers:typeof createHandlers}};runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports});return module.exports.createHandlers;
}
function fixture(make=createHandlers) {
 let session={revision:'r1',userId:'7',tenantId:9,extensionId:41,accountId:'a'};let confirmed=false;let confirms=0;let deletes=0;
 let confirm:()=>Promise<boolean>=async()=>confirmed;let remove:()=>Promise<void>=async()=>{};
 const provider={currentSession:()=>session,deleteVoicemail:async(r:string,id:number,yes:boolean)=>{assert.equal(r,session.revision);assert.equal(id,4);assert.equal(yes,true);deletes++;await remove();}};
 const handlers=make(provider as never,{snapshot:()=>({call:null})} as never,()=>null,()=>{},()=>false,async()=>{confirms++;return confirm();});
 return {handlers,counts:()=>({confirms,deletes}),approve:()=>{confirmed=true;},replace:()=>{session={...session};},setConfirm:(fn:()=>Promise<boolean>)=>{confirm=fn;},setRemove:(fn:()=>Promise<void>)=>{remove=fn;}};
}
test('default-off IPC blocks delete before confirmation/provider',async()=>{const f=fixture();f.approve();await assert.rejects(f.handlers.voicemailDelete({sessionRevision:'r1',id:4}),/PHONE11_VOICEMAIL_UNAVAILABLE/);assert.deepEqual(f.counts(),{confirms:0,deletes:0});});
test('actual handler rejects caller confirmation/tenant/unknown IDs and owns native confirmation',async()=>{
 const f=fixture(await enabledHandlers());for(const input of [{sessionRevision:'old',id:4},{sessionRevision:'r1',id:0},{sessionRevision:'r1',id:4,confirmed:true},{sessionRevision:'r1',id:4,tenantId:9},[],null])await assert.rejects(f.handlers.voicemailDelete(input));assert.deepEqual(f.counts(),{confirms:0,deletes:0});
 assert.equal((await f.handlers.voicemailDelete({sessionRevision:'r1',id:4})).deleted,false);assert.equal(f.counts().deletes,0);f.approve();assert.equal((await f.handlers.voicemailDelete({sessionRevision:'r1',id:4})).deleted,true);assert.equal(f.counts().deletes,1);
});
test('same-tag replacement during confirmation refuses; duplicates cannot show another dialog',async()=>{
 const f=fixture(await enabledHandlers());let resolve!:(v:boolean)=>void;f.setConfirm(()=>new Promise(r=>{resolve=r;}));const pending=f.handlers.voicemailDelete({sessionRevision:'r1',id:4});const rejected=assert.rejects(pending);await assert.rejects(f.handlers.voicemailDelete({sessionRevision:'r1',id:4}));f.replace();resolve(true);await rejected;assert.equal(f.counts().deletes,0);
});
test('retired completion never publishes success to replacement session',async()=>{
 const f=fixture(await enabledHandlers());f.approve();let resolve!:()=>void;f.setRemove(()=>new Promise(r=>{resolve=r;}));const pending=f.handlers.voicemailDelete({sessionRevision:'r1',id:4});const rejected=assert.rejects(pending);await new Promise(r=>setImmediate(r));f.replace();resolve();await rejected;
});
test('fixed preload channel and sender-protected Cancel-default main dialog',async()=>{
 const bundle=await build({entryPoints:[join(root,'src/preload.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['electron']});let api!: {voicemailDelete:(r:string,id:number)=>Promise<unknown>};const calls:unknown[]=[];
 runInNewContext(bundle.outputFiles[0].text,{require:()=>({contextBridge:{exposeInMainWorld:(_n:string,v:typeof api)=>{api=v;}},ipcRenderer:{invoke:(...args:unknown[])=>{calls.push(args);return Promise.resolve();}}})});await api.voicemailDelete('r1',4);assert.equal(JSON.stringify(calls),JSON.stringify([[CHANNELS.voicemailDelete,{sessionRevision:'r1',id:4}]]));
 const main=readFileSync(join(root,'src/main.ts'),'utf8');assert.match(main,/handle\(CHANNELS\.voicemailDelete, checked\(/);assert.match(main,/buttons: \['Cancel', 'Delete voicemail'\], defaultId: 0, cancelId: 0/);assert.match(readFileSync(join(root,'src/ipc.ts'),'utf8'),/VOICEMAIL_ENABLED = false/);
});
