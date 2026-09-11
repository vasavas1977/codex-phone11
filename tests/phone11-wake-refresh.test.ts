import {beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({enabled:true,user:{id:1},account:{id:"phone",ownerUserId:1,tenantId:1,enabled:true,username:"3001",domain:"test.invalid"},
 binding:{bindingId:"binding",ownerUserId:1,tenantId:1,deviceId:"device",sessionBinding:"session",expiresAt:0},
 deps:null as any,get:vi.fn(),start:vi.fn(),native:vi.fn(),save:vi.fn(),stop:vi.fn(),register:vi.fn(),resolve:vi.fn(),enroll:vi.fn(),bind:vi.fn(),bearer:vi.fn()}));
vi.mock("react-native",()=>({Platform:{OS:"ios"}}));
vi.mock("expo-secure-store",()=>({getItemAsync:m.get,setItemAsync:vi.fn(),WHEN_UNLOCKED_THIS_DEVICE_ONLY:"unchanged"}));
vi.mock("expo-constants",()=>({default:{expoConfig:{ios:{bundleIdentifier:"test.bundle"},extra:{phone11ApnsEnvironment:"sandbox"}}}}));
vi.mock("../lib/_core/auth",()=>({getAuthSnapshot:()=>({user:m.user}),getSessionToken:m.bearer}));
vi.mock("../lib/sip/account-store",()=>({useSipAccountStore:{getState:()=>({account:m.account})}}));
vi.mock("../lib/push/native-voip",()=>({getVoipCapabilities:async()=>({registrationAvailable:m.enabled}),getNativeWakeBinding:m.native,saveNativeWakeEnrollment:m.save,stopNativeVoip:m.stop,startNativeVoip:m.start,createVoipDeviceId:async()=>"device"}));
vi.mock("../lib/sip/siprix-engine",()=>({siprixEngine:{bindWakeOwner:m.bind}}));
vi.mock("../lib/push/token-coordinator",()=>({VoipTokenCoordinator:class{constructor(deps:unknown){m.deps=deps;}bind(value:unknown){return m.deps.register(value,new AbortController().signal);}beforeLogout(){return Promise.resolve();}}}));
vi.mock("@trpc/client",()=>({createTRPCProxyClient:()=>({push:{register:{mutate:m.register},resolveWakeBinding:{query:m.resolve},enrollWake:{mutate:m.enroll}}}),httpBatchLink:()=>({})}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();m.enabled=true;m.user={id:1};m.account={id:"phone",ownerUserId:1,tenantId:1,enabled:true,username:"3001",domain:"test.invalid"};m.binding={bindingId:"binding",ownerUserId:1,tenantId:1,deviceId:"device",sessionBinding:"session",expiresAt:Date.now()+3*86400000};m.get.mockResolvedValue("device");m.start.mockImplementation(async cb=>{cb("synthetic-token");return ()=>{};});m.native.mockImplementation(async()=>({...m.binding}));m.resolve.mockImplementation(async()=>({...m.binding}));m.enroll.mockImplementation(async()=>({...m.binding,expiresAt:Date.now()+7*86400000,grant:"fake-only"}));m.register.mockResolvedValue(undefined);m.save.mockResolvedValue(undefined);m.bind.mockResolvedValue(undefined);m.bearer.mockResolvedValue("fake-bearer");});
async function refresh(signal=new AbortController().signal,idle=()=>true){return (await import("../lib/push/client")).refreshPhoneVoipEnrollment(signal,idle);}
describe("foreground wake enrollment refresh",()=>{
 it("closed gate performs no token, storage or network work",async()=>{m.enabled=false;await refresh();expect(m.start).not.toHaveBeenCalled();expect(m.get).not.toHaveBeenCalled();expect(m.register).not.toHaveBeenCalled();});
 it("retains a current grant with sufficient validity",async()=>{await refresh();expect(m.register).toHaveBeenCalledOnce();expect(m.enroll).not.toHaveBeenCalled();expect(m.bind).toHaveBeenCalledWith(m.binding);});
 it("renews a same-session grant near expiry only while idle",async()=>{m.binding.expiresAt=Date.now()+3600000;await refresh();expect(m.resolve).toHaveBeenCalledWith({bindingId:"binding"});expect(m.enroll).toHaveBeenCalledWith({deviceId:"device",platform:"ios"});expect(m.save).toHaveBeenCalledOnce();});
 it("restores registration and enrollment when logout removed the native grant",async()=>{m.native.mockResolvedValue(null);await refresh();expect(m.start).toHaveBeenCalledOnce();expect(m.enroll).toHaveBeenCalledOnce();expect(m.bind).toHaveBeenCalledOnce();});
 it("skips all work during a live call",async()=>{await refresh(undefined,()=>false);expect(m.start).not.toHaveBeenCalled();expect(m.register).not.toHaveBeenCalled();});
 it("a server busy refusal preserves the old native grant for retry",async()=>{m.binding.expiresAt=Date.now()+3600000;m.enroll.mockRejectedValue(new Error("busy"));await expect(refresh()).rejects.toThrow("busy");expect(m.save).not.toHaveBeenCalled();expect(m.stop).not.toHaveBeenCalled();});
 it("retry can succeed after a transient enrollment failure",async()=>{m.native.mockResolvedValue(null);m.enroll.mockRejectedValueOnce(new Error("offline"));await expect(refresh()).rejects.toThrow("offline");await refresh();expect(m.save).toHaveBeenCalledOnce();});
 it("call start while registration is pending prevents grant renewal and native save",async()=>{let idle=true;const controller=new AbortController();m.register.mockImplementation(async()=>{idle=false;controller.abort();});await expect(refresh(controller.signal,()=>idle)).rejects.toThrow("account changed");expect(m.enroll).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();});
});
