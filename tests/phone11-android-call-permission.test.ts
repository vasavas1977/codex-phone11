import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SipAccount } from "../lib/sip/account-store";
import type { SipCall } from "../lib/sip/call-store";
import { SipProvider } from "../lib/sip/sip-provider";

const m = vi.hoisted(() => ({
  platform: { OS: "android" }, owner: { id: 17 } as { id: number } | null, loading: false,
  account: null as SipAccount | null, incoming: null as SipCall | null,
  active: {} as Record<string, SipCall>, refs: [] as { current: any }[], index: 0,
  callListeners: new Set<() => void>(),
  effects: [] as (() => void | (() => void))[], order: [] as string[],
  check: vi.fn(), request: vi.fn(), prepare: vi.fn(), release: vi.fn(),
  initialize: vi.fn(), makeCall: vi.fn(), answerCall: vi.fn(), hangupCall: vi.fn(),
  systemAnswer: vi.fn(), reportOutgoing: vi.fn(), loadAccount: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => m.refs[m.index++] ?? (m.refs[m.index - 1] = { current: initial }),
    useEffect: (effect: () => void | (() => void)) => { m.effects.push(effect); },
  };
});
vi.mock("react-native", () => ({
  Platform: m.platform, AppState: { currentState: "active", addEventListener: vi.fn() },
  PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: "android.permission.RECORD_AUDIO" },
    RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
    check: m.check, request: m.request },
}));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.owner, loading: m.loading }), addAuthChangeListener: vi.fn() }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: Object.assign(() => ({ loadAccount: m.loadAccount }), {
  getState: () => ({ account: m.account, registrationState: "registered" }), subscribe: vi.fn(),
}) }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: {
  getState: () => ({ incomingCall: m.incoming, activeCalls: m.active }),
  subscribe: (changed: () => void) => { m.callListeners.add(changed); return () => { m.callListeners.delete(changed); }; },
} }));
vi.mock("../lib/sip/diagnostics-store", () => ({ useSipDiagnosticsStore: { getState: () => ({ addEvent: vi.fn() }) } }));
vi.mock("../lib/sip/registration-lifecycle", () => ({ createRegistrationLifecycle: vi.fn() }));
vi.mock("../lib/push/enrollment-lifecycle", () => ({ createVoipEnrollmentLifecycle: vi.fn() }));
vi.mock("../lib/sip/video-runtime", () => ({ getVideoBridge: vi.fn() }));
vi.mock("../lib/meetings/native-session", () => ({ prepareSipMediaOwnership: m.prepare, releaseSipMediaOwnership: m.release }));
vi.mock("../lib/sip/engine", () => ({ sipEngine: { initialize: m.initialize, makeCall: m.makeCall, answerCall: m.answerCall, hangupCall: m.hangupCall } }));
vi.mock("../lib/sip/siprix-engine", () => ({ siprixEngine: { consultation: vi.fn(), remainingConsultation: vi.fn() } }));
vi.mock("../lib/sip/native-call", () => ({ nativeCallManager: { initialize: vi.fn(async () => {}),
  answerIncomingCall: m.systemAnswer, reportOutgoingCall: m.reportOutgoing, reportCallConnected: vi.fn(),
}, registerVoipPush: vi.fn(async () => {}) }));

type Actions = { makeCall(destination: string, video?: boolean): Promise<string | null>; answerCall(id: string, video?: boolean): Promise<void> };
function provider(): Actions {
  m.index = 0;
  return (SipProvider({ children: null }).props as { value: Actions }).value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const ring = (historyId = "ring-lifetime-1"): SipCall => ({
  id: "incoming-1", direction: "inbound", status: "incoming", remoteNumber: "2002", startTime: new Date(1000),
  isMuted: false, isHeld: false, isSpeaker: false, isVideo: false,
  history: { id: historyId, ownerUserId: 17, number: "2002", direction: "inbound", startedAt: 1000, updatedAt: 1000 },
});
beforeEach(() => {
  vi.clearAllMocks();
  m.platform.OS = "android"; m.owner = { id: 17 }; m.loading = false;
  m.account = { id: "assigned", ownerUserId: 17, tenantId: 4, username: "1001", password: "synthetic-only",
    domain: "sip.example.test", displayName: "Test", port: 5061, transport: "TLS", srtp: true, enabled: true };
  m.incoming = null; m.active = {}; m.refs = []; m.effects = []; m.index = 0; m.order = []; m.callListeners.clear();
  vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "siprix");
  vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL", "1");
  m.check.mockReset().mockImplementation(async () => { m.order.push("check"); return false; });
  m.request.mockReset().mockImplementation(async () => { m.order.push("request"); return "granted"; });
  m.prepare.mockReset().mockImplementation(async () => { m.order.push("media"); return { id: "outgoing-lease" }; });
  m.initialize.mockReset().mockImplementation(async () => { m.order.push("initialize"); });
  m.makeCall.mockReset().mockImplementation(async () => { m.order.push("dial"); return "outgoing-1"; });
  m.answerCall.mockReset().mockImplementation(async () => { m.order.push("answer"); });
  m.systemAnswer.mockReset().mockResolvedValue(undefined); m.loadAccount.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { expect(m.callListeners.size).toBe(0); vi.unstubAllEnvs(); });

it("requests RECORD_AUDIO from Dial before media ownership or any native command", async () => {
  const actions = provider();
  expect(m.check).not.toHaveBeenCalled(); expect(m.request).not.toHaveBeenCalled();
  await expect(actions.makeCall("2002")).resolves.toBe("outgoing-1");
  expect(m.check).toHaveBeenCalledWith("android.permission.RECORD_AUDIO");
  expect(m.request).toHaveBeenCalledWith("android.permission.RECORD_AUDIO");
  expect(m.order).toEqual(["check", "request", "media", "initialize", "dial"]);
});
it("checks an existing microphone grant without prompting again", async () => {
  m.check.mockResolvedValue(true);
  await provider().makeCall("2002");
  expect(m.request).not.toHaveBeenCalled(); expect(m.makeCall).toHaveBeenCalledOnce();
});
it.each(["denied", "never_ask_again"])("denied Dial (%s) creates no call/lease and can retry on the next gesture", async result => {
  m.request.mockResolvedValueOnce(result).mockResolvedValueOnce("granted");
  const actions = provider();
  await expect(actions.makeCall("2002")).rejects.toThrow("Microphone permission is required");
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.initialize).not.toHaveBeenCalled();
  expect(m.makeCall).not.toHaveBeenCalled(); expect(m.reportOutgoing).not.toHaveBeenCalled();
  await expect(actions.makeCall("2002")).resolves.toBe("outgoing-1");
  expect(m.request).toHaveBeenCalledTimes(2); expect(m.makeCall).toHaveBeenCalledOnce();
});
it("coalesces repeated Dial taps throughout the permission and native command promises", async () => {
  const permission = deferred<string>(), command = deferred<string>();
  m.request.mockReturnValue(permission.promise); m.makeCall.mockReturnValue(command.promise);
  const actions = provider(), first = actions.makeCall("2002"), duplicate = actions.makeCall("2002");
  await vi.waitFor(() => expect(m.request).toHaveBeenCalledOnce());
  permission.resolve("granted");
  await vi.waitFor(() => expect(m.makeCall).toHaveBeenCalledOnce());
  const third = actions.makeCall("2002");
  command.resolve("outgoing-1");
  await expect(Promise.all([first, duplicate, third])).resolves.toEqual(["outgoing-1", "outgoing-1", "outgoing-1"]);
  expect(m.prepare).toHaveBeenCalledOnce(); expect(m.makeCall).toHaveBeenCalledOnce();
});
it("rejects a conflicting Dial while another call action is pending", async () => {
  const permission = deferred<string>(); m.request.mockReturnValue(permission.promise);
  const actions = provider(), first = actions.makeCall("2002");
  await expect(actions.makeCall("2003")).rejects.toThrow("Another phone action");
  permission.resolve("granted"); await first;
  expect(m.request).toHaveBeenCalledOnce(); expect(m.makeCall).toHaveBeenCalledWith("2002", undefined);
});
it.each(["logout", "owner-replaced", "loading", "account-replaced", "account-disabled", "incoming-arrived"])("does not dial after %s while permission is pending", async change => {
  const permission = deferred<string>(); m.request.mockReturnValue(permission.promise);
  const work = provider().makeCall("2002");
  await vi.waitFor(() => expect(m.request).toHaveBeenCalledOnce());
  if (change === "logout") m.owner = null;
  if (change === "owner-replaced") m.owner = { id: 17 };
  if (change === "loading") m.loading = true;
  if (change === "account-replaced") m.account = { ...m.account! };
  if (change === "account-disabled") m.account!.enabled = false;
  if (change === "incoming-arrived") m.incoming = ring();
  permission.resolve("granted"); await expect(work).rejects.toThrow("changed");
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.initialize).not.toHaveBeenCalled(); expect(m.makeCall).not.toHaveBeenCalled();
});
it("rechecks Dial before requesting permission if the account changes during its check", async () => {
  const check = deferred<boolean>(); m.check.mockReturnValue(check.promise);
  const work = provider().makeCall("2002");
  await vi.waitFor(() => expect(m.check).toHaveBeenCalledOnce());
  m.account = { ...m.account! }; check.resolve(false);
  await expect(work).rejects.toThrow("changed");
  expect(m.request).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled();
});
it("rechecks Dial after media ownership yields and releases only its newly acquired lease", async () => {
  const media = deferred<{ id: string }>(); m.prepare.mockReturnValue(media.promise);
  const work = provider().makeCall("2002");
  await vi.waitFor(() => expect(m.prepare).toHaveBeenCalledOnce());
  m.account = { ...m.account! }; const lease = { id: "new-lease" }; media.resolve(lease);
  await expect(work).rejects.toThrow("changed");
  expect(m.initialize).not.toHaveBeenCalled(); expect(m.makeCall).not.toHaveBeenCalled();
  expect(m.release).toHaveBeenCalledWith(lease);
});
it("rechecks Dial after initialization yields before the native dial command", async () => {
  const initialization = deferred<void>(); m.initialize.mockReturnValue(initialization.promise);
  const work = provider().makeCall("2002");
  await vi.waitFor(() => expect(m.initialize).toHaveBeenCalledOnce());
  m.account = { ...m.account! }; initialization.resolve();
  await expect(work).rejects.toThrow("changed"); expect(m.makeCall).not.toHaveBeenCalled();
  expect(m.release).toHaveBeenCalledWith({ id: "outgoing-lease" });
});
it("denied Answer preserves the ringing call and existing lease, and can retry", async () => {
  m.incoming = ring(); const original = m.incoming;
  m.request.mockResolvedValueOnce("denied").mockResolvedValueOnce("granted");
  const actions = provider();
  await expect(actions.answerCall("incoming-1")).rejects.toThrow("Microphone permission is required");
  expect(m.incoming).toBe(original); expect(m.incoming.status).toBe("incoming");
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
  expect(m.initialize).not.toHaveBeenCalled(); expect(m.answerCall).not.toHaveBeenCalled(); expect(m.hangupCall).not.toHaveBeenCalled();
  await actions.answerCall("incoming-1");
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.answerCall).toHaveBeenCalledWith("incoming-1", undefined);
});
it("coalesces repeated Answer taps without acquiring or releasing the ringing lease", async () => {
  m.incoming = ring(); const permission = deferred<string>(); m.request.mockReturnValue(permission.promise);
  const actions = provider(), first = actions.answerCall("incoming-1"), duplicate = actions.answerCall("incoming-1");
  await vi.waitFor(() => expect(m.request).toHaveBeenCalledOnce()); permission.resolve("granted");
  await Promise.all([first, duplicate]);
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
});
it.each(["logout", "owner-replaced", "account-replaced", "terminated", "replaced-id", "replaced-lifetime", "answered"])("does not answer after %s during the prompt", async change => {
  m.incoming = ring(); const permission = deferred<string>(); m.request.mockReturnValue(permission.promise);
  const work = provider().answerCall("incoming-1");
  await vi.waitFor(() => expect(m.request).toHaveBeenCalledOnce());
  if (change === "logout") m.owner = null;
  if (change === "owner-replaced") m.owner = { id: 17 };
  if (change === "account-replaced") m.account = { ...m.account! };
  if (change === "terminated") m.incoming = null;
  if (change === "replaced-id") m.incoming = { ...ring(), id: "incoming-2" };
  if (change === "replaced-lifetime") m.incoming = ring("new-lifetime-same-native-id");
  if (change === "answered") m.incoming = { ...m.incoming!, status: "active" };
  permission.resolve("granted"); await expect(work).rejects.toThrow("changed");
  expect(m.answerCall).not.toHaveBeenCalled(); expect(m.hangupCall).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
});
it("rechecks Answer lifetime after initialization yields", async () => {
  m.incoming = ring(); const initialization = deferred<void>(); m.initialize.mockReturnValue(initialization.promise);
  const work = provider().answerCall("incoming-1");
  await vi.waitFor(() => expect(m.initialize).toHaveBeenCalledOnce());
  m.incoming = ring("new-lifetime-same-native-id"); initialization.resolve();
  await expect(work).rejects.toThrow("changed"); expect(m.answerCall).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
});
it("rejects Answer with the wrong call identity before asking for permission", async () => {
  m.incoming = ring(); await expect(provider().answerCall("another-call")).rejects.toThrow("changed");
  expect(m.check).not.toHaveBeenCalled(); expect(m.request).not.toHaveBeenCalled(); expect(m.answerCall).not.toHaveBeenCalled();
});
it("invalidates a pending prompt when the provider unmounts", async () => {
  const actions = provider(), cleanup = m.effects[0]() as () => void;
  const permission = deferred<string>(); m.request.mockReturnValue(permission.promise);
  const work = actions.makeCall("2002");
  await vi.waitFor(() => expect(m.request).toHaveBeenCalledOnce()); cleanup(); permission.resolve("granted");
  await expect(work).rejects.toThrow("changed"); expect(m.prepare).not.toHaveBeenCalled(); expect(m.makeCall).not.toHaveBeenCalled();
});
it("remains usable after a development effect cleanup/setup rehearsal", async () => {
  const actions = provider(), setup = m.effects[0]; (setup() as () => void)(); setup();
  await expect(actions.makeCall("2002")).resolves.toBe("outgoing-1"); expect(m.makeCall).toHaveBeenCalledOnce();
});
it.each(["ios", "ordinary-android", "pjsip-android"])("does not change the %s call path or ask for Android microphone permission", async path => {
  if (path === "ios") m.platform.OS = "ios";
  if (path === "ordinary-android") vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL", "0");
  if (path === "pjsip-android") vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "pjsip");
  const actions = provider(); await actions.makeCall("2002");
  m.incoming = ring(); await actions.answerCall("incoming-1");
  expect(m.check).not.toHaveBeenCalled(); expect(m.request).not.toHaveBeenCalled();
  if (path === "ios") { expect(m.systemAnswer).toHaveBeenCalledOnce(); expect(m.answerCall).not.toHaveBeenCalled(); }
  else expect(m.answerCall).toHaveBeenCalledOnce();
});

const outgoing = (id = "outgoing-1", historyId = "outgoing-lifetime-1"): SipCall => ({
  ...ring(historyId), id, direction: "outbound", status: "calling",
});
const publishCalls = (active: Record<string, SipCall>, incoming: SipCall | null = null) => {
  m.active = active; m.incoming = incoming; m.callListeners.forEach(changed => changed());
};
it("coalesces Dial after its callback publishes an outgoing call before command resolution", async () => {
  const command = deferred<string>(); m.makeCall.mockReturnValue(command.promise);
  const actions = provider(), first = actions.makeCall("2002");
  await vi.waitFor(() => expect(m.makeCall).toHaveBeenCalledOnce());
  // Mirrors the review reproduction even without notifying the store observer.
  m.active = { "outgoing-1": outgoing() };
  const second = actions.makeCall("2002"); command.resolve("outgoing-1");
  await expect(Promise.all([first, second])).resolves.toEqual(["outgoing-1", "outgoing-1"]);
  expect(m.makeCall).toHaveBeenCalledOnce(); expect(m.request).toHaveBeenCalledOnce();
});
it("coalesces Answer after its connected callback moves the original lifetime to active", async () => {
  m.incoming = ring(); const original = m.incoming;
  const command = deferred<void>(); m.answerCall.mockReturnValue(command.promise);
  const actions = provider(), first = actions.answerCall("incoming-1");
  await vi.waitFor(() => expect(m.answerCall).toHaveBeenCalledOnce());
  m.incoming = null; m.active = { "incoming-1": { ...original, status: "active" } };
  const second = actions.answerCall("incoming-1"); command.resolve();
  await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.request).toHaveBeenCalledOnce();
});
it.each(["calling", "active", "held"] as const)("coalesces observed outgoing %s callbacks with the exact routed SIP URI", async status => {
  const command = deferred<string>(); m.makeCall.mockReturnValue(command.promise);
  const actions = provider(), first = actions.makeCall("2002");
  await vi.waitFor(() => expect(m.makeCall).toHaveBeenCalledOnce());
  publishCalls({ "outgoing-1": { ...outgoing(), remoteNumber: "sip:2002@sip.example.test", status } });
  const second = actions.makeCall("2002"); command.resolve("outgoing-1");
  await expect(Promise.all([first, second])).resolves.toEqual(["outgoing-1", "outgoing-1"]);
  expect(m.makeCall).toHaveBeenCalledOnce();
});
it.each(["logout", "owner-replaced", "account-replaced", "incoming-takeover", "different-peer", "different-id", "reused-id-new-lifetime", "terminated"])("rejects duplicate Dial after %s following its first callback", async change => {
  const command = deferred<string>(); m.makeCall.mockReturnValue(command.promise);
  const actions = provider(), first = actions.makeCall("2002");
  await vi.waitFor(() => expect(m.makeCall).toHaveBeenCalledOnce());
  publishCalls({ "outgoing-1": outgoing() });
  if (change === "logout") m.owner = null;
  if (change === "owner-replaced") m.owner = { id: 17 };
  if (change === "account-replaced") m.account = { ...m.account! };
  if (change === "incoming-takeover") publishCalls({}, ring());
  if (change === "different-peer") publishCalls({ "other": { ...outgoing("other"), remoteNumber: "3003" } });
  if (change === "different-id") publishCalls({ "other": outgoing("other") });
  if (change === "reused-id-new-lifetime") publishCalls({ "outgoing-1": outgoing("outgoing-1", "replacement-lifetime") });
  if (change === "terminated") publishCalls({});
  await expect(actions.makeCall("2002")).rejects.toThrow("changed");
  command.resolve("outgoing-1"); await first;
  expect(m.makeCall).toHaveBeenCalledOnce(); expect(m.request).toHaveBeenCalledOnce();
});
it.each(["logout", "account-replaced", "different-id", "reused-id-new-lifetime", "another-ringing-call", "terminated"])("rejects duplicate Answer after %s following its connected callback", async change => {
  m.incoming = ring(); const original = m.incoming;
  const command = deferred<void>(); m.answerCall.mockReturnValue(command.promise);
  const actions = provider(), first = actions.answerCall("incoming-1");
  await vi.waitFor(() => expect(m.answerCall).toHaveBeenCalledOnce());
  publishCalls({ "incoming-1": { ...original, status: "active" } });
  if (change === "logout") m.owner = null;
  if (change === "account-replaced") m.account = { ...m.account! };
  if (change === "different-id") publishCalls({ "other": { ...original, id: "other", status: "active" } });
  if (change === "reused-id-new-lifetime") publishCalls({ "incoming-1": { ...ring("replacement-lifetime"), status: "active" } });
  if (change === "another-ringing-call") publishCalls(m.active, { ...ring("another-lifetime"), id: "incoming-2" });
  if (change === "terminated") publishCalls({});
  await expect(actions.answerCall("incoming-1")).rejects.toThrow("changed");
  command.resolve(); await first;
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.request).toHaveBeenCalledOnce();
});
it("retains a takeover fence even if the earlier outgoing lifetime reappears", async () => {
  const command = deferred<string>(); m.makeCall.mockReturnValue(command.promise);
  const actions = provider(), first = actions.makeCall("2002");
  await vi.waitFor(() => expect(m.makeCall).toHaveBeenCalledOnce());
  const original = outgoing(); publishCalls({ "outgoing-1": original });
  publishCalls({ "outgoing-1": outgoing("outgoing-1", "replacement-lifetime") });
  publishCalls({ "outgoing-1": original });
  await expect(actions.makeCall("2002")).rejects.toThrow("changed"); command.resolve("outgoing-1"); await first;
  expect(m.makeCall).toHaveBeenCalledOnce();
});
it("rejects a duplicate after unmount during callback-first command progression and removes its observer", async () => {
  const actions = provider(), cleanup = m.effects[0]() as () => void;
  const command = deferred<string>(); m.makeCall.mockReturnValue(command.promise);
  const first = actions.makeCall("2002");
  await vi.waitFor(() => expect(m.makeCall).toHaveBeenCalledOnce());
  publishCalls({ "outgoing-1": outgoing() }); cleanup();
  expect(m.callListeners.size).toBe(0);
  await expect(actions.makeCall("2002")).rejects.toThrow("changed");
  command.resolve("outgoing-1"); await first;
  expect(m.makeCall).toHaveBeenCalledOnce(); expect(m.request).toHaveBeenCalledOnce();
});
