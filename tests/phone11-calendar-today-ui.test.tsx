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
  TouchableOpacity: ({ accessibilityLabel, children, onPress }: any) => {
    if (accessibilityLabel) mocks.buttons.set(accessibilityLabel, onPress);
    return createElement("button", null, children);
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
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ foreground: "#111", muted: "#666", primary: "#06c", surface: "#fff", border: "#ddd" }),
}));

import CalendarTodayScreen from "../app/calendar";

function render() {
  mocks.buttons.clear();
  return renderToStaticMarkup(createElement(CalendarTodayScreen));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canGoBack.mockReturnValue(true);
});

it("keeps the Calendar view read-only until the shared adapter supplies phone items", () => {
  const html = render();
  expect(html).toContain("Today");
  expect(html).toContain("Nothing scheduled today");
  expect(html).toContain("Personal notes and recording follow-ups stay with the call");
  expect(html).not.toContain("Create event");
});

it("returns to Settings from the Calendar view", () => {
  render();
  mocks.buttons.get("Back to settings")!();
  expect(mocks.back).toHaveBeenCalledOnce();
});
