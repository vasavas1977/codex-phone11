'use strict';
// Explicit operator launch only. Old-owner absence must be established by the
// supervisor before EVERY launch; this process cannot establish that remotely.
const fs=require('node:fs'),crypto=require('node:crypto'),{Module}=require('node:module');
const DIRECTORY='/run/phone11-worker-runtime',CONFIG=DIRECTORY+'/private-binding.json';
const FACTORY='/app/phone11-worker-bound.cjs',SHA='db2b8717ba2193a1e174c51e97a4b823d03ab842a426ea2c4406af89c00fa85e',BYTES=271163;
const STARTUP_MS=45000,STOP_MS=150000;
const TERMINAL_WRITE_MS = 5000;
const need=value=>{if(!value)throw Error('WORKER_PRIVATE_INPUT_REFUSED');};
async function readHeld(path,limit,privateFile,d){
 const h=await d.fs.promises.open(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const a=await h.stat();need(a.isFile()&&a.nlink===1&&a.size>0&&a.size<=limit);
  if(privateFile)need(a.uid===1001&&a.gid===1001&&(a.mode&0o7777)===0o400);
  const raw=Buffer.alloc(a.size);let at=0;
  while(at<raw.length){const {bytesRead}=await h.read(raw,at,raw.length-at,at);need(bytesRead>0);at+=bytesRead;}
  const b=await h.stat(),named=await d.fs.promises.lstat(path);
  for(const key of ['dev','ino','size','uid','gid','mode','nlink','mtimeMs','ctimeMs'])need(a[key]===b[key]&&a[key]===named[key]);
  return raw;
 }finally{try{await h.close();}catch{d.ioCleanupUnknown=true;throw Error('WORKER_INPUT_CLOSE_UNKNOWN');}}
}
async function load(d,open){
 need(d.process.geteuid()===1001&&d.process.getegid()===1001);
 const parent=await d.fs.promises.lstat(DIRECTORY);open();
 need(parent.isDirectory()&&!parent.isSymbolicLink()&&parent.uid===1001&&parent.gid===1001&&(parent.mode&0o7777)===0o700);
 need(await d.fs.promises.realpath(DIRECTORY)===DIRECTORY);open();
 const raw=await readHeld(CONFIG,98304,true,d);open();const input=JSON.parse(raw.toString('utf8'));
 need(Buffer.from(JSON.stringify(input)+'\n').equals(raw)&&input&&Object.keys(input).length===2&&input.version==='PHONE11_WORKER_PRIVATE_V1'&&input.worker);
 const bytes=await readHeld(FACTORY,BYTES,false,d);open();need(bytes.length===BYTES&&crypto.createHash('sha256').update(bytes).digest('hex')===SHA);
 const factory=d.compile(bytes);open();need(Object.keys(factory).length===1&&typeof factory.prepareBoundWorkerRuntime==='function');
 return {input:input.worker,factory};
}
function defaults(){return {fs,process,setTimeout,clearTimeout,setInterval,clearInterval,
 compile(bytes){const m=new Module(FACTORY,module);m.filename=FACTORY;m.paths=Module._nodeModulePaths('/app');m._compile(bytes.toString('utf8'),FACTORY);return m.exports;},
 emit(value){process.stdout.write(JSON.stringify(value)+'\n');}};}
function run(injected, emitConfirmed = true){
 const d=injected||defaults();let stopped=false,settled=false,failed=false,runtime,startTask,stopTask,closeTask,startTimer,stopTimer,resolve;
 const terminal=new Promise(r=>resolve=r),handlers={};
 // Worker schedulers intentionally unref their timers. Own one process handle.
 const keepAlive=d.setInterval(()=>{},60000);
 const open=()=>need(!stopped&&!settled);
 function finish(code,status,cleanupConfirmed){
  if(settled)return;settled=true;d.clearTimeout(startTimer);d.clearTimeout(stopTimer);
  const result={code,status,cleanupConfirmed,oldOwnerAbsenceProvenByRunner:false};
  if(cleanupConfirmed){d.clearInterval(keepAlive);for(const[k,v]of Object.entries(handlers))d.process.removeListener(k,v);}
  // An uncertain close remains quarantined and alive, including after a late
  // resolution. No retry, provider replay or automatic new worker is admitted.
  if (!cleanupConfirmed || emitConfirmed) d.emit(result);
  resolve(result);
 }
 function requestClose(){if(runtime&&!closeTask){closeTask=Promise.resolve().then(()=>runtime.close());closeTask.catch(()=>{});}return closeTask;}
 function stop(failure){
  failed=failed||failure;stopped=true;if(stopTask)return stopTask;d.clearTimeout(startTimer);
  stopTimer=d.setTimeout(()=>finish(70,'WORKER_STOP_UNCERTAIN',false),STOP_MS);
  requestClose();
  stopTask=Promise.resolve().then(async()=>{
   // Preparation may own resources before it returns. Wait for its settlement,
   // then close that returned instance; never launch it after a stop request.
   await startTask.catch(()=>{});await requestClose();
   const confirmed=d.ioCleanupUnknown!==true&&(!runtime||runtime.status()==='closed');
   finish(confirmed&&!failed?0:70,confirmed?(failed?'WORKER_REFUSED':'WORKER_STOPPED'):'WORKER_STOP_UNCERTAIN',confirmed);
  }).catch(()=>finish(70,'WORKER_STOP_UNCERTAIN',false));return stopTask;
 }
 for(const name of ['SIGTERM','SIGINT'])handlers[name]=()=>{void stop(false);};
 for(const name of ['uncaughtException','unhandledRejection'])handlers[name]=()=>{void stop(true);};
 for(const[k,v]of Object.entries(handlers))d.process.on(k,v);
 startTimer=d.setTimeout(()=>{void stop(true);},STARTUP_MS);
 startTask=Promise.resolve().then(async()=>{
  const {input,factory}=await load(d,open);open();
  try{runtime=await factory.prepareBoundWorkerRuntime(input);}catch(error){
   if(error?.message!=='WORKER_BOUND_SETUP_REFUSED')d.ioCleanupUnknown=true;
   throw error;
  }
  open();need(runtime.status()==='prepared');await runtime.start();open();need(runtime.status()==='running');
  d.clearTimeout(startTimer);d.emit({status:'WORKER_READY',samePoolStartupAttested:true,oldOwnerAbsenceProvenByRunner:false,disposition:runtime.disposition});
 });
 startTask.catch(()=>{if(!stopped)void stop(true);});return terminal;
}
function exitAfterTerminalFrame(result) {
 const fail = () => process.exit(70);
 try {
  const output = process.stdout;
  const deadline = setTimeout(fail, TERMINAL_WRITE_MS);
  output.once('error', fail);
  output.write(JSON.stringify(result) + '\n', error => {
   clearTimeout(deadline);
   if (error) fail();
   else process.exit(result.code);
  });
 } catch {
  fail();
 }
}

function runCli(injected) {
 return run(injected, false).then(result => {
  // Unknown cleanup keeps its quarantine handle and never reaches this exit.
  if (result.cleanupConfirmed) exitAfterTerminalFrame(result);
 });
}

module.exports={run,runCli,readHeld,load,constants:{DIRECTORY,CONFIG,FACTORY,SHA,BYTES,STARTUP_MS,STOP_MS,TERMINAL_WRITE_MS}};
if(require.main===module){
 if(process.argv.length===3&&process.argv[2]==='--run-bound-worker')void runCli();
 else{process.stdout.write('{"status":"UNBOUND","hostIo":false,"workersStarted":false}\n');process.exitCode=process.argv.length===2?0:64;}
}
