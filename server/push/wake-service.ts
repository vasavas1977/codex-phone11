import { z } from "zod";
import { wakeRepository, WakeError, type WakeCall } from "./wake-repository";
import { pushRepository } from "./repository";
import { sendApnsPush } from "./apns";

export const wakeIdentitySchema=z.object({bindingId:z.string().uuid()}).strict();
export const wakeEnrollSchema=z.object({deviceId:z.string().min(1).max(512),platform:z.literal("ios")}).strict();
export const wakeDeviceCallSchema=z.object({bindingId:z.string().uuid(),callUUID:z.string().uuid()}).strict();
export const wakeOfferSchema=z.object({sipUri:z.string().regex(/^sip:[A-Za-z0-9_.+-]{1,128}@[A-Za-z0-9.-]{1,253}$/),
  sipCallId:z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/)}).strict();
export const wakeTerminalSchema=wakeOfferSchema.extend({status:z.enum(["cancelled","ended"])}).strict();

export function wakePilot(): string {
  const uri=process.env.PHONE11_WAKE_PILOT_SIP_URI;
  if (process.env.PHONE11_WAKE_ENABLED!=="1" || !uri || !wakeOfferSchema.shape.sipUri.safeParse(uri).success) {
    throw new WakeError(503,"Background incoming calls are not enabled");
  }
  return uri;
}
async function notify(call: WakeCall, deadline:number, signal:AbortSignal) {
  const check=()=>{if(signal.aborted || Date.now()>=deadline) throw new WakeError(410);};
  check();
  const target=await wakeRepository.deliveryTarget(call.callUUID);
  check();
  const candidates=(await pushRepository.list(target.sipUri)).filter(t=>t.revision===target.revision);
  check();
  if(candidates.length!==1) throw new WakeError(410);
  const token=candidates[0];
  try {
    await sendApnsPush(token,{callId:call.callUUID,callerNumber:"",wake:{v:1,callUUID:call.callUUID,bindingId:call.bindingId,expiresAt:call.expiresAt}},async()=>{
    check();
    const current=await wakeRepository.current(call.callUUID);
    check();
    if(!current || current.status!=="pending")return false;
    const valid=await pushRepository.isCurrent(token);
    check();
    return valid;
    },Math.min(call.expiresAt,deadline));
    check();
    await pushRepository.markUsed(token);
  } catch(error) {
    const invalid=error as {invalidToken?:boolean;invalidatedAt?:number};
    if(!signal.aborted && Date.now()<deadline && invalid?.invalidToken===true
      && (invalid.invalidatedAt===undefined || token.registeredAt<=invalid.invalidatedAt)) {
      // A response for an old revision must never remove a refreshed device.
      try { await pushRepository.removeInvalid(token); } catch { /* Original provider failure remains authoritative. */ }
    }
    throw error;
  }
}
export function createWakeService(deps: {
  repository?: typeof wakeRepository; notify?: (call:WakeCall,deadline:number,signal:AbortSignal)=>Promise<void>; pilot?: ()=>string;
  sleep?: (ms:number)=>Promise<void>; now?: ()=>number;
}={}) {
  const repository=deps.repository??wakeRepository,send=deps.notify??notify,pilot=deps.pilot??wakePilot;
  const sleep=deps.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms))),now=deps.now??Date.now;
  const requireTarget=(uri:string)=>{if(uri!==pilot()) throw new WakeError(403);};
  const bounded=<T>(deadline:number,run:()=>Promise<T>,signal?:AbortSignal):Promise<T>=>new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error?:unknown,value?:T)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);
      if(error)reject(error);else resolve(value as T);
    };
    const abort=()=>finish(new WakeError(410));
    const timer=setTimeout(abort,Math.max(0,deadline-now()));
    signal?.addEventListener("abort",abort,{once:true});
    if(signal?.aborted || now()>=deadline){abort();return;}
    Promise.resolve().then(()=>{
      if(signal?.aborted || now()>=deadline)throw new WakeError(410);
      return run();
    }).then(value=>{
      if(signal?.aborted || now()>=deadline)abort();else finish(undefined,value);
    },error=>finish(error));
  });
  return {
    enroll(sessionId:string,userId:number,input:z.infer<typeof wakeEnrollSchema>) {
      return repository.enroll(sessionId,userId,input.deviceId,pilot());
    },
    resolve(sessionId:string,userId:number,bindingId:string) {pilot();return repository.resolve(bindingId,sessionId,userId);},
    revoke(sessionId:string,userId:number,bindingId:string) {return repository.revoke(bindingId,sessionId,userId);},
    device(action:"claim"|"ready"|"status"|"end",grant:string,input:z.infer<typeof wakeDeviceCallSchema>) {
      pilot();return repository.deviceCall(input.bindingId,grant,input.callUUID,action);
    },
    terminal(input:z.infer<typeof wakeTerminalSchema>) {requireTarget(input.sipUri);return repository.transitionTrusted(input.sipUri,input.sipCallId,input.status);},
    /** Proxy holds the original SIP transaction while this bounded request waits for registration. */
    async offer(input:z.infer<typeof wakeOfferSchema>,signal?:AbortSignal) {
      requireTarget(input.sipUri);
      if(signal?.aborted)throw new WakeError(410);
      const deadline=now()+25_000;
      const submission=new AbortController();
      const abortSubmission=()=>submission.abort();
      signal?.addEventListener("abort",abortSubmission,{once:true});
      const cancel=()=>repository.transitionTrusted(input.sipUri,input.sipCallId,"cancelled");
      let abandoned=false;
      const offered=repository.offer(input.sipUri,input.sipCallId);
      // A database operation may finish after its HTTP budget; it must never cause a later push.
      void offered.then(result=>{if(abandoned && result.created)void cancel().catch(()=>{});},()=>{});
      let pending:Awaited<typeof offered>|undefined;
      try {
        pending=await bounded(deadline,()=>offered,signal);
        if(signal?.aborted) throw new WakeError(410);
        if(pending.created) {
          const submissionDeadline=Math.min(deadline,now()+5000);
          await bounded(submissionDeadline,()=>send(pending!.call,submissionDeadline,submission.signal),signal);
        }
        while(now()<deadline && !signal?.aborted) {
          const current=await bounded(deadline,()=>repository.current(pending!.call.callUUID),signal);
          if(current?.status==="ready") return {v:1 as const,callUUID:current.callUUID,status:"ready" as const};
          if(!current || current.status!=="pending") throw new WakeError(410);
          await bounded(deadline,()=>sleep(Math.min(500,deadline-now())),signal);
        }
        throw new WakeError(410);
      } catch(error) {
        abandoned=true;
        submission.abort();
        if(pending?.created) {try{await bounded(now()+3000,cancel);}catch{/* Native call TTL still bounds an unavailable backend. */}}
        throw error instanceof WakeError ? error : new WakeError(503);
      } finally {
        signal?.removeEventListener("abort",abortSubmission);
        submission.abort();
      }
    },
  };
}
export const wakeService=createWakeService();
