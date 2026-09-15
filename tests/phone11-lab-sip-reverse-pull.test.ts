import {describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import express from "express";
import {createServer} from "node:http";
import {createLabFcmService,registerLabFcmRoutes} from "../server/push/lab-fcm-routes";
import {createLabSipReversePullBroker} from "../server/push/lab-sip-reverse-pull";

const now=2_000_000_000_000,executionId=randomUUID(),bindingId=randomUUID(),leaseId=randomUUID(),secret="d".repeat(48),apk="a".repeat(64);
const source=():NodeJS.ProcessEnv=>({PHONE11_LAB_FCM_SCENARIO_ENABLED:"1",PHONE11_LAB_FCM_ENVIRONMENT:"staging",PHONE11_LAB_FCM_PACKAGE:"ai.phone11.mobile.staging",
 PHONE11_LAB_FCM_PROJECT_ID:"phone11-stage-20260914",PHONE11_LAB_FCM_SENDER_ID:"413228367517",PHONE11_LAB_FCM_APP_ID:"1:413228367517:android:f41353883923fc15911e74",
 PHONE11_LAB_FCM_APK_SHA256:apk,PHONE11_LAB_FCM_EXECUTION_ID:executionId,PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT:String(now+300_000),PHONE11_LAB_FCM_BINDING_ID:bindingId,
 PHONE11_LAB_FCM_CASES:"PUSH-06",PHONE11_LAB_FCM_TRIGGER_SECRET:"s".repeat(48),PHONE11_LAB_FCM_PUBLIC_ORIGIN:"https://api.stage.phone11.ai",PHONE11_LAB_SIP_DRIVER_TRANSPORT:"reverse_pull",
 PHONE11_LAB_SIP_DRIVER_SECRET:secret,PHONE11_WAKE_ENABLED:"1",PHONE11_WAKE_PILOT_SIP_URI:"sip:7101@sip.stage.phone11.test",FCM_PROJECT_ID:"phone11-stage-20260914",PHONE11_BUILD_SHA:"b".repeat(40)});
const runnerHeaders={"x-phone11-lab-driver-secret":secret,"x-phone11-execution-id":executionId};
const triggerHeaders={"x-phone11-lab-secret":"s".repeat(48),"x-phone11-execution-id":executionId};
const auth=(name:string,value:unknown)=>value===source()[name]?"ok" as const:"forbidden" as const;

describe("private reverse-pull SIP broker",()=>{
 it("requires a current runner, leases one correlation and accepts only its exact receipt and evidence",async()=>{
  const broker=createLabSipReversePullBroker({now:()=>now,id:()=>leaseId});
  const service=createLabFcmService({source,now:()=>now,broker,secretStatus:auth});
  const first={v:1 as const,executionId,testId:"PUSH-06" as const,correlationId:randomUUID(),apkSha256:apk};
  await expect(service.trigger(triggerHeaders,first)).rejects.toMatchObject({status:503});
  expect(await service.runnerLease(runnerHeaders)).toBeNull();
  const pending=service.trigger(triggerHeaders,first);await Promise.resolve();
  const lease=await service.runnerLease(runnerHeaders);expect(lease).toMatchObject({v:1,leaseId,operation:"start",executionId,testId:"PUSH-06",correlationId:first.correlationId,targetSipUri:"sip:7101@sip.stage.phone11.test"});
  const conflict=service.trigger(triggerHeaders,{...first,correlationId:randomUUID()});await expect(conflict).rejects.toMatchObject({status:409});
  await expect(service.runnerComplete(runnerHeaders,{v:1,leaseId:randomUUID(),operation:"start",executionId,testId:"PUSH-06",correlationId:first.correlationId,result:{}})).rejects.toMatchObject({status:403});
  const receipt={accepted:true as const,source:"real_sip_driver" as const,executionId,testId:"PUSH-06",correlationId:first.correlationId,sipCallIdHash:"c".repeat(64),pbxChannelHash:"d".repeat(64),startedAtMs:now};
  expect(await service.runnerComplete(runnerHeaders,{v:1,leaseId,operation:"start",executionId,testId:"PUSH-06",correlationId:first.correlationId,result:receipt})).toEqual({accepted:true,operation:"start"});
  await expect(pending).resolves.toMatchObject({accepted:true,correlationId:first.correlationId});

  const observed=service.evidence(triggerHeaders,{executionId,testId:"PUSH-06",correlationId:first.correlationId});await Promise.resolve();
  const evidenceLease=await service.runnerLease(runnerHeaders);expect(evidenceLease).toMatchObject({operation:"evidence",correlationId:first.correlationId});
  const event=(event:string,source="backend")=>({event,timestampMs:now,correlationId:first.correlationId,source});
  const evidence={source:"real_fcm_v1" as const,executionId,testId:"PUSH-06",correlationId:first.correlationId,events:[
   {...event("real_sip_scenario_started","sip_driver"),sipCallIdHash:"c".repeat(64),pbxChannelHash:"d".repeat(64)},event("wake_expired"),event("no_notification"),event("no_ghost_call"),event("cleanup_completed","sip_driver")]};
  await service.runnerComplete(runnerHeaders,{v:1,leaseId:evidenceLease!.leaseId,operation:"evidence",executionId,testId:"PUSH-06",correlationId:first.correlationId,result:evidence});
  await expect(observed).resolves.toMatchObject({source:"real_fcm_v1",simulated:false,correlationId:first.correlationId});
 });

 it("rejects wrong runner authorization without disclosing a lease",async()=>{
  const service=createLabFcmService({source,now:()=>now,secretStatus:auth});
  await expect(service.runnerLease({...runnerHeaders,"x-phone11-lab-driver-secret":"wrong"})).rejects.toMatchObject({status:403});
 });

 it("exposes runner exchange only when the private Cloud Run registration opts in",async()=>{
  const app=express(),service=createLabFcmService({source,now:()=>now,secretStatus:auth});registerLabFcmRoutes(app,service,{reversePull:true});const server=createServer(app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{const address=server.address();if(!address||typeof address==="string")throw new Error("missing address");const origin=`http://127.0.0.1:${address.port}`;
   const denied=await fetch(`${origin}/api/phone11/lab/sip-driver/lease`,{headers:{...runnerHeaders,"x-phone11-lab-driver-secret":"wrong"}});expect(denied.status).toBe(403);expect(await denied.json()).toEqual({error:"Forbidden"});
   const idle=await fetch(`${origin}/api/phone11/lab/sip-driver/lease`,{headers:runnerHeaders});expect(idle.status).toBe(204);expect(idle.headers.get("cache-control")).toBe("no-store");
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });
});
