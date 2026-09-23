vi.mock("../components/chat/voice-note", () => ({
  VoiceNote: (props: any) => {
    mocks.voice = props;
    return null;
  },
}));
vi.mock("../components/chat/received-media", () => ({ ReceivedMedia: () => null }));
vi.mock("../components/chat/conversation-rail", () => ({ ConversationRail: () => null }));
vi.mock("../components/chat/peer-call", () => ({ ChatPeerCall: () => null }));
vi.mock("../components/chat/meeting-action", () => ({ ChatMeetingAction: () => null }));
vi.mock("../components/chat/channel-meeting-picker", () => ({
  ChannelMeetingPicker: (props: any) => {
    mocks.channelMeeting = props;
    return null;
  },
}));
vi.mock("../components/profile/profile-avatar", () => ({
  ProfileAvatar: (props: any) => createElement("span", { "data-photo-url": props.photoUrl ?? "", "data-photo-version": props.photoVersion ?? "", "data-user-id": props.userId }),
  useProfilePhotoCacheScope: () => {},
}));
vi.mock("../hooks/use-directory", () => ({ useDirectory: () => ({ people: [], owner: null }) }));
vi.mock("../lib/profile/use-workspace-profile", () => ({ useWorkspaceProfile: () => ({ profile: undefined, photoDescriptor: mocks.ownPhotoDescriptor }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  state: {} as any,
  user: { id: 1 },
  ownPhotoDescriptor: { userId: 1, photoUrl: "/api/profile/photo/10/1?v=33333333-3333-4333-8333-333333333333", photoVersion: "33333333-3333-4333-8333-333333333333" },
  tenantId: "10",
  press: new Map<string, { press: () => unknown; longPress?: () => unknown; accessibilityAction?: (event: any) => unknown; disabled: boolean }>(),
  meetingCapability: vi.fn(),
  meetingStart: vi.fn(),
  navigate: vi.fn(),
  send: vi.fn(),
  retry: vi.fn(),
  thread: vi.fn(),
  report: vi.fn(),
  draft: vi.fn(),
  input: null as any,
  keyboard: null as any,
  keyboards: new Map<string | undefined, any>(),
  list: null as any,
  voice: null as any,
  channelMeeting: null as any,
  upload: vi.fn(),
  details: vi.fn(),
  refs: [] as any[],
  values: [] as any[],
  stateIndex: 0,
  refIndex: 0,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: any) => {
      const index = mocks.stateIndex++;
      if (index >= mocks.values.length)
        mocks.values[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        mocks.values[index],
        (value: any) => {
          mocks.values[index] =
            typeof value === "function" ? value(mocks.values[index]) : value;
        },
      ];
    },
    useRef: (initial: any) => {
      const index = mocks.refIndex++;
      if (!mocks.refs[index]) mocks.refs[index] = { current: initial };
      return mocks.refs[index];
    },
  };
});
function element({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  View: element,
  ScrollView: element,
  Text: element,
  KeyboardAvoidingView: (props: any) => {
    mocks.keyboard = props;
    mocks.keyboards.set(props.testID, props);
    return element(props);
  },
  ActivityIndicator: element,
  Modal: ({ visible, children }: any) =>
    visible ? element({ children }) : null,
  FlatList: (props: any) => {
    mocks.list = props;
    return createElement(
      "div",
      null,
      props.ListHeaderComponent,
      ...props.data.map((item: any, index: number) =>
        props.renderItem({ item, index }),
      ),
    );
  },
  TextInput: (props: any) => {
    if (props.accessibilityLabel === "Message") mocks.input = props;
    return null;
  },
  Platform: { OS: "ios" },
  AppState: { currentState: "active", addEventListener: vi.fn() },
  StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  Pressable: ({ children, accessibilityLabel, onPress, onLongPress, onAccessibilityAction, disabled }: any) => {
    mocks.press.set(accessibilityLabel, { press: onPress, longPress: onLongPress, accessibilityAction: onAccessibilityAction, disabled });
    return createElement("button", { disabled }, children);
  },
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "room", tenantId: mocks.tenantId }),
  useFocusEffect: vi.fn(),
  router: { push: (...args: any[]) => mocks.navigate(...args) },
}));
vi.mock("../lib/chat/transport", async () => {
  const actual = await vi.importActual<typeof import("../lib/chat/transport")>("../lib/chat/transport");
  return { createChatTransport: () => ({ ...actual.createChatTransport(), channelMeetingCapabilities: (...args: any[]) => mocks.meetingCapability(...args), startChannelMeeting: (...args: any[]) => mocks.meetingStart(...args) }) };
});
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: mocks.user }),
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "green",
    foreground: "black",
    muted: "gray",
    surface: "white",
  }),
}));
vi.mock("../lib/chat/store", () => ({
  useChatStore: Object.assign(() => mocks.state, {
    getState: () => mocks.state,
  }),
}));
vi.mock("../lib/chat/media-client", () => ({
  newUploadId: () => "upload-client",
  uploadChatMedia: (...args: any[]) => mocks.upload(...args),
  shareChatFile: vi.fn(),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
import ChatRoom from "../app/chat/[id]";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.meetingCapability.mockReset().mockResolvedValue({ available: false, canStart: false, maxSelectedMembers: 50 });
  mocks.meetingStart.mockReset();
  mocks.send.mockReset();
  mocks.retry.mockReset();
  mocks.thread.mockReset();
  mocks.report.mockReset();
  mocks.press.clear();
  mocks.keyboard = null;
  mocks.keyboards.clear();
  mocks.list = null;
  mocks.voice = null;
  mocks.channelMeeting = null;
  mocks.upload.mockReset();
  mocks.details.mockReset();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  mocks.refs = [];
  mocks.values = [];
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  mocks.tenantId = "10";
  mocks.user = { id: 1 };
  mocks.state = {
    userId: 1,
    workspace: { id: 10, name: "Work" },
    channels: [{ id: "room", name: "Team", memberIds: [1, 2] }],
    drafts: { room: "Hello", "room:thread:parent": "Hello" },
    messages: {},
    roomErrors: {},
    roomLoading: {},
    hasMore: {},
    sendMessage: mocks.send,
    retryMessage: mocks.retry,
    loadThread: mocks.thread,
    reportMessage: mocks.report,
    setDraft: mocks.draft,
    loadDetails: mocks.details,
  };
  mocks.details.mockResolvedValue({
    members: [{ id: 1, name: "You", extension: "1001" }, { id: 2, name: "Nathasa", extension: "1002" }],
    media: [],
    links: [],
  });
  mocks.thread.mockResolvedValue({
    root: {
      id: "parent",
      clientId: "parent-client",
      channelId: "room",
      senderId: 2,
      senderName: "Bob",
      content: "Please confirm",
      timestamp: 1,
      sequence: 1,
      status: "sent",
      parent: null,
    },
    replies: [],
    hasMore: false,
  });
  mocks.report.mockResolvedValue(undefined);
  mocks.retry.mockResolvedValue(undefined);
});
function render() {
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  mocks.press.clear();
  mocks.input = null;
  return renderToStaticMarkup(<ChatRoom />);
}
it("uses the scoped local photo descriptor for the owner's message avatar", () => {
  mocks.state.messages.room = [{ id: "own-message", clientId: "own-message", channelId: "room", senderId: 1, senderName: "Owner", content: "Photo check", timestamp: 1, sequence: 1, status: "sent", parent: null }];
  const html = render();
  expect(html).toContain('data-photo-url="/api/profile/photo/10/1?v=33333333-3333-4333-8333-333333333333"');
  expect(html).toContain('data-photo-version="33333333-3333-4333-8333-333333333333"');
});
it("a double tap sends one message while the first request is in flight", async () => {
  let finish!: () => void;
  mocks.send.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render();
  const button = mocks.press.get("Send message")!;
  const first = button.press();
  const second = button.press();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledWith("room", "Hello", undefined);
  mocks.state.drafts.room = "Next message";
  finish();
  await first;
  await second;
  expect(mocks.state.drafts.room).toBe("Next message");
});
it("opens on a typed @, inserts at the caret, and sends a structured member mention", async () => {
  mocks.state.channels[0].kind = "group";
  mocks.state.drafts.room = "  ";
  mocks.draft.mockImplementation((key: string, value: string) => { mocks.state.drafts[key] = value; });
  render();
  mocks.input.onSelectionChange({ nativeEvent: { selection: { start: 2, end: 2 } } });
  mocks.input.onChangeText("  @");
  await Promise.resolve();
  await Promise.resolve();
  render();
  expect(mocks.press.has("Mention Nathasa")).toBe(true);
  mocks.press.get("Mention Nathasa")!.press();
  render();
  await mocks.press.get("Send message")!.press();
  expect(mocks.send).toHaveBeenCalledWith("room", "@Nathasa", undefined, [], [
    { userId: 2, start: 0, length: 8 },
  ]);
});
it("loads an authorized channel roster for a disabled creation picker without sending invitations", async () => {
  mocks.state.channels[0].kind = "channel";
  render();
  expect(mocks.press.has("Start channel meeting")).toBe(true);

  mocks.press.get("Start channel meeting")!.press();
  await vi.waitFor(() => {
    render();
    expect(mocks.channelMeeting.loading).toBe(false);
  });

  expect(mocks.details).toHaveBeenCalledWith("room");
  expect(mocks.channelMeeting).toMatchObject({
    visible: true,
    tenantId: 10,
    channelId: "room",
    hostId: 1,
    members: [
      { id: 1, name: "You", extension: "1001" },
      { id: 2, name: "Nathasa", extension: "1002" },
    ],
    loading: false,
    startAvailable: false,
  });
  expect(mocks.meetingStart).not.toHaveBeenCalled();
});
it("offers and sends @all only with the server capability", async () => {
  mocks.state.channels[0].kind = "channel";
  mocks.state.drafts.room = "@";
  mocks.draft.mockImplementation((key: string, value: string) => { mocks.state.drafts[key] = value; });
  mocks.details.mockResolvedValue({ members: [], canMentionAll: true, media: [], links: [] });
  render();
  mocks.input.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } });
  await Promise.resolve(); await Promise.resolve();
  render();
  expect(mocks.press.has("Mention everyone")).toBe(true);
  mocks.press.get("Mention everyone")!.press();
  render();
  await mocks.press.get("Send message")!.press();
  expect(mocks.send).toHaveBeenCalledWith("room", "@all", undefined, [], [], { start: 0, length: 4 });
});
it("resizes the full chat route for the keyboard and preserves the message anchor", () => {
  render();
  const roomKeyboard = mocks.keyboards.get("chat-room-keyboard-avoiding");
  expect(roomKeyboard).toMatchObject({
    behavior: "padding",
    keyboardVerticalOffset: 0,
  });
  expect(roomKeyboard.children.props.edges).toEqual([
    "top",
    "left",
    "right",
    "bottom",
  ]);
  expect(mocks.list).toMatchObject({
    keyboardDismissMode: "interactive",
    keyboardShouldPersistTaps: "handled",
    maintainVisibleContentPosition: { minIndexForVisible: 0 },
  });
  expect(mocks.input).toMatchObject({
    multiline: true,
    scrollEnabled: true,
    textAlignVertical: "top",
  });
});
it("reanchors only a bottom reader when the keyboard changes list layout", () => {
  mocks.state.messages = {
    room: [
      {
        id: "message",
        clientId: "client",
        channelId: "room",
        senderId: 2,
        senderName: "Bob",
        content: "Hello",
        timestamp: 1,
        sequence: 1,
        status: "sent",
        parent: null,
      },
    ],
  };
  render();
  const scrollToEnd = vi.fn();
  // The live-scope ref protects details responses; the list ref follows it.
  mocks.refs[3].current = { scrollToEnd };
  mocks.list.onScroll({
    nativeEvent: {
      contentOffset: { y: 100 },
      contentSize: { height: 200 },
      layoutMeasurement: { height: 100 },
    },
  });
  mocks.list.onLayout({});
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  mocks.list.onScroll({
    nativeEvent: {
      contentOffset: { y: 0 },
      contentSize: { height: 1000 },
      layoutMeasurement: { height: 100 },
    },
  });
  mocks.list.onLayout({});
  expect(scrollToEnd).toHaveBeenCalledTimes(1);
});
it("cannot send through a stale owner or a mismatched route workspace", () => {
  mocks.state.userId = 2;
  render();
  expect(mocks.press.get("Send message")?.disabled ?? mocks.press.get("Record voice note")?.disabled).toBe(true);
  mocks.state.userId = 1;
  mocks.tenantId = "20";
  render();
  expect(mocks.press.get("Send message")?.disabled ?? mocks.press.get("Record voice note")?.disabled).toBe(true);
  mocks.tenantId = "invalid";
  render();
  expect(mocks.press.get("Send message")?.disabled ?? mocks.press.get("Record voice note")?.disabled).toBe(true);
});
it.each(["owner", "workspace", "same-owner-session"])(
  "blocks captured send and typing after %s changes",
  async (change) => {
    render();
    const send = mocks.press.get("Send message")!.press,
      type = mocks.input.onChangeText;
    if (change === "owner") {
      mocks.user = { id: 2 };
      mocks.state = { ...mocks.state, userId: 2 };
    }
    if (change === "same-owner-session") mocks.user = { id: 1 };
    if (change === "workspace")
      mocks.state = { ...mocks.state, workspace: { id: 20 } };
    type("old private draft");
    await send();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  },
);
it("does not render another workspace's draft or header while the route is changing", () => {
  mocks.tenantId = "20";
  expect(render()).not.toContain("Team");
  expect(mocks.input.value).toBe("");
  expect(mocks.input.editable).toBe(false);
});
it("keeps report in its own sheet and closes the menu before entering search", () => {
  render();
  mocks.press.get("Conversation menu")!.press();
  render();
  expect(mocks.press.has("Search messages")).toBe(true);
  mocks.press.get("Report conversation")!.press();
  render();
  expect(mocks.press.has("Report category spam")).toBe(true);
  expect(mocks.keyboards.get("report-keyboard-avoiding")).toMatchObject({
    behavior: "padding",
  });
  expect(mocks.press.has("Search messages")).toBe(false);
  mocks.press.get("Close report form")!.press();
  render();
  mocks.press.get("Conversation menu")!.press();
  render();
  mocks.press.get("Search messages")!.press();
  render();
  expect(mocks.press.has("Close message search")).toBe(true);
  expect(mocks.press.has("Report category spam")).toBe(false);
});
it("keeps replies, search, and safety as mutually exclusive room modes", async () => {
  const parent = {
    id: "parent",
    clientId: "parent-client",
    channelId: "room",
    senderId: 2,
    senderName: "Bob",
    content: "Please confirm",
    timestamp: 1,
    sequence: 1,
    status: "sent" as const,
    parent: null,
  };
  mocks.state.messages = { room: [parent] };
  mocks.thread.mockResolvedValue({ root: parent, replies: [], hasMore: false });
  render();
  mocks.press.get("Message from Bob")!.longPress!();
  render();
  await mocks.press.get("View replies")!.press();
  expect(render()).toContain("Original message");

  mocks.press.get("Conversation menu")!.press();
  render();
  mocks.press.get("Search messages")!.press();
  expect(render()).not.toContain("Original message");
  expect(mocks.press.has("Close message search")).toBe(true);

  mocks.press.get("Close message search")!.press();
  render();
  mocks.press.get("Conversation menu")!.press();
  render();
  mocks.press.get("Report conversation")!.press();
  expect(render()).not.toContain("Original message");
  expect(mocks.press.has("Close report form")).toBe(true);
  expect(mocks.press.has("Close message search")).toBe(false);
});
it("does not commit a voice message when its upload is cancelled", async () => {
  mocks.state.drafts.room = "";
  let finishUpload!: (attachment: any) => void;
  mocks.upload.mockReturnValue(
    new Promise((resolve) => {
      finishUpload = resolve;
    }),
  );
  render();
  mocks.press.get("Record voice note")!.press();
  render();
  const controller = new AbortController();
  const commit = vi.fn(() => true);
  const delivery = mocks.voice.onReady(
    {
      uri: "file:///voice.m4a",
      filename: "voice-note.m4a",
      mimeType: "audio/mp4",
      sizeBytes: 8_192,
    },
    { signal: controller.signal, commit },
  );
  controller.abort();
  finishUpload({
    id: "attachment",
    conversationId: "room",
    filename: "voice-note.m4a",
    mimeType: "audio/mp4",
    sizeBytes: 8_192,
    status: "ready",
  });
  await expect(delivery).rejects.toMatchObject({ name: "AbortError" });
  expect(commit).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("returns to the message composer from the voice-note keyboard action", () => {
  mocks.state.drafts.room = "";
  render();
  const focus = vi.fn();
  const setNativeProps = vi.fn();
  mocks.refs[4].current = { focus, setNativeProps };
  mocks.press.get("Record voice note")!.press();
  render();
  mocks.voice.onReturnToKeyboard();
  expect(focus).toHaveBeenCalledOnce();
  expect(setNativeProps).toHaveBeenCalledWith({ selection: { start: 0, end: 0 } });
});
it("keeps message actions in a long press instead of the conversation canvas", () => {
  const parent = {
    id: "parent",
    clientId: "parent-client",
    channelId: "room",
    senderId: 2,
    senderName: "Bob",
    content: "Please confirm",
    timestamp: 1,
    sequence: 1,
    status: "sent" as const,
    parent: null,
  };
  mocks.state.messages = { room: [parent] };
  const html = render();
  expect(mocks.press.has("Message from Bob")).toBe(true);
  expect(mocks.press.has("Reply to Bob")).toBe(false);
  expect(mocks.press.has("More actions for Bob")).toBe(false);
  expect(html).not.toContain(">Reply<");
  expect(html).not.toContain("Original message");
  mocks.press.get("Message from Bob")!.accessibilityAction!({ nativeEvent: { actionName: "activate" } });
  render();
  expect(mocks.press.has("Reply")).toBe(true);
});
it("keeps a Replies composer attached to its parent across consecutive sends", async () => {
  const parent = {
    id: "parent",
    clientId: "parent-client",
    channelId: "room",
    senderId: 2,
    senderName: "Bob",
    content: "Please confirm",
    timestamp: 1,
    sequence: 1,
    status: "sent" as const,
    parent: null,
  };
  mocks.state.messages = { room: [parent] };
  mocks.thread.mockResolvedValue({ root: parent, replies: [], hasMore: false });
  render();
  mocks.press.get("Message from Bob")!.longPress!();
  render();
  await mocks.press.get("View replies")!.press();
  expect(render()).toContain("Replies");
  await mocks.press.get("Send message")!.press();
  await mocks.press.get("Send message")!.press();
  expect(mocks.send).toHaveBeenNthCalledWith(1, "room", "Hello", "parent");
  expect(mocks.send).toHaveBeenNthCalledWith(2, "room", "Hello", "parent");
});
it("keeps a reply action inside the active Replies root instead of creating a hidden nested reply", async () => {
  const root = {
    id: "parent",
    clientId: "parent-client",
    channelId: "room",
    senderId: 2,
    senderName: "Bob",
    content: "Please confirm",
    timestamp: 1,
    sequence: 1,
    status: "sent" as const,
    parent: null,
  };
  const reply = {
    id: "reply",
    clientId: "reply-client",
    channelId: "room",
    senderId: 3,
    senderName: "Alice",
    content: "I can help",
    timestamp: 2,
    sequence: 2,
    status: "sent" as const,
    parent: { id: "parent", senderName: "Bob", content: "Please confirm" },
  };
  mocks.state.messages = { room: [root, reply] };
  mocks.thread.mockResolvedValue({ root, replies: [reply], hasMore: false });
  render();
  mocks.press.get("Message from Bob")!.longPress!();
  render();
  await mocks.press.get("View replies")!.press();
  render();
  mocks.press.get("Message from Alice")!.longPress!();
  render();
  mocks.press.get("Reply")!.press();
  render();
  await mocks.press.get("Send message")!.press();
  expect(mocks.send).toHaveBeenLastCalledWith("room", "Hello", "parent");
});
it("retains a local failed reply through a thread refresh and retries the same client message", async () => {
  const root = {
    id: "parent",
    clientId: "parent-client",
    channelId: "room",
    senderId: 2,
    senderName: "Bob",
    content: "Please confirm",
    timestamp: 1,
    sequence: 1,
    status: "sent" as const,
    parent: null,
  };
  const failed = {
    id: "local",
    clientId: "local-client",
    channelId: "room",
    senderId: 1,
    senderName: "You",
    content: "Still visible",
    timestamp: 2,
    sequence: 0,
    status: "failed" as const,
    parent: { id: "parent", senderName: "Bob", content: "Please confirm" },
  };
  mocks.state.messages = { room: [root, failed] };
  mocks.thread.mockResolvedValue({ root, replies: [], hasMore: false });
  render();
  mocks.press.get("Message from Bob")!.longPress!();
  render();
  await mocks.press.get("View replies")!.press();
  expect(render()).toContain("Still visible");
  mocks.press.get("Retry sending message")!.press();
  expect(mocks.retry).toHaveBeenCalledWith("room", "local-client");
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.thread).toHaveBeenCalledWith("room", "parent");
  expect(render()).toContain("Still visible");
});
it("does not reopen a Replies view when a closed request resolves late", async () => {
  let resolve!: (result: any) => void;
  const pending = new Promise<any>((done) => {
    resolve = done;
  });
  const parent = {
    id: "parent",
    clientId: "parent-client",
    channelId: "room",
    senderId: 2,
    senderName: "Bob",
    content: "Please confirm",
    timestamp: 1,
    sequence: 1,
    status: "sent" as const,
    parent: null,
  };
  mocks.state.messages = { room: [parent] };
  mocks.thread.mockReturnValueOnce(pending);
  render();
  mocks.press.get("Message from Bob")!.longPress!();
  render();
  const opening = mocks.press.get("View replies")!.press();
  render();
  mocks.press.get("Back to conversation")!.press();
  resolve({ root: parent, replies: [], hasMore: false });
  await opening;
  expect(render()).not.toContain("Original message");
  expect(render()).not.toContain(">Replies<");
});

it("starts only on explicit selection and reuses the request ID after an uncertain failure", async () => {
  mocks.state.channels[0].kind = "channel";
  mocks.meetingCapability.mockResolvedValue({ available: true, canStart: true, maxSelectedMembers: 50 });
  mocks.meetingStart.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ meetingId: "admitted-room" });
  render();
  mocks.press.get("Start channel meeting")!.press();
  await vi.waitFor(() => { render(); expect(mocks.channelMeeting.loading).toBe(false); });
  expect(mocks.meetingStart).not.toHaveBeenCalled();
  expect(mocks.channelMeeting.startAvailable).toBe(true);
  mocks.channelMeeting.onStart([2]);
  await Promise.resolve(); await Promise.resolve(); render();
  expect(mocks.channelMeeting.error).toContain("Try again");
  mocks.channelMeeting.onStart([2]);
  await Promise.resolve(); await Promise.resolve(); render();
  expect(mocks.meetingStart).toHaveBeenCalledTimes(2);
  expect(mocks.meetingStart.mock.calls[0]).toEqual(mocks.meetingStart.mock.calls[1]);
  expect(mocks.meetingStart.mock.calls[0].slice(0, 3)).toEqual([10, "room", [2]]);
  expect(mocks.navigate).toHaveBeenCalledWith({ pathname: "/conference", params: { meetingId: "admitted-room" } });
});
it("keeps the authorized roster when the meeting capability request fails", async () => {
  mocks.state.channels[0].kind = "channel";
  mocks.meetingCapability.mockRejectedValue(new Error("capability unavailable"));
  render();
  mocks.press.get("Start channel meeting")!.press();
  await vi.waitFor(() => {
    render();
    expect(mocks.channelMeeting.loading).toBe(false);
  });
  expect(mocks.channelMeeting.members.map((member: any) => member.id)).toEqual([1, 2]);
  expect(mocks.channelMeeting.rosterError).toBeNull();
  expect(mocks.channelMeeting.startAvailable).toBe(false);
  expect(mocks.channelMeeting.unavailableReason).toContain("permissions could not be checked");
});
it("does not report an authorized empty roster when loading members fails", async () => {
  mocks.state.channels[0].kind = "group";
  mocks.details.mockRejectedValue(new Error("roster unavailable"));
  mocks.meetingCapability.mockResolvedValue({ available: true, canStart: true, maxSelectedMembers: 50 });
  render();
  mocks.press.get("Start channel meeting")!.press();
  await vi.waitFor(() => {
    render();
    expect(mocks.channelMeeting.loading).toBe(false);
  });
  expect(mocks.channelMeeting.members).toEqual([]);
  expect(mocks.channelMeeting.rosterError).toContain("Could not connect to Team Chat");
  expect(mocks.channelMeeting.error).toBeNull();
});
it("does not let a closed picker request overwrite a reopened picker", async () => {
  mocks.state.channels[0].kind = "channel";
  let resolveOldRoster!: (value: any) => void;
  let resolveOldCapability!: (value: any) => void;
  mocks.details
    .mockReturnValueOnce(new Promise(resolve => { resolveOldRoster = resolve; }))
    .mockResolvedValueOnce({ members: [{ id: 1, name: "You" }, { id: 3, name: "Current member" }], media: [], links: [] });
  mocks.meetingCapability
    .mockReturnValueOnce(new Promise(resolve => { resolveOldCapability = resolve; }))
    .mockResolvedValueOnce({ available: true, canStart: true, maxSelectedMembers: 10 });
  render();
  mocks.press.get("Start channel meeting")!.press();
  render();
  mocks.channelMeeting.onCancel();
  render();
  mocks.press.get("Start channel meeting")!.press();
  await vi.waitFor(() => {
    render();
    expect(mocks.channelMeeting.loading).toBe(false);
  });
  expect(mocks.channelMeeting.members.map((member: any) => member.id)).toEqual([1, 3]);
  expect(mocks.channelMeeting.startAvailable).toBe(true);

  resolveOldRoster({ members: [{ id: 1, name: "Old host" }, { id: 2, name: "Old member" }], media: [], links: [] });
  resolveOldCapability({ available: false, canStart: false, maxSelectedMembers: 1 });
  await Promise.resolve(); await Promise.resolve();
  render();
  expect(mocks.channelMeeting.members.map((member: any) => member.id)).toEqual([1, 3]);
  expect(mocks.channelMeeting.startAvailable).toBe(true);
});
it("ignores roster and capability results from an account that is no longer current", async () => {
  mocks.state.channels[0].kind = "channel";
  let resolveRoster!: (value: any) => void;
  let resolveCapability!: (value: any) => void;
  mocks.details.mockReturnValue(new Promise(resolve => { resolveRoster = resolve; }));
  mocks.meetingCapability.mockReturnValue(new Promise(resolve => { resolveCapability = resolve; }));
  render();
  mocks.press.get("Start channel meeting")!.press();
  mocks.user = { id: 9 };
  resolveRoster({ members: [{ id: 1, name: "Old host" }, { id: 2, name: "Old member" }], media: [], links: [] });
  resolveCapability({ available: true, canStart: true, maxSelectedMembers: 50 });
  await Promise.resolve(); await Promise.resolve();
  render();
  expect(mocks.channelMeeting.visible).toBe(false);
  expect(mocks.channelMeeting.members).toEqual([]);
  expect(mocks.channelMeeting.startAvailable).toBe(false);
  expect(mocks.meetingStart).not.toHaveBeenCalled();
});
it("ignores meeting start results after an account change", async () => {
  mocks.state.channels[0].kind = "channel";
  mocks.meetingCapability.mockResolvedValue({ available: true, canStart: true, maxSelectedMembers: 50 });
  let resolve!: (value: unknown) => void;
  mocks.meetingStart.mockReturnValue(new Promise(r => { resolve = r; }));
  render(); mocks.press.get("Start channel meeting")!.press();
  await vi.waitFor(() => { render(); expect(mocks.channelMeeting.loading).toBe(false); });
  mocks.channelMeeting.onStart([2]); mocks.channelMeeting.onStart([2]);
  expect(mocks.meetingStart).toHaveBeenCalledTimes(1);
  mocks.user = { id: 9 };
  resolve({ meetingId: "old-owner-room" });
  await Promise.resolve(); await Promise.resolve(); render();
  expect(mocks.navigate).not.toHaveBeenCalled();
});
