import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFixtureSipAdapter,createRealSipDriverServer,createRealSipDriverService,DriverError,readDriverConfig} from '../lab/android/real-sip-driver.mjs';

const now=2_000_000_000_000,executionId=randomUUID(),correlationId=randomUUID(),secret='s'.repeat(48);
const source=()=>({PHONE11_LAB_SIP_DRIVER_ENABLED:'1',PHONE11_LAB_SIP_DRIVER_ENVIRONMENT:'staging',PHONE11_LAB_SIP_DRIVER_EXECUTION_ID:executionId,
 PHONE11_LAB_SIP_DRIVER_EXECUTION_EXPIRES_AT:String(now+300_000),PHONE11_LAB_SIP_DRIVER_CASES:'PUSH-01,PUSH-06',PHONE11_LAB_SIP_DRIVER_SECRET:secret,
 PHONE11_LAB_SIP_DRIVER_TARGET_SIP_URI:'sip:7101@sip.stage.phone11.test',PHONE11_LAB_SIP_DRIVER_FIXTURE_FILE:'.lab/fixture.json'});
const headers={'x-phone11-lab-driver-secret':secret,'x-phone11-execution-id':executionId};
const start={executionId,testId:'PUSH-01',correlationId,targetSipUri:'sip:7101@sip.stage.phone11.test'};

test('driver config requires staging, an exact execution/case scope, fixed target, and private fixture path',()=>{
 assert.equal(readDriverConfig(source(),now).executionId,executionId);
 for(const change of [{PHONE11_LAB_SIP_DRIVER_ENABLED:'0'},{PHONE11_LAB_SIP_DRIVER_ENVIRONMENT:'production'},
  {PHONE11_LAB_SIP_DRIVER_EXECUTION_EXPIRES_AT:String(now+3_600_001)},{PHONE11_LAB_SIP_DRIVER_CASES:'PUSH-01,UNKNOWN'},
  {PHONE11_LAB_SIP_DRIVER_SECRET:'placeholder'},{PHONE11_LAB_SIP_DRIVER_TARGET_SIP_URI:'sip:7101@sip.phone11.ai'},
  {PHONE11_LAB_SIP_DRIVER_FIXTURE_FILE:'../production.json'}])assert.throws(()=>readDriverConfig({...source(),...change},now),DriverError);
});

function adapterFixture({callId='raw-sip-call-id',registered=true}={}){
 const channel='PJSIP/7101-00000001',calls=[];let channelReads=0;
 const execute=(args,options={})=>{calls.push({args,options});const command=args.join(' ');
  if(command.startsWith('container inspect'))return JSON.stringify([{State:{Running:true},Config:{Labels:{'com.phone11.android-lab.owner':'owned','com.phone11.android-lab.run':'run'}}}]);
  if(command.includes('pjsip show contacts'))return registered?'7101/sip:7101@device Avail':'';
  if(command.includes('core show channels concise'))return channelReads++===0?'':`${channel}!lab!7190!1!Ring!Dial!\n`;
  if(command.includes('pjsip show channel'))return callId?`Call-ID: ${callId}\n`:'';
  if(command.includes('sh -c'))return '';
  if(command.includes('channel request hangup'))return 'Requested';throw new Error(`Unexpected ${command}`);
 };
 const adapter=createFixtureSipAdapter({execute,wait:async()=>{},now:()=>now,monitor:false,loadFixture:()=>({owner:'owned',runId:'run',container:'owned-container'})});
 return {adapter,calls,channel,callId};
}

test('fixture adapter originates one real PBX call and returns only hashed SIP/channel correlation',async()=>{
 const fixture=adapterFixture(),config=readDriverConfig(source(),now),receipt=await fixture.adapter.start(config,start);
 assert.deepEqual(Object.keys(receipt).sort(),['accepted','correlationId','executionId','pbxChannelHash','sipCallIdHash','source','startedAtMs','testId'].sort());
 assert.match(receipt.sipCallIdHash,/^[a-f0-9]{64}$/);assert.match(receipt.pbxChannelHash,/^[a-f0-9]{64}$/);
 assert.doesNotMatch(JSON.stringify(receipt),new RegExp(fixture.callId));assert.doesNotMatch(JSON.stringify(receipt),new RegExp(fixture.channel.replaceAll('/','\\/')));
 const queued=fixture.calls.find(value=>value.args.includes('-i'));assert.ok(queued);assert.match(queued.options.input,/Channel: PJSIP\/7101/);assert.doesNotMatch(queued.options.input,new RegExp(correlationId));
 const evidence=await fixture.adapter.evidence(config,{executionId,testId:'PUSH-01',correlationId});
 assert.deepEqual(evidence.events.map(value=>value.event),['real_sip_scenario_started','sip_invite_delivered']);
 assert.equal(evidence.events.every(value=>!('callId' in value)&&!('channel' in value)),true);
});

test('fixture adapter fails when registration or an actual SIP Call-ID is absent',async()=>{
 for(const options of [{registered:false},{callId:''}]){const fixture=adapterFixture(options),config=readDriverConfig(source(),now);await assert.rejects(fixture.adapter.start(config,start),DriverError);}
});

test('HTTP contract enforces secret and execution headers and preserves strict driver responses',async()=>{
 const sip='c'.repeat(64),pbx='d'.repeat(64),adapter={
  start:async(_config,input)=>({accepted:true,source:'real_sip_driver',executionId:input.executionId,testId:input.testId,correlationId:input.correlationId,sipCallIdHash:sip,pbxChannelHash:pbx,startedAtMs:now}),
  evidence:async(_config,input)=>({source:'real_fcm_v1',...input,events:[{event:'real_sip_scenario_started',timestampMs:now,correlationId:input.correlationId,source:'sip_driver',sipCallIdHash:sip,pbxChannelHash:pbx}]}),
 };
 const service=createRealSipDriverService({source,now:()=>now,adapter}),server=createRealSipDriverServer(service);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;try{
  const denied=await fetch(`${origin}/v1/phone11/real-sip-scenario`,{method:'POST',headers:{...headers,'x-phone11-lab-driver-secret':'wrong','content-type':'application/json'},body:JSON.stringify(start)});assert.equal(denied.status,403);
  const accepted=await fetch(`${origin}/v1/phone11/real-sip-scenario`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(start)});assert.equal(accepted.status,202);const receipt=await accepted.json();assert.equal(receipt.sipCallIdHash,sip);
  const query=new URLSearchParams({executionId,testId:'PUSH-01',correlationId});const observed=await fetch(`${origin}/v1/phone11/real-sip-evidence?${query}`,{headers});assert.equal(observed.status,200);assert.equal((await observed.json()).source,'real_fcm_v1');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('service deduplicates concurrent correlation and rejects secret-bearing adapter output',async()=>{
 let starts=0,release;const pending=new Promise(resolve=>{release=resolve;});
 const receipt={accepted:true,source:'real_sip_driver',executionId,testId:'PUSH-01',correlationId,sipCallIdHash:'c'.repeat(64),pbxChannelHash:'d'.repeat(64),startedAtMs:now};
 const adapter={start:async()=>{starts++;await pending;return receipt;},evidence:async()=>({source:'real_fcm_v1',executionId,testId:'PUSH-01',correlationId,events:[{event:'real_sip_scenario_started',timestampMs:now,correlationId,source:'sip_driver',sipCallIdHash:'c'.repeat(64),pbxChannelHash:'d'.repeat(64)}]})};
 const service=createRealSipDriverService({source,now:()=>now,adapter});const first=service.start(headers,start),second=service.start(headers,start);release();
 assert.deepEqual(await first,receipt);assert.deepEqual(await second,receipt);assert.equal(starts,1);
 const leaking=createRealSipDriverService({source,now:()=>now,adapter:{...adapter,start:async()=>({...receipt,token:'forbidden'})}});
 await assert.rejects(leaking.start(headers,start),DriverError);
 const eventLeak=createRealSipDriverService({source,now:()=>now,adapter:{...adapter,evidence:async()=>({source:'real_fcm_v1',executionId,testId:'PUSH-01',correlationId,events:[{event:'real_sip_scenario_started',timestampMs:now,correlationId,source:'sip_driver',sipCallIdHash:'c'.repeat(64),pbxChannelHash:'d'.repeat(64),callId:'raw'}]})}});
 await assert.rejects(eventLeak.evidence(headers,{executionId,testId:'PUSH-01',correlationId}),DriverError);
});
