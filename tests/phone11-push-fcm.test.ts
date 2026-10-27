import { afterEach, describe, expect, it, vi } from "vitest";
import { createFcmSender, readFcmConfig, type FcmMessage } from "../server/push/fcm";
const device={platform:"android" as const,tokenType:"fcm" as const,token:"synthetic-token",bundleId:"test.phone11",sandbox:false};
const message:FcmMessage={data:{v:"1",callUUID:"synthetic-call",bindingId:"synthetic-binding",expiresAt:"30000"},android:{priority:"HIGH",ttl:"0s"}};
function fixture() {
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response("",{status:200}));
 const accessToken=vi.fn(async()=>"synthetic-access-token");
 const send=createFcmSender({loadConfig:()=>({projectId:"synthetic-project",packageName:device.bundleId}),accessToken,fetch:fetcher});
 return {fetcher,accessToken,send};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe("bounded FCM HTTP v1 transport",()=>{
 it("requires explicit project/package configuration",()=>{
  vi.stubEnv("FCM_PROJECT_ID","");vi.stubEnv("FCM_ANDROID_PACKAGE","");expect(readFcmConfig).toThrow("configuration");
  vi.stubEnv("FCM_PROJECT_ID","synthetic-project");vi.stubEnv("FCM_ANDROID_PACKAGE",device.bundleId);
  expect(readFcmConfig()).toEqual({projectId:"synthetic-project",packageName:device.bundleId});
 });
 it("sends only the passed data envelope and restricts the package",async()=>{
  const h=fixture(),current=vi.fn(async()=>true);await h.send(device,message,current);
  const [url,options]=h.fetcher.mock.calls[0];
  expect(url).toBe("https://fcm.googleapis.com/v1/projects/synthetic-project/messages:send");
  expect(JSON.parse(options!.body as string)).toEqual({message:{token:device.token,...message,android:{...message.android,restricted_package_name:device.bundleId}}});
  expect(current).toHaveBeenCalledOnce();expect(options!.headers).toEqual({"content-type":"application/json",authorization:"Bearer synthetic-access-token"});
 });
 it("supports ordinary alerts with a distinct notification channel",async()=>{
  const h=fixture();await h.send(device,{data:{type:"phone11_chat",eventId:"synthetic-event"},notification:{title:"Phone11",body:"New message"},
   android:{priority:"HIGH",ttl:"30s",notification:{channel_id:"phone11_team_chat",sound:"default"}}});
  expect(JSON.parse(h.fetcher.mock.calls[0][1]!.body as string).message.notification).toEqual({title:"Phone11",body:"New message"});
 });
 it.each([{platform:"ios"},{tokenType:"voip"},{bundleId:"wrong.package"},{sandbox:true},{token:"bad\ntoken"}])("rejects incompatible device %# before credentials",async change=>{
  const h=fixture();await expect(h.send({...device,...change} as typeof device,message)).rejects.toMatchObject({kind:"configuration"});
  expect(h.accessToken).not.toHaveBeenCalled();expect(h.fetcher).not.toHaveBeenCalled();
 });
 it("rechecks session/call authority after credentials and never submits stale state",async()=>{
  const h=fixture(),current=vi.fn(async()=>false);await expect(h.send(device,message,current)).rejects.toMatchObject({kind:"rejected"});
  expect(h.fetcher).not.toHaveBeenCalled();
 });
 it("bounds hung OAuth and prevents late submission",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=fixture();let release!:(value:string)=>void;
  h.accessToken.mockReturnValue(new Promise(resolve=>{release=resolve;}));
  const result=h.send(device,message,async()=>true,100).catch(error=>error);await vi.advanceTimersByTimeAsync(100);
  expect(await result).toMatchObject({kind:"timeout"});release("late-token");await vi.advanceTimersByTimeAsync(0);expect(h.fetcher).not.toHaveBeenCalled();
 });
 it("bounds hung authority and never starts provider work after timeout",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=fixture();let release!:(value:boolean)=>void;
  const result=h.send(device,message,()=>new Promise(resolve=>{release=resolve;}),100).catch(error=>error);await vi.advanceTimersByTimeAsync(100);
  expect(await result).toMatchObject({kind:"timeout"});release(true);await vi.advanceTimersByTimeAsync(0);expect(h.fetcher).not.toHaveBeenCalled();
 });
 it.each([
  [404,{error:{details:[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError",errorCode:"UNREGISTERED"}]}},"invalid-token"],
  [400,{error:{message:"UNREGISTERED",status:"INVALID_ARGUMENT"}},"rejected"],
  [401,{error:{message:"private credential detail"}},"authentication"],
  [403,{},"authentication"],[429,{},"throttled"],[503,{},"unavailable"],
 ] as const)("classifies HTTP %s without exposing provider content",async(status,body,kind)=>{
  const h=fixture();h.fetcher.mockResolvedValue(new Response(JSON.stringify(body),{status}));
  const error=await h.send(device,message).catch(error=>error);expect(error).toMatchObject({kind,status});expect(error.message).not.toContain("private");expect(h.fetcher).toHaveBeenCalledOnce();
 });
 it("provider network failure is not acceptance and is never retried",async()=>{
  const h=fixture();h.fetcher.mockRejectedValue(new Error("private token content"));
  await expect(h.send(device,message)).rejects.toMatchObject({kind:"transport",message:"Push provider transport"});expect(h.fetcher).toHaveBeenCalledOnce();
 });
 it("reduces ordinary alert TTL after credential latency to the absolute expiry",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=fixture();
  h.accessToken.mockImplementation(async()=>{vi.setSystemTime(2500);return "test-token";});
  await h.send(device,{...message,android:{priority:"HIGH",ttl:"10s"}},async()=>true,5000,10_000);
  expect(JSON.parse(h.fetcher.mock.calls[0][1]!.body as string).message.android.ttl).toBe("7s");
 });
 it("rejects ordinary alert expiry reached during credentials",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);const h=fixture();
  h.accessToken.mockImplementation(async()=>{vi.setSystemTime(2500);return "test-token";});
  await expect(h.send(device,message,async()=>true,5000,2000)).rejects.toMatchObject({kind:"rejected"});expect(h.fetcher).not.toHaveBeenCalled();
 });

});
