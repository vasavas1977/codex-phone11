import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  plain: new Map<string, string>(),
  user: { id: 17 } as { id: number } | null,
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, NativeModules: {} }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: vi.fn(async (key: string) => state.secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { state.secure.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { state.secure.delete(key); }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.plain.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => { state.plain.delete(key); }),
  },
}));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: state.user }) }));
vi.mock("../lib/sip/diagnostics-store", () => ({
  formatSipError: () => "Test error",
  recordPersistentSipDiagnosticEvent: vi.fn(),
  useSipDiagnosticsStore: { getState: () => ({ addEvent: vi.fn() }) },
}));

import * as SecureStore from "expo-secure-store";
import { useSipAccountStore, type SipAccount } from "../lib/sip/account-store";
import { sipEngine } from "../lib/sip/pjsip-engine";
import { useSipCallStore } from "../lib/sip/call-store";

const account: SipAccount = {
  ownerUserId: 17, id: "test", username: "1001", password: "not-a-live-SIP-secret",
  domain: "sip.example.test", displayName: "Test", port: 5061,
  transport: "TLS", srtp: true, enabled: true,
};

describe("Phone11 auth and SIP account isolation", () => {
  beforeEach(async () => {
    state.user = { id: 17 };
    await useSipAccountStore.getState().clearAccount();
    state.secure.clear();
    state.plain.clear();
    useSipCallStore.setState({ activeCalls: {}, incomingCall: null });
    vi.clearAllMocks();
  });
  it("stores the account only in device secure storage", async () => {
    await useSipAccountStore.getState().setAccount(account);
    expect(state.secure.size).toBe(1);
    expect(state.plain.size).toBe(0);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "phone11_sip_account_v2", expect.any(String), { keychainAccessible: 7 },
    );
  });
  it("discards old unbound plaintext credentials instead of assigning them to the next user", async () => {
    state.plain.set("phone11_sip_account", JSON.stringify(account));
    await useSipAccountStore.getState().loadAccount();
    expect(state.plain.size).toBe(0);
    expect(useSipAccountStore.getState().account).toBeNull();
  });
  it("refuses to store credentials for another user", async () => {
    await expect(useSipAccountStore.getState().setAccount({ ...account, ownerUserId: 29 })).rejects.toThrow();
    expect(state.secure.size).toBe(0);
  });
  it("does not load another user's secure account", async () => {
    state.secure.set("phone11_sip_account_v2", JSON.stringify({ ...account, ownerUserId: 29 }));
    await useSipAccountStore.getState().loadAccount();
    expect(useSipAccountStore.getState().account).toBeNull();
  });
  it("does not let an in-flight store restore credentials after sign-out", async () => {
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
      await blocked; state.secure.set(key, value);
    });
    const write = useSipAccountStore.getState().setAccount(account);
    await Promise.resolve();
    const clear = useSipAccountStore.getState().clearAccount();
    finish();
    await Promise.all([write, clear]);
    expect(useSipAccountStore.getState().account).toBeNull();
    expect(state.secure.size).toBe(0);
  });
  it("blocks native registration without a verified matching Phone11 user", async () => {
    useSipAccountStore.setState({ account, registrationState: "registered" });
    state.user = null;
    await sipEngine.initialize();
    expect(useSipAccountStore.getState().registrationState).toBe("unregistered");
  });
  it("deletes the native account even when legacy PJSIP has no stop method", async () => {
    const endpoint = { deleteAccount: vi.fn(), removeAllListeners: vi.fn() };
    const nativeAccount = { getId: () => 4 };
    const engine = sipEngine as unknown as { endpoint: unknown; pjsipAccount: unknown; initialized: boolean };
    engine.endpoint = endpoint;
    engine.pjsipAccount = nativeAccount;
    engine.initialized = true;
    await sipEngine.destroy();
    expect(endpoint.deleteAccount).toHaveBeenCalledWith(nativeAccount);
    expect(endpoint.removeAllListeners).toHaveBeenCalled();
    expect(engine.endpoint).toBeNull();
    expect(engine.initialized).toBe(false);
  });
  it("ends an active call before removing its native account", async () => {
    const order: string[] = [];
    const call = { getId: () => 5 };
    useSipCallStore.getState().addOutgoingCall(call, "sip:test@example.test");
    const endpoint = {
      hangupCall: vi.fn(async () => { order.push("hangup"); }),
      deleteAccount: vi.fn(async () => { order.push("delete"); }),
      removeAllListeners: vi.fn(),
    };
    Object.assign(sipEngine, { endpoint, pjsipAccount: { getId: () => 4 }, initialized: true });
    await sipEngine.destroy();
    expect(order).toEqual(["hangup", "delete"]);
    expect(endpoint.hangupCall).toHaveBeenCalledWith(call);
  });
  it("retains failed cleanup for retry instead of reporting successful sign-out", async () => {
    const endpoint = { deleteAccount: vi.fn().mockRejectedValueOnce(new Error("native failure")), removeAllListeners: vi.fn() };
    Object.assign(sipEngine, { endpoint, pjsipAccount: { getId: () => 4 }, initialized: true });
    await expect(sipEngine.destroy()).rejects.toThrow("could not stop");
    expect(endpoint.removeAllListeners).not.toHaveBeenCalled();
    await sipEngine.destroy();
    expect(endpoint.deleteAccount).toHaveBeenCalledTimes(2);
    expect(endpoint.removeAllListeners).toHaveBeenCalledOnce();
  });
  it("serializes logout behind an in-flight native startup", async () => {
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const endpoint = { deleteAccount: vi.fn(), removeAllListeners: vi.fn() };
    const internals = sipEngine as unknown as { initializeEndpoint: () => Promise<void> };
    const initialize = vi.spyOn(internals, "initializeEndpoint").mockImplementationOnce(async () => {
      await blocked;
      Object.assign(sipEngine, { endpoint, pjsipAccount: { getId: () => 4 }, initialized: true });
    });
    const start = sipEngine.initialize();
    const stop = sipEngine.destroy();
    expect(endpoint.deleteAccount).not.toHaveBeenCalled();
    finish();
    await Promise.all([start, stop]);
    expect(endpoint.deleteAccount).toHaveBeenCalledOnce();
    initialize.mockRestore();
  });
});

describe("Phone11 CallKit audio ownership", () => {
  const internals = sipEngine as unknown as {
    _activateAudioSession: (callId: string, reason: string) => Promise<void>;
    endpoint: unknown;
  };
  const endpoint = () => ({
    activateAudioSession: vi.fn().mockResolvedValue(undefined),
    deactivateAudioSession: vi.fn().mockResolvedValue(undefined),
  });
  beforeEach(async () => {
    await sipEngine.handleNativeAudioSession(false);
    internals.endpoint = null;
  });
  it("does not open iOS audio at call creation or confirmation before CallKit grants it", async () => {
    const native = endpoint();
    internals.endpoint = native;
    await internals._activateAudioSession("1", "outbound_call_created");
    await internals._activateAudioSession("1", "call_changed");
    expect(native.activateAudioSession).not.toHaveBeenCalled();
    await sipEngine.handleNativeAudioSession(true);
    expect(native.activateAudioSession).toHaveBeenCalledOnce();
  });
  it("does not tear down and reopen an already activated sound device on confirmation", async () => {
    const native = endpoint();
    internals.endpoint = native;
    await sipEngine.handleNativeAudioSession(true);
    await Promise.all([
      internals._activateAudioSession("1", "call_changed"),
      sipEngine.handleNativeAudioSession(true),
    ]);
    expect(native.activateAudioSession).toHaveBeenCalledOnce();
  });
  it("reopens after a CallKit deactivation and later reactivation", async () => {
    const native = endpoint();
    internals.endpoint = native;
    await sipEngine.handleNativeAudioSession(true);
    await sipEngine.handleNativeAudioSession(false);
    await internals._activateAudioSession("1", "call_changed");
    expect(native.activateAudioSession).toHaveBeenCalledOnce();
    await sipEngine.handleNativeAudioSession(true);
    expect(native.activateAudioSession).toHaveBeenCalledTimes(2);
    expect(native.deactivateAudioSession).toHaveBeenCalledOnce();
  });
  it("serializes deactivation behind an in-flight activation", async () => {
    const native = endpoint();
    let finish!: () => void;
    native.activateAudioSession.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    internals.endpoint = native;
    const start = sipEngine.handleNativeAudioSession(true);
    await Promise.resolve();
    const stop = sipEngine.handleNativeAudioSession(false);
    expect(native.deactivateAudioSession).not.toHaveBeenCalled();
    finish();
    await Promise.all([start, stop]);
    expect(native.deactivateAudioSession).toHaveBeenCalledOnce();
  });
  it("does not treat failed activation as an active sound device", async () => {
    const native = endpoint();
    native.activateAudioSession.mockRejectedValueOnce(new Error("audio unavailable"));
    internals.endpoint = native;
    await sipEngine.handleNativeAudioSession(true);
    await internals._activateAudioSession("1", "call_changed");
    expect(native.activateAudioSession).toHaveBeenCalledTimes(2);
  });
  it("cycles the sound device when deactivation and reactivation arrive together", async () => {
    const native = endpoint();
    internals.endpoint = native;
    await sipEngine.handleNativeAudioSession(true);
    await Promise.all([
      sipEngine.handleNativeAudioSession(false),
      sipEngine.handleNativeAudioSession(true),
    ]);
    expect(native.deactivateAudioSession).toHaveBeenCalledOnce();
    expect(native.activateAudioSession).toHaveBeenCalledTimes(2);
  });
  it("does not activate an endpoint replaced before the queued callback runs", async () => {
    const old = endpoint();
    internals.endpoint = old;
    const start = sipEngine.handleNativeAudioSession(true);
    const next = endpoint();
    internals.endpoint = next;
    await start;
    expect(old.activateAudioSession).not.toHaveBeenCalled();
    expect(next.activateAudioSession).not.toHaveBeenCalled();
  });
});
