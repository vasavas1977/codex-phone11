import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  owner: { id: 3001 },
  renderedOwner: { id: 3001 },
  workspaceId: 1,
  chatOwnerId: 3001,
  available: true,
  error: null as Error | null,
  button: null as any,
  refetch: vi.fn(),
  start: vi.fn(),
  push: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("react-native", () => ({
  Alert: { alert: m.alert },
  Pressable: (props: any) => {
    m.button = props;
    return createElement("button", { disabled: props.disabled, "aria-label": props.accessibilityLabel }, props.children);
  },
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("expo-router", () => ({ router: { push: m.push } }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.renderedOwner }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#05f", muted: "#777" }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.owner }) }));
vi.mock("../lib/chat/store", () => ({
  useChatStore: Object.assign(
    (select: any) => select({ userId: m.chatOwnerId, workspace: { id: m.workspaceId } }),
    { getState: () => ({ userId: m.chatOwnerId, workspace: { id: m.workspaceId }, channels: [{ id: "direct-1", kind: "direct" }] }) },
  ),
}));
vi.mock("../lib/trpc", () => ({
  trpc: { meetings: {
    directCapabilities: { useQuery: () => ({
      data: { available: m.available, canStart: m.available },
      error: m.error, isLoading: false, isFetching: false, refetch: m.refetch,
    }) },
    startDirectMeeting: { useMutation: () => ({ mutateAsync: m.start }) },
  } },
}));

import { DirectMeetingAction } from "../components/chat/direct-meeting-action";

beforeEach(() => {
  m.owner = { id: 3001 };
  m.renderedOwner = m.owner;
  m.workspaceId = 1;
  m.chatOwnerId = 3001;
  m.available = true;
  m.error = null;
  m.button = null;
  m.refetch.mockReset().mockResolvedValue({ data: { available: true, canStart: true }, error: null });
  m.start.mockReset().mockResolvedValue({ meetingId: "22222222-2222-4222-8222-222222222222" });
  m.push.mockReset();
  m.alert.mockReset();
});

it("starts an exact direct-contact invitation and opens that room", async () => {
  renderToStaticMarkup(createElement(DirectMeetingAction, { tenantId: 1, conversationId: "direct-1" }));
  expect(m.button.accessibilityLabel).toBe("Meet with contact");
  m.button.onPress();
  await vi.waitFor(() => expect(m.push).toHaveBeenCalledOnce());
  expect(m.start).toHaveBeenCalledWith({
    tenantId: 1,
    conversationId: "direct-1",
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  expect(m.push).toHaveBeenCalledWith({ pathname: "/conference", params: {
    meetingId: "22222222-2222-4222-8222-222222222222",
    tenantId: "1",
    source: "direct",
  } });
});

it("does not create a room when permission or workspace binding is missing", () => {
  m.available = false;
  renderToStaticMarkup(createElement(DirectMeetingAction, { tenantId: 1, conversationId: "direct-1" }));
  expect(m.button.disabled).toBe(true);
  m.button.onPress();
  expect(m.start).not.toHaveBeenCalled();
  m.available = true;
  m.workspaceId = 2;
  renderToStaticMarkup(createElement(DirectMeetingAction, { tenantId: 1, conversationId: "direct-1" }));
  expect(m.button.disabled).toBe(true);
  m.button.onPress();
  expect(m.start).not.toHaveBeenCalled();
});

it("drops a late permission result after account switch", async () => {
  let resolve!: (value: unknown) => void;
  m.refetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  renderToStaticMarkup(createElement(DirectMeetingAction, { tenantId: 1, conversationId: "direct-1" }));
  m.button.onPress();
  m.owner = { id: 1020 };
  resolve({ data: { available: true, canStart: true }, error: null });
  await vi.waitFor(() => expect(m.refetch).toHaveBeenCalledOnce());
  expect(m.start).not.toHaveBeenCalled();
  expect(m.push).not.toHaveBeenCalled();
});
