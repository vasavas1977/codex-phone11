import express,{type Express,type NextFunction,type Request,type Response} from "express";
import {z} from "zod";
import {integrationSecretStatus} from "../pbx/integration-auth";
import {wakeRepository} from "./wake-repository";

const identity={packageName:"ai.phone11.mobile.staging",projectId:"phone11-stage-20260914",
  senderId:"413228367517",appId:"1:413228367517:android:f41353883923fc15911e74"} as const;
const cases=["PUSH-01","PUSH-02","PUSH-03","PUSH-04","PUSH-05","PUSH-06","PUSH-07","PUSH-08","PUSH-09","LIFE-04","LIFE-05","PERM-02","PERM-03"] as const;
type CaseId=typeof cases[number];
const caseSet=new Set<string>(cases);
const requirements:Record<CaseId,string[]>={
  "PUSH-01":["app_background","pending_created","fcm_provider_accepted","fcm_data_envelope","native_push_received","wake_owner_verified","notification_posted","notification_actions_verified","sip_invite_delivered","answer_action_accepted","call_connected","call_terminated","history_reconciled"],
  "PUSH-02":["device_locked","pending_created","fcm_provider_accepted","fcm_data_envelope","native_push_received","wake_owner_verified","notification_posted","notification_actions_verified","sip_invite_delivered","answer_action_accepted","call_connected","call_terminated","history_reconciled"],
  "PUSH-03":["device_doze_idle","pending_created","fcm_provider_accepted","fcm_data_envelope","native_push_received","wake_owner_verified","notification_posted","notification_actions_verified","sip_invite_delivered","answer_action_accepted","call_connected","call_terminated","history_reconciled"],
  "PUSH-04":["fcm_provider_accepted","duplicate_delivery","one_native_call","one_notification","one_history_entry"],
  "PUSH-05":["fcm_provider_accepted","native_push_received","server_cancelled","notification_cleared","no_ghost_call"],
  "PUSH-06":["wake_expired","no_notification","no_ghost_call"],
  "PUSH-07":["token_rotated_register_first","old_binding_rejected","new_binding_received"],
  "PUSH-08":["owner_changed","wake_owner_rejected","no_sensitive_history"],
  "PUSH-09":["provider_unavailable","bounded_expiry","no_late_call"],
  "LIFE-04":["process_absent","package_not_force_stopped","process_started","pending_created","fcm_provider_accepted","fcm_data_envelope","native_push_received","wake_owner_verified","notification_posted","notification_actions_verified","sip_invite_delivered","answer_action_accepted","call_connected","call_terminated","history_reconciled"],
  "LIFE-05":["package_force_stopped","fcm_provider_accepted","no_push_delivery","explicit_relaunch","enrollment_restored"],
  "PERM-02":["notifications_denied","fcm_provider_accepted","native_push_received","permission_fallback_observed","no_forced_permission_change"],
  "PERM-03":["full_screen_denied","fcm_provider_accepted","native_push_received","notification_posted","notification_actions_verified","notification_fallback_observed","no_background_activity_start"],
};
const uuid=z.string().uuid(),hex40=z.string().regex(/^[a-f0-9]{40}$/i),hex64=z.string().regex(/^[a-f0-9]{64}$/i);
const triggerSchema=z.object({v:z.literal(1),executionId:uuid,testId:z.enum(cases),correlationId:uuid,apkSha256:hex64}).strict();
const driverReceiptSchema=z.object({accepted:z.literal(true),source:z.literal("real_sip_driver"),executionId:uuid,testId:z.enum(cases),correlationId:uuid,
  sipCallIdHash:hex64,pbxChannelHash:hex64,startedAtMs:z.number().int().positive()}).strict();
const evidenceEventSchema=z.object({event:z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),timestampMs:z.number().int().positive(),correlationId:uuid,
  source:z.enum(["backend","fcm_v1","android_native","android_system","sip_driver","sip_proxy","pbx"]),keys:z.array(z.enum(["bindingId","callUUID","expiresAt","v"])).max(4).optional(),
  messageNameHash:hex64.optional(),sipCallIdHash:hex64.optional(),pbxChannelHash:hex64.optional(),transport:z.literal("FCM_V1").optional(),code:z.number().int().min(-999).max(999).optional(),count:z.number().int().min(0).max(1000).optional()}).strict();
const driverEvidenceSchema=z.object({source:z.literal("real_fcm_v1"),executionId:uuid,testId:z.enum(cases),correlationId:uuid,events:z.array(evidenceEventSchema).min(1).max(128)}).strict();

export class LabFcmError extends Error{constructor(public readonly status:number,message="Lab staging service unavailable"){super(message);}}
export type LabFcmConfig={executionId:string;expiresAt:number;apkSha256:string;sourceCommit:string;bindingId:string;pilotSipUri:string;allowed:Set<string>;publicOrigin:string;driverOrigin:string};
const stage=/(^|[.-])(staging|stage|sandbox|nonprod)([.-]|$)/i;
const placeholder=/(example|placeholder|changeme|replace[-_]?me|your[-_]|dummy|sample)/i;
const secret=(value:unknown)=>typeof value==="string"&&value.length>=32&&value.length<=512&&!placeholder.test(value);
function stagingOrigin(value:unknown){try{const url=new URL(String(value));if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash||!stage.test(url.hostname)||placeholder.test(url.hostname))throw new Error();return url.origin;}catch{throw new LabFcmError(503);}}
function stagingSip(value:unknown){const match=/^sip:[A-Za-z0-9_.+-]{1,128}@([A-Za-z0-9.-]{1,253})$/.exec(String(value));if(!match||!stage.test(match[1])||placeholder.test(match[1]))throw new LabFcmError(503);return String(value);}

export function readLabFcmConfig(source:NodeJS.ProcessEnv=process.env,now=Date.now()):LabFcmConfig{
 if(source.PHONE11_LAB_FCM_SCENARIO_ENABLED!=="1"||source.PHONE11_LAB_FCM_ENVIRONMENT!=="staging")throw new LabFcmError(404,"Lab route unavailable");
 const expiresAt=Number(source.PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT),allowed=new Set((source.PHONE11_LAB_FCM_CASES??"").split(",").filter(Boolean));
 const app=/^1:(\d{6,20}):android:[a-f0-9]{16,64}$/i.exec(source.PHONE11_LAB_FCM_APP_ID??"");
 if(source.PHONE11_LAB_FCM_PACKAGE!==identity.packageName||source.PHONE11_LAB_FCM_PROJECT_ID!==identity.projectId||source.FCM_PROJECT_ID!==identity.projectId||
  source.PHONE11_LAB_FCM_SENDER_ID!==identity.senderId||source.PHONE11_LAB_FCM_APP_ID!==identity.appId||app?.[1]!==identity.senderId||
  !uuid.safeParse(source.PHONE11_LAB_FCM_EXECUTION_ID).success||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+3_600_000||
  !hex64.safeParse(source.PHONE11_LAB_FCM_APK_SHA256).success||!hex40.safeParse(source.PHONE11_BUILD_SHA).success||
  !uuid.safeParse(source.PHONE11_LAB_FCM_BINDING_ID).success||source.PHONE11_WAKE_ENABLED!=="1"||
  allowed.size<1||[...allowed].some(value=>!caseSet.has(value))||!secret(source.PHONE11_LAB_FCM_TRIGGER_SECRET)||!secret(source.PHONE11_LAB_SIP_DRIVER_SECRET))throw new LabFcmError(503);
 return {executionId:source.PHONE11_LAB_FCM_EXECUTION_ID!,expiresAt,apkSha256:source.PHONE11_LAB_FCM_APK_SHA256!.toLowerCase(),sourceCommit:source.PHONE11_BUILD_SHA!.toLowerCase(),
  bindingId:source.PHONE11_LAB_FCM_BINDING_ID!,pilotSipUri:stagingSip(source.PHONE11_WAKE_PILOT_SIP_URI),allowed,
  publicOrigin:stagingOrigin(source.PHONE11_LAB_FCM_PUBLIC_ORIGIN),driverOrigin:stagingOrigin(source.PHONE11_LAB_SIP_DRIVER_ORIGIN)};
}

type SafeReadiness={bindingId:string;bindingExpiresAt:number;platform:"ios"|"android";tokenType:"voip"|"fcm";packageName:string};
type Driver={start:(input:{executionId:string;testId:CaseId;correlationId:string;targetSipUri:string})=>Promise<unknown>;evidence:(input:{executionId:string;testId:CaseId;correlationId:string})=>Promise<unknown>};
const bounded=async<T>(run:(signal:AbortSignal)=>Promise<T>)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{return await run(controller.signal);}catch{throw new LabFcmError(503);}finally{clearTimeout(timer);}};
const json=async(response:globalThis.Response)=>{if(!response.ok)throw new LabFcmError(503);try{return await response.json();}catch{throw new LabFcmError(503);}};
function httpDriver(config:LabFcmConfig):Driver{
 const headers=()=>({"content-type":"application/json","x-phone11-lab-driver-secret":process.env.PHONE11_LAB_SIP_DRIVER_SECRET!,"x-phone11-execution-id":config.executionId});
 const call=(pathname:string,init:RequestInit)=>bounded(signal=>fetch(config.driverOrigin+pathname,{...init,headers:{...headers(),...init.headers},signal}).then(json));
 return {start:input=>call("/v1/phone11/real-sip-scenario",{method:"POST",body:JSON.stringify({v:1,...input})}),
  evidence:input=>call(`/v1/phone11/real-sip-evidence?${new URLSearchParams(input)}`,{method:"GET"})};
}
async function providerProject():Promise<{projectId:string;serviceAccount:boolean}>{
 try{const {GoogleAuth}=await import("google-auth-library");const auth=new GoogleAuth({scopes:["https://www.googleapis.com/auth/firebase.messaging"]});
  const [projectId,credentials]=await bounded(()=>Promise.all([auth.getProjectId(),auth.getCredentials()]));
  return {projectId,serviceAccount:typeof credentials.client_email==="string"&&credentials.client_email.endsWith(".iam.gserviceaccount.com")};
 }catch{return {projectId:"",serviceAccount:false};}
}
type Dependencies={source?:()=>NodeJS.ProcessEnv;now?:()=>number;readiness?:(bindingId:string,sipUri:string)=>Promise<SafeReadiness|null>;provider?:()=>Promise<{projectId:string;serviceAccount:boolean}>;driver?:(config:LabFcmConfig)=>Driver;secretStatus?:(name:string,value:unknown)=>"ok"|"unavailable"|"forbidden"};
type Receipt=z.infer<typeof driverReceiptSchema>;
type Ledger={executionId:string;testId:CaseId;receipt:Receipt};

export function createLabFcmService(deps:Dependencies={}){
 const source=deps.source??(()=>process.env),now=deps.now??Date.now,readiness=deps.readiness??((binding,sip)=>wakeRepository.labReadiness(binding,sip));
 const provider=deps.provider??providerProject,driverFactory=deps.driver??httpDriver,secretStatus=deps.secretStatus??integrationSecretStatus;
 const ledger=new Map<string,Ledger>(),inflight=new Map<string,{executionId:string;testId:CaseId;promise:Promise<Receipt>}>();
 const config=()=>readLabFcmConfig(source(),now());
 const authorize=(headers:Request["headers"])=>{const value=config();const auth=secretStatus("PHONE11_LAB_FCM_TRIGGER_SECRET",headers["x-phone11-lab-secret"]);
  if(auth==="unavailable")throw new LabFcmError(503);if(auth!=="ok")throw new LabFcmError(403,"Forbidden");
  if(headers["x-phone11-execution-id"]!==value.executionId)throw new LabFcmError(403,"Forbidden");return value;};
 const prune=(cutoff:number)=>{for(const [key,value]of ledger)if(value.receipt.startedAtMs<cutoff)ledger.delete(key);};
 return {
  async attestation(headers:Request["headers"]){const value=authorize(headers),[enrollment,credentials]=await Promise.all([readiness(value.bindingId,value.pilotSipUri),provider()]);
   if(!enrollment||enrollment.bindingId!==value.bindingId||enrollment.bindingExpiresAt<=now()||enrollment.platform!=="android"||enrollment.tokenType!=="fcm"||enrollment.packageName!==identity.packageName||credentials.projectId!==identity.projectId||!credentials.serviceAccount)throw new LabFcmError(503);
   return {v:1 as const,environment:"staging" as const,packageName:identity.packageName,projectId:identity.projectId,senderId:identity.senderId,firebaseAppId:identity.appId,backendCommit:value.sourceCommit,
    provider:{transport:"FCM_V1" as const,credentialProjectId:identity.projectId,ready:true as const},enrollment:{packageName:identity.packageName,tokenType:"fcm" as const,platform:"android" as const,registered:true as const,bindingId:enrollment.bindingId,bindingExpiresAt:enrollment.bindingExpiresAt}};
  },
  async trigger(headers:Request["headers"],input:unknown){const value=authorize(headers),parsed=triggerSchema.safeParse(input);if(!parsed.success)throw new LabFcmError(400,"Invalid lab request");
   const request=parsed.data;if(request.executionId!==value.executionId||request.apkSha256.toLowerCase()!==value.apkSha256||!value.allowed.has(request.testId))throw new LabFcmError(403,"Forbidden");
   prune(now()-3_600_000);const existing=ledger.get(request.correlationId);if(existing){if(existing.executionId!==request.executionId||existing.testId!==request.testId)throw new LabFcmError(409,"Scenario conflict");return {accepted:true as const,testId:request.testId,correlationId:request.correlationId};}
   const pending=inflight.get(request.correlationId);if(pending){if(pending.executionId!==request.executionId||pending.testId!==request.testId)throw new LabFcmError(409,"Scenario conflict");await pending.promise;return {accepted:true as const,testId:request.testId,correlationId:request.correlationId};}
   const started=driverFactory(value).start({executionId:request.executionId,testId:request.testId,correlationId:request.correlationId,targetSipUri:value.pilotSipUri}).then(result=>{
    const receipt=driverReceiptSchema.safeParse(result);if(!receipt.success||receipt.data.executionId!==request.executionId||receipt.data.testId!==request.testId||receipt.data.correlationId!==request.correlationId||Math.abs(receipt.data.startedAtMs-now())>60_000)throw new LabFcmError(503);
    ledger.set(request.correlationId,{executionId:request.executionId,testId:request.testId,receipt:receipt.data});return receipt.data;});
   inflight.set(request.correlationId,{executionId:request.executionId,testId:request.testId,promise:started});try{await started;}finally{inflight.delete(request.correlationId);}
   return {accepted:true as const,testId:request.testId,correlationId:request.correlationId};
  },
  async evidence(headers:Request["headers"],query:unknown){const value=authorize(headers),parsed=z.object({executionId:uuid,testId:z.enum(cases),correlationId:uuid}).strict().safeParse(query);if(!parsed.success)throw new LabFcmError(400,"Invalid lab request");
   const request=parsed.data,entry=ledger.get(request.correlationId);if(request.executionId!==value.executionId||!value.allowed.has(request.testId))throw new LabFcmError(403,"Forbidden");
   if(!entry||entry.executionId!==request.executionId||entry.testId!==request.testId)throw new LabFcmError(404,"Evidence unavailable");
   const observed=driverEvidenceSchema.safeParse(await driverFactory(value).evidence(request));if(!observed.success||observed.data.executionId!==request.executionId||observed.data.testId!==request.testId||observed.data.correlationId!==request.correlationId)throw new LabFcmError(503);
   if(observed.data.events.some(event=>event.correlationId!==request.correlationId||event.timestampMs<entry.receipt.startedAtMs-60_000||event.timestampMs>now()+60_000))throw new LabFcmError(503);
   const names=new Set(observed.data.events.map(event=>event.event));for(const expected of [...requirements[request.testId],"cleanup_completed","real_sip_scenario_started"])if(!names.has(expected))throw new LabFcmError(503);
   const sip=observed.data.events.find(event=>event.event==="real_sip_scenario_started");if(sip?.source!=="sip_driver"||sip.sipCallIdHash!==entry.receipt.sipCallIdHash||sip.pbxChannelHash!==entry.receipt.pbxChannelHash)throw new LabFcmError(503);
   if(observed.data.events.some(event=>event.event==="sip_invite_delivered"&&(!["sip_proxy","pbx"].includes(event.source)||event.sipCallIdHash!==entry.receipt.sipCallIdHash)))throw new LabFcmError(503);
   const envelope=observed.data.events.find(event=>event.event==="fcm_data_envelope");if(envelope&&JSON.stringify([...(envelope.keys??[])].sort())!==JSON.stringify(["bindingId","callUUID","expiresAt","v"]))throw new LabFcmError(503);
   const accepted=observed.data.events.find(event=>event.event==="fcm_provider_accepted");if(accepted&&(!accepted.messageNameHash||accepted.transport!=="FCM_V1"))throw new LabFcmError(503);
   return {source:"real_fcm_v1" as const,simulated:false as const,localBroadcast:false as const,testId:request.testId,executionId:request.executionId,correlationId:request.correlationId,
    apkSha256:value.apkSha256,packageName:identity.packageName,projectId:identity.projectId,senderId:identity.senderId,events:observed.data.events};
  },
 };
}
export const labFcmService=createLabFcmService();

export function registerLabFcmRoutes(app:Express,service:ReturnType<typeof createLabFcmService>=labFcmService){
 const base="/api/phone11/lab";app.use(base,(_req:Request,res:Response,next:NextFunction)=>{res.setHeader("Cache-Control","no-store");next();},express.json({limit:"8kb"}),
  (error:unknown,_req:Request,res:Response,_next:NextFunction)=>res.status((error as {status?:number})?.status===413?413:400).json({error:"Invalid lab request"}));
 const failure=(res:Response,error:unknown)=>{const status=error instanceof LabFcmError?error.status:503;const message=status===403?"Forbidden":status===404?error instanceof LabFcmError?error.message:"Lab route unavailable":status===400?"Invalid lab request":status===409?"Scenario conflict":"Lab staging service unavailable";res.status(status).json({error:message});};
 app.get(`${base}/wake-evidence`,async(req,res)=>{try{if(Object.keys(req.query).length===0)res.json(await service.attestation(req.headers));else res.json(await service.evidence(req.headers,req.query));}catch(error){failure(res,error);}});
 app.post(`${base}/fcm-scenario`,async(req,res)=>{try{res.status(202).json(await service.trigger(req.headers,req.body));}catch(error){failure(res,error);}});
}
