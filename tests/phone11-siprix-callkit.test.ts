import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (data?: any) => unknown>(),
  keep: { setup: vi.fn(async (_options?: any) => {}), startCall: vi.fn(), displayIncomingCall: vi.fn(), reportConnectedOutgoingCallWithUUID: vi.fn(), setCurrentCallActive: vi.fn(), endAllCalls: vi.fn(), removeEventListener: vi.fn(), reportEndCallWithUUID: vi.fn() },
  engine: { handleNativeAudioSession: vi.fn(async (_active: boolean) => {}), answerCall: vi.fn(async () => {}), hangupCall: vi.fn(async (_id: string) => {}) },
  terminate: vi.fn(), diagnostic: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: { addEventListener: () => ({ remove: vi.fn() }) } }));
vi.mock("../lib/sip/engine", () => ({ sipEngine: mocks.engine }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: { getState: () => ({ activeCalls: {}, terminateCall: mocks.terminate }) } }));
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
