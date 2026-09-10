import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  state: {} as any,
  params: { callId: "call-1" } as any,
  press: new Map<string, { run: () => unknown; disabled: boolean }>(),
  hangup: vi.fn(async () => {}),
  mute: vi.fn(async () => {}),
  hold: vi.fn(async () => {}),
  speaker: vi.fn(async () => {}),
  dtmf: vi.fn(async () => {}),
  alert: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  StyleSheet: { create: (s: any) => s },
  ScrollView: ({ children }: any) =>
    createElement("section", { "data-call-scroll": true }, children),
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({
    children,
    accessibilityLabel,
    onPress,
    disabled,
  }: any) => {
    if (accessibilityLabel)
      mocks.press.set(accessibilityLabel, { run: onPress, disabled });
    return createElement(
      "button",
      { "aria-label": accessibilityLabel, disabled },
      children,
    );
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 30 }),
}));
vi.mock("expo-router", () => ({
  router: { back: mocks.back, replace: mocks.replace, canGoBack: () => true },
  useLocalSearchParams: () => mocks.params,
}));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Warning: "warning" },
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "#008877",
    error: "#bb0000",
    warning: "#bb8800",
    success: "#008877",
  }),
}));
vi.mock("../lib/sip/sip-provider", () => ({
  useSip: () => ({
    hangupCall: mocks.hangup,
    setMute: mocks.mute,
    setHold: mocks.hold,
    setSpeaker: mocks.speaker,
    sendDtmf: mocks.dtmf,
  }),
}));
vi.mock("../lib/sip/call-store", () => ({
  useSipCallStore: (select: any) => select(mocks.state),
}));
import ActiveCallScreen from "../app/call/active";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.press.clear();
  mocks.params = { callId: "call-1" };
  mocks.state = {
    activeCalls: {
      "call-1": {
        id: "call-1",
        status: "active",
        remoteNumber: "3002",
        isMuted: false,
        isHeld: false,
        isSpeaker: false,
      },
    },
    incomingCall: null,
  };
});
it("binds media controls to the authoritative call, without fabricated state updates", async () => {
  renderToStaticMarkup(<ActiveCallScreen />);
  await mocks.press.get("Mute microphone")!.run();
  await mocks.press.get("Hold call")!.run();
  await mocks.press.get("Use speaker")!.run();
  expect(mocks.mute).toHaveBeenCalledWith("call-1", true);
  expect(mocks.hold).toHaveBeenCalledWith("call-1", true);
  expect(mocks.speaker).toHaveBeenCalledWith("call-1", true);
  expect(mocks.state.activeCalls["call-1"].isMuted).toBe(false);
});
it("keeps a rejected control visible and does not end the call", async () => {
  mocks.mute.mockRejectedValueOnce(new Error("SDK rejected"));
  renderToStaticMarkup(<ActiveCallScreen />);
  await mocks.press.get("Mute microphone")!.run();
  expect(mocks.alert).toHaveBeenCalledWith(
    "Could not update call",
    expect.any(String),
  );
  expect(mocks.hangup).not.toHaveBeenCalled();
  expect(renderToStaticMarkup(<ActiveCallScreen />)).toContain(
    'aria-label="End call"',
  );
});
it("does not send media commands while a call is still connecting", async () => {
  mocks.state.activeCalls["call-1"].status = "connecting";
  renderToStaticMarkup(<ActiveCallScreen />);
  expect(mocks.press.get("Mute microphone")!.disabled).toBe(true);
  await mocks.press.get("Mute microphone")!.run();
  expect(mocks.mute).not.toHaveBeenCalled();
});
it("a stale route cannot manipulate a different live call", async () => {
  mocks.params.callId = "finished-call";
  renderToStaticMarkup(<ActiveCallScreen />);
  expect(mocks.press.get("Mute microphone")!.disabled).toBe(true);
  await mocks.press.get("Mute microphone")!.run();
  await mocks.press.get("Close ended call")!.run();
  expect(mocks.mute).not.toHaveBeenCalled();
  expect(mocks.hangup).not.toHaveBeenCalled();
  expect(mocks.back).toHaveBeenCalled();
});
it("uses the current single call when opening controls without an explicit ID", async () => {
  mocks.params = {};
  renderToStaticMarkup(<ActiveCallScreen />);
  await mocks.press.get("End call")!.run();
  expect(mocks.hangup).toHaveBeenCalledWith("call-1");
  expect(mocks.back).not.toHaveBeenCalled();
});
it("excludes unsupported transfer and video controls from a live call", () => {
  const html = renderToStaticMarkup(<ActiveCallScreen />);
  expect(html).not.toContain("Transfer");
  expect(html).not.toContain("Video");
  expect(html).toContain("End call");
});

it("keeps End call outside the scrolling media controls", () => {
  const html = renderToStaticMarkup(<ActiveCallScreen />);
  const scrollEnd = html.indexOf("</section>");
  expect(scrollEnd).toBeGreaterThan(0);
  expect(html.indexOf('aria-label="Mute microphone"')).toBeLessThan(scrollEnd);
  expect(html.indexOf('aria-label="End call"')).toBeGreaterThan(scrollEnd);
});
