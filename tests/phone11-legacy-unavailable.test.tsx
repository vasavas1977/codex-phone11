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
vi.mock("../lib/notifications/enrollment-status", () => ({ useChatNotificationEnrollment: () => ({ ownerId:null,tenantId:null,status:"unsupported" }) }));
vi.mock("../lib/chat/store", () => ({ useChatStore: vi.fn() }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: vi.fn() }));
vi.mock("../hooks/use-auth", () => ({ useAuth: vi.fn(() => ({ user: null })) }));
vi.mock("../hooks/use-colors", () => ({ useColors: vi.fn() }));
vi.mock("../components/screen-container", () => ({
  ScreenContainer: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("../lib/trpc", () => ({
  trpc: {
    meetings: {
      capabilities: {
        useQuery: vi.fn(() => ({ isLoading: false, isFetching: false, data: undefined, error: null, refetch: vi.fn() })),
      },
      available: {
        useQuery: vi.fn(() => ({ isLoading: false, isFetching: false, data: [], error: null, refetch: vi.fn() })),
      },
    },
  },
}));
vi.mock("../components/meetings/meeting-prejoin", () => ({
  MeetingPrejoin: ({ unavailableReason }: any) => createElement("main", null, unavailableReason ? "Meetings aren’t available" : "Join a meeting", unavailableReason),
}));
vi.mock("../components/meetings/meeting-room-state", () => ({
  MeetingRoomState: ({ unavailableReason }: any) => createElement("main", null, unavailableReason),
}));
vi.mock("expo-router", () => ({ router: {}, useLocalSearchParams: () => ({}) }));
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
  [Conference, "Meetings aren’t available"],
  [Room, "Meetings are still being configured for this workspace"],
] as const)("legacy route stays safe without starting demo services (%#)", (Component, title) => {
  const html = renderToStaticMarkup(createElement(Component)); expect(html).toContain(title);
  expect(html).not.toMatch(/INV-2026|David Kim|47\.32|current_user/);
});
