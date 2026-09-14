import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {randomUUID} from 'node:crypto';
import {createIdentityTokenProvider,createReversePullRunner,readReversePullRunnerConfig,ReversePullRunnerError} from '../lab/android/reverse-pull-runner.mjs';

const now=2_000_000_000_000,executionId=randomUUID(),correlationId=randomUUID(),leaseId=randomUUID(),secret='d'.repeat(48),origin='https://phone11-fcm-staging-lab-iwfx6x7hba-as.a.run.app';
const source=()=>({PHONE11_LAB_SIP_REVERSE_PULL_ENABLED:'1',PHONE11_LAB_SIP_REVERSE_PULL_ENVIRONMENT:'staging',PHONE11_LAB_SIP_DRIVER_TRANSPORT:'reverse_pull',PHONE11_LAB_FCM_PUBLIC_ORIGIN:origin,
 PHONE11_LAB_SIP_RUNNER_SERVICE_ACCOUNT:'phone11-sip-runner@phone11-stage-20260914.iam.gserviceaccount.com',PHONE11_LAB_SIP_DRIVER_ENABLED:'1',PHONE11_LAB_SIP_DRIVER_ENVIRONMENT:'staging',
 PHONE11_LAB_SIP_DRIVER_EXECUTION_ID:executionId,PHONE11_LAB_SIP_DRIVER_EXECUTION_EXPIRES_AT:String(now+300_000),PHONE11_LAB_SIP_DRIVER_CASES:'PUSH-06',PHONE11_LAB_SIP_DRIVER_SECRET:secret,
 PHONE11_LAB_SIP_DRIVER_TARGET_SIP_URI:'sip:7101@sip.stage.phone11.test',PHONE11_LAB_SIP_DRIVER_FIXTURE_FILE:'.lab/fixture.json'});

test('runner configuration is exact and rejects public/direct or wrong identities',()=>{
 assert.equal(readReversePullRunnerConfig(source(),now).origin,origin);
 for(const change of [{PHONE11_LAB_SIP_DRIVER_TRANSPORT:'direct_https'},{PHONE11_LAB_FCM_PUBLIC_ORIGIN:'https://api.stage.phone11.ai'},{PHONE11_LAB_SIP_RUNNER_SERVICE_ACCOUNT:'phone11-fcm-lab@phone11-stage-20260914.iam.gserviceaccount.com'}])
  assert.throws(()=>readReversePullRunnerConfig({...source(),...change},now),ReversePullRunnerError);
});

test('identity provider mints and caches a short-lived token for the exact service account and audience',async()=>{
 const config=readReversePullRunnerConfig(source(),now),calls=[];
 const payload=Buffer.from(JSON.stringify({exp:Math.floor((now+300_000)/1000)})).toString('base64url'),fake=`e30.${payload}.signature`;
 const token=createIdentityTokenProvider(config,{now:()=>now,execute:(command,args,options)=>{calls.push({command,args,options});return `${fake}\n`;}});
 assert.equal(await token(),fake);assert.equal(await token(),fake);assert.equal(calls.length,1);assert.equal(calls[0].command,'gcloud');
 assert.deepEqual(calls[0].args,['auth','print-identity-token',`--impersonate-service-account=${config.runnerAccount}`,`--audiences=${origin}`]);assert.deepEqual(calls[0].options.stdio,['ignore','pipe','pipe']);
});

test('runner polls outbound, invokes the injected local driver once and returns the exact result',async()=>{
 const calls=[],started=[];const receipt={accepted:true,source:'real_sip_driver',executionId,testId:'PUSH-06',correlationId,sipCallIdHash:'a'.repeat(64),pbxChannelHash:'b'.repeat(64),startedAtMs:now};
 const fetchImpl=async(url,init)=>{calls.push({url,init});if(url.endsWith('/lease'))return new Response(JSON.stringify({v:1,leaseId,operation:'start',executionId,testId:'PUSH-06',correlationId,targetSipUri:'sip:7101@sip.stage.phone11.test',leaseExpiresAt:now+5_000}),{status:200,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({accepted:true}),{status:202,headers:{'content-type':'application/json'}});};
 const runner=createReversePullRunner({source,now:()=>now,fetchImpl,tokenProvider:async()=>"private-id-token",driverService:{start:async(headers,input)=>{started.push({headers,input});return receipt;},evidence:async()=>assert.fail('unexpected evidence')}});
 assert.deepEqual(await runner.pollOnce(),{status:'completed',operation:'start'});assert.equal(started.length,1);assert.deepEqual(started[0].input,{executionId,testId:'PUSH-06',correlationId,targetSipUri:'sip:7101@sip.stage.phone11.test'});
 assert.equal(calls.length,2);assert.match(calls[0].init.headers.authorization,/^Bearer /);assert.equal(calls[0].init.redirect,'error');
 const completion=JSON.parse(calls[1].init.body);assert.deepEqual(completion.result,receipt);assert.equal(completion.leaseId,leaseId);
});

test('runner stays idle on an authenticated empty lease without touching the fixture',async()=>{
 const runner=createReversePullRunner({source,now:()=>now,fetchImpl:async()=>new Response(null,{status:204}),tokenProvider:async()=>"private-id-token",driverService:{start:async()=>assert.fail('unexpected call'),evidence:async()=>assert.fail('unexpected evidence')}});
 assert.deepEqual(await runner.pollOnce(),{status:'idle'});
});
