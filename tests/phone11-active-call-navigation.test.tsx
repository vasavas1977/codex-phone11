import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  press: new Map<string, () => void | Promise<unknown>>(), replace: vi.fn(), hangup: vi.fn(), mute: vi.fn(), diagnostics: vi.fn(),
  call: { id: "12", status: "active", remoteNumber: "+66825826667", history: { id: "history-12" }, startTime: new Date() },
}));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() }, StyleSheet: { create: (s: unknown) => s },
  View: ({ children }: any) => createElement("div", null, children),
  ScrollView: ({ children }: any) => createElement("section", { "data-scroll": true }, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children, accessibilityLabel, onPress }: any) => {
    mocks.press.set(accessibilityLabel, onPress);
    return createElement("button", { "aria-label": accessibilityLabel }, children);
  },
}));
vi.mock("expo-router", () => ({ router: { replace: mocks.replace }, useLocalSearchParams: () => ({ callId: "12" }) }));
vi.mock("expo-haptics", () => ({ notificationAsync: vi.fn(), impactAsync: vi.fn(), NotificationFeedbackType: {}, ImpactFeedbackStyle: {} }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#3080ff", success: "green", warning: "yellow", error: "red" }) }));
vi.mock("../lib/sip/sip-provider", () => ({ useSip: () => ({ hangupCall: mocks.hangup, setMute: mocks.mute }) }));
vi.mock("../lib/sip/diagnostics-store", () => ({ useSipDiagnosticsStore: { getState: () => ({ addEvent: mocks.diagnostics }) } }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: () => mocks.call }));
vi.mock("../components/cloud-recordings/active-call-recording-controls", () => ({ ActiveCallRecordingControls: ({ nativeHistoryId }: any) => createElement("span", null, nativeHistoryId) }));
import ActiveCallScreen from "../app/call/active";
beforeEach(() => { vi.clearAllMocks(); mocks.press.clear(); });
it("opens Recents without ending the active call", () => {
  renderToStaticMarkup(<ActiveCallScreen />);
  mocks.press.get("Minimize call and open Recents")!();
  expect(mocks.replace).toHaveBeenCalledWith("/(tabs)/recents");
  expect(mocks.hangup).not.toHaveBeenCalled();
  expect(mocks.call.status).toBe("active");
});
it("keeps End call available while displaying recording controls", () => {
  const output = renderToStaticMarkup(<ActiveCallScreen />);
  expect(mocks.press.has("End call")).toBe(true);
  expect(output).toContain("history-12");
});
it("keeps microphone controls outside recording scroll and sends Mute to the current call", async () => {
  const output = renderToStaticMarkup(<ActiveCallScreen />);
  const scroll = output.match(/<section[^>]*data-scroll[^>]*>([\s\S]*?)<\/section>/)?.[1];
  expect(scroll).toContain("history-12");
  expect(scroll).not.toContain('aria-label="Mute microphone"');
  expect(output).toContain('aria-label="Mute microphone"');
  await mocks.press.get("Mute microphone")!();
  expect(mocks.mute).toHaveBeenCalledWith("12", true);
  expect(mocks.diagnostics).toHaveBeenCalledWith(expect.objectContaining({
    message: "In-app microphone control tapped",
    context: expect.objectContaining({ callId: "12", muted: true, controlsReady: true }),
  }));
  expect(mocks.hangup).not.toHaveBeenCalled();
});
