import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (data?: any) => unknown>(),
  keep: { setup: vi.fn(async (_options?: any) => {}), startCall: vi.fn(), answerIncomingCall: vi.fn(), displayIncomingCall: vi.fn(), reportConnectedOutgoingCallWithUUID: vi.fn(), setCurrentCallActive: vi.fn(), endAllCalls: vi.fn(), removeEventListener: vi.fn(), reportEndCallWithUUID: vi.fn() },
  engine: { handleNativeAudioSession: vi.fn(async (_active: boolean) => {}), answerCall: vi.fn(async (_id: string) => {}), hangupCall: vi.fn(async (_id: string) => {}) },
  terminate: vi.fn(), diagnostic: vi.fn(),
  alert: vi.fn(), appState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
  owner: { id: 1 } as { id: number } | null,
  incoming: null as { id: string; status: string } | null,
}));
vi.mock("react-native", () => ({ Alert: { alert: mocks.alert }, Platform: { OS: "ios" }, AppState: mocks.appState }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: mocks.owner }) }));
vi.mock("../lib/sip/engine", () => ({ sipEngine: mocks.engine }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: { getState: () => ({ activeCalls: {}, incomingCall: mocks.incoming, terminateCall: mocks.terminate }) } }));
vi.mock("../lib/sip/diagnostics-store", () => ({ formatSipError: String, useSipDiagnosticsStore: { getState: () => ({ addEvent: mocks.diagnostic }) } }));

// NativeCallManager loads CallKeep with CommonJS require; inject that package's cached export.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const key = require.resolve("react-native-callkeep");
require.cache[key] = { id: key, filename: key, loaded: true, exports: { default: { ...mocks.keep, addEventListener: (event: string, handler: any) => mocks.handlers.set(event, handler) } } } as any;
import { nativeCallManager } from "../lib/sip/native-call";

beforeEach(() => {
  nativeCallManager.destroy();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.owner = { id: 1 }; mocks.incoming = null; mocks.appState.currentState = "active";
  vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "siprix");
});
it("initializes one CallKit provider for simultaneous callers", async () => {
  await Promise.all([nativeCallManager.initialize(), nativeCallManager.initialize()]);
  expect(mocks.keep.setup).toHaveBeenCalledTimes(1);
  expect(mocks.keep.setup.mock.calls[0]?.[0]).toMatchObject({ ios: { supportsVideo: false, maximumCallGroups: 1, audioSession: { mode: "AVAudioSessionModeVoiceChat" } } });
});
it("reports real outgoing connection using the iOS method", async () => {
  await nativeCallManager.initialize();
  nativeCallManager.reportOutgoingCall("42", "1002");
  nativeCallManager.reportOutgoingCall("42", "sip:1002@example.test");
  expect(mocks.keep.startCall).toHaveBeenCalledTimes(1);
  expect(mocks.keep.reportConnectedOutgoingCallWithUUID).not.toHaveBeenCalled();
  nativeCallManager.reportCallConnected("42");
  expect(mocks.keep.reportConnectedOutgoingCallWithUUID).toHaveBeenCalledTimes(1);
  expect(mocks.keep.setCurrentCallActive).not.toHaveBeenCalled();
});
it("forwards CallKit audio activation and deactivation to the selected SDK", async () => {
  await nativeCallManager.initialize();
  await mocks.handlers.get("didActivateAudioSession")?.();
  await mocks.handlers.get("didDeactivateAudioSession")?.();
  expect(mocks.engine.handleNativeAudioSession.mock.calls).toEqual([[true], [false]]);
});
it("forwards native hang-up but retains the call until SDK termination", async () => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("200", "3001");
  const callUUID = mocks.keep.displayIncomingCall.mock.calls[0][0];
  await mocks.handlers.get("endCall")!({ callUUID });
  expect(mocks.engine.hangupCall).toHaveBeenCalledWith("200");
  expect(mocks.terminate).not.toHaveBeenCalled();
  expect(mocks.keep.reportEndCallWithUUID).not.toHaveBeenCalled();
  nativeCallManager.reportCallEnded("200");
  expect(mocks.keep.reportEndCallWithUUID).toHaveBeenCalledWith(callUUID, expect.any(Number));
});
it("records native hang-up failure and preserves the mapping for retry", async () => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("201", "3001");
  const callUUID = mocks.keep.displayIncomingCall.mock.calls[0][0];
  mocks.engine.hangupCall.mockRejectedValueOnce(new Error("SDK refused"));
  await mocks.handlers.get("endCall")!({ callUUID });
  expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: "error", message: expect.stringContaining("hang-up failed") }));
  await mocks.handlers.get("endCall")!({ callUUID });
  expect(mocks.engine.hangupCall).toHaveBeenCalledTimes(2);
  expect(mocks.terminate).not.toHaveBeenCalled();
});
it("answers the mapped incoming SDK call without claiming connection or ending it", async () => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("202", "3001");
  mocks.incoming = { id: "202", status: "incoming" };
  const callUUID = mocks.keep.displayIncomingCall.mock.calls[0][0];
  await mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.engine.answerCall).toHaveBeenCalledWith("202");
  await mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(1);
  expect(mocks.keep.setCurrentCallActive).not.toHaveBeenCalled();
  expect(mocks.keep.reportEndCallWithUUID).not.toHaveBeenCalled();
  expect(mocks.terminate).not.toHaveBeenCalled();
});
it("observes native answer failure, hides raw error text, and preserves retry mapping", async () => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("203", "3001");
  mocks.incoming = { id: "203", status: "incoming" };
  const callUUID = mocks.keep.displayIncomingCall.mock.calls[0][0];
  mocks.engine.answerCall.mockRejectedValueOnce(new Error("private raw SIP credential"));
  await expect(mocks.handlers.get("answerCall")!({ callUUID })).resolves.toBeUndefined();
  expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: "error", message: expect.stringContaining("answer failed") }));
  expect(JSON.stringify(mocks.diagnostic.mock.calls)).not.toContain("private raw");
  await mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(2);
  expect(mocks.keep.reportEndCallWithUUID).not.toHaveBeenCalled();
});
it("suppresses simultaneous duplicate native answer actions while preserving terminal cleanup", async () => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("204", "3001");
  mocks.incoming = { id: "204", status: "incoming" };
  const callUUID = mocks.keep.displayIncomingCall.mock.calls[0][0];
  let complete: () => void = () => {};
  mocks.engine.answerCall.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const first = mocks.handlers.get("answerCall")!({ callUUID });
  await mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(1);
  nativeCallManager.reportCallEnded("204"); complete(); await first;
  await mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(1);
  expect(mocks.keep.reportEndCallWithUUID).toHaveBeenCalledTimes(1);
});
it("ignores unknown native answer identifiers without selecting another call", async () => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("205", "3001");
  await mocks.handlers.get("answerCall")!({ callUUID: "old-or-unrelated-uuid" });
  expect(mocks.engine.answerCall).not.toHaveBeenCalled();
  expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: "warning", message: expect.stringContaining("unknown call") }));
});
it("shows bounded retry guidance only for the same still-ringing foreground call", async () => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("206", "3001");
  mocks.incoming = { id: "206", status: "incoming" };
  const callUUID = mocks.keep.displayIncomingCall.mock.calls[0][0];
  mocks.engine.answerCall.mockRejectedValueOnce(new Error("private raw SDK response"));
  await mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.alert).toHaveBeenCalledWith("Could not answer call", expect.stringContaining("Tap Answer again"));
  expect(JSON.stringify(mocks.alert.mock.calls)).not.toContain("private");
});
it.each(["background", "ended", "connected", "ownerChanged"])("suppresses late native answer alerts after %s", async change => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("207", "3001");
  mocks.incoming = { id: "207", status: "incoming" };
  const callUUID = mocks.keep.displayIncomingCall.mock.calls[0][0];
  mocks.engine.answerCall.mockImplementationOnce(async () => {
    if (change === "background") mocks.appState.currentState = "background";
    if (change === "ended") nativeCallManager.reportCallEnded("207");
    if (change === "connected") mocks.incoming = { id: "207", status: "active" };
    if (change === "ownerChanged") mocks.owner = { id: 1 };
    throw new Error("SDK refused");
  });
  await mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.alert).not.toHaveBeenCalled();
  expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: "error", message: "Native answer failed" }));
});

it("persists safe answer callback, duplicate, and command acceptance separately from connection", async () => {
  await nativeCallManager.initialize(); nativeCallManager.displayIncomingCall("208", "private-caller-address");
  mocks.incoming = { id: "208", status: "incoming" };
  const callUUID = mocks.keep.displayIncomingCall.mock.calls[0][0];
  let complete: () => void = () => {};
  mocks.engine.answerCall.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const first = mocks.handlers.get("answerCall")!({ callUUID, token: "private-event-token" });
  await mocks.handlers.get("answerCall")!({ callUUID });
  const messages = () => mocks.diagnostic.mock.calls.map(([event]) => event.message);
  expect(messages()).toEqual([
    "Native answer callback received", "Native answer requested",
    "Native answer callback received", "Ignored duplicate pending native answer",
  ]);
  expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({
    message: "Native answer callback received", callId: "208", context: { mapped: true, ringing: true },
  }));
  complete(); await first;
  expect(messages().at(-1)).toBe("Native answer command accepted");
  expect(messages()).not.toContain("CallKit call marked active");
  nativeCallManager.reportCallConnected("208");
  expect(messages().at(-1)).toBe("Incoming SIP call connected");
  expect(JSON.stringify(mocks.diagnostic.mock.calls)).not.toContain("private-");
});
it("records an unmapped answer callback without persisting the supplied identifier or invoking SIP", async () => {
  await nativeCallManager.initialize();
  await mocks.handlers.get("answerCall")!({ callUUID: "private-untrusted-address" });
  expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({
    message: "Native answer callback received", context: { mapped: false, ringing: false },
  }));
  expect(mocks.engine.answerCall).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.diagnostic.mock.calls)).not.toContain("private-untrusted-address");
});

async function incomingForSystemAnswer(id = "301") {
  await nativeCallManager.initialize();
  nativeCallManager.displayIncomingCall(id, "3001");
  mocks.incoming = { id, status: "incoming" };
  return mocks.keep.displayIncomingCall.mock.calls.at(-1)![0];
}
it("routes in-app Answer through one system transaction and waits for SDK acceptance from its callback", async () => {
  const callUUID = await incomingForSystemAnswer();
  let accept!: () => void;
  mocks.engine.answerCall.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
  const request = nativeCallManager.answerIncomingCall("301");
  expect(nativeCallManager.answerIncomingCall("301")).toBe(request);
  expect(mocks.keep.answerIncomingCall).toHaveBeenCalledTimes(1);
  expect(mocks.keep.answerIncomingCall).toHaveBeenCalledWith(callUUID);
  expect(mocks.engine.answerCall).not.toHaveBeenCalled();
  let completed = false; void request.then(() => { completed = true; });
  const callback = mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(1);
  expect(mocks.engine.answerCall).toHaveBeenCalledWith("301");
  await Promise.resolve(); expect(completed).toBe(false);
  accept(); await callback; await request;
  expect(completed).toBe(true);
  expect(mocks.keep.setCurrentCallActive).not.toHaveBeenCalled();
  await nativeCallManager.answerIncomingCall("301");
  expect(mocks.keep.answerIncomingCall).toHaveBeenCalledTimes(1);
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(1);
});
it("retries SDK failure after a fulfilled system Answer without requesting a second CXAnswer action", async () => {
  const callUUID = await incomingForSystemAnswer();
  mocks.engine.answerCall.mockRejectedValueOnce(new Error("private SDK response"));
  const first = nativeCallManager.answerIncomingCall("301");
  const rejected = expect(first).rejects.toThrow("Could not answer call");
  await mocks.handlers.get("answerCall")!({ callUUID }); await rejected;
  expect(mocks.alert).not.toHaveBeenCalled(); // The in-app handler owns its error UI.
  await nativeCallManager.answerIncomingCall("301");
  expect(mocks.keep.answerIncomingCall).toHaveBeenCalledTimes(1);
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(mocks.diagnostic.mock.calls)).not.toContain("private SDK");
});
it("joins an in-flight system Answer instead of issuing another transaction", async () => {
  const callUUID = await incomingForSystemAnswer();
  let accept!: () => void;
  mocks.engine.answerCall.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
  const callback = mocks.handlers.get("answerCall")!({ callUUID });
  const inApp = nativeCallManager.answerIncomingCall("301");
  expect(mocks.keep.answerIncomingCall).not.toHaveBeenCalled();
  accept(); await callback; await inApp;
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(1);
});
it("bounds a missing system callback and permits a new transaction without accepting SIP directly", async () => {
  vi.useFakeTimers();
  try {
    const callUUID = await incomingForSystemAnswer();
    const request = nativeCallManager.answerIncomingCall("301");
    const rejected = expect(request).rejects.toThrow("Call controls did not respond");
    await vi.advanceTimersByTimeAsync(8_000); await rejected;
    expect(mocks.engine.answerCall).not.toHaveBeenCalled();
    const retry = nativeCallManager.answerIncomingCall("301");
    expect(mocks.keep.answerIncomingCall).toHaveBeenCalledTimes(2);
    await mocks.handlers.get("answerCall")!({ callUUID }); await retry;
    expect(mocks.engine.answerCall).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
it.each(["ended", "destroyed", "reset"])("rejects pending app Answer after %s and ignores late callback for a reused SDK id", async change => {
  const oldUUID = await incomingForSystemAnswer();
  const oldCallback = mocks.handlers.get("answerCall")!;
  const request = nativeCallManager.answerIncomingCall("301");
  const rejected = expect(request).rejects.toThrow("incoming call ended");
  if (change === "ended") nativeCallManager.reportCallEnded("301");
  if (change === "destroyed") nativeCallManager.destroy();
  if (change === "reset") await mocks.handlers.get("didResetProvider")!();
  await rejected;
  await incomingForSystemAnswer();
  await oldCallback({ callUUID: oldUUID });
  expect(mocks.engine.answerCall).not.toHaveBeenCalled();
});
it("rejects a late system callback when the original owner session was replaced", async () => {
  const callUUID = await incomingForSystemAnswer();
  const request = nativeCallManager.answerIncomingCall("301");
  const rejected = expect(request).rejects.toThrow("phone session changed");
  mocks.owner = { id: 1 };
  await mocks.handlers.get("answerCall")!({ callUUID }); await rejected;
  expect(mocks.engine.answerCall).not.toHaveBeenCalled();
  await expect(nativeCallManager.answerIncomingCall("301")).rejects.toThrow("no longer available");
});
it("catches system transaction dispatch errors without a direct SIP fallback", async () => {
  await incomingForSystemAnswer();
  mocks.keep.answerIncomingCall.mockImplementationOnce(() => { throw new Error("private native response"); });
  await expect(nativeCallManager.answerIncomingCall("301")).rejects.toThrow("Could not open the system call controls");
  expect(mocks.engine.answerCall).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.diagnostic.mock.calls)).not.toContain("private native");
});
it("observes audio activation failures and records bounded callback evidence", async () => {
  await nativeCallManager.initialize();
  mocks.engine.handleNativeAudioSession.mockRejectedValueOnce(new Error("private native audio response"));
  await expect(mocks.handlers.get("didActivateAudioSession")!()).resolves.toBeUndefined();
  expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ message: "CallKit audio activation received" }));
  expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ message: "CallKit audio session update failed", context: { active: true } }));
  expect(JSON.stringify(mocks.diagnostic.mock.calls)).not.toContain("private native");
});

it.each(["missing", "active", "replacement"])("rejects late system answer after ringing call is %s", async state => {
  const callUUID = await incomingForSystemAnswer();
  const request = nativeCallManager.answerIncomingCall("301");
  const rejected = expect(request).rejects.toThrow("no longer available");
  if (state === "missing") mocks.incoming = null;
  if (state === "active") mocks.incoming = { id: "301", status: "active" };
  if (state === "replacement") mocks.incoming = { id: "301", status: "incoming" };
  await mocks.handlers.get("answerCall")!({ callUUID }); await rejected;
  expect(mocks.engine.answerCall).not.toHaveBeenCalled();
});

it("retains call identity after timeout so a late old callback cannot answer a same-ID replacement", async () => {
  vi.useFakeTimers();
  try {
    const callUUID = await incomingForSystemAnswer();
    const request = nativeCallManager.answerIncomingCall("301");
    const rejected = expect(request).rejects.toThrow("Call controls did not respond");
    await vi.advanceTimersByTimeAsync(8_000); await rejected;
    mocks.incoming = { id: "301", status: "incoming" };
    await mocks.handlers.get("answerCall")!({ callUUID });
    await expect(nativeCallManager.answerIncomingCall("301")).rejects.toThrow("no longer available");
    expect(mocks.engine.answerCall).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it("does not reuse a previous system Answer proof for a replacement call after SDK rejection", async () => {
  const callUUID = await incomingForSystemAnswer();
  mocks.engine.answerCall.mockRejectedValueOnce(new Error("SDK refused"));
  const request = nativeCallManager.answerIncomingCall("301");
  const rejected = expect(request).rejects.toThrow("Could not answer call");
  await mocks.handlers.get("answerCall")!({ callUUID }); await rejected;
  mocks.incoming = { id: "301", status: "incoming" };
  await expect(nativeCallManager.answerIncomingCall("301")).rejects.toThrow("no longer available");
  await mocks.handlers.get("answerCall")!({ callUUID });
  expect(mocks.engine.answerCall).toHaveBeenCalledTimes(1);
  expect(mocks.keep.answerIncomingCall).toHaveBeenCalledTimes(1);
});


it("adopts the pre-reported wake UUID and leaves SIP acceptance to its native coordinator", async () => {
  await nativeCallManager.initialize();
  const uuid="11111111-1111-4111-8111-111111111111";
  nativeCallManager.adoptIncomingCall("wake-1",uuid,false);
  mocks.incoming={ id:"wake-1",status:"incoming" };
  const requested=nativeCallManager.answerIncomingCall("wake-1");
  expect(mocks.keep.answerIncomingCall).toHaveBeenCalledWith(uuid);
  expect(mocks.keep.displayIncomingCall).not.toHaveBeenCalled();
  await mocks.handlers.get("answerCall")!({ callUUID: uuid });
  expect(mocks.engine.answerCall).not.toHaveBeenCalled();
  nativeCallManager.reportCallConnected("wake-1"); await requested;
  nativeCallManager.reportCallEnded("wake-1");
  expect(mocks.keep.reportEndCallWithUUID).not.toHaveBeenCalled();
});
it("refuses conflicting or new-owner wake mappings", async () => {
  await nativeCallManager.initialize(); const uuid="11111111-1111-4111-8111-111111111111";
  nativeCallManager.adoptIncomingCall("wake-1",uuid,false);
  expect(() => nativeCallManager.adoptIncomingCall("wake-2",uuid,false)).toThrow("cannot be adopted");
  mocks.owner={id:1};
  expect(() => nativeCallManager.adoptIncomingCall("wake-1",uuid,false)).toThrow("cannot be adopted");
  mocks.incoming={id:"wake-1",status:"incoming"};
  await expect(nativeCallManager.answerIncomingCall("wake-1")).rejects.toThrow("no longer available");
});
it("rejects a waiting wake answer on native termination without a second system End report", async () => {
  await nativeCallManager.initialize(); const uuid="11111111-1111-4111-8111-111111111111";
  nativeCallManager.adoptIncomingCall("wake-1",uuid,false); mocks.incoming={id:"wake-1",status:"incoming"};
  const requested=nativeCallManager.answerIncomingCall("wake-1");
  nativeCallManager.reportCallEnded("wake-1");
  await expect(requested).rejects.toThrow("ended");
  expect(mocks.keep.reportEndCallWithUUID).not.toHaveBeenCalled();
});
