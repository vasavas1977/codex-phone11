import { expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
vi.mock("../components/feature-unavailable", () => ({ FeatureUnavailable: ({ title, description }: any) => createElement("main", null, title, description) }));
// If any legacy route imports its former state/engine, fail before rendering.
vi.mock("../lib/notifications/store", () => { throw new Error("Demo notification store must stay unreachable"); });
vi.mock("../lib/conference/store", () => { throw new Error("Local conference engine must stay unreachable"); });
vi.mock("../lib/notifications/client", () => ({ chatNotificationClientEnabled: () => false }));
vi.mock("../lib/notifications/chat-notifications", () => ({ enableChatNotifications: vi.fn() }));
vi.mock("../lib/chat/store", () => ({ useChatStore: vi.fn() }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: vi.fn() }));
vi.mock("../hooks/use-auth", () => ({ useAuth: vi.fn() }));
vi.mock("../hooks/use-colors", () => ({ useColors: vi.fn() }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: () => null }));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("react-native", () => ({ StyleSheet: { create: (x: unknown) => x } }));
import Notifications from "../app/notifications";
import Preferences from "../app/notifications/preferences";
import Billing from "../app/billing";
import Conference from "../app/conference";
import Room from "../app/conference/room";
it.each([
  [Notifications, "Notification center is not available yet"],
  [Preferences, "Notification settings are not available yet"],
  [Billing, "Billing is not available in the app"],
  [Conference, "Conference calls are not available yet"],
  [Room, "Conference calls are not available yet"],
] as const)("legacy route renders an unavailable state without starting demo services (%#)", (Component, title) => {
  const html = renderToStaticMarkup(createElement(Component)); expect(html).toContain(title);
  expect(html).not.toMatch(/INV-2026|David Kim|47\.32|current_user/);
});
