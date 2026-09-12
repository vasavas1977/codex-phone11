import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiprixCall, SiprixEvent, SiprixSnapshot } from "../modules/phone11-siprix";

const runtime = vi.hoisted(() => ({
  platform: { OS: "ios" }, modules: {} as Record<string, unknown>,
  user: { id: 17 } as { id: number } | null,
  authListeners: new Set<() => void>(),
  listeners: new Set<(event: SiprixEvent) => void>(),
  diagnostics: vi.fn(),
  wakeBinding: vi.fn(), storage: new Map<string,string>(), writeHistory: vi.fn(),
  callManager: {
    initialize: vi.fn(async () => {}), displayIncomingCall: vi.fn(), reportOutgoingCall: vi.fn(),
    reportCallConnected: vi.fn(), reportCallEnded: vi.fn(), adoptIncomingCall: vi.fn(),
  },
}));
vi.mock("react-native", () => ({
  Platform: runtime.platform, NativeModules: runtime.modules,
  NativeEventEmitter: class {
    addListener(name: string, listener: (event: SiprixEvent) => void) {
      expect(name).toBe("Phone11SiprixEvent");
      runtime.listeners.add(listener);
      return { remove: () => runtime.listeners.delete(listener) };
    }
  },
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async (key: string) => runtime.storage.get(key) ?? null, setItem: runtime.writeHistory } }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: runtime.user }),
  addAuthChangeListener: (listener: () => void) => {
    runtime.authListeners.add(listener);
    return () => runtime.authListeners.delete(listener);
  },
}));
vi.mock("../lib/sip/diagnostics-store", () => ({
  useSipDiagnosticsStore: { getState: () => ({ addEvent: runtime.diagnostics }) },
}));
vi.mock("../lib/push/client", () => ({ getWakeAdoptionBinding: runtime.wakeBinding }));
vi.mock("../lib/sip/native-call", () => ({ nativeCallManager: runtime.callManager }));

import { createRegistrationLifecycle } from "../lib/sip/registration-lifecycle";
import { SiprixEngine } from "../lib/sip/siprix-engine";
import { useSipAccountStore, type SipAccount } from "../lib/sip/account-store";
import { useSipCallStore } from "../lib/sip/call-store";

const account: SipAccount = {
  id: "test", ownerUserId: 17, username: "1001", password: "not-live-secret",
  domain: "sip.example.test", displayName: "Test", transport: "TLS", port: 5061,
  srtp: true, stun: "stun.example.test", enabled: true,
};

const newCall = (values: Partial<SiprixCall> = {}): SiprixCall => ({
  id: "11", callId: "11", accountId: "1", direction: "outgoing", state: "dialing",
  remoteUri: "sip:2002@sip.example.test", hasVideo: false, muted: false, held: false,
  holdState: 0, ...values,
});
const emptySnapshot = (): SiprixSnapshot => ({
  initialized: false, generation: 0, sequence: 0, sdkVersion: "1.0.40", accounts: [],
  calls: [], audioSessionActive: false, speaker: false, trialNotified: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let snapshot: SiprixSnapshot;
const bridge = {
  readCompletedWakeCalls: vi.fn(async () => [] as import("../modules/phone11-siprix").CompletedWakeCall[]),
  ackCompletedWakeCalls: vi.fn(async (_binding: unknown, _ids: string[]) => {}),
  bindForegroundWakeContext: vi.fn(async () => {}),
  adoptIncomingWake: vi.fn(async () => structuredClone(snapshot)),
  restoreIncomingWakeDelegate: vi.fn(async () => {}),
  getSnapshot: vi.fn(async () => structuredClone(snapshot)),
  initialize: vi.fn(async () => {
    snapshot.initialized = true;
    snapshot.generation++;
    return structuredClone(snapshot);
  }),
  createAccount: vi.fn(async (_config: unknown) => {
    const result = { id: "1", accountId: "1", registrationState: "unregistered" as const };
    snapshot.accounts = [result];
    return result;
  }),
  registerAccount: vi.fn(async (id: string, _expires: number) => {
    // Mirrors the real native bridge snapshot, covered by native-runtime.m.
    snapshot.accounts = snapshot.accounts.map(account => account.accountId === id
      ? { id: account.id, accountId: id, registrationState: "registering" } : account);
  }),
  makeCall: vi.fn(async (_id: string, _destination: string) => newCall()),
  answerCall: vi.fn(async (_id: string) => {}),
  hangupCall: vi.fn(async (_id: string) => {}),
  setMute: vi.fn(async (_id: string, _muted: boolean) => {}),
  setHold: vi.fn(async (_id: string, _held: boolean) => {}),
  setSpeaker: vi.fn(async (_speaker: boolean) => {}),
  sendDtmf: vi.fn(async (_id: string, _digits: string) => {}),
  handleNativeAudioSession: vi.fn(async (_active: boolean) => {}),
  destroy: vi.fn(async () => {
    snapshot = { ...emptySnapshot(), generation: snapshot.generation, sequence: snapshot.sequence };
  }),
};
let engine: SiprixEngine;

function emit(data: Omit<SiprixEvent, "generation" | "sequence"> | Record<string, unknown>) {
  const event = { ...data, generation: snapshot.generation, sequence: ++snapshot.sequence } as SiprixEvent;
  runtime.listeners.forEach(listener => listener(event));
  return event;
}
function registered() {
  emit({ type: "registration", account: { id: "1", accountId: "1", registrationState: "registered", regState: 0 } });
}
async function ready() { await engine.initialize(); registered(); }

beforeEach(() => {
    vi.clearAllMocks();
    runtime.storage.clear(); runtime.writeHistory.mockReset().mockImplementation(async (key: string, value: string) => { runtime.storage.set(key,value); });
    bridge.readCompletedWakeCalls.mockReset().mockResolvedValue([]); bridge.ackCompletedWakeCalls.mockReset().mockResolvedValue(undefined);
    runtime.wakeBinding.mockReset().mockResolvedValue(null);
    snapshot = emptySnapshot();
    runtime.platform.OS = "ios";
    runtime.modules.Phone11Siprix = bridge;
    runtime.user = { id: 17 };
    runtime.listeners.clear();
    runtime.authListeners.clear();
    useSipAccountStore.setState({ account: { ...account }, registrationState: "unregistered", registrationError: null });
    useSipCallStore.setState({ activeCalls: {}, incomingCall: null });
    engine = new SiprixEngine();
  });
afterEach(async () => { await engine.destroy(); });

describe("Siprix native adapter", () => {

  it.each(["callback", "stalled"])("gives the real initialized native snapshot its registration grace (%s)", async (outcome) => {
    vi.useFakeTimers();
    const restart = vi.fn(() => engine.restart());
    const lifecycle = createRegistrationLifecycle({
      snapshot: () => ({
        userId: runtime.user?.id, authLoading: false,
        account: useSipAccountStore.getState().account,
        registrationState: useSipAccountStore.getState().registrationState,
        hasLiveCall: !!useSipCallStore.getState().incomingCall ||
          Object.keys(useSipCallStore.getState().activeCalls).length > 0,
      }),
      loadAccount: async () => {}, initialize: () => engine.initialize(), restart,
      onError: () => { throw new Error("Unexpected lifecycle failure"); },
    }, true);
    const unsubscribe = useSipAccountStore.subscribe(() => lifecycle.changed());
    try {
      lifecycle.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(bridge.registerAccount).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(restart).not.toHaveBeenCalled();
      expect(bridge.destroy).not.toHaveBeenCalled();
      expect(useSipAccountStore.getState().registrationState).toBe("registering");
      if (outcome === "callback") {
        await vi.advanceTimersByTimeAsync(5_000);
        registered();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(useSipAccountStore.getState().registrationState).toBe("registered");
        expect(restart).not.toHaveBeenCalled();
      } else {
        await vi.advanceTimersByTimeAsync(24_999);
        expect(restart).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(restart).toHaveBeenCalledOnce();
        expect(bridge.initialize).toHaveBeenCalledTimes(2);
      }
    } finally {
      lifecycle.stop(); unsubscribe(); vi.useRealTimers();
    }
  });

  it("explicitly registers after account creation and only accepts native regState success", async () => {
    await engine.initialize();
    expect(bridge.createAccount).toHaveBeenCalledWith({
      sipServer: account.domain, sipExtension: account.username, sipPassword: account.password,
      sipAuthId: account.username, displName: account.displayName,
      transport: "TLS", port: 5061, secureMedia: 1, stunServer: account.stun,
    });
    expect(bridge.registerAccount).toHaveBeenCalledWith("1", 300);
    expect(useSipAccountStore.getState().registrationState).not.toBe("registered");
    emit({ type: "registration", account: { id: "1", accountId: "1", registrationState: "registered" } });
    expect(useSipAccountStore.getState().registrationState).not.toBe("registered");
    registered();
    expect(useSipAccountStore.getState().registrationState).toBe("registered");
    await engine.initialize();
    expect(bridge.initialize).toHaveBeenCalledOnce();
  });

  it("omits empty optional account keys rather than sending null across the RN bridge", async () => {
    useSipAccountStore.setState({ account: { ...account, proxy: "", stun: "" } });
    await engine.initialize();
    const config = bridge.createAccount.mock.calls[0][0];
    expect(config).not.toHaveProperty("sipProxy");
    expect(config).not.toHaveProperty("stunServer");
  });

  it("records native SDK version and numeric SIP status without raw response text", async () => {
    await engine.initialize();
    expect(runtime.diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      message: "Siprix native engine initialized", context: expect.objectContaining({ sdkVersion: "1.0.40" }),
    }));
    emit({ type: "registration", account: { id: "1", accountId: "1", registrationState: "failed", regState: 1, sipStatusCode: 403 } });
    expect(runtime.diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      message: "Siprix registration failed", context: expect.objectContaining({ regState: 1, sipStatusCode: 403 }),
    }));
    expect(JSON.stringify(runtime.diagnostics.mock.calls)).not.toContain(account.password);
  });

  it("recovers confirmation emitted before account Promise resolution from the native snapshot", async () => {
    bridge.registerAccount.mockImplementationOnce(async () => {
      snapshot.accounts = [{ id: "1", accountId: "1", registrationState: "registered", regState: 0 }];
      snapshot.sequence++;
    });
    await engine.initialize();
    expect(useSipAccountStore.getState().registrationState).toBe("registered");
  });

  it("awaits CallKeep readiness before exposing a registered account to incoming calls", async () => {
    const pending = deferred<void>();
    runtime.callManager.initialize.mockReturnValueOnce(pending.promise);
    const start = engine.initialize();
    await vi.waitFor(() => expect(runtime.callManager.initialize).toHaveBeenCalledOnce());
    expect(bridge.createAccount).not.toHaveBeenCalled();
    pending.resolve();
    await start;
    expect(bridge.createAccount).toHaveBeenCalledOnce();
  });

  it("does not register when CallKeep setup rejects", async () => {
    runtime.callManager.initialize.mockRejectedValueOnce(new Error("CallKeep unavailable"));
    await expect(engine.initialize()).rejects.toThrow("initialization");
    expect(bridge.createAccount).not.toHaveBeenCalled();
    expect(bridge.destroy).toHaveBeenCalledOnce();
  });

  it("does not place calls before native registration confirmation", async () => {
    await engine.initialize();
    await expect(engine.makeCall("2002")).rejects.toThrow("not registered");
    expect(bridge.makeCall).not.toHaveBeenCalled();
  });

  it("maps native failure, removal, progress, and network loss without optimistic recovery", async () => {
    await ready();
    for (const [state, regState] of [["failed", 1], ["unregistered", 2], ["registering", 3]] as const) {
      emit({ type: "registration", account: { id: "1", accountId: "1", registrationState: state, regState } });
      expect(useSipAccountStore.getState().registrationState).toBe(state);
    }
    emit({ type: "network", networkState: 0 });
    expect(useSipAccountStore.getState().registrationState).toBe("network_error");
    emit({ type: "network", networkState: 1 });
    expect(useSipAccountStore.getState().registrationState).toBe("network_error");
  });

  it("does not let a post-loss snapshot revive an older native registration success", async () => {
    bridge.registerAccount.mockImplementationOnce(async () => {
      snapshot.accounts = [{ id: "1", accountId: "1", registrationState: "registered", regState: 0 }];
      registered();
      emit({ type: "network", networkState: 0 });
    });
    await engine.initialize();
    expect(useSipAccountStore.getState().registrationState).toBe("network_error");
    registered();
    expect(useSipAccountStore.getState().registrationState).toBe("registered");
  });

  it.each(["android", "web"])("rejects selected Siprix on %s without loading another engine", async platform => {
    runtime.platform.OS = platform;
    await expect(engine.initialize()).rejects.toThrow("no PJSIP fallback");
    expect(bridge.initialize).not.toHaveBeenCalled();
  });

  it("rejects a missing native module clearly", async () => {
    delete runtime.modules.Phone11Siprix;
    await expect(engine.initialize()).rejects.toThrow("native module is missing");
    expect(useSipAccountStore.getState().registrationState).toBe("failed");
  });

  it("does not create a native session for another user's credentials", async () => {
    runtime.user = { id: 29 };
    await engine.initialize();
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(useSipAccountStore.getState().registrationState).toBe("unregistered");
  });

  it("discards a previous JS owner's native session before registering new credentials", async () => {
    snapshot.initialized = true;
    snapshot.accounts = [{ id: "old", accountId: "old", registrationState: "registered", regState: 0 }];
    await engine.initialize();
    expect(bridge.destroy).toHaveBeenCalledOnce();
    expect(bridge.destroy.mock.invocationCallOrder[0]).toBeLessThan(bridge.initialize.mock.invocationCallOrder[0]);
    expect(useSipAccountStore.getState().registrationState).not.toBe("registered");
  });

  it("ignores wrong account, stale generation, duplicate and out-of-order callbacks", async () => {
    await ready();
    const listener = [...runtime.listeners][0];
    const failure = { type: "registration", account: { id: "1", accountId: "1", registrationState: "failed", regState: 1 } };
    listener({ ...failure, generation: snapshot.generation - 1, sequence: 900 } as SiprixEvent);
    listener({ ...failure, generation: snapshot.generation, sequence: snapshot.sequence } as SiprixEvent);
    emit({ ...failure, account: { ...failure.account, accountId: "different" } });
    expect(useSipAccountStore.getState().registrationState).toBe("registered");
  });

  it("blocks native completion and callbacks after logout during account creation", async () => {
    const pending = deferred<Awaited<ReturnType<typeof bridge.createAccount>>>();
    bridge.createAccount.mockReturnValueOnce(pending.promise);
    const start = engine.initialize();
    await vi.waitFor(() => expect(bridge.createAccount).toHaveBeenCalledOnce());
    const listener = [...runtime.listeners][0];
    runtime.user = null;
    runtime.authListeners.forEach(listener => listener());
    listener({ type: "registration", generation: snapshot.generation, sequence: 20,
      account: { id: "1", accountId: "1", registrationState: "registered", regState: 0 } });
    pending.resolve({ id: "1", accountId: "1", registrationState: "unregistered" });
    await start;
    await engine.destroy();
    expect(bridge.registerAccount).not.toHaveBeenCalled();
    expect(useSipAccountStore.getState().registrationState).toBe("unregistered");
    expect(runtime.listeners.size).toBe(0);
  });

  it("invalidates same-user credential replacement and does not reuse the old registration", async () => {
    await ready();
    useSipAccountStore.setState({ account: { ...account, password: "another-test-secret" } });
    await expect(engine.makeCall("2002")).rejects.toThrow("session");
    await engine.initialize();
    expect(bridge.initialize).toHaveBeenCalledTimes(2);
    expect(bridge.createAccount.mock.calls[1][0]).toMatchObject({ sipPassword: "another-test-secret" });
  });

  it("keeps registration and calls when diagnostics hydrates identical credentials into a new object", async () => {
    await ready();
    await engine.makeCall("2002");
    const hydrated = JSON.parse(JSON.stringify(useSipAccountStore.getState().account));
    useSipAccountStore.setState({ account: hydrated });
    await engine.initialize();
    expect(bridge.destroy).not.toHaveBeenCalled();
    expect(bridge.initialize).toHaveBeenCalledOnce();
    expect(useSipAccountStore.getState().registrationState).toBe("registered");
    expect(useSipCallStore.getState().activeCalls["11"]).toBeDefined();
  });

  it.each([
    { domain: "new.example.test" }, { proxy: "proxy.example.test" }, { transport: "TCP" as const },
    { port: 5060 }, { srtp: false }, { stun: "new-stun.example.test" }, { enabled: false },
    { username: "1002" }, { tenantId: 9 }, { id: "new" }, { displayName: "New name" }, { ownerUserId: 29 },
  ])("invalidates a changed account field %o", async change => {
    await ready();
    useSipAccountStore.setState({ account: { ...account, ...change } });
    await expect(engine.makeCall("2002")).rejects.toThrow("session");
    expect(bridge.destroy).toHaveBeenCalledOnce();
  });

  it("retains failed native cleanup for retry and blocks new accounts", async () => {
    await ready();
    bridge.destroy.mockRejectedValueOnce(new Error("native busy"));
    await expect(engine.destroy()).rejects.toThrow("cleanup");
    expect(useSipAccountStore.getState().registrationState).toBe("failed");
    bridge.destroy.mockRejectedValueOnce(new Error("still busy"));
    await expect(engine.initialize()).rejects.toThrow("cleanup");
    expect(bridge.createAccount).toHaveBeenCalledOnce();
    await engine.initialize();
    expect(bridge.createAccount).toHaveBeenCalledTimes(2);
  });

  it("does not restart a session canceled by a later destroy", async () => {
    await ready();
    const pending = deferred<void>();
    bridge.destroy.mockReturnValueOnce(pending.promise);
    const restart = engine.restart();
    await vi.waitFor(() => expect(bridge.destroy).toHaveBeenCalledOnce());
    const stop = engine.destroy();
    pending.resolve();
    await Promise.all([restart, stop]);
    expect(bridge.initialize).toHaveBeenCalledOnce();
    expect(useSipAccountStore.getState().registrationState).toBe("unregistered");
  });

  it("creates outgoing calls and confirms/holds/ends only from SDK events", async () => {
    await ready();
    expect(await engine.makeCall("2002")).toBe("11");
    expect(bridge.makeCall).toHaveBeenCalledWith("1", "sip:2002@sip.example.test");
    expect(useSipCallStore.getState().activeCalls["11"].status).toBe("calling");
    emit({ type: "callConnected", call: newCall({ state: "connected" }) });
    expect(useSipCallStore.getState().activeCalls["11"].status).toBe("active");
    await engine.setHold("11", true);
    expect(useSipCallStore.getState().activeCalls["11"].status).toBe("active");
    emit({ type: "callHeld", call: newCall({ state: "held", held: true, holdState: 2 }) });
    expect(useSipCallStore.getState().activeCalls["11"].status).toBe("held");
    await engine.hangupCall("11");
    expect(useSipCallStore.getState().activeCalls["11"]).toBeDefined();
    emit({ type: "callTerminated", call: newCall({ state: "terminated" }) });
    expect(useSipCallStore.getState().activeCalls).toEqual({});
  });

  it("keeps inbound ringing until native connected and deduplicates incoming callbacks", async () => {
    await ready();
    const incoming = newCall({ direction: "incoming", state: "ringing" });
    emit({ type: "callIncoming", call: incoming });
    emit({ type: "callIncoming", call: incoming });
    expect(useSipCallStore.getState().incomingCall?.remoteNumber).toBe("2002");
    await engine.answerCall("11");
    expect(useSipCallStore.getState().incomingCall?.status).toBe("incoming");
    expect(runtime.callManager.reportCallConnected).not.toHaveBeenCalled();
    expect(runtime.callManager.displayIncomingCall).toHaveBeenCalledOnce();
    emit({ type: "callConnected", call: { ...incoming, state: "connected" } });
    expect(useSipCallStore.getState().incomingCall).toBeNull();
    expect(useSipCallStore.getState().activeCalls["11"].direction).toBe("inbound");
    expect(useSipCallStore.getState().activeCalls["11"].connectTime).toBeInstanceOf(Date);
    expect(runtime.callManager.reportCallConnected).toHaveBeenCalledWith("11");
  });

  it.each([
    ["sip:phone11-test@internal.example.test", "phone11-test"],
    ["sips:+66812345678@internal.example.test;transport=tls", "+66812345678"],
    ['"Support desk" <sip:3001@internal.example.test>', "3001"],
    ["3001", "3001"],
  ])("shows a clean incoming system handle while preserving the native URI (%s)", async (remoteUri, label) => {
    await ready();
    const incoming = newCall({ direction: "incoming", state: "ringing", remoteUri });
    emit({ type: "callIncoming", call: incoming }); emit({ type: "callIncoming", call: incoming });
    expect(runtime.callManager.displayIncomingCall).toHaveBeenCalledOnce();
    expect(runtime.callManager.displayIncomingCall).toHaveBeenCalledWith("11", label);
    const native = useSipCallStore.getState().getCall("11");
    expect(native.getRemoteUri()).toBe(remoteUri); expect(native.getInfo().remoteUri).toBe(remoteUri);
    expect(useSipCallStore.getState().incomingCall?.history?.number).toBe(label);
    expect(bridge.makeCall).not.toHaveBeenCalled();
    await engine.answerCall("11"); expect(bridge.answerCall).toHaveBeenCalledWith("11");
  });

  it("normalizes only the outgoing system handle and deduplicates early callbacks", async () => {
    await ready();
    const remoteUri = "sips:+66812345678@internal.example.test;transport=tls";
    const outgoing = newCall({ remoteUri });
    bridge.makeCall.mockImplementationOnce(async () => {
      emit({ type: "callProceeding", call: { ...outgoing, state: "proceeding" } }); return outgoing;
    });
    expect(await engine.makeCall(remoteUri)).toBe("11");
    expect(bridge.makeCall).toHaveBeenCalledWith("1", remoteUri);
    expect(runtime.callManager.reportOutgoingCall).toHaveBeenCalledOnce();
    expect(runtime.callManager.reportOutgoingCall).toHaveBeenCalledWith("11", "+66812345678");
    expect(useSipCallStore.getState().activeCalls["11"]._nativeCall.getRemoteUri()).toBe(remoteUri);
    expect(useSipCallStore.getState().activeCalls["11"].history?.number).toBe("+66812345678");
  });

  it("records only sequenced current-session audio activation booleans without claiming call connection", async () => {
    await ready(); emit({ type: "callIncoming", call: newCall({ direction: "incoming", state: "ringing" }) });
    const active = emit({ type: "audioSession", audioSessionActive: true, speaker: false });
    runtime.listeners.forEach(listener => listener(active)); // Same sequence is ignored.
    runtime.listeners.forEach(listener => listener({ ...active, sequence: active.sequence + 1, generation: active.generation + 1 }));
    emit({ type: "audioSession", audioSessionActive: "private-device-detail" });
    emit({ type: "audioSession", audioSessionActive: false, speaker: false });
    runtime.user = { id: 29 }; emit({ type: "audioSession", audioSessionActive: true, speaker: false });
    const diagnostics = runtime.diagnostics.mock.calls.map(([entry]) => entry).filter(entry => entry.message === "Siprix native audio session changed");
    expect(diagnostics).toEqual([
      { level: "info", category: "media", message: "Siprix native audio session changed", context: { active: true } },
      { level: "info", category: "media", message: "Siprix native audio session changed", context: { active: false } },
    ]);
    expect(runtime.callManager.reportCallConnected).not.toHaveBeenCalled();
    expect(useSipCallStore.getState().incomingCall?.status).toBe("incoming");
  });

  it("distinguishes a requested Answer from SDK acceptance and actual connection", async () => {
    await ready();
    emit({ type: "callIncoming", call: newCall({ direction: "incoming", state: "ringing" }) });
    const accepted = deferred<void>();
    bridge.answerCall.mockImplementationOnce(() => accepted.promise);
    const answer = engine.answerCall("11");
    expect(runtime.diagnostics).toHaveBeenCalledWith(expect.objectContaining({ message: "Siprix answer requested" }));
    expect(runtime.diagnostics).not.toHaveBeenCalledWith(expect.objectContaining({ message: "Siprix answer command accepted" }));
    accepted.resolve();
    await answer;
    expect(runtime.diagnostics).toHaveBeenCalledWith(expect.objectContaining({ message: "Siprix answer command accepted", context: { callId: "11" } }));
    expect(useSipCallStore.getState().incomingCall?.status).toBe("incoming");
    expect(runtime.callManager.reportCallConnected).not.toHaveBeenCalled();
  });

  it("does not record Answer acceptance or raw SDK text after rejection", async () => {
    await ready();
    emit({ type: "callIncoming", call: newCall({ direction: "incoming", state: "ringing" }) });
    bridge.answerCall.mockRejectedValueOnce(new Error(account.password));
    await expect(engine.answerCall("11")).rejects.toThrow("Siprix answer failed");
    expect(runtime.diagnostics).not.toHaveBeenCalledWith(expect.objectContaining({ message: "Siprix answer command accepted" }));
    expect(JSON.stringify(runtime.diagnostics.mock.calls)).not.toContain(account.password);
    expect(useSipCallStore.getState().incomingCall?.status).toBe("incoming");
  });

  it("enforces single-call mode for concurrent commands and second incoming calls", async () => {
    await ready();
    const results = await Promise.allSettled([engine.makeCall("2002"), engine.makeCall("2003")]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(bridge.makeCall).toHaveBeenCalledOnce();
    emit({ type: "callIncoming", call: newCall({ id: "12", callId: "12", direction: "incoming", state: "ringing" }) });
    expect(bridge.hangupCall).toHaveBeenCalledWith("12");
    expect(useSipCallStore.getState().incomingCall).toBeNull();
  });

  it("never resurrects an outgoing call terminated before its native Promise resolves", async () => {
    await ready();
    bridge.makeCall.mockImplementationOnce(async () => {
      emit({ type: "callTerminated", call: newCall({ state: "terminated" }) });
      return newCall();
    });
    expect(await engine.makeCall("2002")).toBeNull();
    emit({ type: "callConnected", call: newCall({ state: "connected" }) });
    expect(useSipCallStore.getState().activeCalls).toEqual({});
  });

  it("does not downgrade early-connected calls when the invite Promise returns", async () => {
    await ready();
    bridge.makeCall.mockImplementationOnce(async () => {
      emit({ type: "callConnected", call: newCall({ state: "connected" }) });
      return newCall();
    });
    await engine.makeCall("2002");
    emit({ type: "callProceeding", call: newCall({ state: "proceeding" }) });
    expect(useSipCallStore.getState().activeCalls["11"].status).toBe("active");
    expect(runtime.callManager.reportOutgoingCall).toHaveBeenCalledOnce();
    expect(runtime.callManager.reportCallConnected).toHaveBeenCalledOnce();
    expect(runtime.callManager.reportOutgoingCall.mock.invocationCallOrder[0])
      .toBeLessThan(runtime.callManager.reportCallConnected.mock.invocationCallOrder[0]);
  });

  it("reports native remote termination and cleanup to CallKit only once", async () => {
    await ready();
    await engine.makeCall("2002");
    emit({ type: "callTerminated", call: newCall({ state: "terminated" }) });
    emit({ type: "callTerminated", call: newCall({ state: "terminated" }) });
    await engine.destroy();
    expect(runtime.callManager.reportCallEnded).toHaveBeenCalledOnce();
    expect(runtime.callManager.reportCallEnded).toHaveBeenCalledWith("11");
  });

  it("does not report CallKit connected from a held or mute callback", async () => {
    await ready();
    await engine.makeCall("2002");
    emit({ type: "callHeld", call: newCall({ state: "held", held: true, holdState: 1 }) });
    emit({ type: "callMuted", call: newCall({ state: "connected", muted: true }) });
    expect(runtime.callManager.reportCallConnected).not.toHaveBeenCalled();
    emit({ type: "callConnected", call: newCall({ state: "connected" }) });
    expect(runtime.callManager.reportCallConnected).toHaveBeenCalledOnce();
  });

  it("rejects video and every transfer entry point without native bypass", async () => {
    await ready();
    await expect(engine.makeCall("2002", true)).rejects.toThrow("video");
    await engine.makeCall("2002");
    await expect(engine.answerCall("11", true)).rejects.toThrow("video");
    await expect(engine.transferCall("11", "2003")).rejects.toThrow("transfer");
    await expect(useSipCallStore.getState().getCall("11").xferReplaces({})).rejects.toThrow("attended transfer");
    expect(bridge.answerCall).not.toHaveBeenCalled();
  });

  it("rejects unknown states/events without manufacturing an active call", async () => {
    await ready();
    emit({ type: "callConnected", call: newCall({ state: "unexpected" as SiprixCall["state"] }) });
    emit({ type: "futureEvent", call: newCall({ state: "connected" }) });
    expect(useSipCallStore.getState().activeCalls).toEqual({});
  });

  it("forwards controls and native errors without retaining raw error text in diagnostics", async () => {
    await ready();
    await engine.makeCall("2002");
    await engine.setMute("11", true);
    expect(bridge.setMute).toHaveBeenCalledWith("11", true);
    await engine.setSpeaker("11", true);
    expect(bridge.setSpeaker).toHaveBeenCalledWith(true);
    expect(useSipCallStore.getState().activeCalls["11"].isSpeaker).toBe(true);
    await engine.sendDtmf("11", "12#a");
    expect(bridge.sendDtmf).toHaveBeenCalledWith("11", "12#A");
    await expect(engine.sendDtmf("11", "bad data")).rejects.toThrow("Invalid DTMF");
    bridge.setMute.mockRejectedValueOnce(Object.assign(new Error(account.password), { code: "E_SIPRIX_-123" }));
    await expect(engine.setMute("11", false)).rejects.toThrow("E_SIPRIX_-123");
    expect(JSON.stringify(runtime.diagnostics.mock.calls)).not.toContain(account.password);
  });

  it("only opens audio on CallKit activation and serializes deactivation/reactivation", async () => {
    await ready();
    await engine.makeCall("2002");
    emit({ type: "callConnected", call: newCall({ state: "connected" }) });
    expect(bridge.handleNativeAudioSession).not.toHaveBeenCalled();
    await engine.handleNativeAudioSession(true);
    await engine.handleNativeAudioSession(true);
    expect(bridge.handleNativeAudioSession.mock.calls).toEqual([[true]]);
    const pending = deferred<void>();
    bridge.handleNativeAudioSession.mockReturnValueOnce(pending.promise);
    const off = engine.handleNativeAudioSession(false);
    const on = engine.handleNativeAudioSession(true);
    await vi.waitFor(() => expect(bridge.handleNativeAudioSession).toHaveBeenCalledTimes(2));
    pending.resolve();
    await Promise.all([off, on]);
    expect(bridge.handleNativeAudioSession.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("retries failed audio activation and drops an activation queued before destroy", async () => {
    await ready();
    bridge.handleNativeAudioSession.mockRejectedValueOnce(new Error("audio unavailable"));
    await expect(engine.handleNativeAudioSession(true)).rejects.toThrow("audio session");
    await engine.handleNativeAudioSession(true);
    expect(bridge.handleNativeAudioSession).toHaveBeenCalledTimes(2);
    const audio = engine.handleNativeAudioSession(false);
    const cleanup = engine.destroy();
    await Promise.all([audio, cleanup]);
    expect(bridge.handleNativeAudioSession).toHaveBeenCalledTimes(2);
  });
});


describe("validated native wake adoption", () => {
  const binding = { bindingId: "binding", ownerUserId: 17, tenantId: 2, deviceId: "device", sessionBinding: "session", expiresAt: Date.now()+600000 };
  const uuid = "11111111-1111-4111-8111-111111111111";
  function pendingWake(state: "ringing" | "connected" = "ringing") {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } });
    snapshot = { ...emptySnapshot(), initialized: true, generation: 7, sequence: 5,
      nativeWake: { ...binding, v: 1, callUUID: uuid, expiresAt: Date.now()+30000, grantExpiresAt: binding.expiresAt },
      accounts: [{ id: "1", accountId: "1", registrationState: "registered", regState: 0 }],
      calls: [newCall({ direction: "incoming", state, wakeCallUUID: uuid, wakeSystemAnswered: state === "connected" })] };
    runtime.wakeBinding.mockResolvedValue(binding);
  }
  it.each(["ringing", "connected"] as const)("adopts a %s native wake without destroying, registering, or reporting another system call", async state => {
    pendingWake(state);
    await engine.initialize();
    expect(bridge.destroy).not.toHaveBeenCalled(); expect(bridge.initialize).not.toHaveBeenCalled();
    expect(bridge.createAccount).not.toHaveBeenCalled(); expect(bridge.registerAccount).not.toHaveBeenCalled();
    expect(bridge.adoptIncomingWake).toHaveBeenCalledWith(binding, expect.objectContaining({ sipExtension: account.username }));
    expect(bridge.restoreIncomingWakeDelegate).toHaveBeenCalledOnce();
    expect(runtime.callManager.adoptIncomingCall).toHaveBeenCalledWith("11", uuid, state === "connected");
    expect(runtime.callManager.displayIncomingCall).not.toHaveBeenCalled();
    expect(useSipAccountStore.getState().registrationState).toBe("registered");
  });
  it.each(["unverified", "session", "tenant"])("refuses %s wake without tearing down its native owner", async reason => {
    pendingWake();
    runtime.wakeBinding.mockResolvedValue(reason === "unverified" ? null : { ...binding, ...(reason === "session" ? { sessionBinding: "replacement" } : { tenantId: 9 }) });
    await expect(engine.initialize()).rejects.toThrow("initialization failed");
    expect(bridge.adoptIncomingWake).not.toHaveBeenCalled(); expect(bridge.destroy).not.toHaveBeenCalled();
    expect(runtime.callManager.adoptIncomingCall).not.toHaveBeenCalled();
  });
  it("does not adopt after same-user re-login during server verification", async () => {
    pendingWake(); const wait=deferred<typeof binding>(); runtime.wakeBinding.mockReturnValue(wait.promise);
    const task=engine.initialize(); await vi.waitFor(() => expect(runtime.wakeBinding).toHaveBeenCalled());
    runtime.user={ id:17 }; wait.resolve(binding); await task;
    expect(bridge.adoptIncomingWake).not.toHaveBeenCalled(); expect(bridge.destroy).not.toHaveBeenCalled();
  });
  it.each(["ringing", "connected", "dialing"] as const)("preserves a %s call found during recovery inspection", async (state) => {
    await ready();
    snapshot.calls = [newCall({ state, direction: state === "ringing" ? "incoming" : "outgoing" })];
    snapshot.sequence++;
    await engine.restart();
    expect(bridge.destroy).not.toHaveBeenCalled();
    expect(useSipCallStore.getState().activeCalls["11"] ?? useSipCallStore.getState().incomingCall).toBeTruthy();
  });
  it("preserves a newer call event while an older idle snapshot is pending", async () => {
    await ready();
    const old = structuredClone(snapshot);
    const wait = deferred<SiprixSnapshot>(); bridge.getSnapshot.mockReturnValueOnce(wait.promise);
    const task = engine.restart();
    emit({ type: "callIncoming", call: newCall({ state: "ringing", direction: "incoming" }) });
    wait.resolve(old); await task;
    expect(bridge.destroy).not.toHaveBeenCalled();
    expect(useSipCallStore.getState().incomingCall?.id).toBe("11");
  });
  it("keeps a verified wake alive on foreground restart", async () => {
    pendingWake(); await engine.initialize();
    await engine.restart();
    expect(bridge.destroy).not.toHaveBeenCalled(); expect(bridge.initialize).not.toHaveBeenCalled();
    expect(runtime.callManager.adoptIncomingCall).toHaveBeenCalledOnce();
  });
  it("binds only the current authenticated account and tenant for a future warm wake", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } }); await ready();
    await engine.bindWakeOwner(binding);
    expect(bridge.bindForegroundWakeContext).toHaveBeenCalledWith(binding, expect.objectContaining({ sipServer: account.domain }));
    await expect(engine.bindWakeOwner({ ...binding, tenantId: 9 })).rejects.toThrow("does not match");
    expect(bridge.bindForegroundWakeContext).toHaveBeenCalledOnce();
  });
  it("clears an adopted session after native wake cleanup fails without retaining a live call", async () => {
    pendingWake(); await engine.initialize();
    emit({ type: "error", operation: "wakeCleanup", code: -1 });
    await vi.waitFor(() => expect(bridge.destroy).toHaveBeenCalledOnce());
    expect(useSipCallStore.getState().incomingCall).toBeNull();
    expect(useSipAccountStore.getState().registrationState).toBe("failed");
  });

  it("does not resurrect registration when destroy wins during wake restart inspection", async () => {
    pendingWake(); await engine.initialize();
    const wait=deferred<SiprixSnapshot>(); bridge.getSnapshot.mockReturnValueOnce(wait.promise);
    const restart=engine.restart(); await engine.destroy();
    wait.resolve({ ...emptySnapshot() }); await restart;
    expect(bridge.destroy).toHaveBeenCalledOnce();
    expect(bridge.initialize).not.toHaveBeenCalled(); expect(bridge.adoptIncomingWake).toHaveBeenCalledOnce();
  });

  it("restores a current cached wake owner after native account restart", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } });
    runtime.wakeBinding.mockResolvedValue(binding);
    await ready(); await engine.restart();
    expect(bridge.bindForegroundWakeContext).toHaveBeenCalledTimes(2);
    expect(bridge.bindForegroundWakeContext).toHaveBeenLastCalledWith(binding, expect.objectContaining({ sipServer: account.domain }));
    expect(bridge.destroy).toHaveBeenCalledOnce();
  });
  it.each(["owner", "tenant", "expired", "unverified"])("does not bind a %s wake identity on a fresh account", async reason => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } });
    runtime.wakeBinding.mockResolvedValue(reason === "unverified" ? null : {
      ...binding, ...(reason === "owner" ? { ownerUserId: 99 } : reason === "tenant" ? { tenantId: 99 } : { expiresAt: Date.now()-1 }),
    });
    await ready();
    expect(bridge.bindForegroundWakeContext).not.toHaveBeenCalled();
    expect(bridge.destroy).not.toHaveBeenCalled();
    expect(useSipAccountStore.getState().registrationState).toBe("registered");
  });
  it("does not bind a resolved owner after the authentication session changes", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } });
    const wait = deferred<typeof binding>(); runtime.wakeBinding.mockReturnValue(wait.promise);
    const task = engine.initialize();
    await vi.waitFor(() => expect(runtime.wakeBinding).toHaveBeenCalledOnce());
    runtime.user = { id: 17 }; // A new login object, even for the same owner.
    runtime.authListeners.forEach(listener => listener());
    wait.resolve(binding); await task;
    expect(bridge.bindForegroundWakeContext).not.toHaveBeenCalled();
  });
  it("preserves an incoming call when warm-owner rebinding fails", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } });
    const wait = deferred<typeof binding>(); runtime.wakeBinding.mockReturnValue(wait.promise);
    const task = engine.initialize();
    await vi.waitFor(() => expect(runtime.wakeBinding).toHaveBeenCalledOnce());
    emit({ type: "callIncoming", call: newCall({ state: "ringing", direction: "incoming" }) });
    bridge.bindForegroundWakeContext.mockRejectedValueOnce(new Error("native owner guard rejected"));
    wait.resolve(binding); await task;
    expect(useSipCallStore.getState().incomingCall?.id).toBe("11");
    expect(bridge.destroy).not.toHaveBeenCalled();
  });

  it("does not bind after phone account configuration changes during verification", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } });
    const wait = deferred<typeof binding>(); runtime.wakeBinding.mockReturnValue(wait.promise);
    const task = engine.initialize();
    await vi.waitFor(() => expect(runtime.wakeBinding).toHaveBeenCalledOnce());
    useSipAccountStore.setState({ account: { ...account, tenantId: 2, domain: "replacement.example.test" } });
    wait.resolve(binding); await task;
    expect(bridge.bindForegroundWakeContext).not.toHaveBeenCalled();
  });
  it("cleans the old runtime when login changes during native owner binding", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } });
    runtime.wakeBinding.mockResolvedValue(binding);
    const wait = deferred<void>(); bridge.bindForegroundWakeContext.mockReturnValueOnce(wait.promise);
    const task = engine.initialize();
    await vi.waitFor(() => expect(bridge.bindForegroundWakeContext).toHaveBeenCalledOnce());
    runtime.user = { id: 99 }; runtime.authListeners.forEach(listener => listener());
    wait.resolve(); await task;
    expect(bridge.destroy).toHaveBeenCalledOnce();
    expect(runtime.diagnostics).not.toHaveBeenCalledWith(expect.objectContaining({ message: "Siprix foreground wake owner restored" }));
  });

  it("records only a fixed diagnostic when wake verification is unavailable", async () => {
    runtime.wakeBinding.mockResolvedValue(null);await ready();
    expect(runtime.diagnostics).toHaveBeenCalledWith({ level:"warning",category:"engine",message:"Siprix wake owner verification unavailable" });
    expect(bridge.destroy).not.toHaveBeenCalled();
  });

});

describe("native-only completed call reconciliation", () => {
  const binding = { bindingId: "binding", ownerUserId: 17, tenantId: 2, deviceId: "device", sessionBinding: "session", expiresAt: Date.now()+600000 };
  const row = { id: "native-wake:11111111-1111-4111-8111-111111111111", ownerUserId: 17, tenantId: 2, number: "2002", direction: "inbound" as const, startedAt: 1000, answeredAt: 2000, endedAt: 5000, updatedAt: 5000 };
  it("imports a completed cold call from an empty runtime and acks only after disk persistence", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } }); runtime.wakeBinding.mockResolvedValue(binding);
    bridge.readCompletedWakeCalls.mockResolvedValue([row]);
    bridge.ackCompletedWakeCalls.mockImplementation(async () => { expect(JSON.parse(runtime.storage.get("phone11_call_history_v1_user_17")!)).toEqual([expect.objectContaining({ id: row.id, endedAt: 5000 })]); });
    await engine.initialize();
    await vi.waitFor(() => expect(bridge.ackCompletedWakeCalls).toHaveBeenCalledWith(binding,[row.id]));
    expect(useSipCallStore.getState().incomingCall).toBeNull();
  });
  it("uses the same prospective ID for a JS-observed wake and terminal import", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } }); runtime.wakeBinding.mockResolvedValue(binding);
    await ready();
    emit({ type: "callIncoming", call: newCall({ direction: "incoming", state: "ringing", wakeCallUUID: row.id.slice(12), historyId: row.id, startedAt: row.startedAt }) });
    emit({ type: "callConnected", call: newCall({ direction: "incoming", state: "connected", wakeCallUUID: row.id.slice(12), historyId: row.id, startedAt: row.startedAt, answeredAt: row.answeredAt }) });
    emit({ type: "callTerminated", call: newCall({ direction: "incoming", state: "terminated" }) });
    bridge.readCompletedWakeCalls.mockResolvedValue([row]); await engine.initialize();
    await vi.waitFor(() => expect(bridge.ackCompletedWakeCalls).toHaveBeenCalled());
    const saved=JSON.parse(runtime.storage.get("phone11_call_history_v1_user_17")!);
    expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ id: row.id, startedAt: row.startedAt, answeredAt: row.answeredAt, endedAt: row.endedAt });
  });
  it("does not ack on failed disk writes", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } }); runtime.wakeBinding.mockResolvedValue(binding);
    bridge.readCompletedWakeCalls.mockResolvedValue([row]); runtime.writeHistory.mockRejectedValue(new Error("unavailable"));
    await engine.initialize(); await vi.waitFor(() => expect(runtime.writeHistory).toHaveBeenCalled());
    expect(bridge.ackCompletedWakeCalls).not.toHaveBeenCalled();
  });
  it("does not import or ack data after auth changes during native read", async () => {
    useSipAccountStore.setState({ account: { ...account, tenantId: 2 } }); runtime.wakeBinding.mockResolvedValue(binding);
    const read=deferred<typeof row[]>(); bridge.readCompletedWakeCalls.mockReturnValue(read.promise);
    await engine.initialize(); await vi.waitFor(() => expect(bridge.readCompletedWakeCalls).toHaveBeenCalled());
    runtime.user={id:99}; read.resolve([row]); await new Promise(resolve => setTimeout(resolve,0));
    expect(bridge.ackCompletedWakeCalls).not.toHaveBeenCalled(); expect(runtime.storage.has("phone11_call_history_v1_user_17")).toBe(false);
  });
});
