import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  state: { activeCalls: {} as Record<string, any>, incomingCall: null as any },
  path: "/settings/sip-diagnostics", press: new Map<string, () => unknown>(),
  hangup: vi.fn(async (_id: string) => {}), alert: vi.fn(), push: vi.fn(),
}));
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert }, StyleSheet: { create: (s: any) => s },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  Pressable: ({ children, accessibilityLabel, onPress, disabled }: any) => {
    mocks.press.set(accessibilityLabel, onPress);
    return createElement("button", { "aria-label": accessibilityLabel, disabled }, children);
  },
}));
vi.mock("expo-router", () => ({ router: { push: mocks.push }, usePathname: () => mocks.path }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20 }) }));
vi.mock("../lib/sip/sip-provider", () => ({ useSip: () => ({ hangupCall: mocks.hangup }) }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: (select: any) => select(mocks.state) }));
import { CurrentCallBanner } from "../components/current-call-banner";
beforeEach(() => {
  vi.clearAllMocks(); mocks.press.clear(); mocks.path = "/settings/sip-diagnostics";
  mocks.state = { activeCalls: { "200": { id: "200", status: "active", remoteNumber: "3001" } }, incomingCall: null };
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
