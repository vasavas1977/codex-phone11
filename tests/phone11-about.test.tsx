import { expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  Pressable: ({ children }: { children?: ReactNode }) => createElement("button", null, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("main", null, children),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("expo-router", () => ({ router: { back: vi.fn() } }));
vi.mock("../components/screen-container", () => ({
  ScreenContainer: ({ children }: { children?: ReactNode }) => createElement("section", null, children),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    border: "#ddd",
    foreground: "#111",
    muted: "#666",
    primary: "#08a",
    surface: "#fff",
    success: "#080",
    warning: "#880",
  }),
}));

import AboutScreen from "../app/settings/about";

it("describes the current Phone11 availability without legacy architecture claims", () => {
  const html = renderToStaticMarkup(createElement(AboutScreen));

  expect(html).toContain("About Phone11");
  expect(html).toContain("Voice calls");
  expect(html).toContain("Background and closed-app calls");
  expect(html).toContain("commissioned native incoming-call support");
  expect(html).toContain("Video, transfers and conference calls");
  expect(html).toContain("SMS and live presence");
  expect(html).not.toMatch(/CloudPhone11|liblinphone|Flexisip|FreeSWITCH|Kamailio|Asterisk|WebRTC|PSTN|Telnyx|Bandwidth|Vonage|Lingo Telecom/);
});
