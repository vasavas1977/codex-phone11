import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const packageName='ai.phone11.mobile.lab';
const appMedia='/sdcard/Android/data/ai.phone11.mobile.lab/files/lab-media/siprix-duplex.mp3';
const hash=data=>createHash('sha256').update(data).digest('hex');
const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function attemptNumber(history,maximum=3,mode='positive'){
 ensure(Number.isInteger(maximum)&&maximum>=1&&maximum<=3,'Media attempt limit must be1..3');
 const modes=['positive','downlink_drop'];ensure(modes.includes(mode),'Unknown media matrix case');
 // Legacy records without mode belong to the original positive MEDIA01/02 case.
 // Only these two fixed cases exist: changing flags cannot create arbitrary rerun namespaces.
 for(const row of history)ensure(modes.includes(row.mode??'positive')&&Number.isInteger(row.attempt)&&row.attempt>=1,'Invalid preserved media attempt');
 const lane=history.filter(row=>(row.mode??'positive')===mode);
 const next=1+Math.max(lane.length,0,...lane.map(row=>row.attempt));
 ensure(next<=maximum,'Media matrix case attempt limit reached; previous evidence is preserved');return next;
}
function ownedRunPaths(run){
 ensure(/^media-\d{13}-[a-f0-9]{8}$/.test(run),'Invalid generated media run');
 return Object.fromEntries(['mix','rx','tx'].map(kind=>[kind,`/tmp/phone11-${run}-${kind}.wav`]));
}
function parseChannels(text){return text.split('\n').map(line=>line.split('!')).filter(parts=>/^PJSIP\/7101-[a-f0-9]+$/.test(parts[0])).map(parts=>({name:parts[0],context:parts[1],extension:parts[2],state:parts[4]}));}
function answeredChannel(text){const rows=parseChannels(text);ensure(rows.length===1&&rows[0].state==='Up'&&rows[0].context==='lab'&&rows[0].extension==='7190','Exactly one owned answered7190 channel required');return rows[0].name;}
function apkPath(text){const lines=text.trim().split(/\r?\n/);ensure(lines.length===1&&/^package:\/data\/app\/[A-Za-z0-9_+./=~-]+\/base\.apk$/.test(lines[0]),'Unexpected installed APK path');return lines[0].slice(8);}
function currentCall(value){return [...(value.events||[])].reverse().find(e=>e.generation===value.generation&&e.callId&&['callConnected','callProceeding','callIncoming'].includes(e.type))?.callId;}
function sameCall(value,identity){return identity&&value.generation===identity.generation&&currentCall(value)===identity.callId;}
const MAX_PEER_BYTES=4*1024*1024;
function verifyPeerBytes(bytes,size,digest){
 ensure(Number.isSafeInteger(size)&&size>=44&&size<=MAX_PEER_BYTES,'Peer media size is outside the4MiB bound');
 ensure(Buffer.isBuffer(bytes)&&bytes.length===size&&hash(bytes)===digest,'PBX media changed during export');
}
function faultProof(analysis,packets){
 return Number.isSafeInteger(packets)&&packets>0&&analysis?.local?.channels===2&&analysis.local.durationSeconds>=1&&
  analysis.decodedDownlink440==='FAIL'&&analysis.localSyntheticSend==='PASS'&&analysis.independentPeerUplinkDtmf1==='PASS';
}
function ruleCounters(text,tag){
 const rows=text.split('\n').filter(line=>line.includes(`/* ${tag} */`));ensure(rows.length===1,'Owned fault rule counter missing or ambiguous');
 const match=rows[0].match(/^\s*(\d+)\s+(\d+)\s+DROP\s+udp\b/);ensure(match,'Owned fault rule counters invalid');
 const packets=Number(match[1]),bytes=Number(match[2]);ensure(Number.isSafeInteger(packets)&&Number.isSafeInteger(bytes),'Fault rule counters exceeded bounds');return {packets,bytes};
}
function selfTest(){
 assert.equal(attemptNumber([]),1);assert.equal(attemptNumber([{attempt:1},{attempt:2}]),3);assert.throws(()=>attemptNumber([{attempt:3}]));assert.throws(()=>attemptNumber([],4));
 const exhaustedPositive=[{attempt:1,result:'FAIL'},{attempt:2,mode:'positive',result:'BLOCKED'},{attempt:3,mode:'positive',result:'PASS'}];
 const preserved=JSON.stringify(exhaustedPositive);
 assert.throws(()=>attemptNumber(exhaustedPositive,3,'positive'));
 assert.equal(attemptNumber(exhaustedPositive,3,'downlink_drop'),1);
 const mixed=[...exhaustedPositive,{attempt:1,mode:'downlink_drop'},{attempt:2,mode:'downlink_drop'}];
 assert.equal(attemptNumber(mixed,3,'downlink_drop'),3);assert.throws(()=>attemptNumber(mixed,3,'positive'));
 assert.throws(()=>attemptNumber([...mixed,{attempt:3,mode:'downlink_drop'}],3,'downlink_drop'));
 assert.throws(()=>attemptNumber(exhaustedPositive,3,'new_namespace'));
 assert.throws(()=>attemptNumber([{attempt:1},{attempt:1},{attempt:1}],3,'positive'));
 assert.equal(JSON.stringify(exhaustedPositive),preserved);
 assert.equal(ownedRunPaths('media-1789380000000-deadbeef').rx,'/tmp/phone11-media-1789380000000-deadbeef-rx.wav');assert.throws(()=>ownedRunPaths('../unsafe'));
 assert.equal(answeredChannel('PJSIP/7101-a1!lab!7190!1!Up!Wait'),'PJSIP/7101-a1');assert.throws(()=>answeredChannel('PJSIP/7101-a1!production!7190!1!Up!Wait'));assert.throws(()=>answeredChannel('PJSIP/7101-a1!lab!7190!1!Ring!Wait'));
 assert.throws(()=>answeredChannel('PJSIP/7101-a1!lab!7190!1!Up!Wait\nPJSIP/7101-b2!lab!7190!1!Up!Wait'));
 assert.equal(apkPath('package:/data/app/~~abc/ai.phone11.mobile.lab-x/base.apk\n'),'/data/app/~~abc/ai.phone11.mobile.lab-x/base.apk');assert.throws(()=>apkPath('package:/sdcard/customer.apk'));
 assert.equal(sameCall({generation:2,events:[{generation:1,type:'callConnected',callId:'200'}]},{generation:2,callId:'200'}),false);
 const media=Buffer.alloc(128,7);verifyPeerBytes(media,media.length,hash(media));
 assert.throws(()=>verifyPeerBytes(media,media.length+1,hash(media)));assert.throws(()=>verifyPeerBytes(media,media.length,'0'.repeat(64)));assert.throws(()=>verifyPeerBytes(media,MAX_PEER_BYTES+1,hash(media)));
 const negative={local:{channels:2,durationSeconds:5},decodedDownlink440:'FAIL',localSyntheticSend:'PASS',independentPeerUplinkDtmf1:'PASS'};
 assert.equal(faultProof(negative,12),true);assert.equal(faultProof(negative,0),false);assert.equal(faultProof({...negative,independentPeerUplinkDtmf1:'FAIL'},12),false);assert.equal(faultProof({...negative,decodedDownlink440:'PASS'},12),false);assert.equal(faultProof({...negative,local:{channels:1,durationSeconds:5}},12),false);
 assert.deepEqual(ruleCounters(' 12 3456 DROP udp -- * * 0.0.0.0/0 0.0.0.0/0 udp spts:16000:16019 /* owned-run */','owned-run'),{packets:12,bytes:3456});assert.throws(()=>ruleCounters('','owned-run'));
 console.log(JSON.stringify({selfTest:'PASS',scope:'Pure ownership/attempt/path assertions only; no device or media proof'}));
}
async function main(){
 process.chdir(root);
 ensure(process.env.LAB_MEDIA_HOST_MIC_DISABLED==='1','Set LAB_MEDIA_HOST_MIC_DISABLED=1 only after confirming the dedicated emulator host microphone is disabled; no permission will be requested');
 ensure(!fs.existsSync('.lab/sip-run.lock'),'SIP harness owns the emulator; wait for it to yield');
 const {validateState,validateRuntime}=await import('./fixture.mjs');
 const {sanitize}=await import('./core.mjs');
 const fixture=validateState(JSON.parse(fs.readFileSync('.lab/fixture.json','utf8')));
 const apk=JSON.parse(fs.readFileSync('.lab/apk.json','utf8'));
 ensure(/^[a-f0-9]{64}$/.test(apk.sha256)&&fs.existsSync(apk.apk)&&hash(fs.readFileSync(apk.apk))===apk.sha256,'Final APK identity is missing or changed');
 const historyPath='.lab/media-attempts.json';
 const previous=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath,'utf8')):[];
 const faultMode=process.env.LAB_MEDIA_BLOCK_DOWNLINK==='1';
 const mode=faultMode?'downlink_drop':'positive';
 const attempt=attemptNumber(previous,Number(process.env.LAB_MEDIA_MAX_ATTEMPTS||3),mode);
 if(faultMode)ensure(previous.some(row=>row.apk_sha256===apk.sha256&&row.result==='PASS'&&row.checks?.['MEDIA-01']==='PASS'&&row.checks?.['MEDIA-02']==='PASS'),'Fault mode requires a preserved positive two-way media PASS on this APK first');
 const runId=`media-${Date.now()}-${randomBytes(4).toString('hex')}`,remote=ownedRunPaths(runId),directory=path.join('.lab',runId);
 const lockPath='.lab/media-run.lock',lock=fs.openSync(lockPath,'wx',0o600);
 fs.writeFileSync(lock,JSON.stringify({runId,pid:process.pid}));fs.closeSync(lock);
 fs.mkdirSync(directory,{mode:0o700});
 const secrets=Object.values(fixture.accounts).map(a=>a.password);
 const clean=value=>sanitize(value,secrets);
 const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(clean(value),null,2),{mode:0o600});
 const result={run_id:runId,attempt,mode,case_ids:faultMode?['MEDIA-04']:['MEDIA-01','MEDIA-02'],result:'NOT_RUN',execution_started:false,started_at:new Date().toISOString(),ended_at:null,
  apk_sha256:apk.sha256,apk_build_commit:apk.commit,apk_source_dirty:!!apk.sourceDirty,harness_base_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  harness_sha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),harness_source_dirty:!!execFileSync('git',['status','--porcelain','--','lab/android/media-test.mjs'],{encoding:'utf8'}).trim(),
  fixture_run:fixture.runId,host_microphone:'operator-confirmed-disabled; harness never requests microphone permission',scope:'Synthetic decoded media only; human audibility and handset acceptance excluded',
  native_states:[],artifacts:[],cleanup:{status:'pending',retained:[]}};
 const persist=()=>{write(path.join(directory,'result.json'),result);const latest=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath,'utf8')):[];const tmp=`${historyPath}.${runId}.tmp`;write(tmp,[...latest.filter(r=>r.run_id!==runId),result]);fs.renameSync(tmp,historyPath);};
 const cmd=(binary,args,timeout=10000)=>execFileSync(binary,args,{encoding:'utf8',timeout,stdio:['pipe','pipe','pipe']});
 const docker=args=>cmd('docker',args);const pbx=command=>docker(['exec',fixture.container,'asterisk','-rx',command]);
 const faultTag=`phone11-${runId}-downlink`,faultRule=['-p','udp','--sport','16000:16019','-m','comment','--comment',faultTag,'-j','DROP'];
 let faultMayExist=false,cancelled=false,cleaning=false;
 const cancel=()=>{cancelled=true;};process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
 const checkCancellation=()=>ensure(cleaning||!cancelled,'Media run cancellation requested; owned cleanup follows');
 let ui,identity,channel,ownsRuntime=false,captureStarted=false,mixStarted=false,appExported=false;const pbxExported=new Set();let failure;
 const inspectFixture=()=>{
  const c=JSON.parse(docker(['inspect',fixture.container]))[0],n=JSON.parse(docker(['network','inspect',fixture.network]))[0];
  for(const value of [c,n]){const labels=value.Config?.Labels||value.Labels;ensure(labels?.['com.phone11.android-lab.owner']===fixture.owner&&labels?.['com.phone11.android-lab.run']===fixture.runId,'Docker fixture ownership changed');}
  ensure(c.State.Running,'Owned PBX is not running');validateRuntime(c,n);return c;
 };
 const rulePresent=()=>{
  const probe=spawnSync('docker',['exec',fixture.container,'iptables','-w','2','-C','OUTPUT',...faultRule],{encoding:'utf8',timeout:10000,maxBuffer:64*1024});
  ensure(probe.status===0||probe.status===1,'Container fault-rule check unavailable');
  if(probe.status===1)ensure(!probe.stdout?.trim()&&(!probe.stderr?.trim()||/Bad rule.*matching rule/i.test(probe.stderr)),'Container fault-rule absence was not established');
  return probe.status===0;
 };
 const countFault=()=>ruleCounters(docker(['exec',fixture.container,'iptables','-w','2','-L','OUTPUT','-n','-v','-x']),faultTag);
 const insertFault=()=>{
  inspectFixture();ensure(!rulePresent(),'Owned fault rule unexpectedly exists before insertion');
  result.fault={direction:'PBX_to_Android',chain:'OUTPUT',protocol:'udp',source_ports:'16000:16019',tag:faultTag,inserted:false,counters:null,cleanup:'pending'};
  faultMayExist=true;persist();
  docker(['exec',fixture.container,'iptables','-w','2','-I','OUTPUT','1',...faultRule]);
  ensure(rulePresent(),'Owned fault rule insertion not confirmed');result.fault.inserted=true;persist();
 };
 const remember=value=>{const safe={};for(const k of ['initialized','sdk','generation','sequence','registration','call','callCount','muted','ended','error','events','labMedia'])if(value[k]!==undefined)safe[k]=value[k];result.native_states.push({at:new Date().toISOString(),...safe});persist();return value;};
 const observed=async(predicate,timeout=8000)=>remember(await ui.waitFor(value=>{checkCancellation();return predicate(value);},timeout));
 const exportPbx=kind=>{
  const file=remote[kind],local=path.join(directory,`pbx-${kind}.wav`);
  docker(['exec',fixture.container,'sh','-c','test -f "$1" && test ! -L "$1"','sh',file]);
  const digest=docker(['exec',fixture.container,'sha256sum',file]).split(/\s/)[0];ensure(/^[a-f0-9]{64}$/.test(digest),'Invalid peer media digest');
  const sizeText=docker(['exec',fixture.container,'stat','-c','%s',file]).trim();ensure(/^\d+$/.test(sizeText),'Invalid peer media size');
  const size=Number(sizeText);ensure(Number.isSafeInteger(size)&&size>=44&&size<=MAX_PEER_BYTES,'Peer media size is outside the4MiB bound');
  // docker cp cannot reliably see files on this container's /tmp tmpfs; read inside its namespace.
  const bytes=execFileSync('docker',['exec',fixture.container,'cat',file],{encoding:'buffer',maxBuffer:MAX_PEER_BYTES,timeout:10000,stdio:['ignore','pipe','pipe']});
  try{
   verifyPeerBytes(bytes,size,digest);
   ensure(docker(['exec',fixture.container,'sha256sum',file]).split(/\s/)[0]===digest,'Peer media changed after export');
   fs.writeFileSync(local,bytes,{mode:0o600,flag:'wx'});fs.chmodSync(local,0o600);
  }finally{bytes.fill(0);}
  pbxExported.add(kind);result.artifacts.push({kind:`pbx_${kind}`,path:local,sha256:digest,bytes:size});persist();
 };
 try{
  persist();inspectFixture();
  ensure(/TIMEOUT\(absolute\).*20/.test(pbx('dialplan show 7190@lab')),'PBX20-second absolute bound is not observed');
  ensure(parseChannels(pbx('core show channels concise')).length===0,'Existing synthetic call must finish before media run');
  ui=await import('./ui.mjs');result.emulator_serial=ui.serial;
  const sdk=process.env.ANDROID_HOME||path.join(os.homedir(),'Library/Android/sdk'),adb=path.join(sdk,'platform-tools/adb');
  const installed=apkPath(ui.shell('pm','path',packageName));ensure(ui.shell('sha256sum',installed).split(/\s/)[0]===apk.sha256,'Installed APK does not match final build identity');
  const fileExists=spawnSync(adb,['-s',ui.serial,'shell','test','-e',appMedia],{encoding:'utf8',timeout:10000});
  ensure(fileExists.status===1&&!fileExists.stdout?.trim()&&!fileExists.stderr?.trim(),'Existing or inaccessible app media must be exported/reviewed before this run; it will not be cleared');
  try{remember(ui.state());}catch{ui.openLab();await observed(()=>true);}
  let initial=remember(ui.state());ensure(initial.call==='none','Refusing to change an existing app call');ownsRuntime=true;
  if(initial.initialized){ui.tap('Destroy');await observed(s=>!s.initialized);}
  ui.tap('Initialize');await observed(s=>s.initialized);
  ui.enterPassword(fixture.accounts['7101'].password);ui.tap('Register');await observed(s=>s.registration==='registered',15000);
  ensure(!fs.existsSync('.lab/sip-run.lock'),'SIP harness acquired emulator before media call');
  result.execution_started=true;persist();
  ui.tap('Call tone');const inviteAt=Date.now();
  const connected=await observed(s=>s.call==='connected'&&s.callCount===1,10000);identity={generation:connected.generation,callId:currentCall(connected)};
  ensure(identity.callId,'Actual connected native call identity missing');
  channel=answeredChannel(pbx('core show channels concise'));result.pbx_channel=channel;
  pbx(`mixmonitor start ${channel} ${remote.mix},r(${remote.rx})t(${remote.tx})`);mixStarted=true;
  if(faultMode){insertFault();await delay(1000);checkCancellation();} // Drain pre-fault decoded/jitter-buffer audio before app capture.
  ensure(Date.now()-inviteAt<12000,'Insufficient time left in bounded call for synthetic media');
  captureStarted=true;ui.tap('Capture media');const recording=await observed(s=>s.labMedia?.active===true&&s.labMedia?.status==='recording',5000);
  ensure(sameCall(recording,identity),'Call changed before media injection');
  // UI dump consumes about2s; ensure at least1s baseline without another unnecessary dump.
  if(Number(recording.labMedia.elapsedMs)<1000)await delay(1000-Number(recording.labMedia.elapsedMs));
  ensure(Date.now()-inviteAt<15000,'Insufficient bounded time for three-second tone');ui.tap('Inject tone');
  await observed(s=>s.labMedia?.toneStatus==='stopped'||s.labMedia?.toneStatus==='failed'||s.call==='none',6000);
  const tone=result.native_states.at(-1);ensure(tone.labMedia?.toneStatus==='stopped','Tone did not complete within the same bounded call');
  ui.tap('Stop capture');const stopped=await observed(s=>s.labMedia?.active===false,5000);
  ensure(!stopped.labMedia.errorCode&&['stopped','call_ended'].includes(stopped.labMedia.status),'Capture stop failed or teardown was unverified');
  if(faultMode){result.fault.counters=countFault();ensure(result.fault.counters.packets>0,'Fault rule did not drop actual downlink packets');persist();}
  pbx(`mixmonitor stop ${channel}`);mixStarted=false;
  if(stopped.call!=='none'){ensure(sameCall(stopped,identity),'Call changed before local hangup');ui.tap('Hang up');await observed(s=>s.call==='none',5000);}
  ensure(!parseChannels(pbx('core show channels concise')).some(c=>c.name===channel),'Owned PBX channel has not terminated');
  const digest=ui.shell('sha256sum',appMedia).split(/\s/)[0];ensure(/^[a-f0-9]{64}$/.test(digest),'App media digest unavailable');
  await delay(250);ensure(ui.shell('sha256sum',appMedia).split(/\s/)[0]===digest,'App capture has not stabilized');
  const local=path.join(directory,'siprix-duplex.mp3');cmd(adb,['-s',ui.serial,'pull',appMedia,local],15000);fs.chmodSync(local,0o600);
  ensure(hash(fs.readFileSync(local))===digest&&fs.statSync(local).size>0,'App media export mismatch');appExported=true;result.artifacts.push({kind:'siprix_duplex',path:local,sha256:digest});persist();
  for(const kind of ['rx','tx','mix'])exportPbx(kind);
  const analysis=spawnSync('python3',['lab/android/media-analyze.py',local,'--peer-received',path.join(directory,'pbx-rx.wav')],{encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
  let parsed;try{parsed=JSON.parse(analysis.stdout);}catch{throw new Error('Media analyzer did not return valid evidence');}
  write(path.join(directory,'analysis.json'),parsed);result.analysis=parsed;result.artifacts.push({kind:'analysis',path:path.join(directory,'analysis.json')});
  if(faultMode){
   const proved=analysis.status===2&&parsed.status==='INCOMPLETE'&&faultProof(parsed,result.fault.counters?.packets);
   result.checks={'MEDIA-04':proved?'PASS':'FAIL'};
   ensure(proved,'Negative media proof requires counted downlink drops, valid stereo decode without440Hz, and independent uplink DTMF still present');
  }else{
   result.checks={'MEDIA-01':parsed.independentPeerUplinkDtmf1==='PASS'&&parsed.localSyntheticSend==='PASS'&&parsed.empiricalChannelMapping?'PASS':'FAIL','MEDIA-02':parsed.decodedDownlink440==='PASS'&&parsed.empiricalChannelMapping?'PASS':'FAIL'};
   ensure(analysis.status===0&&parsed.status==='PASS','Known decoded signatures or independent peer proof are incomplete');
  }
  result.result='PASS';
 }catch(error){failure=error;result.result=result.execution_started?'FAIL':'BLOCKED';result.reason=clean(error instanceof Error?error.message:'Media run unavailable');}
 finally{
  cleaning=true;const cleanupErrors=[];
  if(faultMayExist){
   try{
    inspectFixture();if(rulePresent()){result.fault.counters=countFault();docker(['exec',fixture.container,'iptables','-w','2','-D','OUTPUT',...faultRule]);}
    ensure(!rulePresent(),'Owned fault rule still exists after deletion');result.fault.cleanup='removed_and_absence_verified';faultMayExist=false;
   }catch{cleanupErrors.push('Owned container downlink-drop rule cleanup unconfirmed');if(result.fault)result.fault.cleanup='unconfirmed';}
  }
  try{inspectFixture();if(mixStarted&&channel){pbx(`mixmonitor stop ${channel}`);mixStarted=false;}if(channel&&parseChannels(pbx('core show channels concise')).some(c=>c.name===channel))pbx(`channel request hangup ${channel}`);}catch{cleanupErrors.push('Owned PBX stop/hangup could not be confirmed');}
  if(ui&&ownsRuntime){
   try{
    let current=remember(ui.state());
    if(current.call!=='none'){
     ensure(sameCall(current,identity),'Another call is active; automatic app teardown refused');
     ui.tap('Hang up');current=await observed(s=>s.call==='none',8000);
    }
    if(appExported&&captureStarted){
     if(!current.initialized){ui.tap('Initialize');await observed(s=>s.initialized);}
     ui.tap('Clear media');await observed(s=>s.labMedia?.status==='idle',5000);
    }
    if(remember(ui.state()).initialized){ui.tap('Destroy');await observed(s=>!s.initialized,5000);}
   }catch{cleanupErrors.push('Lab app cleanup unconfirmed; inspect before another run');}
  }
  if(captureStarted&&!appExported)result.cleanup.retained.push(appMedia);
  for(const kind of ['mix','rx','tx']){
   if(pbxExported.has(kind)){try{inspectFixture();docker(['exec',fixture.container,'rm','--',remote[kind]]);}catch{cleanupErrors.push(`Exported PBX${kind} cleanup failed`);result.cleanup.retained.push(remote[kind]);}}
   else if(channel)result.cleanup.retained.push(remote[kind]);
  }
  result.cleanup.status=cleanupErrors.length?'failed':'completed';result.cleanup.errors=cleanupErrors;
  if(cleanupErrors.length&&result.result==='PASS'){result.result='FAIL';result.reason='Media signatures passed but cleanup is unconfirmed';}
  result.ended_at=new Date().toISOString();persist();
  try{const owner=JSON.parse(fs.readFileSync(lockPath,'utf8'));if(owner.runId===runId&&owner.pid===process.pid)fs.unlinkSync(lockPath);}catch{}
  console.log(JSON.stringify({runId,attempt,result:result.result,checks:result.checks,cleanup:result.cleanup.status,evidence:path.join(directory,'result.json')}));
  process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
  if(failure||result.result!=='PASS')process.exitCode=1;
 }
}
if(process.argv.includes('--self-test'))selfTest();
else if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Media preflight blocked; no evidence overwritten. Check final APK, dedicated AVD, host-mic confirmation and run locks.');process.exitCode=1;});
