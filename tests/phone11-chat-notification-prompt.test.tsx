import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({ buttons: new Map<string, any>(), enable: vi.fn(async () => ({ status: "enabled" as const })),
  enrollment: { ownerId: 2, tenantId: 10, status: "permission-required" } }));
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({
  View: element, Text: element, StyleSheet: { create: (value: any) => value },
  Pressable: (props: any) => { if (props.accessibilityLabel) m.buttons.set(props.accessibilityLabel, props); return createElement("button", null, props.children); },
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "green", foreground: "black", muted: "gray" }) }));
vi.mock("../lib/notifications/enrollment-status", () => ({
  requestChatNotificationEnrollment: () => m.enable(),
  useChatNotificationEnrollment: () => m.enrollment,
}));

import { NotificationEnrollmentPrompt } from "../components/chat/notification-enrollment-prompt";

function render(ownerId = 2, tenantId = 10) {
  m.buttons.clear();
  return renderToStaticMarkup(createElement(NotificationEnrollmentPrompt, { ownerId, tenantId }));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.enrollment = { ownerId: 2, tenantId: 10, status: "permission-required" };
});

it("shows the scoped prompt without asking for permission until the user taps", async () => {
  const html = render();
  expect(html).toContain("Get new message alerts");
  expect(m.enable).not.toHaveBeenCalled();
  await m.buttons.get("Enable message notifications").onPress();
  expect(m.enable).toHaveBeenCalledOnce();
});

it("does not leak a prior account or workspace prompt", () => {
  expect(render(3, 10)).toBe("");
  expect(render(2, 20)).toBe("");
  m.enrollment = { ownerId: 2, tenantId: 10, status: "enabled" };
  expect(render()).toBe("");
  expect(m.enable).not.toHaveBeenCalled();
});
