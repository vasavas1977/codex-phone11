import {randomUUID} from "node:crypto";
import {z} from "zod";

const uuid=z.string().uuid(),hex64=z.string().regex(/^[a-f0-9]{64}$/i);
const receiptSchema=z.object({accepted:z.literal(true),source:z.literal("real_sip_driver"),executionId:uuid,testId:z.string().min(1).max(32),correlationId:uuid,
  sipCallIdHash:hex64,pbxChannelHash:hex64,startedAtMs:z.number().int().positive()}).strict();
const eventSchema=z.object({event:z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),timestampMs:z.number().int().positive(),correlationId:uuid,
  source:z.enum(["backend","fcm_v1","android_native","android_system","sip_driver","sip_proxy","pbx"]),keys:z.array(z.enum(["bindingId","callUUID","expiresAt","v"])).max(4).optional(),
  messageNameHash:hex64.optional(),sipCallIdHash:hex64.optional(),pbxChannelHash:hex64.optional(),transport:z.literal("FCM_V1").optional(),code:z.number().int().min(-999).max(999).optional(),count:z.number().int().min(0).max(1000).optional()}).strict();
const evidenceSchema=z.object({source:z.literal("real_fcm_v1"),executionId:uuid,testId:z.string().min(1).max(32),correlationId:uuid,events:z.array(eventSchema).min(1).max(128)}).strict();
const completionSchema=z.object({v:z.literal(1),leaseId:uuid,operation:z.enum(["start","evidence"]),executionId:uuid,testId:z.string().min(1).max(32),correlationId:uuid,result:z.unknown()}).strict();

export type ReversePullConfig={executionId:string;expiresAt:number;allowed:Set<string>;pilotSipUri:string};
export type SipDriverInput={executionId:string;testId:string;correlationId:string;targetSipUri:string};
type EvidenceInput=Omit<SipDriverInput,"targetSipUri">;
export type ReversePullLease={v:1;leaseId:string;operation:"start"|"evidence";executionId:string;testId:string;correlationId:string;targetSipUri?:string;leaseExpiresAt:number};
type Deferred={resolve:(value:unknown)=>void;reject:(error:unknown)=>void;promise:Promise<unknown>};
type Job={lease:ReversePullLease;input:SipDriverInput|EvidenceInput;deferred:Deferred;timer:ReturnType<typeof setTimeout>;leased:boolean};
type Record={input:SipDriverInput;receipt?:unknown;evidence?:unknown;updatedAt:number};

export class ReversePullError extends Error{constructor(public readonly status=503){super("Reverse-pull SIP driver unavailable");}}

function deferred():Deferred{let resolve!:(value:unknown)=>void,reject!:(error:unknown)=>void;const promise=new Promise<unknown>((ok,no)=>{resolve=ok;reject=no;});return {resolve,reject,promise};}
function same(left:EvidenceInput,right:EvidenceInput){return left.executionId===right.executionId&&left.testId===right.testId&&left.correlationId===right.correlationId;}

/** One process-local broker for one max-one-instance, one-hour staging execution. */
export function createLabSipReversePullBroker({now=Date.now,runnerFreshMs=2_000,operationMs=5_000,ownerMs=30_000,id=randomUUID}:{now?:()=>number;runnerFreshMs?:number;operationMs?:number;ownerMs?:number;id?:()=>string}={}){
 const records=new Map<string,Record>();let active:Job|undefined,owner:string|undefined,runnerSeenAt=Number.NEGATIVE_INFINITY;
 const verify=(config:ReversePullConfig,input:EvidenceInput)=>{if(input.executionId!==config.executionId||!config.allowed.has(input.testId))throw new ReversePullError(403);};
 const prune=(config:ReversePullConfig)=>{const clock=now();if(active&&active.lease.leaseExpiresAt<=clock){clearTimeout(active.timer);active.deferred.reject(new ReversePullError());if(active.lease.operation==="start"){records.delete(active.lease.correlationId);owner=undefined;}active=undefined;}
  if(owner){const record=records.get(owner);if(!record||record.updatedAt+ownerMs<=clock||config.expiresAt<=clock){records.delete(owner);owner=undefined;}}};
 const queue=(config:ReversePullConfig,operation:"start"|"evidence",input:SipDriverInput|EvidenceInput)=>{
  prune(config);if(active)throw new ReversePullError(409);const pending=deferred(),leaseExpiresAt=Math.min(config.expiresAt,now()+operationMs);
  const lease:ReversePullLease={v:1,leaseId:id(),operation,executionId:input.executionId,testId:input.testId,correlationId:input.correlationId,leaseExpiresAt,
    ...(operation==="start"?{targetSipUri:(input as SipDriverInput).targetSipUri}:{})};
  const timer=setTimeout(()=>{if(active?.lease.leaseId!==lease.leaseId)return;active=undefined;if(operation==="start"){records.delete(input.correlationId);owner=undefined;}pending.reject(new ReversePullError());},Math.max(1,leaseExpiresAt-now()));
  active={lease,input,deferred:pending,timer,leased:false};return pending.promise;
 };
 return {
  driver(config:ReversePullConfig){return {
   async start(input:SipDriverInput){verify(config,input);prune(config);const record=records.get(input.correlationId);
    if(owner&&owner!==input.correlationId)throw new ReversePullError(409);if(record){if(!same(record.input,input))throw new ReversePullError(409);if(record.receipt)return record.receipt;}
    if(now()-runnerSeenAt>runnerFreshMs)throw new ReversePullError();owner=input.correlationId;records.set(input.correlationId,{input:{...input},updatedAt:now()});return queue(config,"start",input);},
   async evidence(input:EvidenceInput){verify(config,input);prune(config);const record=records.get(input.correlationId);if(owner!==input.correlationId||!record||!same(record.input,input)||!record.receipt)throw new ReversePullError(404);if(record.evidence)return record.evidence;
    if(now()-runnerSeenAt>runnerFreshMs)throw new ReversePullError();return queue(config,"evidence",input);},
  };},
  lease(config:ReversePullConfig):ReversePullLease|null{prune(config);runnerSeenAt=now();if(!active||active.leased)return null;active.leased=true;return structuredClone(active.lease);},
  complete(config:ReversePullConfig,value:unknown){prune(config);const parsed=completionSchema.safeParse(value);if(!parsed.success)throw new ReversePullError(400);const item=parsed.data,job=active;
   if(!job||!job.leased||job.lease.leaseId!==item.leaseId||job.lease.operation!==item.operation||!same(job.input,item)||item.executionId!==config.executionId)throw new ReversePullError(403);
   let result;if(item.operation==="start"){const checked=receiptSchema.safeParse(item.result);if(!checked.success||!same(checked.data,item)||Math.abs(checked.data.startedAtMs-now())>60_000)throw new ReversePullError(400);result=checked.data;const record=records.get(item.correlationId);if(!record)throw new ReversePullError();record.receipt=result;record.updatedAt=now();}
   else{const checked=evidenceSchema.safeParse(item.result);if(!checked.success||!same(checked.data,item)||checked.data.events.some(event=>event.correlationId!==item.correlationId))throw new ReversePullError(400);result=checked.data;const record=records.get(item.correlationId);if(!record?.receipt)throw new ReversePullError();record.updatedAt=now();if(checked.data.events.some(event=>event.event==="cleanup_completed")){record.evidence=result;owner=undefined;}}
   clearTimeout(job.timer);active=undefined;job.deferred.resolve(result);return {accepted:true as const,operation:item.operation};
  },
 };
}
