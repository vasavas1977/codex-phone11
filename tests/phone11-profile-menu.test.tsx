import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

vi.mock("react-native", () => ({
  Pressable: ({ children, accessibilityLabel, style: _style, accessibilityRole: _role, accessibilityState: _state, ...props }: any) => createElement("button", { "aria-label": accessibilityLabel, ...props }, children),
  Modal: ({ children, visible }: any) => visible ? createElement("section", null, children) : null,
  ScrollView: ({ children, contentContainerStyle: _contentStyle, style: _style, keyboardShouldPersistTaps: _keyboard, ...props }: any) => createElement("main", props, children),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: ({ children, style: _style, accessibilityRole: _role, accessibilityLabel: _label, numberOfLines: _lines, ...props }: any) => createElement("span", props, children),
  TextInput: ({ style: _style, accessibilityLabel, editable: _editable, placeholderTextColor: _placeholderColor, value, onChangeText: _changeText, ...props }: any) => createElement("input", { "aria-label": accessibilityLabel, defaultValue: value, ...props }),
  View: ({ children, style: _style, accessibilityLabel: _label, ...props }: any) => createElement("div", props, children),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: ({ name }: { name: string }) => createElement("i", null, name) }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ background: "#fff", surface: "#fafafa", border: "#ddd", foreground: "#111", muted: "#666", primary: "#07c", success: "#080" }),
}));

import { AccountHub, accountInitials } from "../components/profile/account-hub";

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
  }));
  for (const label of ["Availability", "Do not disturb", "Status", "Work location", "Remote", "My profile", "Settings"])
    expect(html).toContain(label);
  expect(html).toContain("In a customer review");
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
