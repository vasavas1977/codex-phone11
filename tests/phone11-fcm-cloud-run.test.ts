import {describe,expect,it,vi} from "vitest";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createLabFcmCloudRunApp} from "../server/lab-fcm-cloud-run";

const now=2_000_000_000_000,executionId="11111111-1111-4111-8111-111111111111",bindingId="22222222-2222-4222-8222-222222222222",commit="a".repeat(40);
const source:NodeJS.ProcessEnv={NODE_ENV:"test",PHONE11_LAB_FCM_SCENARIO_ENABLED:"1",PHONE11_LAB_FCM_ENVIRONMENT:"staging",PHONE11_LAB_FCM_PACKAGE:"ai.phone11.mobile.staging",
 PHONE11_LAB_FCM_PROJECT_ID:"phone11-stage-20260914",PHONE11_LAB_FCM_SENDER_ID:"413228367517",PHONE11_LAB_FCM_APP_ID:"1:413228367517:android:f41353883923fc15911e74",
 PHONE11_LAB_FCM_APK_SHA256:"b".repeat(64),PHONE11_LAB_FCM_EXECUTION_ID:executionId,PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT:String(now+300_000),PHONE11_LAB_FCM_BINDING_ID:bindingId,
 PHONE11_LAB_FCM_CASES:"PUSH-06",PHONE11_LAB_FCM_TRIGGER_SECRET:"s".repeat(48),PHONE11_LAB_FCM_PUBLIC_ORIGIN:"https://api.stage.phone11.ai",PHONE11_LAB_SIP_DRIVER_TRANSPORT:"reverse_pull",
 PHONE11_LAB_SIP_DRIVER_SECRET:"d".repeat(48),PHONE11_WAKE_ENABLED:"1",PHONE11_WAKE_PILOT_SIP_URI:"sip:7101@sip.stage.phone11.test",FCM_PROJECT_ID:"phone11-stage-20260914",PHONE11_BUILD_SHA:commit};

describe("minimal Phone11 FCM staging Cloud Run service",()=>{
 it("refuses to construct without the existing fail-closed staging gates",()=>{
  expect(()=>createLabFcmCloudRunApp({source:{...source,PHONE11_LAB_FCM_SCENARIO_ENABLED:"0"},now})).toThrow();
  expect(()=>createLabFcmCloudRunApp({source:{...source,PHONE11_LAB_FCM_PROJECT_ID:"phone11-prod"},now})).toThrow();
  expect(()=>createLabFcmCloudRunApp({source:{...source,PHONE11_LAB_FCM_TRIGGER_SECRET:"short"},now})).toThrow();
  expect(()=>createLabFcmCloudRunApp({source:{...source,PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT:String(now+3_600_001)},now})).toThrow();
  expect(()=>createLabFcmCloudRunApp({source:{...source,PHONE11_LAB_SIP_DRIVER_TRANSPORT:"direct_https"},now})).toThrow();
 });

 it("cold-starts after execution expiry but keeps lab routes expired",async()=>{
  const expired={...source,PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT:String(Date.now()-1)};
  const server=createServer(createLabFcmCloudRunApp({source:expired}));await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{const address=server.address();if(!address||typeof address==="string")throw new Error("missing address");const origin=`http://127.0.0.1:${address.port}`;
   const health=await fetch(origin+"/health");expect(health.status).toBe(200);expect(await health.json()).toMatchObject({ok:true,build:commit});
   const headers={"x-phone11-lab-secret":source.PHONE11_LAB_FCM_TRIGGER_SECRET!,"x-phone11-execution-id":executionId};
   const attestation=await fetch(origin+"/api/phone11/lab/wake-evidence",{headers});expect(attestation.status).toBe(503);expect(await attestation.json()).toEqual({error:"Lab staging service unavailable"});
   const scenario=await fetch(origin+"/api/phone11/lab/fcm-scenario",{method:"POST",headers:{...headers,"content-type":"application/json"},body:"{}"});expect(scenario.status).toBe(503);expect(await scenario.json()).toEqual({error:"Lab staging service unavailable"});
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });

 it("exposes only health and the bounded private lab paths",async()=>{
  const service={attestation:vi.fn(async()=>({environment:"staging"})),trigger:vi.fn(),evidence:vi.fn(),runnerLease:vi.fn(async()=>null),runnerComplete:vi.fn()} as any;
  const server=createServer(createLabFcmCloudRunApp({source,now,service}));await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{const address=server.address();if(!address||typeof address==="string")throw new Error("missing address");const origin=`http://127.0.0.1:${address.port}`;
   const health=await fetch(origin+"/health");expect(health.status).toBe(200);expect(await health.json()).toEqual({ok:true,service:"phone11-fcm-staging-lab",environment:"staging",projectId:"phone11-stage-20260914",build:commit});
   for(const route of ["/api/health","/api/trpc","/api/phone11/wake/offer","/api/recordings","/v1/phone11/real-sip-scenario"]){const response=await fetch(origin+route);expect(response.status,route).toBe(404);}
   const lab=await fetch(origin+"/api/phone11/lab/wake-evidence");expect(lab.status).toBe(200);expect(service.attestation).toHaveBeenCalledOnce();
   const lease=await fetch(origin+"/api/phone11/lab/sip-driver/lease");expect(lease.status).toBe(204);expect(service.runnerLease).toHaveBeenCalledOnce();
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });

 it("builds only the minimal entrypoint and keeps deployment private, immutable and project-locked",()=>{
  const root=path.resolve(__dirname,"..");const docker=readFileSync(path.join(root,"infra/cloud-run/phone11-fcm-staging/Dockerfile"),"utf8"),deploy=readFileSync(path.join(root,"infra/cloud-run/phone11-fcm-staging/deploy.sh"),"utf8");
  expect(docker).toContain("server/lab-fcm-cloud-run.ts");expect(docker).not.toContain("server/_core/index.ts");expect(docker).toContain('CMD ["node","dist/lab-fcm-cloud-run.mjs"]');
  expect(deploy).toContain('EXPECTED_PROJECT="phone11-stage-20260914"');expect(deploy).toContain("@sha256:");expect(deploy).toContain("--no-allow-unauthenticated");expect(deploy).toContain("--set-secrets=");
  expect(deploy).toContain('--add-cloudsql-instances="$EXPECTED_CLOUDSQL_INSTANCE"');expect(deploy).toContain("PHONE11_CLOUDSQL_IAM_DB_AUTH=1");
  expect(deploy).not.toContain("DATABASE_URL=phone11-stage-database-url");
  expect(deploy).toContain("PHONE11_LAB_SIP_DRIVER_TRANSPORT=reverse_pull");expect(deploy).toContain("public SIP-driver origins are forbidden");
  expect(deploy).toContain("phone11-sip-runner@phone11-stage-20260914.iam.gserviceaccount.com");expect(deploy).toContain("roles/run.invoker");expect(deploy).toContain("--managed-by=user");
  expect(deploy).not.toContain("--allow-unauthenticated");expect(deploy).not.toMatch(/gcloud projects create|gcloud services enable/);
 });

 it("refuses a project other than the isolated Phone11 staging project before using gcloud",()=>{
  const script=path.resolve(__dirname,"../infra/cloud-run/phone11-fcm-staging/deploy.sh");
  const result=spawnSync("sh",[script],{encoding:"utf8",env:{...process.env,PHONE11_LAB_CLOUDRUN_PROJECT:"phone11-production"}});
  expect(result.status).toBe(2);expect(result.stderr).toContain("exact project is required");expect(result.stdout).toBe("");
 });
});
