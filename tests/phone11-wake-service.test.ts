import {afterEach,describe,expect,it,vi} from "vitest";
const apns=vi.hoisted(()=>({send:vi.fn(async()=>{})}));
vi.mock("../server/push/apns",()=>({sendApnsPush:apns.send}));
import {createWakeService,wakePilot} from "../server/push/wake-service";
import {wakeRepository,WakeError,type WakeCall} from "../server/push/wake-repository";
import {pushRepository} from "../server/push/repository";
const input={sipUri:"sip:3001@pilot.invalid",sipCallId:"synthetic-dialog"};
const call:WakeCall={v:1,callUUID:"33333333-3333-4333-8333-333333333333",bindingId:"11111111-1111-4111-8111-111111111111",expiresAt:30000,status:"pending"};
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(){
 const repository={offer:vi.fn(async()=>({call,created:true})),current:vi.fn(async()=>({...call,status:"ready" as const})),transitionTrusted:vi.fn(async()=>{}),enroll:vi.fn(),resolve:vi.fn(),revoke:vi.fn(),deviceCall:vi.fn()};
 const notify=vi.fn(async()=>{});
 const service=createWakeService({repository:repository as unknown as typeof wakeRepository,notify,pilot:()=>input.sipUri});
 return {repository,notify,service};
}
function providerHarness() {
 const h=harness();
 const token={revision:"revision-original",token:"synthetic-provider-token",registeredAt:1000};
 vi.spyOn(wakeRepository,"deliveryTarget").mockResolvedValue({sipUri:input.sipUri,revision:token.revision} as never);
 vi.spyOn(wakeRepository,"current").mockResolvedValue(call);
 const list=vi.spyOn(pushRepository,"list").mockResolvedValue([token] as never);
 const current=vi.spyOn(pushRepository,"isCurrent").mockResolvedValue(true);
 const mark=vi.spyOn(pushRepository,"markUsed").mockResolvedValue();
 const remove=vi.spyOn(pushRepository,"removeInvalid").mockResolvedValue();
 const service=createWakeService({repository:h.repository as unknown as typeof wakeRepository,pilot:()=>input.sipUri});
 return {...h,service,token,list,current,mark,remove};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();apns.send.mockReset();apns.send.mockResolvedValue();});
describe("wake service ownership and bounded call setup",()=>{
 it("stays unavailable without explicit enablement and exact valid pilot",()=>{
  vi.stubEnv("PHONE11_WAKE_ENABLED","");vi.stubEnv("PHONE11_WAKE_PILOT_SIP_URI",input.sipUri);expect(()=>wakePilot()).toThrow(WakeError);
  vi.stubEnv("PHONE11_WAKE_ENABLED","1");vi.stubEnv("PHONE11_WAKE_PILOT_SIP_URI","not-a-sip-uri");expect(()=>wakePilot()).toThrow(WakeError);
  vi.stubEnv("PHONE11_WAKE_PILOT_SIP_URI",input.sipUri);expect(wakePilot()).toBe(input.sipUri);
 });
 it("rejects cross-pilot offers and terminal changes before database/provider work",async()=>{
  const h=harness();await expect(h.service.offer({...input,sipUri:"sip:3002@pilot.invalid"})).rejects.toMatchObject({status:403});
  expect(()=>h.service.terminal({...input,sipUri:"sip:3002@pilot.invalid",status:"cancelled"})).toThrow(WakeError);
  expect(h.repository.offer).not.toHaveBeenCalled();expect(h.repository.transitionTrusted).not.toHaveBeenCalled();expect(h.notify).not.toHaveBeenCalled();
 });
 it("forwards the exact resolved session and device identity to enrollment and resolution",async()=>{
  const h=harness();await h.service.enroll("session-current",7,{deviceId:"device",platform:"ios"});
  await h.service.resolve("session-current",7,call.bindingId);await h.service.revoke("session-current",7,call.bindingId);
  expect(h.repository.enroll).toHaveBeenCalledWith("session-current",7,"device",input.sipUri);
  expect(h.repository.resolve).toHaveBeenCalledWith(call.bindingId,"session-current",7);
  expect(h.repository.revoke).toHaveBeenCalledWith(call.bindingId,"session-current",7);
 });
 it("returns readiness only after actual pending state becomes ready",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=harness();h.repository.current.mockResolvedValueOnce(call as never);
  const pending=h.service.offer(input);await vi.advanceTimersByTimeAsync(500);
  expect(await pending).toEqual({v:1,callUUID:call.callUUID,status:"ready"});expect(h.notify).toHaveBeenCalledOnce();expect(h.repository.current).toHaveBeenCalledTimes(2);
 });
 it("duplicate observer neither resends push nor owns cancellation",async()=>{
  const h=harness();h.repository.offer.mockResolvedValue({call,created:false});h.repository.current.mockResolvedValue({...call,status:"cancelled"} as never);
  await expect(h.service.offer(input)).rejects.toMatchObject({status:410});expect(h.notify).not.toHaveBeenCalled();expect(h.repository.transitionTrusted).not.toHaveBeenCalled();
 });
 it("creator cancels its pending call when provider submission fails",async()=>{
  const h=harness();h.notify.mockRejectedValue(new Error("private provider credential detail"));
  await expect(h.service.offer(input)).rejects.toMatchObject({status:503,message:"This incoming call is unavailable"});
  expect(h.repository.transitionTrusted).toHaveBeenCalledWith(input.sipUri,input.sipCallId,"cancelled");
 });
 it("bounds a hung offer lookup and never pushes when it resolves after timeout",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=harness();const db=deferred<any>();h.repository.offer.mockReturnValue(db.promise);
  const pending=h.service.offer(input).catch(error=>error);await vi.advanceTimersByTimeAsync(25000);expect(await pending).toMatchObject({status:410});
  db.resolve({call,created:true});await vi.advanceTimersByTimeAsync(0);expect(h.notify).not.toHaveBeenCalled();expect(h.repository.transitionTrusted).toHaveBeenCalledOnce();
 });
 it("bounds provider submission to five seconds and observes late rejection",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=harness();const provider=deferred<void>();h.notify.mockReturnValue(provider.promise);
  const pending=h.service.offer(input).catch(error=>error);await vi.advanceTimersByTimeAsync(5000);expect(await pending).toMatchObject({status:410});
  provider.reject(new Error("late private provider failure"));await vi.advanceTimersByTimeAsync(0);expect(h.repository.current).not.toHaveBeenCalled();
 });
 it("bounds a hung state lookup and subsequent cleanup",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=harness();h.repository.current.mockReturnValue(new Promise(()=>{}));h.repository.transitionTrusted.mockReturnValue(new Promise(()=>{}));
  const pending=h.service.offer(input).catch(error=>error);await vi.advanceTimersByTimeAsync(28000);expect(await pending).toMatchObject({status:410});expect(h.notify).toHaveBeenCalledOnce();
 });
 it("an already-aborted offer does no database or push work",async()=>{
  const h=harness();const controller=new AbortController();controller.abort();
  await expect(h.service.offer(input,controller.signal)).rejects.toMatchObject({status:410});expect(h.repository.offer).not.toHaveBeenCalled();expect(h.notify).not.toHaveBeenCalled();
 });
 it("abort during a hung lookup finishes promptly and prevents a late push",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=harness();const db=deferred<any>();h.repository.offer.mockReturnValue(db.promise);const controller=new AbortController();
  let settled=false;const pending=h.service.offer(input,controller.signal).catch(error=>{settled=true;return error;});
  await vi.advanceTimersByTimeAsync(0);controller.abort();await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(true);
  db.resolve({call,created:true});await vi.advanceTimersByTimeAsync(0);expect(await pending).toMatchObject({status:410});expect(h.notify).not.toHaveBeenCalled();
 });
 it("default provider submits only correlation metadata with the original deadline and fresh ownership check",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=harness();
  const token={revision:"revision",token:"synthetic-provider-token-never-in-payload",registeredAt:0};
  vi.spyOn(wakeRepository,"deliveryTarget").mockResolvedValue({sipUri:input.sipUri,revision:"revision"} as never);
  vi.spyOn(wakeRepository,"current").mockResolvedValue(call);
  vi.spyOn(pushRepository,"list").mockResolvedValue([token] as never);
  const current=vi.spyOn(pushRepository,"isCurrent").mockResolvedValue(true);
  const mark=vi.spyOn(pushRepository,"markUsed").mockResolvedValue();
  const remove=vi.spyOn(pushRepository,"removeInvalid").mockResolvedValue();
  apns.send.mockImplementation(async (...args:any[])=>{
   expect(args[0]).toBe(token);expect(args[3]).toBe(5000);expect(await args[2]()).toBe(true);
   expect(args[1]).toEqual({callId:call.callUUID,callerNumber:"",wake:{v:1,callUUID:call.callUUID,bindingId:call.bindingId,expiresAt:call.expiresAt}});
   const payload=JSON.stringify(args[1]);expect(payload).not.toContain(token.token);expect(payload).not.toContain(input.sipUri);expect(payload).not.toContain("sipPassword");expect(payload).not.toContain("grant");expect(payload).not.toContain("callerName");
  });
  const service=createWakeService({repository:h.repository as unknown as typeof wakeRepository,pilot:()=>input.sipUri});
  expect(await service.offer(input)).toEqual({v:1,callUUID:call.callUUID,status:"ready"});expect(apns.send).toHaveBeenCalledOnce();expect(current).toHaveBeenCalledWith(token);expect(mark).toHaveBeenCalledWith(token);expect(remove).not.toHaveBeenCalled();
 });
 it("removes only the delivered revision on a current explicit invalid-token response",async()=>{
  const h=providerHarness();apns.send.mockRejectedValue({invalidToken:true,invalidatedAt:h.token.registeredAt});
  await expect(h.service.offer(input)).rejects.toMatchObject({status:503});
  expect(h.remove).toHaveBeenCalledOnce();expect(h.remove.mock.calls[0][0]).toBe(h.token);expect(h.mark).not.toHaveBeenCalled();
 });
 it("preserves a device registered after the provider invalidation timestamp",async()=>{
  const h=providerHarness();apns.send.mockRejectedValue({invalidToken:true,invalidatedAt:h.token.registeredAt-1});
  await expect(h.service.offer(input)).rejects.toMatchObject({status:503});expect(h.remove).not.toHaveBeenCalled();expect(h.mark).not.toHaveBeenCalled();
 });
 it("a delayed response retains the sent revision for conditional cleanup after refresh",async()=>{
  const h=providerHarness();const refreshed={...h.token,revision:"revision-refreshed",registeredAt:2000};
  apns.send.mockImplementation(async()=>{h.list.mockResolvedValue([refreshed] as never);throw {invalidToken:true};});
  await expect(h.service.offer(input)).rejects.toMatchObject({status:503});
  expect(h.remove).toHaveBeenCalledWith(h.token);expect(h.remove).not.toHaveBeenCalledWith(refreshed);expect(h.mark).not.toHaveBeenCalled();
 });
 it("does not deliver when the target revision disappeared before device lookup",async()=>{
  const h=providerHarness();h.list.mockResolvedValue([{...h.token,revision:"revision-refreshed"}] as never);
  await expect(h.service.offer(input)).rejects.toMatchObject({status:410});expect(apns.send).not.toHaveBeenCalled();expect(h.remove).not.toHaveBeenCalled();expect(h.mark).not.toHaveBeenCalled();
 });
 it.each([new Error("private provider auth error"),{kind:"network"},{kind:"configuration"}])("preserves registration on non-invalid provider failure %#",async error=>{
  const h=providerHarness();apns.send.mockRejectedValue(error);
  await expect(h.service.offer(input)).rejects.toMatchObject({status:503});expect(h.remove).not.toHaveBeenCalled();expect(h.mark).not.toHaveBeenCalled();
 });
 it("late invalid-token rejection after submission timeout cannot start cleanup",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=providerHarness();const provider=deferred<void>();apns.send.mockReturnValue(provider.promise);
  const pending=h.service.offer(input).catch(error=>error);await vi.advanceTimersByTimeAsync(5000);expect(await pending).toMatchObject({status:410});
  provider.reject({invalidToken:true});await vi.advanceTimersByTimeAsync(0);expect(h.remove).not.toHaveBeenCalled();expect(h.mark).not.toHaveBeenCalled();
 });
 it("late provider acceptance after submission timeout cannot mark a device used",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=providerHarness();const provider=deferred<void>();apns.send.mockReturnValue(provider.promise);
  const pending=h.service.offer(input).catch(error=>error);await vi.advanceTimersByTimeAsync(5000);expect(await pending).toMatchObject({status:410});
  provider.resolve();await vi.advanceTimersByTimeAsync(0);expect(h.mark).not.toHaveBeenCalled();expect(h.remove).not.toHaveBeenCalled();
 });
 it.each(["mark","remove"] as const)("bounds hung %s persistence and observes abandoned rejection",async stage=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=providerHarness();const storage=deferred<void>();h[stage].mockReturnValue(storage.promise);
  if(stage==="remove")apns.send.mockRejectedValue({invalidToken:true});
  const pending=h.service.offer(input).catch(error=>error);await vi.advanceTimersByTimeAsync(5000);expect(await pending).toMatchObject({status:410});expect(h[stage]).toHaveBeenCalledWith(h.token);
  storage.reject(new Error("late private storage failure"));await vi.advanceTimersByTimeAsync(0);expect(h.repository.transitionTrusted).toHaveBeenCalledOnce();
 });
 it("default provider path never starts a network send after its target lookup exceeded the submission budget",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=harness();const target=deferred<any>();
  vi.spyOn(wakeRepository,"deliveryTarget").mockReturnValue(target.promise);
  vi.spyOn(wakeRepository,"current").mockResolvedValue(call);
  vi.spyOn(pushRepository,"list").mockResolvedValue([{revision:"revision"}] as never);
  vi.spyOn(pushRepository,"isCurrent").mockResolvedValue(true);
  const service=createWakeService({repository:h.repository as unknown as typeof wakeRepository,pilot:()=>input.sipUri});
  const pending=service.offer(input).catch(error=>error);await vi.advanceTimersByTimeAsync(5000);expect(await pending).toMatchObject({status:410});
  target.resolve({sipUri:input.sipUri,revision:"revision"});await vi.advanceTimersByTimeAsync(0);expect(apns.send).not.toHaveBeenCalled();
 });
});
