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
import { PhoneTodayView } from "../components/calendar/phone-today-view";

function render() {
  mocks.buttons.clear();
  return renderToStaticMarkup(createElement(CalendarTodayScreen));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canGoBack.mockReturnValue(true);
});

it("reports unavailable sync without claiming an empty schedule until the shared adapter is available", () => {
  const html = render();
  expect(html).toContain("Today");
  expect(html).toContain("Calendar sync unavailable");
  expect(html).toContain("Your shared calendar is not connected in Phone11 yet");
  expect(html).toContain("Scheduled calls, callbacks and meetings cannot be loaded until calendar sync is available");
  expect(html).not.toContain("Check Super Number");
  expect(html).not.toContain("Nothing scheduled today");
  expect(html).not.toContain("will appear here");
  expect(html).toContain("Personal notes and recording follow-ups stay with the call");
  expect(html).not.toContain("Create event");
});

it("retains the empty schedule state for an available calendar with no supplied events", () => {
  const html = renderToStaticMarkup(createElement(PhoneTodayView, { items: [] }));
  expect(html).toContain("Nothing scheduled today");
  expect(html).not.toContain("Calendar sync unavailable");
});

it("renders supplied scheduled events independently of the unavailable route", () => {
  const now = new Date(2026, 9, 7, 9, 0);
  const html = renderToStaticMarkup(createElement(PhoneTodayView, {
    now,
    items: [{ id: "meeting", kind: "meeting", status: "scheduled", startsAt: new Date(2026, 9, 7, 15, 0).toISOString(), title: "Weekly call" }],
  }));
  expect(html).toContain("Weekly call");
  expect(html).not.toContain("Nothing scheduled today");
  expect(html).not.toContain("Calendar sync unavailable");
});

it("returns to Settings from the Calendar view", () => {
  render();
  mocks.buttons.get("Back to settings")!();
  expect(mocks.back).toHaveBeenCalledOnce();
});
