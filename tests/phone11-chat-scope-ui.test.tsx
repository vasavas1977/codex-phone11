import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  user: { id: 1 }, state: {} as any, params: { id: "room", tenantId: "10" },
  frame: { values: [] as any[], index: 0 }, buttons: new Map<string, any>(), inputs: new Map<string, any>(),
  send: vi.fn(), create: vi.fn(), directory: vi.fn(), push: vi.fn(),
}));
// Keep state/ref slots alive across SSR renders so account/workspace transitions
// exercise the same mounted component, including unresolved previous actions.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: any) => { const frame = m.frame, i = frame.index++; if (i >= frame.values.length) frame.values[i] = typeof initial === "function" ? initial() : initial;
      return [frame.values[i], (value: any) => { frame.values[i] = typeof value === "function" ? value(frame.values[i]) : value; }]; },
    useRef: (initial: any) => { const frame = m.frame, i = frame.index++; if (i >= frame.values.length) frame.values[i] = { current: initial }; return frame.values[i]; },
  };
});
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({
  View: element, Text: element, KeyboardAvoidingView: element, ActivityIndicator: element, ScrollView: element,
  Modal: ({ visible, children }: any) => visible ? children : null,
  FlatList: ({ data, renderItem }: any) => createElement("div", null, ...data.map((item: any, index: number) => createElement("section", { key: index }, renderItem({ item })))),
  TextInput: (props: any) => { m.inputs.set(props.accessibilityLabel, props); return createElement("input", { value: props.value, readOnly: true }); },
  Pressable: (props: any) => { if (props.accessibilityLabel) m.buttons.set(props.accessibilityLabel, props); return createElement("button", { disabled: props.disabled }, props.children); },
  Platform: { OS: "ios" }, AppState: { currentState: "active", addEventListener: vi.fn() }, StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => m.params, useFocusEffect: vi.fn(), router: { push: m.push } }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.user }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "green", foreground: "black", muted: "gray", surface: "white" }) }));
vi.mock("../lib/chat/store", () => ({ useChatStore: Object.assign(() => m.state, { getState: () => m.state }) }));
import TeamChat from "../app/(tabs)/teamchat";
import ChatRoom from "../app/chat/[id]";
function render(component: typeof TeamChat) { m.frame.index = 0; m.buttons.clear(); m.inputs.clear(); return renderToStaticMarkup(createElement(component)); }
function deferred() { let resolve!: (value?: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; }
async function composeGroup() {
  render(TeamChat); m.buttons.get("New conversation").onPress(); await Promise.resolve(); await Promise.resolve();
  render(TeamChat); m.buttons.get("group conversation").onPress(); render(TeamChat);
  m.inputs.get("Conversation name").onChangeText("Daily work"); m.buttons.get("Select teammate Bob").onPress(); render(TeamChat);
}
beforeEach(() => {
  vi.resetAllMocks(); m.user = { id: 1 }; m.params = { id: "room", tenantId: "10" }; m.frame = { values: [], index: 0 };
  m.directory.mockResolvedValue(undefined); m.create.mockResolvedValue("created-room"); m.send.mockResolvedValue(undefined);
  m.state = { userId: 1, workspace: { id: 10, name: "Work" }, workspaces: [], channels: [{ id: "room", name: "Team", kind: "group", memberIds: [1, 2] }],
    people: [{ id: 2, name: "Bob" }], drafts: { room: "Hello" }, messages: {}, roomErrors: {}, roomLoading: {}, hasMore: {},
    sendMessage: m.send, createConversation: m.create, loadDirectory: m.directory, setDraft: vi.fn(), loadChannels: vi.fn() };
});
it("creates a selected group once and navigates using its captured workspace", async () => {
  const request = deferred(); m.create.mockReturnValueOnce(request.promise); await composeGroup();
  const start = m.buttons.get("Start conversation").onPress; const first = start(); await start();
  expect(m.create).toHaveBeenCalledTimes(1); expect(m.create).toHaveBeenCalledWith("group", "Daily work", [2]);
  request.resolve("created-room"); await first;
  expect(m.push).toHaveBeenCalledWith({ pathname: "/chat/[id]", params: { id: "created-room", tenantId: "10" } });
});
it("does not navigate a late group creation into a replacement account", async () => {
  const request = deferred(); m.create.mockReturnValueOnce(request.promise); await composeGroup();
  const first = m.buttons.get("Start conversation").onPress();
  m.user = { id: 2 }; m.state = { ...m.state, userId: 2 };
  expect(render(TeamChat)).not.toContain("Daily work");
  request.resolve("old-room"); await first; expect(m.push).not.toHaveBeenCalled();
});
it("preserves group name and selection while refreshing after an error", async () => {
  m.create.mockRejectedValueOnce(new Error("offline")); await composeGroup(); await m.buttons.get("Start conversation").onPress();
  render(TeamChat); await m.buttons.get("Refresh teammates").onPress(); render(TeamChat);
  expect(m.inputs.get("Conversation name").value).toBe("Daily work");
  expect(m.buttons.get("Start conversation").disabled).toBe(false);
  await m.buttons.get("Start conversation").onPress(); expect(m.create).toHaveBeenLastCalledWith("group", "Daily work", [2]);
});
it("a stuck old workspace creation cannot disable a new workspace composer or clear its action", async () => {
  const old = deferred(), next = deferred(); m.create.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await composeGroup(); const first = m.buttons.get("Start conversation").onPress();
  m.state = { ...m.state, workspace: { id: 20, name: "Other" } };
  await composeGroup(); expect(m.buttons.get("Start conversation").disabled).toBe(false);
  const second = m.buttons.get("Start conversation").onPress(); render(TeamChat);
  expect(m.buttons.get("Start conversation").disabled).toBe(true);
  old.resolve("old-room"); await first; render(TeamChat);
  expect(m.buttons.get("Start conversation").disabled).toBe(true); expect(m.push).not.toHaveBeenCalled();
  next.resolve("new-room"); await second;
  expect(m.push).toHaveBeenCalledWith(expect.objectContaining({ params: { id: "new-room", tenantId: "20" } }));
});
it("a stuck old send cannot disable a replacement room or clear its pending send", async () => {
  const old = deferred(), next = deferred(); m.send.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  render(ChatRoom); const first = m.buttons.get("Send message").onPress(); render(ChatRoom); expect(m.buttons.get("Send message").disabled).toBe(true);
  m.params = { id: "next-room", tenantId: "10" }; m.state = { ...m.state, channels: [{ id: "next-room", name: "Next", memberIds: [1, 2] }], drafts: { "next-room": "Next text" } };
  render(ChatRoom); expect(m.buttons.get("Send message").disabled).toBe(false);
  const second = m.buttons.get("Send message").onPress(); old.resolve(); await first; render(ChatRoom);
  expect(m.buttons.get("Send message").disabled).toBe(true); next.resolve(); await second; render(ChatRoom);
  expect(m.buttons.get("Send message").disabled).toBe(false);
});
it("hides an old search immediately when the route points at another workspace", () => {
  render(ChatRoom); m.buttons.get("Search messages").onPress(); render(ChatRoom);
  m.inputs.get("Search saved messages").onChangeText("private search text");
  expect(render(ChatRoom)).toContain("private search text");
  m.params = { id: "room", tenantId: "20" };
  expect(render(ChatRoom)).not.toContain("private search text");
  expect(m.inputs.has("Search saved messages")).toBe(false);
  expect(m.inputs.get("Message").value).toBe("");
});
