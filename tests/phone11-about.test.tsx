import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import AboutScreen from "../app/settings/about";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

const runtime = vi.hoisted(() => ({
  os: "ios",
  version: "1.0.0" as string | undefined,
  platform: {} as {
    ios?: { buildNumber: string | null };
    android?: { versionCode: number | null };
  },
  video: false as boolean | null,
}));

vi.mock("react-native", () => ({
  Platform: { get OS() { return runtime.os; } },
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  Pressable: ({ children }: { children?: ReactNode }) => createElement("button", null, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("main", null, children),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("expo-constants", () => ({ default: {
  get expoConfig() { return { version: runtime.version, ios: { buildNumber: "5" }, android: { versionCode: 5 } }; },
  get platform() { return runtime.platform; },
} }));
vi.mock("../hooks/use-video-capability", () => ({ useVideoCapability: () => runtime.video }));
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

beforeEach(() => {
  runtime.os = "ios";
  runtime.version = "1.0.0";
  runtime.platform = {};
  runtime.video = false;
});

it("describes the current Phone11 availability without legacy architecture claims", () => {
  const html = renderToStaticMarkup(createElement(AboutScreen));

  expect(html).toContain("About Phone11");
  expect(html).toContain("Voice calls");
  expect(html).toContain("Background and closed-app calls");
  expect(html).toContain("Requires native incoming-call setup");
  expect(html).toContain("Phone video calls");
  expect(html).toContain("Not available in this build");
  expect(html).toContain("Team Chat video meetings");
  expect(html).toContain("when meetings are enabled for your workspace and conversation");
  expect(html).toContain("Call transfers");
  expect(html).toContain("PBX conference calls");
  expect(html).toContain("SMS");
  expect(html).toContain("Workspace presence");
  expect(html).toContain("when presence is enabled for your workspace");
  expect(html).not.toMatch(/Video, transfers and conference calls|SMS and live presence|CloudPhone11|liblinphone|Flexisip|FreeSWITCH|Kamailio|Asterisk|WebRTC|PSTN|Telnyx|Bandwidth|Vonage|Lingo Telecom/);
});

it.each([null, true])("uses the phone video's actual runtime guard (%s)", video => {
  runtime.video = video;
  const html = renderToStaticMarkup(createElement(AboutScreen));
  expect(html).toContain(video === null
    ? "Checking this build’s video support"
    : "Compatible callers and camera permission are required");
  expect(html).not.toContain("Not available in this build");
});

it.each([
  ["ios", { ios: { buildNumber: "114" } }, "114"],
  ["android", { android: { versionCode: 114 } }, "114"],
] as const)("shows the installed %s build beside the version", (os, platform, build) => {
  runtime.os = os;
  runtime.platform = platform;
  const html = renderToStaticMarkup(createElement(AboutScreen));
  expect(html).toContain(`Version 1.0.0 · Build ${build}`);
  expect(html).not.toContain("Build 5");
});

it.each([
  ["web", { ios: { buildNumber: "114" } }],
  ["ios", {}],
  ["ios", { ios: { buildNumber: null } }],
  ["ios", { ios: { buildNumber: " " } }],
  ["android", { android: { versionCode: null } }],
] as const)("omits an absent native build on %s", (os, platform) => {
  runtime.os = os;
  runtime.platform = platform;
  const html = renderToStaticMarkup(createElement(AboutScreen));
  expect(html).toContain("Version 1.0.0");
  expect(html).not.toContain("Build ");
});

it("does not invent a version when app metadata is absent", () => {
  runtime.version = undefined;
  const html = renderToStaticMarkup(createElement(AboutScreen));
  expect(html).toContain("Version unavailable");
  expect(html).not.toContain("Version 1.0.0");
});
