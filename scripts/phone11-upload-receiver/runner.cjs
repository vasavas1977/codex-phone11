'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),{Module}=require('node:module');
const CONFIG='/run/phone11-upload-receiver/private-binding.json',DIRECTORY='/run/phone11-upload-receiver',FACTORY='/opt/phone11-upload-receiver/upload-receiver.cjs',SHA='129c1910dbb93b4663a91778e470be06bb6ed37f598605d666369b38a69f68b2';
const STARTUP_MS=30000,STOP_MS=3000;
function need(v){if(!v)throw Error('PRIVATE_INPUT_REFUSED');}
async function readHeld(path,limit,privateFile,deps){
 const uid=deps.process.geteuid(),gid=deps.process.getegid();
 const handle=await deps.fs.promises.open(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
  const a=await handle.stat();need(a.isFile()&&a.nlink===1&&a.size>0&&a.size<=limit);
  if(privateFile)need(a.uid===uid&&a.gid===gid&&(a.mode&0o777)===0o400);
  const buffer=Buffer.alloc(limit+1);let offset=0;while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}need(offset<=limit);const raw=buffer.subarray(0,offset);const b=await handle.stat();need(raw.length===a.size&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs);return raw;
 }finally{await handle.close();}
}
async function load(deps,ensureOpen){
 const dir=await deps.fs.promises.lstat(DIRECTORY);ensureOpen();need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===deps.process.geteuid()&&dir.gid===deps.process.getegid()&&(dir.mode&0o777)===0o700);
 const real=await deps.fs.promises.realpath(DIRECTORY);ensureOpen();need(real===DIRECTORY);
 const raw=await readHeld(CONFIG,98304,true,deps);ensureOpen();const input=JSON.parse(raw.toString('utf8'));need(Buffer.from(JSON.stringify(input)+'\n').equals(raw));
 const bytes=await readHeld(FACTORY,23048,false,deps);ensureOpen();need(bytes.length===23048&&crypto.createHash('sha256').update(bytes).digest('hex')===SHA);
 const factory=deps.compile(bytes);ensureOpen();need(factory.sourceBinding?.candidateRevision==='v2-lifecycle-cancellation'&&typeof factory.createUploadReceiver==='function');return{input,factory};
}
function defaults(){return{fs,process,compile(bytes){const m=new Module(FACTORY,module);m.filename=FACTORY;m.paths=Module._nodeModulePaths('/opt/phone11-upload-receiver');m._compile(bytes.toString('utf8'),FACTORY);return m.exports;},setTimeout,clearTimeout,emit(value){process.stdout.write(JSON.stringify(value)+'\n');}};}
function run(injected){
 const d=injected||defaults();let stopped=false,settled=false,failureRequested=false,receiver=null,startTask=null,stopTask=null,closeTask=null,startTimer,stopTimer;let resolve;
 const terminal=new Promise(r=>resolve=r);const handlers={};
 const finish=(code,status,cleanupConfirmed)=>{if(settled)return;settled=true;d.clearTimeout(startTimer);d.clearTimeout(stopTimer);for(const[name,fn]of Object.entries(handlers))d.process.removeListener(name,fn);const value={status,cleanupConfirmed,inFlightUploadAtomicityProven:false};d.emit(value);resolve({code,...value});};
 const ensureOpen=()=>need(!stopped&&!settled);
 function stop(failure){
  failureRequested=failureRequested||failure;stopped=true;if(stopTask)return stopTask;d.clearTimeout(startTimer);
  stopTimer=d.setTimeout(()=>finish(70,'UPLOAD_RECEIVER_STOP_UNCERTAIN',false),STOP_MS);
  stopTask=Promise.resolve().then(async()=>{
   if(receiver&&!closeTask)closeTask=Promise.resolve().then(()=>receiver.close());
   const closed=closeTask?await closeTask:null;
   await startTask.catch(()=>{});
   // The admitted factory cannot be constructed after stopped=true. A pending
   // constructor-free read must settle/close held FDs before cleanup is known.
   const confirmed=receiver?closed?.cleanupConfirmed===true:true;
   finish(confirmed&&!failureRequested?0:70,confirmed?(failureRequested?'UPLOAD_RECEIVER_REFUSED':'UPLOAD_RECEIVER_STOPPED'):'UPLOAD_RECEIVER_STOP_UNCERTAIN',confirmed);
  }).catch(()=>finish(70,'UPLOAD_RECEIVER_STOP_UNCERTAIN',false));return stopTask;
 }
 handlers.SIGTERM=()=>{void stop(false);};handlers.SIGINT=()=>{void stop(false);};handlers.uncaughtException=()=>{void stop(true);};handlers.unhandledRejection=()=>{void stop(true);};
 for(const[name,fn]of Object.entries(handlers))d.process.on(name,fn);
 startTimer=d.setTimeout(()=>{void stop(true);},STARTUP_MS);
 startTask=Promise.resolve().then(async()=>{const {input,factory}=await load(d,ensureOpen);ensureOpen();receiver=factory.createUploadReceiver(input);ensureOpen();const ready=await receiver.start();ensureOpen();need(ready.status==='UPLOAD_ONLY_RECEIVER_LISTENING'&&ready.restrictedTlsIdentityVerified===true&&ready.globalWorkersStarted===false);d.clearTimeout(startTimer);d.emit({status:'UPLOAD_RECEIVER_READY',restrictedTlsIdentityVerified:true,globalWorkersStarted:false});});
 startTask.catch(()=>{if(!stopped)void stop(true);});return terminal;
}
module.exports={run,readHeld,load,constants:{CONFIG,DIRECTORY,FACTORY,SHA,STARTUP_MS,STOP_MS}};
if(require.main===module){if(process.argv.length===3&&process.argv[2]==='--run-bound-upload-receiver'){run().then(r=>process.exit(r.code),()=>{process.stdout.write('{"status":"UPLOAD_RECEIVER_REFUSED","cleanupConfirmed":false}\n');process.exit(70);});}else{process.stdout.write('{"status":"UNBOUND","hostIo":false,"listening":false}\n');process.exitCode=process.argv.length===2?0:64;}}
