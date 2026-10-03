import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const mocks = vi.hoisted(() => ({
  supported: true,
  params: { callId: "call-1" },
  calls: {} as Record<string, any>,
  transfer: vi.fn(async () => {}),
  back: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => createElement("span", null, "loading"),
  Pressable: ({ children, accessibilityLabel, disabled }: any) => createElement("button", { "aria-label": accessibilityLabel, disabled }, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TextInput: ({ accessibilityLabel, value }: any) => createElement("input", { "aria-label": accessibilityLabel, value, readOnly: true }),
  View: ({ children }: any) => createElement("div", null, children),
  StyleSheet: { create: (value: any) => value },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock("expo-router", () => ({
  router: { back: mocks.back, replace: mocks.replace, canGoBack: () => true },
  useLocalSearchParams: () => mocks.params,
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ background: "white", foreground: "black", muted: "gray", surface: "white", primary: "blue", success: "green", error: "red" }) }));
vi.mock("../lib/sip/sip-provider", () => ({ useSip: () => ({ transferCall: mocks.transfer, supportsBlindTransfer: () => mocks.supported }) }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: (select: any) => select({ activeCalls: mocks.calls, incomingCall: null }) }));
vi.mock("../components/feature-unavailable", () => ({ FeatureUnavailable: ({ title }: any) => createElement("span", null, title) }));

import TransferCallScreen from "../app/call/transfer";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.supported = true;
  mocks.params = { callId: "call-1" };
  mocks.calls = { "call-1": { id: "call-1", status: "active", isHeld: false } };
});

it("gates older builds and keeps the call available", () => {
  mocks.supported = false;
  const html = renderToStaticMarkup(<TransferCallScreen />);
  expect(html).toContain("Call transfer is unavailable");
  expect(html).not.toContain("Transfer now");
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it("does not offer transfer for a stale explicit call route or a held call", () => {
  mocks.params.callId = "ended-call";
  expect(renderToStaticMarkup(<TransferCallScreen />)).not.toContain("Transfer now");
  mocks.params.callId = "call-1";
  mocks.calls["call-1"].status = "held";
  mocks.calls["call-1"].isHeld = true;
  expect(renderToStaticMarkup(<TransferCallScreen />)).toContain("Resume the call");
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it("shows the valid native path without reporting success before a callback", () => {
  const html = renderToStaticMarkup(<TransferCallScreen />);
  expect(html).toContain("Transfer destination");
  expect(html).toContain("Transfer now");
  expect(html).not.toContain("Transfer confirmed");
  expect(mocks.transfer).not.toHaveBeenCalled();
});
