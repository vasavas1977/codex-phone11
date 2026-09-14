import {afterEach,describe,expect,it,vi} from "vitest";
import express from "express";
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {createLabFcmService,LabFcmError,readLabFcmConfig,registerLabFcmRoutes} from "../server/push/lab-fcm-routes";
import {createWakeRepository} from "../server/push/wake-repository";

const now=2_000_000_000_000,executionId=randomUUID(),bindingId=randomUUID(),apk="a".repeat(64),commit="b".repeat(40),secret="s".repeat(48);
const source=():NodeJS.ProcessEnv=>({NODE_ENV:"test",PHONE11_LAB_FCM_SCENARIO_ENABLED:"1",PHONE11_LAB_FCM_ENVIRONMENT:"staging",PHONE11_LAB_FCM_PACKAGE:"ai.phone11.mobile.staging",
 PHONE11_LAB_FCM_PROJECT_ID:"phone11-stage-20260914",PHONE11_LAB_FCM_SENDER_ID:"413228367517",PHONE11_LAB_FCM_APP_ID:"1:413228367517:android:f41353883923fc15911e74",
 PHONE11_LAB_FCM_APK_SHA256:apk,PHONE11_LAB_FCM_EXECUTION_ID:executionId,PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT:String(now+300_000),PHONE11_LAB_FCM_BINDING_ID:bindingId,
 PHONE11_LAB_FCM_CASES:"PUSH-06,PUSH-01",PHONE11_LAB_FCM_TRIGGER_SECRET:secret,PHONE11_LAB_FCM_PUBLIC_ORIGIN:"https://api.stage.phone11.ai",
 PHONE11_LAB_SIP_DRIVER_ORIGIN:"https://sip-driver.stage.phone11.ai",PHONE11_LAB_SIP_DRIVER_SECRET:"d".repeat(48),PHONE11_WAKE_ENABLED:"1",PHONE11_WAKE_PILOT_SIP_URI:"sip:7101@sip.stage.phone11.test",
 FCM_PROJECT_ID:"phone11-stage-20260914",PHONE11_BUILD_SHA:commit});
const headers={"x-phone11-lab-secret":secret,"x-phone11-execution-id":executionId};
function event(event:string,correlationId:string,extra={}){return {event,timestampMs:now,correlationId,source:"backend",...extra};}
function service(driverOverrides:Partial<{receipt:unknown;evidence:unknown}>={}){
 const receipt=(input:any)=>driverOverrides.receipt??{accepted:true,source:"real_sip_driver",executionId:input.executionId,testId:input.testId,correlationId:input.correlationId,sipCallIdHash:"c".repeat(64),pbxChannelHash:"d".repeat(64),startedAtMs:now};
 const evidence=(input:any)=>driverOverrides.evidence??{source:"real_fcm_v1",...input,events:[
  event("real_sip_scenario_started",input.correlationId,{source:"sip_driver",sipCallIdHash:"c".repeat(64),pbxChannelHash:"d".repeat(64)}),event("wake_expired",input.correlationId),event("no_notification",input.correlationId),event("no_ghost_call",input.correlationId),event("cleanup_completed",input.correlationId),
 ]};
 return createLabFcmService({source,now:()=>now,readiness:async()=>({bindingId,bindingExpiresAt:now+600_000,platform:"android",tokenType:"fcm",packageName:"ai.phone11.mobile.staging"}),
  provider:async()=>({projectId:"phone11-stage-20260914",serviceAccount:true}),driver:()=>({start:vi.fn(async input=>receipt(input)),evidence:vi.fn(async input=>evidence(input))}),secretStatus:(_name,value)=>value===secret?"ok":"forbidden"});
}
function secretKeys(value:unknown):string[]{if(!value||typeof value!=="object")return[];return Object.entries(value).flatMap(([key,item])=>[key,...secretKeys(item)]);}

describe("isolated Phone11 staging FCM routes",()=>{
 afterEach(()=>vi.restoreAllMocks());
 it("fails closed unless the exact staging, execution, Firebase and SIP gates agree",()=>{
  expect(()=>readLabFcmConfig({...source(),PHONE11_LAB_FCM_SCENARIO_ENABLED:"0"},now)).toThrowError(LabFcmError);
  expect(()=>readLabFcmConfig({...source(),PHONE11_LAB_FCM_PROJECT_ID:"phone11-prod"},now)).toThrowError(LabFcmError);
  expect(()=>readLabFcmConfig({...source(),PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT:String(now-1)},now)).toThrowError(LabFcmError);
  expect(()=>readLabFcmConfig({...source(),PHONE11_WAKE_PILOT_SIP_URI:"sip:7101@sip.phone11.test"},now)).toThrowError(LabFcmError);
  expect(()=>readLabFcmConfig({...source(),PHONE11_LAB_SIP_DRIVER_ORIGIN:"https://sip-driver.stage.phone11.test"},now)).toThrowError(LabFcmError);
  expect(()=>readLabFcmConfig({...source(),PHONE11_LAB_FCM_PUBLIC_ORIGIN:"https://api.stage.phone11.invalid"},now)).toThrowError(LabFcmError);
 });

 it("attests only a current Android FCM binding and service-account project without secrets",async()=>{
  const value=await service().attestation(headers);
  expect(value).toMatchObject({environment:"staging",packageName:"ai.phone11.mobile.staging",projectId:"phone11-stage-20260914",senderId:"413228367517",
   provider:{transport:"FCM_V1",credentialProjectId:"phone11-stage-20260914",ready:true},enrollment:{bindingId,platform:"android",tokenType:"fcm",registered:true}});
  expect(secretKeys(value)).not.toEqual(expect.arrayContaining(["token","grant","sessionBinding","serviceAccount"]));
  await expect(createLabFcmService({source,now:()=>now,readiness:async()=>null,provider:async()=>({projectId:"phone11-stage-20260914",serviceAccount:true}),secretStatus:()=>"ok"}).attestation(headers)).rejects.toMatchObject({status:503});
 });

 it("reads lab readiness through the live binding joins without selecting device secrets",async()=>{
  const queries:string[]=[];const repository=createWakeRepository(async run=>run({query:vi.fn(async(sql:string)=>{queries.push(sql);return sql.startsWith("SET LOCAL")?{rows:[]}:{rows:[{id:bindingId,expires_at:new Date(now+600_000),platform:"android",token_type:"fcm",bundle_id:"ai.phone11.mobile.staging"}]};})} as any));
  const value=await repository.labReadiness(bindingId,"sip:7101@sip.stage.phone11.test");
  expect(value).toEqual({bindingId,bindingExpiresAt:now+600_000,platform:"android",tokenType:"fcm",packageName:"ai.phone11.mobile.staging"});
  const sql=queries.at(-1)??"";expect(sql).toContain("phone11_wake_bindings");expect(sql).toContain("liveBinding".replace("liveBinding","phone11_push_devices"));expect(sql).not.toMatch(/SELECT\s+(?:p\.\*|[^\n]*p\.token(?:,|\s+AS))/i);
  expect(secretKeys(value)).not.toEqual(expect.arrayContaining(["token","grant","deviceId","sessionBinding","ownerUserId","tenantId"]));
 });

 it("requires a real SIP-driver receipt and deduplicates a correlation before evidence",async()=>{
  const correlationId=randomUUID(),start=vi.fn(async(input:any)=>({accepted:true,source:"real_sip_driver",executionId:input.executionId,testId:input.testId,correlationId:input.correlationId,sipCallIdHash:"c".repeat(64),pbxChannelHash:"d".repeat(64),startedAtMs:now}));
  const driver={start,evidence:vi.fn(async(input:any)=>({source:"real_fcm_v1",...input,events:[event("real_sip_scenario_started",input.correlationId,{source:"sip_driver",sipCallIdHash:"c".repeat(64),pbxChannelHash:"d".repeat(64)}),event("wake_expired",input.correlationId),event("no_notification",input.correlationId),event("no_ghost_call",input.correlationId),event("cleanup_completed",input.correlationId)]}))};
  const target=createLabFcmService({source,now:()=>now,driver:()=>driver,secretStatus:(_n,v)=>v===secret?"ok":"forbidden"});
  const input={v:1,executionId,testId:"PUSH-06",correlationId,apkSha256:apk};
  await expect(target.trigger(headers,input)).resolves.toMatchObject({accepted:true,correlationId});await target.trigger(headers,input);expect(start).toHaveBeenCalledTimes(1);
  const evidence=await target.evidence(headers,{executionId,testId:"PUSH-06",correlationId});expect(evidence).toMatchObject({source:"real_fcm_v1",simulated:false,localBroadcast:false});
  expect(JSON.stringify(evidence)).not.toMatch(/token|grant|authorization/i);
 });

 it("rejects a synthetic receipt, incomplete evidence, and wrong request authorization",async()=>{
  const correlationId=randomUUID(),input={v:1,executionId,testId:"PUSH-06",correlationId,apkSha256:apk};
  await expect(service({receipt:{accepted:true,source:"synthetic"}}).trigger(headers,input)).rejects.toMatchObject({status:503});
  await expect(service().trigger({...headers,"x-phone11-lab-secret":"wrong"},input)).rejects.toMatchObject({status:403});
  const target=service({evidence:{source:"real_fcm_v1",executionId,testId:"PUSH-06",correlationId,events:[event("cleanup_completed",correlationId)]}});await target.trigger(headers,input);
  await expect(target.evidence(headers,{executionId,testId:"PUSH-06",correlationId})).rejects.toMatchObject({status:503});
  const wrongCorrelation=service({evidence:{source:"real_fcm_v1",executionId,testId:"PUSH-06",correlationId,events:[event("real_sip_scenario_started",randomUUID(),{source:"sip_driver",sipCallIdHash:"c".repeat(64),pbxChannelHash:"d".repeat(64)}),event("wake_expired",correlationId),event("no_notification",correlationId),event("no_ghost_call",correlationId),event("cleanup_completed",correlationId)]}});await wrongCorrelation.trigger(headers,input);
  await expect(wrongCorrelation.evidence(headers,{executionId,testId:"PUSH-06",correlationId})).rejects.toMatchObject({status:503});
 });

 it("registers the exact HTTP paths with no-store and bounded public errors",async()=>{
  const app=express(),target=service(),server=createServer(app);registerLabFcmRoutes(app,target);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{const address=server.address();if(!address||typeof address==="string")throw new Error("missing address");const origin=`http://127.0.0.1:${address.port}`;
   const denied=await fetch(origin+"/api/phone11/lab/wake-evidence",{headers:{...headers,"x-phone11-lab-secret":"wrong"}});expect(denied.status).toBe(403);expect(denied.headers.get("cache-control")).toBe("no-store");
   const attested=await fetch(origin+"/api/phone11/lab/wake-evidence",{headers});expect(attested.status).toBe(200);expect(await attested.json()).toMatchObject({environment:"staging"});
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });
});
