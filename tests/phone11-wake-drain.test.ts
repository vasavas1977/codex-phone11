import {afterEach,describe,expect,it,vi} from "vitest";
import {createWakeService} from "../server/push/wake-service";
import {wakeRepository,type WakeCall} from "../server/push/wake-repository";
import {pushRepository} from "../server/push/repository";
const apns=vi.hoisted(()=>({send:vi.fn(async()=>{})}));
vi.mock("../server/push/apns",()=>({sendApnsPush:apns.send}));
const input={sipUri:"sip:3001@pilot.invalid",sipCallId:"owned-drain-dialog"};
const call:WakeCall={v:1,callUUID:"33333333-3333-4333-8333-333333333333",bindingId:"11111111-1111-4111-8111-111111111111",expiresAt:30000,status:"pending"};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(defaultNotify=false){
 const repository={offer:vi.fn(async()=>({call,created:true})),current:vi.fn(async()=>({...call,status:"ready" as const})),transitionTrusted:vi.fn(async()=>{}),enroll:vi.fn(async()=>{}),resolve:vi.fn(async()=>{}),revoke:vi.fn(async()=>{}),deviceCall:vi.fn(async()=>{})};
 const notify=vi.fn(async()=>{});
 const service=createWakeService({repository:repository as unknown as typeof wakeRepository,...(defaultNotify?{}:{notify}),pilot:()=>input.sipUri});return {repository,notify,service};
}
function provider(){
 const h=harness(true),token={revision:"owned-revision",registeredAt:0};
 vi.spyOn(wakeRepository,"deliveryTarget").mockResolvedValue({sipUri:input.sipUri,revision:token.revision} as never);
 vi.spyOn(wakeRepository,"current").mockResolvedValue(call);
 vi.spyOn(pushRepository,"list").mockResolvedValue([token] as never);
 vi.spyOn(pushRepository,"isCurrent").mockResolvedValue(true);
 const mark=vi.spyOn(pushRepository,"markUsed").mockResolvedValue(),remove=vi.spyOn(pushRepository,"removeInvalid").mockResolvedValue();return {...h,mark,remove};
}
async function turn(){await vi.advanceTimersByTimeAsync(0);}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();apns.send.mockReset();apns.send.mockResolvedValue();});
describe("owned wake shutdown",()=>{
 it("holds drain through late offer resolution and its cancellation without sending",async()=>{
  vi.useFakeTimers();const h=harness(),offer=deferred<any>(),cancel=deferred<void>();h.repository.offer.mockReturnValue(offer.promise);h.repository.transitionTrusted.mockReturnValue(cancel.promise);
  const request=h.service.offer(input).catch(e=>e);await turn();let done=false;const close=h.service.close();expect(h.service.close()).toBe(close);const drained=close.then(()=>{done=true;});await turn();expect(await request).toMatchObject({status:410});expect(done).toBe(false);
  offer.resolve({call,created:true});await turn();expect(h.repository.transitionTrusted).toHaveBeenCalledOnce();expect(h.notify).not.toHaveBeenCalled();expect(done).toBe(false);
  cancel.resolve();await drained;expect(done).toBe(true);
 });
 it("cancels exactly once when close interleaves between offer-result reactions",async()=>{
  vi.useFakeTimers();
  for(let offset=0;offset<16;offset++){
   const h=harness(),offer=deferred<any>();h.repository.offer.mockReturnValue(offer.promise);const request=h.service.offer(input).catch(e=>e);await turn();offer.resolve({call,created:true});
   for(let i=0;i<offset;i++)await Promise.resolve();
   const close=h.service.close();await turn();const result=await request;await close;
   if(result.status===410)expect(h.repository.transitionTrusted.mock.calls.length,`microtask offset ${offset}`).toBe(1);
  }
 });
 it("tracks cleanup even when the HTTP offer already timed out before close",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=harness(),offer=deferred<any>(),cancel=deferred<void>();h.repository.offer.mockReturnValue(offer.promise);h.repository.transitionTrusted.mockReturnValue(cancel.promise);
  const request=h.service.offer(input).catch(e=>e);await vi.advanceTimersByTimeAsync(25000);expect(await request).toMatchObject({status:410});let done=false;const close=h.service.close().then(()=>{done=true;});offer.resolve({call,created:true});await turn();expect(done).toBe(false);expect(h.notify).not.toHaveBeenCalled();cancel.resolve();await close;
 });
 it("late cancellation rejection surfaces sanitized unconfirmed drain and remains terminal",async()=>{
  vi.useFakeTimers();const h=harness(),offer=deferred<any>(),cancel=deferred<void>();h.repository.offer.mockReturnValue(offer.promise);h.repository.transitionTrusted.mockReturnValue(cancel.promise);
  const request=h.service.offer(input).catch(e=>e);await turn();const close=h.service.close(),result=close.catch(e=>e);offer.resolve({call,created:true});await turn();cancel.reject(Error("private cancellation detail"));expect((await result).message).toBe("PHONE11_WAKE_DRAIN_UNCONFIRMED");expect(h.service.close()).toBe(close);await request;
 });
 it("does not equate an aborted bounded state read with its underlying settlement",async()=>{
  vi.useFakeTimers();const h=harness(),read=deferred<any>();h.repository.current.mockReturnValue(read.promise);const request=h.service.offer(input).catch(e=>e);await turn();expect(h.repository.current).toHaveBeenCalledOnce();let done=false;const close=h.service.close().then(()=>{done=true;});await turn();expect(await request).toMatchObject({status:410});expect(done).toBe(false);read.resolve({...call,status:"ready"});await close;expect(h.notify).toHaveBeenCalledOnce();
 });
 it("waits for the default notifier's already-started mark persistence",async()=>{
  vi.useFakeTimers();const h=provider(),mark=deferred<void>();h.mark.mockReturnValue(mark.promise);const request=h.service.offer(input).catch(e=>e);await turn();expect(h.mark).toHaveBeenCalledOnce();let done=false;const close=h.service.close().then(()=>{done=true;});await turn();expect(done).toBe(false);mark.resolve();await close;await request;expect(h.remove).not.toHaveBeenCalled();
 });
 it("observes a default notifier persistence failure after its HTTP budget abort",async()=>{
  vi.useFakeTimers();const h=provider(),remove=deferred<void>();apns.send.mockRejectedValue({invalidToken:true});h.remove.mockReturnValue(remove.promise);const request=h.service.offer(input).catch(e=>e);await turn();expect(h.remove).toHaveBeenCalledOnce();const close=h.service.close().catch(e=>e);remove.reject(Error("private revision persistence failure"));expect((await close).message).toBe("PHONE11_WAKE_DRAIN_UNCONFIRMED");await request;
 });
 it("retains a detached APNS ownership callback when the provider wrapper already rejected",async()=>{
  vi.useFakeTimers();const h=provider(),read=deferred<any>();vi.mocked(wakeRepository.current).mockReturnValue(read.promise);
  apns.send.mockImplementation(async(...args:any[])=>{void args[2]().catch(()=>{});throw Error("provider budget failed");});
  const request=h.service.offer(input).catch(e=>e);await turn();expect(await request).toMatchObject({status:503});let done=false;const close=h.service.close().then(()=>{done=true;});await turn();expect(done).toBe(false);read.resolve(call);await close;expect(h.mark).not.toHaveBeenCalled();
 });
 it("refuses within30s if an underlying operation ignores abort; later settlement cannot relabel success",async()=>{
  vi.useFakeTimers();const h=harness(),offer=deferred<any>();h.repository.offer.mockReturnValue(offer.promise);const request=h.service.offer(input).catch(e=>e);await turn();const close=h.service.close(),result=close.catch(e=>e);await vi.advanceTimersByTimeAsync(30000);expect((await result).message).toBe("PHONE11_WAKE_DRAIN_UNCONFIRMED");offer.resolve({call,created:false});await turn();expect(h.service.close()).toBe(close);expect((await close.catch(e=>e)).message).toBe("PHONE11_WAKE_DRAIN_UNCONFIRMED");await request;
 });
 it("fences every external method and leaves a separately-owned service usable",async()=>{
  const a=harness(),b=harness();await a.service.close();
  for(const run of [()=>a.service.enroll("s",7,{deviceId:"d",platform:"ios"}),()=>a.service.resolve("s",7,call.bindingId),()=>a.service.revoke("s",7,call.bindingId),()=>a.service.device("end","g",{bindingId:call.bindingId,callUUID:call.callUUID}),()=>a.service.terminal({...input,status:"ended"})])expect(run).toThrow();
  await expect(a.service.offer(input)).rejects.toMatchObject({status:503});expect(a.repository.offer).not.toHaveBeenCalled();expect(a.repository.transitionTrusted).not.toHaveBeenCalled();await b.service.terminal({...input,status:"ended"});expect(b.repository.transitionTrusted).toHaveBeenCalledOnce();await b.service.close();
 });
 it("tracks synchronous repository throws without unhandled children or a false pending drain",async()=>{
  const h=harness();h.repository.offer.mockImplementation(()=>{throw Error("private synchronous error");});await expect(h.service.offer(input)).rejects.toMatchObject({status:503,message:"This incoming call is unavailable"});await h.service.close();expect(h.notify).not.toHaveBeenCalled();
 });
});
