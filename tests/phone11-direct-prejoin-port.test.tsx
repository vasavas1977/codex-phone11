import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  user: { id: 3001, name: "Host" } as { id: number; name: string } | null,
  ownerId: 3001,
  workspaceId: 1,
  route: { meetingId: "22222222-2222-4222-8222-222222222222", tenantId: "1", source: "direct" },
  exact: { meetingId: "22222222-2222-4222-8222-222222222222", tenantId: 1 } as { meetingId: string; tenantId: number } | null,
  exactOptions: null as any,
  generalOptions: null as any,
  generalError: new Error("Capped list unavailable") as Error | null,
  prejoin: null as any,
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.user }) }));
vi.mock("../lib/chat/store", () => ({
  useChatStore: (selector: any) => selector({ userId: m.ownerId, workspace: { id: m.workspaceId } }),
}));
vi.mock("../lib/trpc", () => ({ trpc: { meetings: {
  capabilities: { useQuery: () => ({ data: { available: true }, error: null, isLoading: false, isFetching: false, refetch: vi.fn() }) },
  available: { useQuery: (_: any, options: any) => {
    m.generalOptions = options;
    return { data: undefined, error: m.generalError, isLoading: false, isFetching: false, refetch: vi.fn() };
  } },
  availableMeetingForTenant: { useQuery: (_: any, options: any) => {
    m.exactOptions = options;
    return { data: m.exact, error: null, isLoading: false, isFetching: false, refetch: vi.fn() };
  } },
  join: { useMutation: () => ({ mutateAsync: vi.fn() }) },
} } }));
vi.mock("expo-router", () => ({ router: { canGoBack: () => false, replace: vi.fn() }, useLocalSearchParams: () => m.route }));
vi.mock("../components/meetings/meeting-prejoin", () => ({ MeetingPrejoin: (props: any) => {
  m.prejoin = props;
  return createElement("section", null, props.unavailableReason ?? "Ready to join");
} }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: ({ children }: any) => createElement("main", null, children) }));
import ConferenceScreen from "../app/conference";

beforeEach(() => {
  m.user = { id: 3001, name: "Host" };
  m.ownerId = 3001;
  m.workspaceId = 1;
  m.route = { meetingId: "22222222-2222-4222-8222-222222222222", tenantId: "1", source: "direct" };
  m.exact = { meetingId: m.route.meetingId, tenantId: 1 };
  m.generalError = new Error("Capped list unavailable");
  m.prejoin = null;
});

it("uses exact direct admission even when the general meeting list is unavailable", () => {
  expect(renderToStaticMarkup(createElement(ConferenceScreen))).toContain("Ready to join");
  expect(m.generalOptions.enabled).toBe(false);
  expect(m.exactOptions.enabled).toBe(true);
  expect(m.prejoin.admittedMeetings).toEqual([{ meetingId: m.route.meetingId }]);
});

it("rejects a direct invitation from a different selected workspace", () => {
  m.workspaceId = 2;
  expect(renderToStaticMarkup(createElement(ConferenceScreen))).toContain("Return to Team Chat");
  expect(m.exactOptions.enabled).toBe(false);
});

it("rejects a room that fails exact admission", () => {
  m.exact = null;
  expect(renderToStaticMarkup(createElement(ConferenceScreen))).toContain("no longer available");
});
