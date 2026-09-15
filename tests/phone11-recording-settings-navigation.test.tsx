/* eslint-disable import/first */
import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(),
  buttons: new Map<string, () => unknown>(),
}));

vi.mock("react-native", () => ({
  ScrollView: ({ children }: any) => createElement("div", null, children),
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({
    accessibilityLabel,
    children,
    disabled,
    onPress,
  }: any) => {
    if (accessibilityLabel) mocks.buttons.set(accessibilityLabel, onPress);
    return createElement("button", { disabled }, children);
  },
}));
vi.mock("expo-router", () => ({
  router: {
    back: mocks.back,
    replace: mocks.replace,
    canGoBack: () => mocks.canGoBack(),
  },
}));
vi.mock("../components/screen-container", () => ({
  ScreenContainer: ({ children }: any) => createElement("main", null, children),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    foreground: "#111",
    muted: "#666",
    primary: "#06c",
  }),
}));
vi.mock("../hooks/use-directory", () => ({
  useDirectory: () => ({ workspaces: [], error: null }),
}));
vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock("../lib/_core/auth", () => ({
  addAuthChangeListener: () => () => undefined,
  getAuthSnapshot: () => ({ user: null }),
}));
vi.mock("../lib/trpc", () => ({
  createTRPCClient: () => ({
    cloudRecordings: {
      getPolicy: { query: vi.fn() },
      updatePolicy: { mutate: vi.fn() },
    },
  }),
}));

import RecordingSettings from "../app/call-recording/settings";

function render() {
  mocks.buttons.clear();
  return renderToStaticMarkup(createElement(RecordingSettings));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canGoBack.mockReturnValue(true);
});

it("exposes a discoverable back control and returns to the previous screen", () => {
  const html = render();
  expect(html).toContain("Recording settings");
  expect(mocks.buttons.has("Back to settings")).toBe(true);

  mocks.buttons.get("Back to settings")!();

  expect(mocks.back).toHaveBeenCalledOnce();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("falls back to Settings when opened without navigation history", () => {
  mocks.canGoBack.mockReturnValue(false);
  render();

  mocks.buttons.get("Back to settings")!();

  expect(mocks.replace).toHaveBeenCalledWith("/(tabs)/settings");
  expect(mocks.back).not.toHaveBeenCalled();
});
