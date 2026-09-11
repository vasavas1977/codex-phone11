import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  state: {} as any, user: { id: 1 }, tenantId: "10", press: new Map<string, { press: () => unknown; disabled: boolean }>(), send: vi.fn(), draft: vi.fn(), input: null as any,
}));
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({
  View: element, Text: element, KeyboardAvoidingView: element, ActivityIndicator: element,
  FlatList: () => null, TextInput: (props: any) => { if (props.accessibilityLabel === "Message") mocks.input = props; return null; }, Platform: { OS: "ios" },
  AppState: { currentState: "active", addEventListener: vi.fn() }, StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  Pressable: ({ children, accessibilityLabel, onPress, disabled }: any) => {
    mocks.press.set(accessibilityLabel, { press: onPress, disabled });
    return createElement("button", { disabled }, children);
  },
}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "room", tenantId: mocks.tenantId }), useFocusEffect: vi.fn(), router: {} }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: mocks.user }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "green", foreground: "black", muted: "gray", surface: "white" }) }));
vi.mock("../lib/chat/store", () => ({ useChatStore: Object.assign(() => mocks.state, { getState: () => mocks.state }) }));
import ChatRoom from "../app/chat/[id]";
beforeEach(() => {
  vi.clearAllMocks(); mocks.press.clear(); mocks.tenantId = "10"; mocks.user = { id: 1 };
  mocks.state = { userId: 1, workspace: { id: 10, name: "Work" }, channels: [{ id: "room", name: "Team", memberIds: [1, 2] }],
    drafts: { room: "Hello" }, messages: {}, roomErrors: {}, roomLoading: {}, hasMore: {}, sendMessage: mocks.send, setDraft: mocks.draft };
});
it("a double tap sends one message while the first request is in flight", async () => {
  let finish!: () => void;
  mocks.send.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  renderToStaticMarkup(<ChatRoom />); const button = mocks.press.get("Send message")!;
  const first = button.press(); const second = button.press();
  expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.send).toHaveBeenCalledWith("room", "Hello");
  mocks.state.drafts.room = "Next message"; finish(); await first; await second;
  expect(mocks.state.drafts.room).toBe("Next message");
});
it("cannot send through a stale owner or a mismatched route workspace", () => {
  mocks.state.userId = 2; renderToStaticMarkup(<ChatRoom />); expect(mocks.press.get("Send message")!.disabled).toBe(true);
  mocks.state.userId = 1; mocks.tenantId = "20"; renderToStaticMarkup(<ChatRoom />); expect(mocks.press.get("Send message")!.disabled).toBe(true);
  mocks.tenantId = "invalid"; renderToStaticMarkup(<ChatRoom />); expect(mocks.press.get("Send message")!.disabled).toBe(true);
});
it.each(["owner", "workspace", "same-owner-session"])("blocks captured send and typing after %s changes", async change => {
  renderToStaticMarkup(<ChatRoom />); const send = mocks.press.get("Send message")!.press, type = mocks.input.onChangeText;
  if (change === "owner") { mocks.user = { id: 2 }; mocks.state = { ...mocks.state, userId: 2 }; }
  if (change === "same-owner-session") mocks.user = { id: 1 };
  if (change === "workspace") mocks.state = { ...mocks.state, workspace: { id: 20 } };
  type("old private draft"); await send();
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.draft).not.toHaveBeenCalled();
});
it("does not render another workspace's draft or header while the route is changing", () => {
  mocks.tenantId = "20";
  expect(renderToStaticMarkup(<ChatRoom />)).not.toContain("Team");
  expect(mocks.input.value).toBe(""); expect(mocks.input.editable).toBe(false);
});
