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
  authListeners: new Set<() => void>(), accountListeners: new Set<() => void>(),
  rooms: [] as any[], stopAudio: vi.fn(), displayIncoming: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => m.refs[m.index++] ?? (m.refs[m.index - 1] = { current: initial }),
    useEffect: (effect: () => void | (() => void)) => { m.effects.push(effect); },
  };
});
vi.mock("react-native", () => ({
  Platform: m.platform, AppState: { currentState: "active", addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: "android.permission.RECORD_AUDIO" },
    RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
    check: m.check, request: m.request },
}));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.owner, loading: m.loading }), addAuthChangeListener: (changed: () => void) => { m.authListeners.add(changed); return () => m.authListeners.delete(changed); } }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: Object.assign(() => ({ loadAccount: m.loadAccount }), {
  getState: () => ({ account: m.account, registrationState: "registered" }), subscribe: (changed: () => void) => { m.accountListeners.add(changed); return () => m.accountListeners.delete(changed); },
}) }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: {
  getState: () => ({ incomingCall: m.incoming, activeCalls: m.active }),
  subscribe: (changed: () => void) => { m.callListeners.add(changed); return () => { m.callListeners.delete(changed); }; },
} }));
vi.mock("../lib/sip/diagnostics-store", () => ({ useSipDiagnosticsStore: { getState: () => ({ addEvent: vi.fn() }) } }));
vi.mock("../lib/sip/registration-lifecycle", () => ({ createRegistrationLifecycle: vi.fn(() => ({ changed: vi.fn(), start: vi.fn(), stop: vi.fn(), setActive: vi.fn(), reconnect: vi.fn() })) }));
vi.mock("../lib/push/enrollment-lifecycle", () => ({ createVoipEnrollmentLifecycle: vi.fn() }));
vi.mock("../lib/sip/video-runtime", () => ({ getVideoBridge: vi.fn() }));
vi.mock("../lib/meetings/native-session", async () => {
  const actual = await vi.importActual<typeof import("../lib/meetings/native-session")>("../lib/meetings/native-session");
  return { ...actual, prepareSipMediaOwnership: m.prepare, releaseSipMediaOwnership: m.release };
});
vi.mock("@livekit/react-native", () => ({ registerGlobals: vi.fn(), AudioSession: {
  setAppleAudioConfiguration: vi.fn(async () => {}), startAudioSession: vi.fn(async () => {}),
  stopAudioSession: m.stopAudio, getAudioOutputs: vi.fn(async () => []), selectAudioOutput: vi.fn(async () => {}),
} }));
vi.mock("livekit-client", () => ({
  ConnectionError: class extends Error {}, ConnectionErrorReason: {},
  Room: class {
    listeners = new Map<string, Set<() => void>>();
    localParticipant = { identity: "local", setMicrophoneEnabled: vi.fn(async () => {}), setCameraEnabled: vi.fn(async () => {}) };
    remoteParticipants = new Map(); connect = vi.fn(async () => {}); disconnect = vi.fn(async () => {});
    constructor() { m.rooms.push(this); }
    on(event: string, fn: () => void) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event)!.add(fn); }
    off(event: string, fn: () => void) { this.listeners.get(event)?.delete(fn); }
    emit(event: string) { this.listeners.get(event)?.forEach(fn => fn()); }
  },
}));
vi.mock("../lib/sip/engine", () => ({ sipEngine: { initialize: m.initialize, makeCall: m.makeCall, answerCall: m.answerCall, hangupCall: m.hangupCall, destroy: vi.fn(async () => {}) } }));
vi.mock("../lib/sip/siprix-engine", () => ({ siprixEngine: { consultation: vi.fn(), remainingConsultation: vi.fn() } }));
vi.mock("../lib/sip/native-call", () => ({ nativeCallManager: { initialize: vi.fn(async () => {}),
  displayIncomingCall: m.displayIncoming, destroy: vi.fn(), answerIncomingCall: m.systemAnswer, reportOutgoingCall: m.reportOutgoing, reportCallConnected: vi.fn(),
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
let native: typeof import("../lib/meetings/native-session");
let meeting: import("../lib/meetings/native-session").NativeMeetingLifecycle | undefined;
let cleanup: (() => void) | undefined;
const admission = { url: "wss://synthetic.test", token: "synthetic-only" };
const publishCalls = () => {
  for (const changed of [...m.callListeners]) (changed as any)({ incomingCall: m.incoming, activeCalls: m.active });
};
function mount() {
  const actions = provider();
  const gateCleanup = m.effects[0]() as () => void;
  const providerCleanup = m.effects[1]() as () => void;
  cleanup = () => { gateCleanup(); providerCleanup(); };
  return actions;
}
async function join() {
  meeting = await native.NativeMeetingLifecycle.join("exact-original-admission", admission, { microphone: false, camera: false });
  return m.rooms[0];
}
beforeEach(async () => {
  vi.clearAllMocks();
  m.platform.OS = "android"; m.owner = { id: 17 }; m.loading = false;
  m.account = { id: "assigned", ownerUserId: 17, tenantId: 4, username: "1001", password: "synthetic-only",
    domain: "sip.example.test", displayName: "Test", port: 5061, transport: "TLS", srtp: true, enabled: true };
  m.incoming = null; m.active = {}; m.refs = []; m.effects = []; m.index = 0; m.order = []; m.callListeners.clear(); m.authListeners.clear(); m.accountListeners.clear(); m.rooms = []; meeting = undefined; cleanup = undefined;
  vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "siprix");
  vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL", "1");
  m.check.mockReset().mockImplementation(async () => { m.order.push("check"); return false; });
  m.request.mockReset().mockImplementation(async () => { m.order.push("request"); return "granted"; });
  native = await vi.importActual<typeof import("../lib/meetings/native-session")>("../lib/meetings/native-session");
  m.prepare.mockReset().mockImplementation(native.prepareSipMediaOwnership);
  m.release.mockReset().mockImplementation(native.releaseSipMediaOwnership);
  m.stopAudio.mockReset().mockResolvedValue(undefined);
  m.displayIncoming.mockReset();
  m.initialize.mockReset().mockImplementation(async () => { m.order.push("initialize"); });
  m.makeCall.mockReset().mockImplementation(async () => { m.order.push("dial"); return "outgoing-1"; });
  m.answerCall.mockReset().mockImplementation(async () => { m.order.push("answer"); });
  m.systemAnswer.mockReset().mockResolvedValue(undefined); m.loadAccount.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  cleanup?.();
  for (const room of m.rooms) room.disconnect.mockResolvedValue(undefined);
  m.stopAudio.mockResolvedValue(undefined);
  await meeting?.leave();
  native.clearNativeMeetingMediaForAuth();
  expect(m.callListeners.size).toBe(0); expect(m.authListeners.size).toBe(0); expect(m.accountListeners.size).toBe(0);
  vi.unstubAllEnvs();
});



it("waits for moved publication drain and actual audio-stop acknowledgement before one Answer", async () => {
  const room = await join(), publish = deferred<void>(), audioStop = deferred<void>();
  room.localParticipant.setCameraEnabled.mockImplementationOnce(() => publish.promise);
  m.stopAudio.mockReturnValue(audioStop.promise);
  const camera = meeting!.session.setCamera(true).catch(error => error);
  await vi.waitFor(() => expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledOnce());
  room.emit("moved");
  const actions = mount(); m.incoming = ring(); publishCalls();
  const answer = actions.answerCall("incoming-1"), duplicate = actions.answerCall("incoming-1");
  await vi.waitFor(() => expect(m.prepare).toHaveBeenCalledOnce());
  expect(m.answerCall).not.toHaveBeenCalled(); expect(m.displayIncoming).not.toHaveBeenCalled();
  publish.resolve(); await camera;
  await vi.waitFor(() => expect(m.stopAudio).toHaveBeenCalledOnce());
  expect(m.answerCall).not.toHaveBeenCalled();
  audioStop.resolve(); await Promise.all([answer, duplicate]);
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.displayIncoming).toHaveBeenCalledOnce();
  expect(m.prepare).toHaveBeenCalledOnce(); expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({kind: "sip", state: "active"});
  expect(m.rooms).toHaveLength(1); // No automatic meeting rejoin.
});

it("refuses failed moved teardown and retries only the same ring after acknowledged cleanup", async () => {
  const room = await join(); room.disconnect.mockRejectedValue(new Error("synthetic SDK failure")); room.emit("moved");
  const actions = mount(); m.incoming = ring(); publishCalls();
  await vi.waitFor(() => expect(native.phone11MediaOwnership.getSnapshot().meetingPause).toBe("failed"));
  await expect(actions.answerCall("incoming-1")).rejects.toThrow("pause-failed");
  expect(m.answerCall).not.toHaveBeenCalled(); expect(m.stopAudio).not.toHaveBeenCalled();
  expect(m.incoming?.status).toBe("incoming"); expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  room.disconnect.mockResolvedValue(undefined);
  await actions.answerCall("incoming-1");
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.stopAudio).toHaveBeenCalledOnce();
  expect(m.rooms).toHaveLength(1);
});

it.each(["logout", "owner-replaced", "account-replaced", "account-disabled", "auth-loading", "terminated", "reused-id", "new-id", "unmounted"])("rejects %s while moved cleanup drains without restoring a retired preparation", async change => {
  const room = await join(), stop = deferred<void>(); room.disconnect.mockReturnValue(stop.promise); room.emit("moved");
  const actions = mount(); m.incoming = ring(); publishCalls();
  const answer = actions.answerCall("incoming-1").catch(error => error);
  await vi.waitFor(() => expect(m.initialize).toHaveBeenCalledOnce());
  expect(native.phone11MediaOwnership.getSnapshot().owner?.state).toBe("pending");
  expect(m.answerCall).not.toHaveBeenCalled();
  if (change === "logout") { m.owner = null; native.clearNativeMeetingMediaForAuth(); }
  if (change === "owner-replaced") m.owner = { id: 17 };
  if (change === "account-replaced") m.account = { ...m.account! };
  if (change === "account-disabled") m.account!.enabled = false;
  if (change === "auth-loading") m.loading = true;
  if (change === "terminated") m.incoming = null;
  if (change === "reused-id") m.incoming = ring("replacement-history");
  if (change === "new-id") m.incoming = { ...ring(), id: "incoming-2" };
  if (change === "unmounted") { cleanup!(); cleanup = undefined; }
  for (const changed of [...m.authListeners, ...m.accountListeners]) changed();
  publishCalls(); stop.resolve();
  expect(await answer).toBeInstanceOf(Error);
  await meeting!.leave(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(m.answerCall).not.toHaveBeenCalled(); expect(m.displayIncoming).not.toHaveBeenCalled();
  expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull(); expect(m.rooms).toHaveLength(1);
});

it("preserves the prepared ringing lease on denial, then shares it for an explicit retry", async () => {
  const actions = mount(); m.incoming = ring(); publishCalls();
  await vi.waitFor(() => expect(m.displayIncoming).toHaveBeenCalledOnce());
  const lease = native.phone11MediaOwnership.getSnapshot().owner;
  m.request.mockResolvedValueOnce("denied");
  await expect(actions.answerCall("incoming-1")).rejects.toThrow("Microphone permission is required");
  expect(m.release).not.toHaveBeenCalled(); expect(native.phone11MediaOwnership.getSnapshot().owner).toEqual(lease);
  await actions.answerCall("incoming-1");
  expect(m.prepare).toHaveBeenCalledOnce(); expect(m.answerCall).toHaveBeenCalledOnce();
});

it("coalesces callback-first Answer while the same original lifetime retains one SIP lease", async () => {
  const actions = mount(); const original = ring(); m.incoming = original; publishCalls();
  const command = deferred<void>(); m.answerCall.mockReturnValue(command.promise);
  const answer = actions.answerCall("incoming-1");
  await vi.waitFor(() => expect(m.answerCall).toHaveBeenCalledOnce());
  const lease = native.phone11MediaOwnership.getSnapshot().owner;
  m.incoming = null; m.active = { "incoming-1": { ...original, status: "active" } }; publishCalls();
  const duplicate = actions.answerCall("incoming-1"); command.resolve(); await Promise.all([answer, duplicate]);
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.prepare).toHaveBeenCalledOnce(); expect(m.release).not.toHaveBeenCalled();
  expect(native.phone11MediaOwnership.getSnapshot().owner).toEqual(lease);
});

it("never clears or takes over another current SIP lease when Answer preparation is refused", async () => {
  const other = await native.prepareSipMediaOwnership("different-original");
  const actions = mount(); m.incoming = ring(); publishCalls();
  await expect(actions.answerCall("incoming-1")).rejects.toThrow("busy");
  expect(m.answerCall).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
  expect(native.phone11MediaOwnership.isCurrent(other)).toBe(true);
  native.releaseSipMediaOwnership(other);
});

it("refuses failed native audio stop after room drain, then permits an explicit acknowledged retry", async () => {
  const room = await join(); m.stopAudio.mockRejectedValue(new Error("synthetic audio stop failure"));
  room.emit("moved");
  const actions = mount(); m.incoming = ring(); publishCalls();
  await vi.waitFor(() => expect(native.phone11MediaOwnership.getSnapshot().meetingPause).toBe("failed"));
  await expect(actions.answerCall("incoming-1")).rejects.toThrow("pause-failed");
  expect(m.answerCall).not.toHaveBeenCalled(); expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  m.stopAudio.mockResolvedValue(undefined); await actions.answerCall("incoming-1");
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.rooms).toHaveLength(1);
});

it("rechecks exact lease authority before Answer and can retry after an independently retired lease", async () => {
  const actions = mount();
  m.prepare.mockImplementationOnce(async (id: string) => {
    const lease = await native.prepareSipMediaOwnership(id);
    native.clearNativeMeetingMediaForAuth();
    return lease;
  });
  // A ring can predate this provider's subscription; Answer still owns its gate.
  m.incoming = ring();
  await expect(actions.answerCall("incoming-1")).rejects.toThrow("media ownership changed");
  expect(m.answerCall).not.toHaveBeenCalled(); expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  await actions.answerCall("incoming-1");
  expect(m.answerCall).toHaveBeenCalledOnce(); expect(m.prepare).toHaveBeenCalledTimes(2);
});
