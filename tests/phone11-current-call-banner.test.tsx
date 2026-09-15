import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  state: { activeCalls: {} as Record<string, any>, incomingCall: null as any },
  path: "/settings/sip-diagnostics", press: new Map<string, () => unknown>(),
  params: {} as { callId?: string | string[] }, user: { id: 1 },
  hooks: null as { values: any[]; index: number } | null,
  disabled: new Map<string, boolean>(),
  hangup: vi.fn(async (_id: string) => {}), alert: vi.fn(), push: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: any) => {
      if (!mocks.hooks) return actual.useState(initial);
      const frame = mocks.hooks, index = frame.index++;
      if (index >= frame.values.length) frame.values[index] = typeof initial === "function" ? initial() : initial;
      return [frame.values[index], (value: any) => { frame.values[index] = typeof value === "function" ? value(frame.values[index]) : value; }];
    },
    useRef: (initial: any) => {
      if (!mocks.hooks) return actual.useRef(initial);
      const frame = mocks.hooks, index = frame.index++;
      if (index >= frame.values.length) frame.values[index] = { current: initial };
      return frame.values[index];
    },
  };
});
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert }, StyleSheet: { create: (s: any) => s },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  Pressable: ({ children, accessibilityLabel, onPress, disabled }: any) => {
    mocks.press.set(accessibilityLabel, onPress);
    mocks.disabled.set(accessibilityLabel, !!disabled);
    return createElement("button", { "aria-label": accessibilityLabel, disabled }, children);
  },
}));
vi.mock("expo-router", () => ({ router: { push: mocks.push }, usePathname: () => mocks.path, useGlobalSearchParams: () => mocks.params }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20 }) }));
vi.mock("../lib/sip/sip-provider", () => ({ useSip: () => ({ hangupCall: mocks.hangup }) }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: Object.assign((select: any) => select(mocks.state), { getState: () => mocks.state }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: mocks.user }) }));
import { CurrentCallBanner } from "../components/current-call-banner";
beforeEach(() => {
  vi.clearAllMocks(); mocks.press.clear(); mocks.path = "/settings/sip-diagnostics";
  mocks.params = {}; mocks.user = { id: 1 };
  mocks.hooks = null; mocks.disabled.clear();
  mocks.state = { activeCalls: { "200": { id: "200", status: "active", remoteNumber: "3001" } }, incomingCall: null };
});
it.each(["/call/active", "/call/incoming"])("reveals the next incoming call on a stale %s route", path => {
  mocks.path = path; mocks.params = { callId: "200" };
  mocks.state = { activeCalls: {}, incomingCall: null };
  expect(renderToStaticMarkup(<CurrentCallBanner />)).toBe("");
  mocks.state.incomingCall = { id: "201", status: "incoming", remoteNumber: "3002" };
  const html = renderToStaticMarkup(<CurrentCallBanner />);
  expect(html).toContain("Incoming call"); expect(html).toContain("Decline call");
  expect(html).toContain("Tap to answer");
  mocks.press.get("Return to current call")!();
  expect(mocks.push).toHaveBeenCalledWith({ pathname: "/call/incoming", params: { callId: "201", number: "3002", type: "voice" } });
});
it.each([undefined, "200", ["200"]])("suppresses matching active controls (id %j)", callId => {
  mocks.path = "/call/active"; mocks.params = { callId };
  expect(renderToStaticMarkup(<CurrentCallBanner />)).toBe("");
});
it("suppresses a matching incoming screen", () => {
  mocks.path = "/call/incoming"; mocks.params = { callId: "201" };
  mocks.state = { activeCalls: {}, incomingCall: { id: "201", status: "incoming", remoteNumber: "3001" } };
  expect(renderToStaticMarkup(<CurrentCallBanner />)).toBe("");
});
it("keeps incoming controls reachable from an active screen with the same id", () => {
  mocks.path = "/call/active"; mocks.params = { callId: "201" };
  mocks.state = { activeCalls: {}, incomingCall: { id: "201", status: "incoming", remoteNumber: "3001" } };
  expect(renderToStaticMarkup(<CurrentCallBanner />)).toContain("Decline call");
});
it("keeps active controls reachable from an incoming screen with the same id", () => {
  mocks.path = "/call/incoming"; mocks.params = { callId: "200" };
  expect(renderToStaticMarkup(<CurrentCallBanner />)).toContain("End call");
  mocks.press.get("Return to current call")!();
  expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/call/active" }));
});
it("ignores captured actions after an account switch reuses the native call id", async () => {
  renderToStaticMarkup(<CurrentCallBanner />);
  const end = mocks.press.get("End call")!, open = mocks.press.get("Return to current call")!;
  mocks.user = { id: 2 };
  mocks.state.activeCalls["200"] = { id: "200", status: "active", remoteNumber: "4001" };
  await end(); open();
  expect(mocks.hangup).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
});
it("ignores a captured end action when the same owner has a new call with a reused id", async () => {
  mocks.state.activeCalls["200"].history = { id: "old-call" };
  renderToStaticMarkup(<CurrentCallBanner />); const end = mocks.press.get("End call")!;
  mocks.state.activeCalls["200"] = { id: "200", status: "active", remoteNumber: "4001", history: { id: "new-call" } };
  await end(); expect(mocks.hangup).not.toHaveBeenCalled();
});
it("does not turn a captured Decline action into hanging up an answered call", async () => {
  mocks.state = { activeCalls: {}, incomingCall: { id: "201", status: "incoming", remoteNumber: "3001", history: { id: "same-call" } } };
  renderToStaticMarkup(<CurrentCallBanner />); const decline = mocks.press.get("Decline call")!;
  mocks.state.activeCalls["201"] = { ...mocks.state.incomingCall, status: "active" }; mocks.state.incomingCall = null;
  await decline(); expect(mocks.hangup).not.toHaveBeenCalled();
});
it("sends only one hangup for an immediate double press", async () => {
  let release!: () => void;
  mocks.hangup.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  renderToStaticMarkup(<CurrentCallBanner />); const end = mocks.press.get("End call")!;
  const first = end(); const second = end();
  expect(mocks.hangup).toHaveBeenCalledTimes(1);
  release(); await Promise.all([first, second]);
});
it.each([false, true])("keeps new call controls independent of old pending hangup (owner changes: %s)", async changeOwner => {
  // Preserve the same component hook slots across renders; ordinary SSR renders
  // remount and would miss a component-wide pending-state leak.
  mocks.hooks = { values: [], index: 0 };
  const render = () => { mocks.hooks!.index = 0; return renderToStaticMarkup(<CurrentCallBanner />); };
  const releases: (() => void)[] = [];
  mocks.hangup.mockImplementationOnce(() => new Promise<void>(resolve => releases.push(resolve)));
  mocks.hangup.mockImplementationOnce(() => new Promise<void>(resolve => releases.push(resolve)));
  mocks.state.activeCalls["200"].history = { id: "old-call" };
  render(); const oldRequest = mocks.press.get("End call")!();
  render(); expect(mocks.disabled.get("End call")).toBe(true);

  if (changeOwner) mocks.user = { id: 2 };
  mocks.state = { activeCalls: {}, incomingCall: { id: "200", history: { id: "new-call" }, status: "incoming", remoteNumber: "4001" } };
  expect(render()).toContain("Tap to answer");
  expect(mocks.disabled.get("Decline call")).toBe(false);
  const newRequest = mocks.press.get("Decline call")!();
  expect(mocks.hangup).toHaveBeenCalledTimes(2);
  render(); expect(mocks.disabled.get("Decline call")).toBe(true);

  releases[0](); await oldRequest;
  render(); expect(mocks.disabled.get("Decline call")).toBe(true);
  await mocks.press.get("Decline call")!();
  expect(mocks.hangup).toHaveBeenCalledTimes(2);
  releases[1](); await newRequest;
  render(); expect(mocks.disabled.get("Decline call")).toBe(false);
});
it("exposes End call outside the call screen and sends the actual call id", async () => {
  expect(renderToStaticMarkup(<CurrentCallBanner />)).toContain("End call");
  await mocks.press.get("End call")!();
  expect(mocks.hangup).toHaveBeenCalledWith("200");
  expect(mocks.state.activeCalls["200"]).toBeDefined();
});
it("returns to controls with the real session id", () => {
  renderToStaticMarkup(<CurrentCallBanner />); mocks.press.get("Return to current call")!();
  expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/call/active", params: expect.objectContaining({ callId: "200" }) }));
});
it("keeps the call visible and explains a rejected hang-up command", async () => {
  mocks.hangup.mockRejectedValueOnce(new Error("SDK refused"));
  renderToStaticMarkup(<CurrentCallBanner />); await mocks.press.get("End call")!();
  expect(mocks.alert).toHaveBeenCalledWith("Could not end call", expect.any(String));
  expect(renderToStaticMarkup(<CurrentCallBanner />)).toContain("End call");
});
it("offers Decline for a real incoming call and hides once no call exists", async () => {
  mocks.state = { activeCalls: {}, incomingCall: { id: "201", status: "incoming", remoteNumber: "3001" } };
  renderToStaticMarkup(<CurrentCallBanner />); await mocks.press.get("Decline call")!();
  expect(mocks.hangup).toHaveBeenCalledWith("201");
  mocks.state.incomingCall = null;
  expect(renderToStaticMarkup(<CurrentCallBanner />)).toBe("");
});
