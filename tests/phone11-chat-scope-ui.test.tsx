vi.mock("../components/chat/voice-note", () => ({ VoiceNote: () => null }));
vi.mock("../components/chat/received-media", () => ({ ReceivedMedia: () => null }));
vi.mock("../components/chat/conversation-rail", () => ({ ConversationRail: () => null }));
vi.mock("../components/chat/peer-call", () => ({ ChatPeerCall: () => null }));
// Chat scope tests exercise tenant/owner state transitions, not native image
// modules or meeting availability. Keep those separate boundaries inert here.
vi.mock("../components/chat/meeting-action", () => ({ ChatMeetingAction: () => null }));
vi.mock("../components/profile/profile-avatar", () => ({
  ProfileAvatar: () => null,
  useProfilePhotoCacheScope: () => {},
}));
vi.mock("../hooks/use-directory", () => ({ useDirectory: () => ({ people: [], owner: null }) }));
vi.mock("../lib/profile/use-workspace-profile", () => ({ useWorkspaceProfile: () => ({ profile: undefined }) }));
vi.mock("../components/meet-action", () => ({ MeetAction: () => null }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  user: { id: 1 }, state: {} as any, params: { id: "room", tenantId: "10" },
  frame: { values: [] as any[], index: 0 }, buttons: new Map<string, any>(), inputs: new Map<string, any>(),
  send: vi.fn(), create: vi.fn(), directory: vi.fn(), details: vi.fn(), report: vi.fn(), block: vi.fn(), unblock: vi.fn(), push: vi.fn(),
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
  FlatList: ({ data, renderItem, ListHeaderComponent }: any) => createElement("div", null, ListHeaderComponent, ...data.map((item: any, index: number) => createElement("section", { key: index }, renderItem({ item, index })))),
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
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
import TeamChat from "../app/(tabs)/teamchat";
import ChatRoom from "../app/chat/[id]";
function render(component: typeof TeamChat) { m.frame.index = 0; m.buttons.clear(); m.inputs.clear(); return renderToStaticMarkup(createElement(component)); }
function deferred() { let resolve!: (value?: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; }
async function composeGroup() {
  render(TeamChat); m.buttons.get("New message").onPress(); await Promise.resolve(); await Promise.resolve();
  render(TeamChat); m.buttons.get("New group").onPress(); render(TeamChat);
  m.inputs.get("Conversation name").onChangeText("Daily work"); m.buttons.get("Select teammate Bob").onPress(); render(TeamChat);
}
beforeEach(() => {
  vi.resetAllMocks(); m.user = { id: 1 }; m.params = { id: "room", tenantId: "10" }; m.frame = { values: [], index: 0 };
  m.directory.mockResolvedValue(undefined); m.create.mockResolvedValue("created-room"); m.send.mockResolvedValue(undefined); m.details.mockResolvedValue({ members: [], media: [], links: [] }); m.report.mockResolvedValue(undefined); m.block.mockResolvedValue(undefined); m.unblock.mockResolvedValue(undefined);
  m.state = { userId: 1, workspace: { id: 10, name: "Work" }, workspaces: [], channels: [{ id: "room", name: "Team", kind: "group", memberIds: [1, 2] }],
    people: [{ id: 2, name: "Bob" }], drafts: { room: "Hello", "room:thread:parent": "Hello" }, messages: {}, roomErrors: {}, roomLoading: {}, hasMore: {},
    sendMessage: m.send, createConversation: m.create, loadDirectory: m.directory, loadDetails: m.details, reportMessage: m.report, blockMember: m.block, unblockMember: m.unblock, setDraft: vi.fn(), loadChannels: vi.fn() };
});
it("creates a selected group once and navigates using its captured workspace", async () => {
  const request = deferred(); m.create.mockReturnValueOnce(request.promise); await composeGroup();
  const start = m.buttons.get("Create").onPress; const first = start(); await start();
  expect(m.create).toHaveBeenCalledTimes(1); expect(m.create).toHaveBeenCalledWith("group", "Daily work", [2]);
  request.resolve("created-room"); await first;
  expect(m.push).toHaveBeenCalledWith({ pathname: "/chat/[id]", params: { id: "created-room", tenantId: "10" } });
});
it("does not navigate a late group creation into a replacement account", async () => {
  const request = deferred(); m.create.mockReturnValueOnce(request.promise); await composeGroup();
  const first = m.buttons.get("Create").onPress();
  m.user = { id: 2 }; m.state = { ...m.state, userId: 2 };
  expect(render(TeamChat)).not.toContain("Daily work");
  request.resolve("old-room"); await first; expect(m.push).not.toHaveBeenCalled();
});
it("preserves group name and selection while refreshing after an error", async () => {
  m.create.mockRejectedValueOnce(new Error("offline")); await composeGroup(); await m.buttons.get("Create").onPress();
  render(TeamChat); await m.buttons.get("Refresh teammates").onPress(); render(TeamChat);
  expect(m.inputs.get("Conversation name").value).toBe("Daily work");
  expect(m.buttons.get("Create").disabled).toBe(false);
  await m.buttons.get("Create").onPress(); expect(m.create).toHaveBeenLastCalledWith("group", "Daily work", [2]);
});
it("a stuck old workspace creation cannot disable a new workspace composer or clear its action", async () => {
  const old = deferred(), next = deferred(); m.create.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await composeGroup(); const first = m.buttons.get("Create").onPress();
  m.state = { ...m.state, workspace: { id: 20, name: "Other" } };
  await composeGroup(); expect(m.buttons.get("Create").disabled).toBe(false);
  const second = m.buttons.get("Create").onPress(); render(TeamChat);
  expect(m.buttons.get("Create").disabled).toBe(true);
  old.resolve("old-room"); await first; render(TeamChat);
  expect(m.buttons.get("Create").disabled).toBe(true); expect(m.push).not.toHaveBeenCalled();
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
it("shows a compact quoted parent in the composer and sends its stable ID", async () => {
  m.state = { ...m.state, messages: { room: [{ id: "parent", clientId: "parent-client", channelId: "room", senderId: 2, senderName: "Bob", content: "Please confirm", timestamp: 1, sequence: 1, status: "sent", parent: null }] } };
  render(ChatRoom); m.buttons.get("Message from Bob").onLongPress(); render(ChatRoom); m.buttons.get("Reply").onPress();
  const html = render(ChatRoom); expect(html).toContain("Replying to Bob"); expect(html).toContain("Please confirm");
  await m.buttons.get("Send message").onPress(); expect(m.send).toHaveBeenLastCalledWith("room", "Hello", "parent");
});
it("requires a confirmation before blocking and keeps the report category bounded", async () => {
  m.state = { ...m.state, channels: [{ id: "room", name: "Bob", kind: "direct", memberIds: [1, 2], blocked: false }], messages: { room: [{ id: "parent", clientId: "parent-client", channelId: "room", senderId: 2, senderName: "Bob", content: "Stop", timestamp: 1, sequence: 1, status: "sent", parent: null }] } };
  render(ChatRoom); m.buttons.get("Conversation menu").onPress(); render(ChatRoom);
  m.buttons.get("Report conversation").onPress(); render(ChatRoom);
  expect(m.buttons.has("Report category spam")).toBe(true); m.buttons.get("Report category spam").onPress();
  m.buttons.get("Close report form").onPress(); render(ChatRoom);
  m.buttons.get("Conversation menu").onPress(); render(ChatRoom); m.buttons.get("Block Bob").onPress();
  expect(render(ChatRoom)).toContain("New direct messages will stop for both people.");
  await m.buttons.get("Confirm safety action").onPress(); expect(m.block).toHaveBeenCalledWith(2);
});
it("keeps a blocked direct chat searchable and pageable while send controls remain disabled", () => {
  m.state = { ...m.state, channels: [{ id: "room", name: "Bob", kind: "direct", memberIds: [1, 2], blocked: true }], hasMore: { room: true }, loadMessages: vi.fn() };
  render(ChatRoom); m.buttons.get("Conversation menu").onPress(); const html = render(ChatRoom);
  expect(m.buttons.get("Search messages").disabled).toBeFalsy(); expect(html).toContain("Load earlier messages");
  expect(m.buttons.get("Send message").disabled).toBe(true);
});
it("hides an old search immediately when the route points at another workspace", () => {
  render(ChatRoom); m.buttons.get("Conversation menu").onPress(); render(ChatRoom); m.buttons.get("Search messages").onPress(); render(ChatRoom);
  m.inputs.get("Search messages").onChangeText("private search text");
  expect(render(ChatRoom)).toContain("private search text");
  m.params = { id: "room", tenantId: "20" };
  expect(render(ChatRoom)).not.toContain("private search text");
  expect(m.inputs.has("Search messages")).toBe(false);
  expect(m.inputs.get("Message").value).toBe("");
});
it("filters drafts without exposing a replacement workspace draft", () => {
  render(TeamChat); m.buttons.get("More filters").onPress(); render(TeamChat); m.buttons.get("Drafts conversations").onPress();
  expect(render(TeamChat)).toContain("Draft: Hello");
  m.state = { ...m.state, userId: 2 };
  expect(render(TeamChat)).not.toContain("Draft: Hello");
});
it("finds a teammate by extension when starting a conversation", async () => {
  m.state.people = [{ id: 2, name: "Bob", extension: "3002" }, { id: 3, name: "Alice", extension: "3003" }];
  render(TeamChat); m.buttons.get("New message").onPress(); await Promise.resolve(); await Promise.resolve();
  render(TeamChat); m.inputs.get("Search teammates").onChangeText("3003");
  const html = render(TeamChat); expect(html).toContain("Alice"); expect(html).not.toContain("Bob");
});
async function lateDetailsAfter(change: () => void) {
  const request = deferred(); m.details.mockReturnValueOnce(request.promise);
  render(ChatRoom); const open = m.buttons.get("Open conversation details").onPress();
  change(); render(ChatRoom);
  request.resolve({ members: [{ id: 99, name: "Private old member", extension: null }], media: [], links: [] });
  await open;
  expect(render(ChatRoom)).not.toContain("Private old member");
}
it("does not reveal a late details response after changing rooms", async () => {
  await lateDetailsAfter(() => { m.params = { id: "next-room", tenantId: "10" }; m.state = { ...m.state, channels: [{ id: "next-room", name: "Next", kind: "group", memberIds: [1, 2] }], drafts: { "next-room": "Next" } }; });
});
it("does not reveal a late details response after changing workspaces", async () => {
  await lateDetailsAfter(() => { m.params = { id: "room", tenantId: "20" }; m.state = { ...m.state, workspace: { id: 20, name: "Other" }, channels: [{ id: "room", name: "Other room", kind: "group", memberIds: [1, 2] }] }; });
});
it("does not reveal a late details response after changing owners", async () => {
  await lateDetailsAfter(() => { m.user = { id: 2 }; m.state = { ...m.state, userId: 2, channels: [{ id: "room", name: "New owner room", kind: "group", memberIds: [2, 3] }] }; });
});
