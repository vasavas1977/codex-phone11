import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  platform: { OS: "ios" }, owner: { id: 1 } as { id: number } | null, loading: false,
  calls: {} as any, account: {} as any,
  loadAccount: vi.fn(async () => {}), engineInit: vi.fn(async () => {}),
  nativeInit: vi.fn(async () => {}), pushInit: vi.fn(async () => {}),
  systemAnswer: vi.fn(async (_id: string) => {}), sdkAnswer: vi.fn(async (_id: string, _video?: boolean) => {}), connected: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: m.platform, AppState: { currentState: "active" } }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.owner, loading: m.loading }), addAuthChangeListener: vi.fn() }));
vi.mock("../lib/sip/registration-lifecycle", () => ({ createRegistrationLifecycle: vi.fn() }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: Object.assign(() => ({ loadAccount: m.loadAccount }), { getState: () => ({ account: m.account }) }) }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: { getState: () => m.calls } }));
vi.mock("../lib/sip/diagnostics-store", () => ({ useSipDiagnosticsStore: { getState: () => ({ addEvent: vi.fn() }) } }));
vi.mock("../lib/sip/engine", () => ({ sipEngine: { initialize: m.engineInit, answerCall: m.sdkAnswer } }));
vi.mock("../lib/sip/native-call", () => ({ nativeCallManager: { initialize: m.nativeInit, answerIncomingCall: m.systemAnswer, reportCallConnected: m.connected }, registerVoipPush: m.pushInit }));
import { SipProvider, useSip } from "../lib/sip/sip-provider";

function renderProvider() {
  let controls!: ReturnType<typeof useSip>;
  function Consumer() { controls = useSip(); return null; }
  renderToStaticMarkup(<SipProvider><Consumer /></SipProvider>);
  return controls;
}
function deferred() {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "siprix");
  m.platform.OS = "ios"; m.owner = { id: 1 }; m.loading = false;
  m.account = { enabled: true, ownerUserId: 1 };
  m.calls = { activeCalls: {}, incomingCall: { id: "201", status: "incoming", remoteNumber: "3001", startTime: new Date(1000), history: { id: "first-call", ownerUserId: 1 } } };
  m.loadAccount.mockResolvedValue(); m.engineInit.mockResolvedValue(); m.nativeInit.mockResolvedValue(); m.pushInit.mockResolvedValue(); m.systemAnswer.mockResolvedValue(); m.sdkAnswer.mockResolvedValue();
});
afterEach(() => vi.unstubAllEnvs());

it("routes iOS Siprix Answer through initialized system controls and awaits acceptance", async () => {
  const request = deferred(); m.systemAnswer.mockReturnValueOnce(request.promise);
  let settled = false;
  const answer = renderProvider().answerCall("201").then(() => { settled = true; });
  await vi.waitFor(() => expect(m.systemAnswer).toHaveBeenCalledWith("201"));
  expect(m.engineInit).toHaveBeenCalledTimes(1); expect(m.nativeInit).toHaveBeenCalledTimes(1); expect(m.pushInit).toHaveBeenCalledTimes(1);
  expect(m.nativeInit.mock.invocationCallOrder[0]).toBeLessThan(m.systemAnswer.mock.invocationCallOrder[0]);
  expect(settled).toBe(false); expect(m.sdkAnswer).not.toHaveBeenCalled(); expect(m.connected).not.toHaveBeenCalled();
  request.resolve(); await answer;
  expect(settled).toBe(true); expect(m.sdkAnswer).not.toHaveBeenCalled();
});
it("propagates system rejection without a direct SDK fallback and permits explicit retry", async () => {
  const error = new Error("System answer timed out"); m.systemAnswer.mockRejectedValueOnce(error);
  const controls = renderProvider();
  await expect(controls.answerCall("201")).rejects.toBe(error);
  expect(m.sdkAnswer).not.toHaveBeenCalled(); expect(m.connected).not.toHaveBeenCalled();
  await controls.answerCall("201"); expect(m.systemAnswer).toHaveBeenCalledTimes(2);
});
it.each(["ios", "android", "web"])("preserves the legacy engine path on %s", async platform => {
  m.platform.OS = platform; vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "pjsip");
  await renderProvider().answerCall("201", true);
  expect(m.sdkAnswer).toHaveBeenCalledWith("201", true); expect(m.connected).toHaveBeenCalledWith("201"); expect(m.systemAnswer).not.toHaveBeenCalled();
});
it("preserves non-iOS Siprix engine handling without reporting legacy connection", async () => {
  m.platform.OS = "android";
  await renderProvider().answerCall("201", false);
  expect(m.sdkAnswer).toHaveBeenCalledWith("201", false); expect(m.connected).not.toHaveBeenCalled(); expect(m.systemAnswer).not.toHaveBeenCalled();
});
it("rejects Siprix video before opening system controls or accepting the SDK", async () => {
  await expect(renderProvider().answerCall("201", true)).rejects.toThrow("does not support video calls");
  expect(m.systemAnswer).not.toHaveBeenCalled(); expect(m.sdkAnswer).not.toHaveBeenCalled(); expect(m.nativeInit).not.toHaveBeenCalled();
});
it.each(["owner", "same-owner-session", "call", "ended", "answered"])("blocks delayed initialization after %s changes", async change => {
  const init = deferred(); m.nativeInit.mockReturnValueOnce(init.promise);
  const answer = renderProvider().answerCall("201");
  await vi.waitFor(() => expect(m.nativeInit).toHaveBeenCalledTimes(1));
  if (change === "owner") { m.owner = { id: 2 }; m.account.ownerUserId = 2; m.calls.incomingCall.history.ownerUserId = 2; }
  if (change === "same-owner-session") m.owner = { id: 1 };
  if (change === "call") m.calls.incomingCall = { ...m.calls.incomingCall, history: { id: "replacement-call", ownerUserId: 1 } };
  if (change === "ended") m.calls.incomingCall = null;
  if (change === "answered") m.calls.incomingCall.status = "active";
  init.resolve(); await expect(answer).rejects.toThrow("no longer available");
  expect(m.systemAnswer).not.toHaveBeenCalled(); expect(m.sdkAnswer).not.toHaveBeenCalled();
});
it("rejects a stale requested call before starting initialization", async () => {
  await expect(renderProvider().answerCall("old-call")).rejects.toThrow("no longer available");
  expect(m.nativeInit).not.toHaveBeenCalled(); expect(m.systemAnswer).not.toHaveBeenCalled(); expect(m.sdkAnswer).not.toHaveBeenCalled();
});
it("accepts a state update of the same durable incoming call during initialization", async () => {
  const init = deferred(); m.nativeInit.mockReturnValueOnce(init.promise);
  const answer = renderProvider().answerCall("201");
  await vi.waitFor(() => expect(m.nativeInit).toHaveBeenCalledTimes(1));
  m.calls.incomingCall = { ...m.calls.incomingCall, remoteName: "Updated caller name" };
  init.resolve(); await answer;
  expect(m.systemAnswer).toHaveBeenCalledWith("201"); expect(m.sdkAnswer).not.toHaveBeenCalled();
});
