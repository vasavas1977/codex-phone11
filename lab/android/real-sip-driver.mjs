import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateState} from './fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const expectedSipUri='sip:7101@sip.stage.phone11.test';
const allCases=new Set(['PUSH-01','PUSH-02','PUSH-03','PUSH-04','PUSH-05','PUSH-06','PUSH-07','PUSH-08','PUSH-09','LIFE-04','LIFE-05','PERM-02','PERM-03']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stage=/(^|[.-])(staging|stage|sandbox|nonprod)([.-]|$)/i;
const placeholder=/(example|placeholder|changeme|replace[-_]?me|your[-_]|dummy|sample)/i;
const hash=value=>createHash('sha256').update(value).digest('hex');
const hex64=/^[a-f0-9]{64}$/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const dockerRun=(args,options={})=>execFileSync('docker',args,{cwd:root,encoding:'utf8',timeout:30_000,stdio:['pipe','pipe','pipe'],...options}).trim();

export class DriverError extends Error{constructor(status=503,message='Real SIP driver unavailable'){super(message);this.status=status;}}

export function readDriverConfig(source=process.env,now=Date.now(),projectRoot=root){
 if(source.PHONE11_LAB_SIP_DRIVER_ENABLED!=='1'||source.PHONE11_LAB_SIP_DRIVER_ENVIRONMENT!=='staging')throw new DriverError(404,'Route unavailable');
 const executionId=source.PHONE11_LAB_SIP_DRIVER_EXECUTION_ID,expiresAt=Number(source.PHONE11_LAB_SIP_DRIVER_EXECUTION_EXPIRES_AT);
 const cases=new Set((source.PHONE11_LAB_SIP_DRIVER_CASES??'').split(',').filter(Boolean)),secret=source.PHONE11_LAB_SIP_DRIVER_SECRET??'';
 const targetSipUri=source.PHONE11_LAB_SIP_DRIVER_TARGET_SIP_URI;
 const secretBytes=Buffer.from(secret);
 if(!uuid.test(executionId??'')||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+3_600_000||cases.size<1||[...cases].some(value=>!allCases.has(value))||
  secretBytes.length<32||secretBytes.length>512||placeholder.test(secret)||targetSipUri!==expectedSipUri||!stage.test(targetSipUri)||source.PHONE11_LAB_SIP_DRIVER_FIXTURE_FILE!=='.lab/fixture.json')throw new DriverError();
 const fixtureFile=path.resolve(projectRoot,source.PHONE11_LAB_SIP_DRIVER_FIXTURE_FILE);
 if(fixtureFile!==path.join(projectRoot,'.lab/fixture.json'))throw new DriverError();
 return {executionId,expiresAt,cases,secret,targetSipUri,fixtureFile};
}

function safeEqual(left,right){const a=Buffer.from(String(left??'')),b=Buffer.from(String(right??''));return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);}
function parseChannels(output){return output.split(/\r?\n/).map(row=>({name:row.split('!')[0],state:row.split('!')[4]})).filter(row=>/^PJSIP\/7101-[a-f0-9]+$/.test(row.name));}
function callIdFrom(output){return /(?:Call-ID|Call-id)\s*:\s*([^\s]+)/i.exec(output)?.[1];}
function publicEvent(event,entry,source,extra={}){return {event,timestampMs:entry.clock(),correlationId:entry.correlationId,source,...extra};}
function strictReceipt(value,input){
 const keys=['accepted','source','executionId','testId','correlationId','sipCallIdHash','pbxChannelHash','startedAtMs'];
 if(!exactKeys(value,keys)||value.accepted!==true||value.source!=='real_sip_driver'||value.executionId!==input.executionId||value.testId!==input.testId||value.correlationId!==input.correlationId||
  !hex64.test(value.sipCallIdHash)||!hex64.test(value.pbxChannelHash)||!Number.isSafeInteger(value.startedAtMs)||value.startedAtMs<=0)throw new DriverError();
 return structuredClone(value);
}
function strictEvidence(value,input){
 if(!exactKeys(value,['source','executionId','testId','correlationId','events'])||value.source!=='real_fcm_v1'||value.executionId!==input.executionId||value.testId!==input.testId||value.correlationId!==input.correlationId||!Array.isArray(value.events)||value.events.length<1||value.events.length>16)throw new DriverError();
 const names=new Set(['real_sip_scenario_started','sip_invite_delivered','call_connected','call_terminated','cleanup_completed']),sources=new Set(['sip_driver','pbx']);
 for(const event of value.events){const allowed=['event','timestampMs','correlationId','source','sipCallIdHash','pbxChannelHash','code'];if(!['event','timestampMs','correlationId','source'].every(key=>Object.hasOwn(event,key))||Object.keys(event).some(key=>!allowed.includes(key))||!names.has(event.event)||!sources.has(event.source)||event.correlationId!==input.correlationId||!Number.isSafeInteger(event.timestampMs)||event.timestampMs<=0||
   ('sipCallIdHash'in event&&!hex64.test(event.sipCallIdHash))||('pbxChannelHash'in event&&!hex64.test(event.pbxChannelHash))||('code'in event&&(!Number.isInteger(event.code)||event.code<-999||event.code>999)))throw new DriverError();}
 return structuredClone(value);
}

export function createFixtureSipAdapter({execute=dockerRun,wait=sleep,now=Date.now,monitor=true,loadFixture=config=>validateState(JSON.parse(fs.readFileSync(config.fixtureFile,'utf8')))}={}){
 const ledger=new Map();
 const command=(state,cli)=>execute(['exec',state.container,'asterisk','-rx',cli]);
 const fixture=config=>{
  let state;try{state=loadFixture(config);}catch{throw new DriverError();}
  let inspected;try{inspected=JSON.parse(execute(['container','inspect',state.container]))[0];}catch{throw new DriverError();}
  const labels=inspected?.Config?.Labels??{};
  if(inspected?.State?.Running!==true||labels['com.phone11.android-lab.owner']!==state.owner||labels['com.phone11.android-lab.run']!==state.runId)throw new DriverError();
  if(!/7101\//.test(command(state,'pjsip show contacts')))throw new DriverError(503,'Staging SIP target is not registered');
  return state;
 };
 const observe=async entry=>{
  for(let attempt=0;attempt<84;attempt++){
   await wait(250);let rows=[];try{rows=parseChannels(command(entry.state,'core show channels concise'));}catch{}
   const current=rows.find(row=>row.name===entry.channel);
   if(current?.state==='Up'&&!entry.events.some(value=>value.event==='call_connected'))entry.events.push(publicEvent('call_connected',entry,'pbx',{sipCallIdHash:entry.sipCallIdHash,pbxChannelHash:entry.pbxChannelHash}));
   if(!current){entry.events.push(publicEvent('call_terminated',entry,'pbx',{sipCallIdHash:entry.sipCallIdHash,pbxChannelHash:entry.pbxChannelHash}),publicEvent('cleanup_completed',entry,'sip_driver',{pbxChannelHash:entry.pbxChannelHash}));entry.finished=true;return;}
  }
  try{command(entry.state,`channel request hangup ${entry.channel}`);}catch{}
  entry.events.push(publicEvent('cleanup_completed',entry,'sip_driver',{pbxChannelHash:entry.pbxChannelHash,code:-1}));entry.finished=true;
 };
 return {
  async start(config,input){
   if(!exactKeys(input,['executionId','testId','correlationId','targetSipUri'])||input.executionId!==config.executionId||!config.cases.has(input.testId)||!uuid.test(input.correlationId)||input.targetSipUri!==config.targetSipUri)throw new DriverError(403,'Forbidden');
   const previous=ledger.get(input.correlationId);if(previous){if(previous.executionId!==input.executionId||previous.testId!==input.testId)throw new DriverError(409,'Scenario conflict');return previous.receipt;}
   const state=fixture(config),before=new Set(parseChannels(command(state,'core show channels concise')).map(row=>row.name));
   const fileId=hash(`${input.executionId}:${input.testId}:${input.correlationId}`).slice(0,24);
   const body=`Channel: PJSIP/7101\nCallerID: Phone11 staging SIP driver <7102>\nMaxRetries: 0\nRetryTime: 1\nWaitTime: 20\nContext: lab\nExtension: 7190\nPriority: 1\nSetvar: PHONE11_LAB_CORRELATION=${fileId}\nArchive: no\n`;
   const shell=`umask 077; cat > /var/spool/asterisk/phone11-${fileId}.tmp && mv /var/spool/asterisk/phone11-${fileId}.tmp /var/spool/asterisk/outgoing/phone11-${fileId}.call`;
   try{execute(['exec','-i',state.container,'sh','-c',shell],{input:body});}catch{throw new DriverError();}
   let channel;
   for(let attempt=0;attempt<20&&!channel;attempt++){await wait(100);channel=parseChannels(command(state,'core show channels concise')).find(row=>!before.has(row.name))?.name;}
   if(!channel)throw new DriverError(503,'PBX did not originate a real SIP channel');
   let sipCallId;try{sipCallId=callIdFrom(command(state,`pjsip show channel ${channel}`));}catch{}
   if(!sipCallId){try{command(state,`channel request hangup ${channel}`);}catch{}throw new DriverError(503,'PBX did not expose the real SIP Call-ID');}
   const startedAtMs=now(),entry={...input,state,channel,sipCallIdHash:hash(sipCallId),pbxChannelHash:hash(channel),events:[],finished:false,clock:now};
   entry.receipt={accepted:true,source:'real_sip_driver',executionId:input.executionId,testId:input.testId,correlationId:input.correlationId,sipCallIdHash:entry.sipCallIdHash,pbxChannelHash:entry.pbxChannelHash,startedAtMs};
   entry.events.push({event:'real_sip_scenario_started',timestampMs:startedAtMs,correlationId:input.correlationId,source:'sip_driver',sipCallIdHash:entry.sipCallIdHash,pbxChannelHash:entry.pbxChannelHash},
    {event:'sip_invite_delivered',timestampMs:startedAtMs,correlationId:input.correlationId,source:'pbx',sipCallIdHash:entry.sipCallIdHash,pbxChannelHash:entry.pbxChannelHash});
   ledger.set(input.correlationId,entry);if(monitor)void observe(entry);return entry.receipt;
  },
  async evidence(config,input){
   if(!exactKeys(input,['executionId','testId','correlationId'])||input.executionId!==config.executionId||!config.cases.has(input.testId)||!uuid.test(input.correlationId))throw new DriverError(403,'Forbidden');
   const entry=ledger.get(input.correlationId);if(!entry||entry.executionId!==input.executionId||entry.testId!==input.testId)throw new DriverError(404,'Evidence unavailable');
   return {source:'real_fcm_v1',executionId:input.executionId,testId:input.testId,correlationId:input.correlationId,events:structuredClone(entry.events)};
  },
 };
}

export function createRealSipDriverService({source=()=>process.env,now=Date.now,adapter=createFixtureSipAdapter(),projectRoot=root}={}){
 const config=()=>readDriverConfig(source(),now(),projectRoot);
 const authorize=headers=>{const value=config();if(!safeEqual(headers['x-phone11-lab-driver-secret'],value.secret)||headers['x-phone11-execution-id']!==value.executionId)throw new DriverError(403,'Forbidden');return value;};
 const inflight=new Map();
 return {async start(headers,input){const value=authorize(headers),key=input?.correlationId;if(typeof key!=='string')return strictReceipt(await adapter.start(value,input),input);
   const pending=inflight.get(key);if(pending){if(pending.executionId!==input.executionId||pending.testId!==input.testId)throw new DriverError(409,'Scenario conflict');return pending.promise;}
   const promise=adapter.start(value,input).then(result=>strictReceipt(result,input));inflight.set(key,{executionId:input.executionId,testId:input.testId,promise});try{return await promise;}finally{inflight.delete(key);}},
  async evidence(headers,input){const value=authorize(headers);return strictEvidence(await adapter.evidence(value,input),input);}};
}

async function body(request){let raw='';for await(const chunk of request){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw new DriverError(413,'Invalid request');}try{return JSON.parse(raw);}catch{throw new DriverError(400,'Invalid request');}}
function failure(response,error){const status=error instanceof DriverError?error.status:503;response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:status===403?'Forbidden':status===404?error.message:status===400||status===413?'Invalid request':status===409?'Scenario conflict':'Real SIP driver unavailable'}));}
export function createRealSipDriverServer(service=createRealSipDriverService()){
 return http.createServer(async(request,response)=>{response.setHeader('cache-control','no-store');try{
  const url=new URL(request.url??'','http://driver.invalid'),headers=request.headers;let value;
  if(request.method==='POST'&&url.pathname==='/v1/phone11/real-sip-scenario')value=await service.start(headers,await body(request));
  else if(request.method==='GET'&&url.pathname==='/v1/phone11/real-sip-evidence')value=await service.evidence(headers,Object.fromEntries(url.searchParams));
  else throw new DriverError(404,'Route unavailable');
  response.writeHead(request.method==='POST'?202:200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));
 }catch(error){failure(response,error);}});
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 try{const config=readDriverConfig(),port=Number(process.env.PHONE11_LAB_SIP_DRIVER_PORT??'');if(!Number.isInteger(port)||port<1024||port>65535)throw new DriverError();
  createRealSipDriverServer().listen(port,'127.0.0.1',()=>console.log(JSON.stringify({status:'READY',host:'127.0.0.1',port,environment:'staging'})));
 }catch{console.error('Real SIP driver refused to start; no call was originated.');process.exitCode=1;}
}
