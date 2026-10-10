vi.mock("../hooks/use-device-contacts", () => ({
  useDeviceContacts: () => ({ people: [] }),
}));
vi.mock("../components/phone/call-person-avatar", () => ({
  CallPersonAvatar: () => null,
}));
import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  press: new Map<string, () => void | Promise<unknown>>(),
  replace: vi.fn(),
  hangup: vi.fn(),
  mute: vi.fn(),
  diagnostics: vi.fn(),
  remaining: vi.fn((_id: string) => null as { originalId: string; callId: string; requestId: string; historyId: string } | null),
  requestedId: "12" as string | undefined,
  originalMissing: false,
  call: {
    id: "12",
    status: "active",
    remoteNumber: "+66825826667",
    history: { id: "history-12" },
    startTime: new Date(),
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  StyleSheet: { create: (s: unknown) => s },
  View: ({ children }: any) => createElement("div", null, children),
  ScrollView: ({ children }: any) =>
    createElement("section", { "data-scroll": true }, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children, accessibilityLabel, onPress }: any) => {
    mocks.press.set(accessibilityLabel, onPress);
    return createElement(
      "button",
      { "aria-label": accessibilityLabel },
      children,
    );
  },
}));
vi.mock("expo-router", () => ({
  router: { replace: mocks.replace, canGoBack: () => false },
  useLocalSearchParams: () => ({ callId: mocks.requestedId }),
}));
vi.mock("expo-haptics", () => ({
  notificationAsync: vi.fn(),
  impactAsync: vi.fn(),
  NotificationFeedbackType: {},
  ImpactFeedbackStyle: {},
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 20 }),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "#3080ff",
    success: "green",
    warning: "yellow",
    error: "red",
  }),
}));
vi.mock("../lib/sip/sip-provider", () => ({
  useSip: () => ({ hangupCall: mocks.hangup, setMute: mocks.mute, remainingConsultation: mocks.remaining, supportsBlindTransfer: () => true }),
}));
vi.mock("../lib/sip/diagnostics-store", () => ({
  useSipDiagnosticsStore: { getState: () => ({ addEvent: mocks.diagnostics }) },
}));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: (select: any) => mocks.originalMissing
  ? select({ activeCalls: { "12": mocks.call }, incomingCall: null }) : mocks.call }));
vi.mock(
  "../components/cloud-recordings/active-call-recording-controls",
  () => ({
    ActiveCallRecordingControls: ({ nativeHistoryId }: any) =>
      createElement("span", null, nativeHistoryId),
  }),
);
import ActiveCallScreen from "../app/call/active";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.press.clear();
  mocks.requestedId = "12"; mocks.originalMissing = false; mocks.remaining.mockReturnValue(null);
});
it("shows the owned remaining consultation and ends it through the original route without navigating away", async () => {
  mocks.requestedId = "11"; mocks.originalMissing = true;
  mocks.remaining.mockReturnValue({ originalId: "11", callId: "12", requestId: "owned-request", historyId: "history-12" });
  const output = renderToStaticMarkup(<ActiveCallScreen />);
  expect(output).toContain("Original call ended. End the remaining consultation");
  expect(output).not.toContain('aria-label="Transfer call"');
  expect(output).not.toContain('aria-label="Hold call"');
  expect(output).not.toContain('aria-label="Resume call"');
  await mocks.press.get("End call")!();
  expect(mocks.hangup).toHaveBeenCalledWith("11");
  expect(mocks.replace).not.toHaveBeenCalled();
});
it("rejects a retained remaining-leg End when its request or lifetime changes", async () => {
  mocks.requestedId = "11"; mocks.originalMissing = true;
  mocks.remaining.mockReturnValue({ originalId: "11", callId: "12", requestId: "owned-request", historyId: "history-12" });
  renderToStaticMarkup(<ActiveCallScreen />);
  const retainedEnd = mocks.press.get("End call")!;
  mocks.remaining.mockReturnValue({ originalId: "11", callId: "12", requestId: "replacement-request", historyId: "replacement-history" });
  await retainedEnd();
  expect(mocks.hangup).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});
it.each(["12", undefined])("recognizes the owned remaining-leg role through the banner/sole-call route (%s)", async route => {
  mocks.requestedId = route; mocks.originalMissing = true;
  mocks.remaining.mockImplementation(id => id === "12" || id === "11"
    ? { originalId: "11", callId: "12", requestId: "owned-request", historyId: "history-12" } : null);
  const output = renderToStaticMarkup(<ActiveCallScreen />);
  expect(output).toContain("Original call ended. End the remaining consultation");
  expect(output).not.toContain('aria-label="Transfer call"');
  expect(output).not.toContain('aria-label="Hold call"');
  expect(output).not.toContain('aria-label="Resume call"');
  await mocks.press.get("End call")!(); expect(mocks.hangup).toHaveBeenCalledWith("11");
  expect(mocks.replace).not.toHaveBeenCalled();
});
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
  const scroll = output.match(
    /<section[^>]*data-scroll[^>]*>([\s\S]*?)<\/section>/,
  )?.[1];
  expect(scroll).toContain("history-12");
  expect(scroll).not.toContain('aria-label="Mute microphone"');
  expect(output).toContain('aria-label="Mute microphone"');
  await mocks.press.get("Mute microphone")!();
  expect(mocks.mute).toHaveBeenCalledWith("12", true);
  expect(mocks.diagnostics).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "In-app microphone control tapped",
      context: expect.objectContaining({
        callId: "12",
        muted: true,
        controlsReady: true,
      }),
    }),
  );
  expect(mocks.hangup).not.toHaveBeenCalled();
});

it("labels the video-call control for assistive technology", () => {
  Object.assign(mocks.call, { isVideo: true });
  renderToStaticMarkup(<ActiveCallScreen />);
  expect(mocks.press.has("Open video call")).toBe(true);
  mocks.press.get("Open video call")!();
  expect(mocks.replace).toHaveBeenCalledWith({
    pathname: "/call/video",
    params: { callId: "12" },
  });
  delete (mocks.call as { isVideo?: boolean }).isVideo;
});
