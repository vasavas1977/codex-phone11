import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({os:"android",module:{} as Record<string,any>,handler:null as null|((event:any)=>void),remove:vi.fn()}));
vi.mock("react-native",()=>({Platform:{get OS(){return m.os;}},NativeModules:{get Phone11Siprix(){return m.module;},get Phone11VoipPush(){return m.module;}},
 NativeEventEmitter:class{addListener(name:string,handler:(event:any)=>void){m.handler=handler;return {remove:m.remove};}}}));
function complete(){return {getCapabilities:vi.fn(async()=>({registrationAvailable:true,closedAppCalling:false,reason:"source_candidate"})),start:vi.fn(async()=>"initial-token"),currentToken:vi.fn(async()=>"rotated-token"),
 createDeviceId:vi.fn(async()=>"device"),stop:vi.fn(async()=>{}),saveWakeEnrollment:vi.fn(async()=>{}),getWakeBinding:vi.fn(async()=>null),addListener:vi.fn(),removeListeners:vi.fn()};}
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();m.os="android";m.module=complete();m.handler=null;});
describe("native Android wake bridge fail-closed activation",()=>{
 it("does not mistake the foreground SIP module for native wake",async()=>{
  m.module={getCapabilities:vi.fn(async()=>({registrationAvailable:true}))};const native=await import("../lib/push/native-voip");
  expect(await native.getVoipCapabilities()).toMatchObject({registrationAvailable:false});expect(await native.getNativeWakeBinding()).toBeNull();
  await expect(native.saveNativeWakeEnrollment({} as never)).rejects.toThrow("unavailable");
  const callback=vi.fn();await native.startNativeVoip(callback);expect(callback).not.toHaveBeenCalled();
 });
 it("does not start token registration while the complete module is uncommissioned",async()=>{
  m.module.getCapabilities.mockResolvedValue({registrationAvailable:false,closedAppCalling:false,reason:"not_commissioned"});
  const native=await import("../lib/push/native-voip");await native.startNativeVoip(vi.fn());expect(m.module.start).not.toHaveBeenCalled();
 });
 it("uses a provider-change signal and reads the current token transiently",async()=>{
  const callback=vi.fn();const native=await import("../lib/push/native-voip");const remove=await native.startNativeVoip(callback);
  expect(callback).toHaveBeenCalledWith("initial-token");m.handler!({token:"untrusted-event-token"});await vi.waitFor(()=>expect(callback).toHaveBeenCalledWith("rotated-token"));
  expect(callback).not.toHaveBeenCalledWith("untrusted-event-token");remove();expect(m.remove).toHaveBeenCalledOnce();
 });
 it("ignores token refresh completion after logout unsubscribes",async()=>{
  const callback=vi.fn();let release!:(value:string)=>void;m.module.currentToken.mockReturnValue(new Promise(resolve=>{release=resolve;}));
  const remove=await (await import("../lib/push/native-voip")).startNativeVoip(callback);callback.mockClear();m.handler!({});remove();release("late-token");
  await Promise.resolve();expect(callback).not.toHaveBeenCalled();
 });
 it("preserves iOS event token handling",async()=>{
  m.os="ios";const callback=vi.fn();await (await import("../lib/push/native-voip")).startNativeVoip(callback);callback.mockClear();m.handler!({token:"ios-token"});
  expect(callback).toHaveBeenCalledWith("ios-token");expect(m.module.currentToken).not.toHaveBeenCalled();
 });
});
