import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  user: { id: 1 }, state: {} as any, frame: { values: [] as any[], index: 0 }, buttons: new Map<string, any>(), inputs: new Map<string, any>(),
  ownPhotoDescriptor: { userId: 1, photoUrl: "/api/profile/photo/10/1?v=22222222-2222-4222-8222-222222222222", photoVersion: "22222222-2222-4222-8222-222222222222" },
  create: vi.fn(), directory: vi.fn(), push: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: any) => { const frame = m.frame, i = frame.index++; if (i >= frame.values.length) frame.values[i] = typeof initial === "function" ? initial() : initial; return [frame.values[i], (value: any) => { frame.values[i] = typeof value === "function" ? value(frame.values[i]) : value; }]; },
    useRef: (initial: any) => { const frame = m.frame, i = frame.index++; if (i >= frame.values.length) frame.values[i] = { current: initial }; return frame.values[i]; },
  };
});
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({
  View: element, Text: element, ActivityIndicator: element, ScrollView: element, KeyboardAvoidingView: element,
  Modal: ({ visible, children }: any) => visible ? children : null,
  FlatList: ({ data, renderItem }: any) => createElement("div", null, ...data.map((item: any, index: number) => createElement("section", { key: index }, renderItem({ item, index })))),
  TextInput: (props: any) => { m.inputs.set(props.accessibilityLabel, props); return createElement("input", { value: props.value, readOnly: true }); },
  Pressable: (props: any) => { if (props.accessibilityLabel) m.buttons.set(props.accessibilityLabel, props); return createElement("button", { disabled: props.disabled }, props.children); },
  AppState: { currentState: "active" }, StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
}));
vi.mock("expo-router", () => ({ router: { push: m.push }, useFocusEffect: vi.fn() }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/meet-action", () => ({ MeetAction: () => null }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.user }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "green", foreground: "black", muted: "gray", surface: "white", border: "silver", error: "red" }) }));
vi.mock("../lib/chat/store", () => ({ useChatStore: Object.assign(() => m.state, { getState: () => m.state }) }));
vi.mock("../components/profile/profile-avatar", () => ({
  ProfileAvatar: (props: any) => createElement("span", {
    "data-photo-url": props.photoUrl ?? "",
    "data-tenant-id": props.tenantId,
    "data-user-id": props.userId,
  }),
  useProfilePhotoCacheScope: vi.fn(),
}));
vi.mock("../lib/profile/use-workspace-profile", () => ({ useWorkspaceProfile: () => ({ photoDescriptor: m.ownPhotoDescriptor }) }));

import TeamChat from "../app/(tabs)/teamchat";

function render() {
  m.frame.index = 0; m.buttons.clear(); m.inputs.clear();
  return renderToStaticMarkup(createElement(TeamChat));
}
function deferred() { let resolve!: (value?: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; }
async function openComposer() {
  render(); m.buttons.get("New message").onPress(); await Promise.resolve(); await Promise.resolve(); render();
}

beforeEach(() => {
  vi.resetAllMocks(); m.user = { id: 1 }; m.frame = { values: [], index: 0 };
  m.create.mockResolvedValue("created-room"); m.directory.mockResolvedValue(undefined);
  m.state = { userId: 1, workspace: { id: 10, name: "Work" }, workspaces: [],
    channels: [
      { id: "direct", name: "Alice Adams", kind: "direct", memberIds: [1, 2], lastMessage: "Hi", lastMessageAt: 1, unreadCount: 0, blocked: false },
      { id: "group", name: "Launch team", kind: "group", memberIds: [1, 2, 3], lastMessage: "Ready", lastMessageAt: 1, unreadCount: 2, blocked: false },
      { id: "channel", name: "Announcements", kind: "channel", memberIds: [1, 2, 3], lastMessage: "Update", lastMessageAt: 1, unreadCount: 0, blocked: false },
    ], people: [{ id: 1, name: "Owner", extension: "3001" }, { id: 2, name: "Alice Adams", extension: "3002", photoUrl: "/api/profile/photo/10/2?v=11111111-1111-4111-8111-111111111111" }, { id: 3, name: "Cara Chen", extension: "3003" }], drafts: { direct: "Draft reply" },
    loading: false, error: null, storageError: null, loadChannels: vi.fn(), loadDirectory: m.directory, createConversation: m.create, setUser: vi.fn() };
});

it("keeps Chats inclusive of direct and group rooms while More owns Groups and Drafts", () => {
  let html = render();
  expect(m.buttons.has("Chats conversations")).toBe(true);
  m.buttons.get("Chats conversations").onPress(); html = render();
  expect(html).toContain("Alice Adams"); expect(html).toContain("Launch team"); expect(html).not.toContain("Announcements");
  m.buttons.get("More filters").onPress(); render(); m.buttons.get("Drafts conversations").onPress(); html = render();
  expect(html).toContain(">Drafts<"); expect(html).toContain("Draft: Draft reply"); expect(html).not.toContain("Launch team");
});

it("uses the authorized teammate photo for direct rows and directory entries", async () => {
  let html = render();
  expect(html).toContain('data-photo-url="/api/profile/photo/10/2?v=11111111-1111-4111-8111-111111111111"');
  expect(html).toContain('data-tenant-id="10"');
  expect(html).toContain('data-user-id="2"');
  await openComposer(); html = render();
  expect(html).toContain('data-photo-url="/api/profile/photo/10/2?v=11111111-1111-4111-8111-111111111111"');
  expect(html).toContain('data-user-id="3"');
});

it("uses the current owner photo in the Team Chat header and self directory row", async () => {
  let html = render();
  expect(html).toContain('data-photo-url="/api/profile/photo/10/1?v=22222222-2222-4222-8222-222222222222"');
  expect(html).toContain('data-user-id="1"');
  await openComposer(); html = render();
  expect(html).toContain('data-photo-url="/api/profile/photo/10/1?v=22222222-2222-4222-8222-222222222222"');
  expect(html.match(/data-user-id="1"/g)).toHaveLength(2);
});

it("clears the inbox query when the search control closes", () => {
  render(); m.buttons.get("Search conversations").onPress(); render();
  m.inputs.get("Search conversations").onChangeText("Launch"); expect(render()).toContain("Launch team");
  m.buttons.get("Search conversations").onPress(); const html = render();
  expect(html).toContain("Alice Adams"); expect(m.inputs.has("Search conversations")).toBe(false);
});

it("opens a direct message on one teammate selection and ignores a double submit in flight", async () => {
  const request = deferred(); m.create.mockReturnValueOnce(request.promise);
  await openComposer();
  expect(m.inputs.get("Search teammates")).toBeDefined();
  expect(m.buttons.has("Select teammate Alice Adams")).toBe(true);
  const select = m.buttons.get("Select teammate Alice Adams").onPress;
  select(); expect(render()).toContain("Opening private message"); select();
  expect(m.create).toHaveBeenCalledTimes(1); expect(m.create).toHaveBeenCalledWith("direct", "Direct message", [2]);
  request.resolve("direct-room"); await Promise.resolve(); await Promise.resolve();
  expect(m.push).toHaveBeenCalledWith({ pathname: "/chat/[id]", params: { id: "direct-room", tenantId: "10" } });
});

it("shows a bounded error after a direct message create failure", async () => {
  m.create.mockRejectedValueOnce(new Error("offline")); await openComposer();
  await m.buttons.get("Select teammate Alice Adams").onPress(); await Promise.resolve(); await Promise.resolve();
  expect(render()).toContain("Could not connect to Team Chat");
  expect(m.buttons.get("Select teammate Alice Adams").disabled).toBe(false);
});
