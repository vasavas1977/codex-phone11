import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({
 user:{id:1}, account:{id:"account",ownerUserId:1,tenantId:1,username:"3001",domain:"invalid.example",enabled:true},
 binding:{bindingId:"binding",ownerUserId:1,tenantId:1,deviceId:"device",sessionBinding:"session",expiresAt:2000000000000},
 native:vi.fn(), resolve:vi.fn(), bearer:vi.fn(), stop:vi.fn(), register:vi.fn(), enroll:vi.fn(), save:vi.fn(), bindOwner:vi.fn(),
 deps:null as any, callbacks:[] as Array<(token:string)=>void>, queued:[] as any[], start:vi.fn(), secureGet:vi.fn(),
}));
vi.mock("react-native",()=>({Platform:{OS:"ios"}}));
vi.mock("expo-secure-store",()=>({WHEN_UNLOCKED_THIS_DEVICE_ONLY:"unchanged",getItemAsync:m.secureGet,setItemAsync:vi.fn()}));
vi.mock("expo-constants",()=>({default:{expoConfig:{ios:{bundleIdentifier:"test.bundle"},extra:{phone11ApnsEnvironment:"sandbox"}}}}));
vi.mock("../lib/_core/auth",()=>({getAuthSnapshot:()=>({user:m.user}),getSessionToken:m.bearer}));
vi.mock("../lib/sip/account-store",()=>({useSipAccountStore:{getState:()=>({account:m.account})}}));
vi.mock("../lib/push/native-voip",()=>({getNativeWakeBinding:m.native,stopNativeVoip:m.stop,saveNativeWakeEnrollment:m.save,
 getVoipCapabilities:async()=>({registrationAvailable:true}), startNativeVoip:m.start,createVoipDeviceId:async()=>"device"}));
vi.mock("../lib/sip/siprix-engine",()=>({siprixEngine:{bindWakeOwner:m.bindOwner}}));
vi.mock("../lib/push/token-coordinator",()=>({VoipTokenCoordinator:class {
 constructor(deps:unknown){m.deps=deps;}
 bind(binding:unknown){m.queued.push(binding);return Promise.resolve();}
 beforeLogout(){return Promise.resolve();}
}}));
vi.mock("@trpc/client",()=>({createTRPCProxyClient:()=>({push:{resolveWakeBinding:{query:m.resolve},register:{mutate:m.register},enrollWake:{mutate:m.enroll}}}),httpBatchLink:()=>({})}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();m.user={id:1};m.account={id:"account",ownerUserId:1,tenantId:1,username:"3001",domain:"invalid.example",enabled:true};m.callbacks=[];m.queued=[];m.secureGet.mockResolvedValue("device");m.start.mockImplementation(async callback=>{m.callbacks.push(callback);return vi.fn();});m.save.mockResolvedValue(undefined);m.register.mockResolvedValue(undefined);m.enroll.mockResolvedValue({...m.binding,grant:"fake-test-grant"});m.bindOwner.mockResolvedValue(undefined);m.native.mockResolvedValue({...m.binding});m.resolve.mockResolvedValue({...m.binding});m.bearer.mockResolvedValue("synthetic-bearer");});
describe("authenticated cold wake adoption",()=>{
 it("returns only exact fresh session-bound identity",async()=>{
  const {getWakeAdoptionBinding}=await import("../lib/push/client");
  expect(await getWakeAdoptionBinding()).toEqual(m.binding);
  expect(m.resolve).toHaveBeenCalledWith({bindingId:m.binding.bindingId});
 });
 it("denies a replacement session or binding for the same owner",async()=>{
  m.resolve.mockResolvedValue({...m.binding,sessionBinding:"replacement"});
  expect(await (await import("../lib/push/client")).getWakeAdoptionBinding()).toBeNull();
 });
 it("denies owner switch during native read before acquiring a bearer",async()=>{
  let release!:(value:unknown)=>void;m.native.mockImplementation(()=>new Promise(r=>{release=r;}));
  const pending=(await import("../lib/push/client")).getWakeAdoptionBinding();
  m.user={id:2};release(m.binding);expect(await pending).toBeNull();expect(m.bearer).not.toHaveBeenCalled();
 });
 it("denies same-owner re-login while authenticated verification is pending",async()=>{
  let release!:(value:unknown)=>void;m.resolve.mockImplementation(()=>new Promise(r=>{release=r;}));
  const pending=(await import("../lib/push/client")).getWakeAdoptionBinding();
  await vi.waitFor(()=>expect(m.resolve).toHaveBeenCalled());m.user={id:1};release(m.binding);expect(await pending).toBeNull();
 });
 it("bounds hung native lookup and prevents late work from querying under a new session",async()=>{
  vi.useFakeTimers();try{
   let release!:(value:unknown)=>void;m.native.mockImplementation(()=>new Promise(r=>{release=r;}));
   const pending=(await import("../lib/push/client")).getWakeAdoptionBinding();
   await vi.advanceTimersByTimeAsync(5000);expect(await pending).toBeNull();release(m.binding);
   await vi.advanceTimersByTimeAsync(0);expect(m.bearer).not.toHaveBeenCalled();expect(m.resolve).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it("denies expired server binding and observes rejection without exposing errors",async()=>{
  m.resolve.mockResolvedValue({...m.binding,expiresAt:1});
  const {getWakeAdoptionBinding}=await import("../lib/push/client");expect(await getWakeAdoptionBinding()).toBeNull();
  m.resolve.mockRejectedValue(new Error("private auth error"));expect(await getWakeAdoptionBinding()).toBeNull();
 });
});


describe("wake enrollment exact-session isolation",()=>{
 const push={ownerUserId:1,deviceId:"device",token:"fake-test-token",sipUri:"sip:3001@invalid.example",bundleId:"test.bundle",platform:"ios",sandbox:true};
 async function deps(){await import("../lib/push/client");return m.deps;}
 it("retains an authenticated existing grant without rotation",async()=>{
  await (await deps()).register(push,new AbortController().signal);
  expect(m.bindOwner).toHaveBeenCalledWith(m.binding);expect(m.enroll).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
 });
 it.each(["register","native","resolve","enroll","save"] as const)("rejects same-owner replacement after %s without binding or stopping the new session",async stage=>{
  const work=await deps();if(stage==="enroll"||stage==="save")m.native.mockResolvedValue(null);
  let release!:(value:any)=>void;m[stage].mockImplementation(()=>new Promise(r=>{release=r;}));
  const task=work.register(push,new AbortController().signal);
  const result=expect(task).rejects.toThrow("account changed");
  await vi.waitFor(()=>expect(m[stage]).toHaveBeenCalled());m.user={id:1};
  release(stage==="enroll" ? {...m.binding,grant:"fake-test-grant"}:stage==="native"||stage==="resolve"?m.binding:undefined);
  await result;expect(m.bindOwner).not.toHaveBeenCalled();expect(m.stop).not.toHaveBeenCalled();
 });
 it("rejects tenant-only reassignment during enrollment",async()=>{
  const work=await deps();m.native.mockResolvedValue(null);
  m.enroll.mockImplementation(async()=>{m.account={...m.account,tenantId:2};return {...m.binding,grant:"fake-test-grant"};});
  await expect(work.register(push,new AbortController().signal)).rejects.toThrow("account changed");
  expect(m.save).not.toHaveBeenCalled();expect(m.bindOwner).not.toHaveBeenCalled();
 });
 it("retains original token callback identity while the durable registration queue is waiting",async()=>{
  const {registerPhoneVoipPush}=await import("../lib/push/client");await registerPhoneVoipPush();
  m.callbacks[0]("fake-test-token");expect(m.queued).toHaveLength(1);
  m.user={id:1};
  await expect(m.deps.register(m.queued[0],new AbortController().signal)).rejects.toThrow("account changed");
  expect(m.bearer).not.toHaveBeenCalled();expect(m.register).not.toHaveBeenCalled();
 });
 it("ignores a late token callback from a replaced login",async()=>{
  const {registerPhoneVoipPush}=await import("../lib/push/client");await registerPhoneVoipPush();
  m.user={id:1};m.callbacks[0]("fake-test-token");expect(m.queued).toHaveLength(0);
 });
});
