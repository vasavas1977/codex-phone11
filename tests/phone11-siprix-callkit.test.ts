import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (data?: any) => unknown>(),
  keep: { setup: vi.fn(async (_options?: any) => {}), startCall: vi.fn(), displayIncomingCall: vi.fn(), reportConnectedOutgoingCallWithUUID: vi.fn(), setCurrentCallActive: vi.fn(), endAllCalls: vi.fn(), removeEventListener: vi.fn(), reportEndCallWithUUID: vi.fn() },
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
