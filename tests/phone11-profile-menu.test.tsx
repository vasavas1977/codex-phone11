import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

vi.mock("react-native", () => ({
  KeyboardAvoidingView: ({ children, behavior: _behavior, style: _style, ...props }: any) => createElement("div", props, children),
  Platform: { OS: "web" },
  Pressable: ({ children, accessibilityLabel, style: _style, accessibilityRole: _role, accessibilityState: _state, ...props }: any) => createElement("button", { "aria-label": accessibilityLabel, ...props }, children),
  Modal: ({ children, visible }: any) => visible ? createElement("section", null, children) : null,
  ScrollView: ({ children, contentContainerStyle: _contentStyle, style: _style, keyboardShouldPersistTaps: _keyboard, ...props }: any) => createElement("main", props, children),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: ({ children, style: _style, accessibilityRole: _role, accessibilityLabel: _label, numberOfLines: _lines, ...props }: any) => createElement("span", props, children),
  TextInput: ({ style: _style, accessibilityLabel, editable: _editable, placeholderTextColor: _placeholderColor, value, onChangeText: _changeText, ...props }: any) => createElement("input", { "aria-label": accessibilityLabel, defaultValue: value, ...props }),
  View: ({ children, style: _style, accessibilityLabel: _label, ...props }: any) => createElement("div", props, children),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: ({ name }: { name: string }) => createElement("i", null, name) }));
vi.mock("expo-image", () => {
  const Image = (props: any) => createElement("img", props);
  Object.assign(Image, { clearMemoryCache: vi.fn(async () => true), clearDiskCache: vi.fn(async () => true) });
  return { Image };
});
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: null, loading: false }),
  getSessionToken: vi.fn(async () => null),
  addAuthChangeListener: () => () => {},
}));
vi.mock("../constants/oauth", () => ({ getApiBaseUrl: () => "" }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ background: "#fff", surface: "#fafafa", border: "#ddd", foreground: "#111", muted: "#666", primary: "#07c", success: "#080" }),
}));
vi.mock("expo-router", () => ({ Redirect: ({ href }: { href: string }) => createElement("a", { href }) }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));

import { AccountHub, accountInitials, statusDisplayTimeLabel, workspaceStatusPresets } from "../components/profile/account-hub";
import { applyPreviewWorkspaceProfile } from "../app/dev/profile-menu-preview";

it("renders only authenticated account and provisioned extension data", () => {
  const html = renderToStaticMarkup(createElement(AccountHub, {
    identity: { name: "Nathasa W.", email: "nathasa@phone11.ai" },
    phone: { extension: "3001" },
    onBack: vi.fn(), onOpenSettings: vi.fn(),
  }));
  expect(html).toContain("Nathasa W.");
  expect(html).toContain("nathasa@phone11.ai");
  expect(html).toContain("Extension 3001");
  expect(html).toContain("Workspace status will be available after your company updates this app.");
  expect(html).toContain("Settings");
  expect(html).not.toMatch(/Personal meeting|QR code/i);
});

it("renders persisted status summaries as a compact account menu", () => {
  const save = vi.fn(async () => undefined);
  const html = renderToStaticMarkup(createElement(AccountHub, {
    identity: { name: "Nathasa W.", email: "nathasa@phone11.ai" }, phone: { extension: "3001" },
    onBack: vi.fn(), onOpenSettings: vi.fn(),
    workspaceProfile: { userId: 1, manualAvailability: "dnd", manualAvailabilityExpiresAt: new Date("2026-09-20T11:00:00Z"), statusText: "In a customer review", statusExpiresAt: null, workLocation: "remote" },
    profileAvailable: true, profileSaving: false, profileError: null, onUpdateWorkspaceProfile: save,
    workspaceName: "Phone11",
  }));
  for (const label of ["Availability", "Do not disturb", "Status", "Work location", "Remote", "My profile", "Settings"])
    expect(html).toContain(label);
  expect(html).toContain("In a customer review");
  expect(html).toContain("Availability, status, and location apply to Phone11");
  expect(html).not.toContain("20 min");
  expect(html).not.toContain("Workspace status will be available after your company updates this app.");
});

it("does not invent a profile when authenticated identity is absent", () => {
  const html = renderToStaticMarkup(createElement(AccountHub, {
    identity: null, phone: null,
    onBack: vi.fn(), onOpenSettings: vi.fn(),
  }));
  expect(html).toContain("Your work account");
  expect(html).toContain("Sign in to view your account");
  expect(html).not.toContain("Extension 3001");
});

it("creates stable initials without a demo identity", () => {
  expect(accountInitials("สมชาย ใจดี")).toBe("สใ");
  expect(accountInitials(null)).toBe("P");
});

it("offers the requested quick statuses and preserves a timed status until the user changes its display time", () => {
  expect(workspaceStatusPresets).toEqual([
    { label: "In a meeting", text: "In a meeting", expiry: "1h" },
    { label: "Commuting", text: "Commuting", expiry: "1h" },
    { label: "Vacation", text: "Vacation", expiry: "always" },
    { label: "Working remotely", text: "Working remotely", expiry: "today" },
  ]);
  expect(statusDisplayTimeLabel(undefined, null)).toBe("Always");
  expect(statusDisplayTimeLabel(undefined, new Date("2026-09-20T11:00:00Z"))).toMatch(/^Until /);
});

it("keeps preview profile edits local while reflecting saved values", () => {
  const current = {
    userId: 1, manualAvailability: null, manualAvailabilityExpiresAt: null,
    statusText: "In a meeting", statusExpiresAt: new Date("2026-09-20T11:00:00Z"), workLocation: "office" as const,
  };
  const renamed = applyPreviewWorkspaceProfile(current, { status: { text: "Meeting moved" } });
  expect(renamed).toMatchObject({ statusText: "Meeting moved", statusExpiresAt: current.statusExpiresAt });
  expect(current.statusText).toBe("In a meeting");
  expect(applyPreviewWorkspaceProfile(renamed, { status: { text: null } })).toMatchObject({ statusText: null, statusExpiresAt: null });
  expect(applyPreviewWorkspaceProfile(renamed, { workLocation: "remote" })).toMatchObject({ workLocation: "remote" });
});
