import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingRoomChat, MobileMeetingChat, supportsNativeRoomChat, type NativeChatRoom } from "../components/meetings/meeting-room-chat";
import { MeetingRoomState } from "../components/meetings/meeting-room-state";
import type { BrowserMeetingSession, BrowserRoom } from "../lib/meetings/browser-session";
import { decodeRoomChatMessage, encodeRoomChatMessage, ROOM_CHAT_MAX_MESSAGES, ROOM_CHAT_TOPIC } from "../lib/meetings/room-chat-message";

const ui = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], effects: [] as any[], stateIndex: 0, refIndex: 0, effectIndex: 0,
  buttons: [] as any[], input: null as any, modal: null as any, keyboard: null as any, platform: "ios",
  renderedOwner: { id: 3001, name: "Current Person" } as any, currentOwner: null as any,
  avatars: [] as any[], people: [] as any[], directoryOwner: 3001, directoryTenant: 7 }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: any) => {
      const index = ui.stateIndex++;
      if (!(index in ui.values)) ui.values[index] = typeof initial === "function" ? initial() : initial;
      return [ui.values[index], (value: any) => { ui.values[index] = typeof value === "function" ? value(ui.values[index]) : value; }];
    },
    useRef: (initial: any) => { const index = ui.refIndex++; return (ui.refs[index] ??= { current: initial }); },
    useEffect: (run: () => void | (() => void), deps: unknown[]) => {
      const index = ui.effectIndex++, previous = ui.effects[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.(); ui.effects[index] = { deps, cleanup: run() };
      }
    },
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  };
});
vi.mock("react-native", () => ({
  Platform: { get OS() { return ui.platform; } }, StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} },
  View: ({ children }: any) => createElement("div", null, children), Text: ({ children }: any) => createElement("span", null, children),
  ScrollView: ({ children }: any) => createElement("div", null, children), ActivityIndicator: () => null,
  Pressable: (props: any) => { ui.buttons.push(props); return createElement("button", { "aria-label": props.accessibilityLabel, disabled: props.disabled }, props.children); },
  Modal: (props: any) => { ui.modal = props; return props.visible ? createElement("aside", null, props.children) : null; },
  KeyboardAvoidingView: (props: any) => { ui.keyboard = props; return createElement("div", null, props.children); },
  TextInput: (props: any) => { ui.input = props; return createElement("textarea", { "aria-label": props.accessibilityLabel, value: props.value, onChange: () => {}, readOnly: !props.editable }); },
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: (props: any) => { ui.avatars.push(props); return createElement("span", null, props.name); }, useProfilePhotoCacheScope: vi.fn() }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: ui.renderedOwner }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: ui.currentOwner }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#00f", error: "#f00", foreground: "#fff", muted: "#888" }) }));
vi.mock("../hooks/use-directory", () => ({ useDirectory: () => ({ owner: ui.directoryOwner, workspace: { id: ui.directoryTenant }, people: ui.people, reload: vi.fn() }), useDirectoryFocusRefresh: vi.fn() }));
vi.mock("../lib/profile/use-workspace-profile", () => ({ useWorkspaceProfile: () => ({ photoDescriptor: null }) }));
vi.mock("../components/meetings/native-video-stage", () => ({ NativeVideoStage: () => null }));
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const id = "12345678-1234-4234-8234-123456789012";

function fixture(interactive = true) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const remote = { identity: "p11-t7-u1020", name: "Nok" };
  const context = { current: true };
  const publish = vi.fn().mockResolvedValue(undefined);
  const room = {
    state: "connected", localParticipant: { identity: "p11-t7-u3001", permissions: { canPublishData: true as boolean, canSubscribe: true as boolean }, publishData: publish,
      setMicrophoneEnabled: vi.fn(), setCameraEnabled: vi.fn() },
    remoteParticipants: new Map([[remote.identity, remote]]), connect: vi.fn(), disconnect: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.get(event)?.delete(listener)),
  } satisfies NativeChatRoom;
  const emit = (event: string, ...args: unknown[]) => [...(listeners.get(event) ?? [])].forEach(listener => listener(...args));
  const chat = new MobileMeetingChat(room, interactive, () => context.current, () => id);
  const receive = (text = "Hello", sender: unknown = remote, messageId = id) => emit("dataReceived", encodeRoomChatMessage(messageId, text), sender, 0, ROOM_CHAT_TOPIC);
  return { room, remote, context, publish, chat, emit, receive, listeners };
}
function deferred() { let resolve!: () => void; let reject!: (error: unknown) => void; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }

beforeEach(() => {
  ui.effects.forEach(effect => effect?.cleanup?.()); ui.values = []; ui.refs = []; ui.effects = [];
  ui.buttons = []; ui.input = null; ui.modal = null; ui.keyboard = null; ui.platform = "ios";
  ui.renderedOwner = { id: 3001, name: "Current Person" }; ui.currentOwner = ui.renderedOwner;
  ui.avatars = []; ui.people = []; ui.directoryOwner = 3001; ui.directoryTenant = 7;
});

describe("mobile chat transport uses the authenticated SDK room", () => {
  it("hides unsupported/restored rooms without adding a fake room", () => {
    expect(supportsNativeRoomChat(undefined)).toBe(false);
    expect(supportsNativeRoomChat({ localParticipant: { identity: "old" } } as BrowserRoom)).toBe(false);
    expect(supportsNativeRoomChat(fixture().room)).toBe(true);
  });
  it("publishes strict room-wide reliable packets and records the actual local SDK identity", async () => {
    const f = fixture(); expect(await f.chat.send(" สวัสดี\r\nteam ")).toBe(true);
    expect(f.publish).toHaveBeenCalledWith(expect.any(Uint8Array), { reliable: true, topic: ROOM_CHAT_TOPIC });
    expect(decodeRoomChatMessage(f.publish.mock.calls[0][0])).toEqual({ version: 1, id, text: "สวัสดี\nteam" });
    expect(f.chat.getSnapshot().messages[0]).toMatchObject({ senderIdentity: f.room.localParticipant.identity, local: true });
  });
  it("requires the current live publish permission even when no render/event occurred", async () => {
    const f = fixture(); f.room.localParticipant.permissions.canPublishData = false;
    expect(await f.chat.send("Denied")).toBe(false); expect(f.publish).not.toHaveBeenCalled();
  });
  it("allows a receive-only member to read but never publish", async () => {
    const f = fixture(false); f.receive(); expect(f.chat.getSnapshot().messages).toHaveLength(1);
    expect(await f.chat.send("Denied")).toBe(false); expect(f.publish).not.toHaveBeenCalled();
  });
  it("uses the known exact SDK sender and rejects spoofed payload identity and unknown participants", () => {
    const f = fixture(); f.receive("Unknown", { identity: f.remote.identity, name: "CEO" });
    f.emit("dataReceived", encodeRoomChatMessage(id, "No sender"), undefined, 0, ROOM_CHAT_TOPIC);
    f.emit("dataReceived", new TextEncoder().encode(JSON.stringify({ version: 1, id, text: "Forged", senderIdentity: f.remote.identity })), f.remote, 0, ROOM_CHAT_TOPIC);
    f.emit("dataReceived", encodeRoomChatMessage(id, "Wrong topic"), f.remote, 0, "other.topic");
    f.emit("dataReceived", encodeRoomChatMessage(id, "Lossy"), f.remote, 1, ROOM_CHAT_TOPIC);
    expect(f.chat.getSnapshot().messages).toHaveLength(0);
    f.receive("Trusted"); expect(f.chat.getSnapshot().messages[0]).toMatchObject({ senderIdentity: f.remote.identity, senderName: "Nok", text: "Trusted" });
  });
  it("does not expose opaque SDK identities as display names", () => {
    const f = fixture(); f.remote.name = f.remote.identity; f.receive(); expect(f.chat.getSnapshot().messages[0].senderName).toBe("Participant");
  });
  it("requires canSubscribe and clears already-received chat when that permission is revoked", () => {
    const f = fixture(); f.receive(); f.room.localParticipant.permissions.canSubscribe = false; f.emit("participantPermissionsChanged");
    f.receive("Denied"); expect(f.chat.getSnapshot().messages).toHaveLength(0);
  });
  it("bounds malformed payloads, duplicate suppression, history, and packet storms", () => {
    const f = fixture(); f.emit("dataReceived", new Uint8Array(4097), f.remote, 0, ROOM_CHAT_TOPIC); expect(f.chat.getSnapshot().messages).toHaveLength(0);
    f.receive(); f.receive(); expect(f.chat.getSnapshot().messages).toHaveLength(1);
    const now = Date.now(); const clock = vi.spyOn(Date, "now");
    for (let index = 0; index < 250; index++) {
      clock.mockReturnValue(Math.floor(index / 90) * 10_000 + now + 10_000);
      f.receive("Message", f.remote, `12345678-1234-4234-8234-${index.toString().padStart(12, "0")}`);
    }
    expect(f.chat.getSnapshot().messages).toHaveLength(ROOM_CHAT_MAX_MESSAGES);
    const before = f.chat.getSnapshot().messages;
    for (let index = 0; index < 150; index++) f.receive("Storm", f.remote, `abcdefab-1234-4234-8234-${index.toString().padStart(12, "0")}`);
    expect(f.chat.getSnapshot().messages).toHaveLength(ROOM_CHAT_MAX_MESSAGES);
    expect(f.chat.getSnapshot().messages.at(-1)?.id).not.toBe("abcdefab-1234-4234-8234-000000000149");
    expect(before).toHaveLength(ROOM_CHAT_MAX_MESSAGES); clock.mockRestore();
  });
  it.each(["room changed", "leave", "SIP interruption", "account changed"])("rejects an old send completion after %s", async () => {
    const f = fixture(), pending = deferred(); f.publish.mockReturnValue(pending.promise);
    const send = f.chat.send("Pending"); f.context.current = false; f.emit("connectionStateChanged"); pending.resolve();
    expect(await send).toBe(false); expect(f.chat.getSnapshot().messages).toHaveLength(0); expect(f.chat.getSnapshot().sending).toBe(false);
    expect(await f.chat.send("Late callback")).toBe(false); expect(f.publish).toHaveBeenCalledTimes(1);
  });
  it("invalidates a pending send through publish-permission revoke and restore", async () => {
    const f = fixture(), pending = deferred(); f.publish.mockReturnValue(pending.promise); const send = f.chat.send("Pending");
    f.room.localParticipant.permissions.canPublishData = false; f.emit("participantPermissionsChanged");
    f.room.localParticipant.permissions.canPublishData = true; f.emit("participantPermissionsChanged"); pending.resolve();
    expect(await send).toBe(false); expect(f.chat.getSnapshot().messages).toHaveLength(0);
  });
  it("rechecks live permission and exact local participant after publish settles", async () => {
    const f = fixture(), pending = deferred(); f.publish.mockReturnValue(pending.promise); const send = f.chat.send("Pending");
    f.room.localParticipant = { ...f.room.localParticipant }; pending.resolve(); expect(await send).toBe(false); expect(f.chat.getSnapshot().messages).toHaveLength(0);
  });
  it("does not attribute a pending send to a mutated local SDK identity", async () => {
    const f = fixture(), pending = deferred(); f.publish.mockReturnValue(pending.promise); const send = f.chat.send("Pending");
    f.room.localParticipant.identity = "other-sdk-identity"; pending.resolve(); expect(await send).toBe(false); expect(f.chat.getSnapshot().messages).toHaveLength(0);
  });
  it("retains failed text and reuses its message ID only for the same retry", async () => {
    const f = fixture(); f.publish.mockRejectedValueOnce(new Error("Private SDK failure"));
    expect(await f.chat.send("Retry me")).toBe(false); expect(f.chat.getSnapshot().error).not.toContain("Private SDK failure");
    expect(f.chat.getSnapshot().messages).toHaveLength(0); expect(await f.chat.send("Retry me")).toBe(true);
    expect(f.publish.mock.calls[0][0]).toEqual(f.publish.mock.calls[1][0]);
  });
  it("cleans subscriptions/history on SDK disconnect and ignores retained receive callbacks", () => {
    const f = fixture(), receive = [...f.listeners.get("dataReceived")!][0]; f.receive(); f.emit("disconnected");
    receive(encodeRoomChatMessage(id, "Late"), f.remote, 0, ROOM_CHAT_TOPIC);
    expect(f.chat.getSnapshot().messages).toHaveLength(0); expect(f.room.off).toHaveBeenCalledTimes(4);
  });
  it("blocks simultaneous sends and invalid outgoing text", async () => {
    const f = fixture(), pending = deferred(); expect(await f.chat.send("x".repeat(1001))).toBe(false); expect(f.publish).not.toHaveBeenCalled();
    f.publish.mockReturnValue(pending.promise); const send = f.chat.send("One"); expect(await f.chat.send("Two")).toBe(false); pending.resolve(); await send;
    expect(f.publish).toHaveBeenCalledTimes(1);
  });
});

function renderChat(props: React.ComponentProps<typeof MeetingRoomChat>) {
  ui.stateIndex = 0; ui.refIndex = 0; ui.effectIndex = 0; ui.buttons = []; ui.input = null; ui.modal = null; ui.keyboard = null;
  return renderToStaticMarkup(createElement(MeetingRoomChat, props));
}
function uiFixture(receiveOnly = false) {
  const f = fixture();
  const authority = { room: f.room as BrowserRoom | undefined, status: "connected", interrupted: false, leaving: false };
  const session = { getRoom: () => authority.room, getSnapshot: () => ({ status: authority.status }) } as BrowserMeetingSession;
  const props = { room: f.room, session, receiveOnly, connected: true, interrupted: false, leaving: false,
    isCurrent: () => authority.room === f.room && authority.status === "connected" && !authority.interrupted && !authority.leaving, onOpen: vi.fn() };
  renderChat(props); renderChat(props); ui.buttons.find(button => button.accessibilityLabel === "Meeting chat").onPress();
  renderChat(props);
  return { ...f, props, authority };
}

describe("mobile meeting chat sheet", () => {
  it("provides iOS keyboard avoidance, bounded composer and accessible Cancel/Done/Send controls", () => {
    uiFixture(); expect(ui.keyboard.behavior).toBe("padding"); expect(ui.input.maxLength).toBe(1000); expect(ui.input.multiline).toBe(true);
    expect(ui.input.accessibilityLabel).toBe("Message everyone in the meeting");
    expect(ui.buttons.map(button => button.accessibilityLabel)).toEqual(expect.arrayContaining(["Cancel meeting chat", "Done with meeting chat", "Send meeting message"]));
    expect(ui.buttons.find(button => button.accessibilityLabel === "Send meeting message").disabled).toBe(true);
  });
  it("uses Android keyboard avoidance and read-only composer for receive-only membership", () => {
    ui.platform = "android"; uiFixture(true); expect(ui.keyboard.behavior).toBe("height"); expect(ui.input.editable).toBe(false);
  });
  it("renders markup as escaped plaintext and sender name only from the current SDK participant", () => {
    const f = uiFixture(); f.receive("<script>unsafe()</script>");
    const html = renderChat(f.props); expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;"); expect(html).toContain("Nok"); expect(html).not.toContain(f.remote.identity);
  });
  it("Cancel and Done dismiss the sheet and discard the unsent draft without publishing", () => {
    const f = uiFixture(); ui.input.onChangeText("Unsent"); renderChat(f.props);
    ui.buttons.find(button => button.accessibilityLabel === "Cancel meeting chat").onPress(); renderChat(f.props); expect(ui.modal.visible).toBe(false); expect(f.publish).not.toHaveBeenCalled();
    ui.buttons.find(button => button.accessibilityLabel === "Meeting chat").onPress(); renderChat(f.props); expect(ui.input.value).toBe("");
    ui.buttons.find(button => button.accessibilityLabel === "Done with meeting chat").onPress(); renderChat(f.props); expect(ui.modal.visible).toBe(false);
  });
  it("guards exact session.getRoom and live interruption/leave state before a retained Send callback", async () => {
    const f = uiFixture(); ui.input.onChangeText("Unsent"); renderChat(f.props);
    const send = ui.buttons.find(button => button.accessibilityLabel === "Send meeting message").onPress;
    f.authority.room = undefined; send(); await Promise.resolve(); expect(f.publish).not.toHaveBeenCalled();
    f.authority.room = f.room; f.authority.interrupted = true; send(); await Promise.resolve(); expect(f.publish).not.toHaveBeenCalled();
    f.authority.interrupted = false; f.authority.leaving = true; send(); await Promise.resolve(); expect(f.publish).not.toHaveBeenCalled();
  });
  it("clears the composer/history and hides the sheet when its room changes", () => {
    const f = uiFixture(); f.receive("Old room"); ui.input.onChangeText("Old draft"); renderChat(f.props);
    const next = fixture(); const props = { ...f.props, room: next.room }; renderChat(props); renderChat(props);
    expect(ui.modal.visible).toBe(false); expect(ui.values[2]).toBe(""); expect(f.room.off).toHaveBeenCalled();
  });
  it("does not render the chat control for an unsupported room", () => {
    const html = renderChat({ receiveOnly: false, connected: true, interrupted: false, leaving: false, isCurrent: () => true, onOpen: vi.fn() });
    expect(html).toBe(""); expect(ui.buttons).toHaveLength(0);
  });
  it("rechecks the real MeetingRoomState auth guard before render and after an in-flight send", async () => {
    const f = fixture(), pending = deferred();
    const snapshot = { status: "connected", participants: [{ identity: f.room.localParticipant.identity, name: "You", local: true, speaking: false, microphone: false, camera: false, attributes: {} }], error: null };
    const session = { getRoom: () => f.room, getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as BrowserMeetingSession;
    const render = () => {
      ui.stateIndex = 0; ui.refIndex = 0; ui.effectIndex = 0; ui.buttons = []; ui.input = null;
      renderToStaticMarkup(createElement(MeetingRoomState, { session, nativeRoom: f.room, onBack: vi.fn() }));
    };
    render(); render(); ui.buttons.find(button => button.accessibilityLabel === "Meeting chat").onPress(); render();
    ui.input.onChangeText("Private meeting text"); render();
    const oldSend = ui.buttons.find(button => button.accessibilityLabel === "Send meeting message").onPress;
    ui.currentOwner = { id: 1020, name: "New account" }; oldSend(); await Promise.resolve();
    expect(f.publish).not.toHaveBeenCalled();
    ui.currentOwner = ui.renderedOwner; f.publish.mockReturnValue(pending.promise); oldSend(); await Promise.resolve();
    expect(f.publish).toHaveBeenCalledTimes(1);
    ui.currentOwner = null; pending.resolve(); await Promise.resolve(); await Promise.resolve(); render();
    expect(ui.input).toBeNull(); expect(ui.buttons.find(button => button.accessibilityLabel === "Meeting chat").disabled).toBe(true);
  });
  it("invalidates the real parent Send callback synchronously even when Leave fails before rerender", async () => {
    const f = fixture(), pending = deferred();
    const snapshot = { status: "connected", participants: [{ identity: f.room.localParticipant.identity, name: "You", local: true, speaking: false, microphone: false, camera: false, attributes: {} }], error: null };
    const session = { getRoom: () => f.room, getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as BrowserMeetingSession;
    const leave = vi.fn().mockRejectedValue(new Error("Native teardown failed"));
    const render = () => {
      ui.stateIndex = 0; ui.refIndex = 0; ui.effectIndex = 0; ui.buttons = []; ui.input = null;
      renderToStaticMarkup(createElement(MeetingRoomState, { session, nativeRoom: f.room, onLeave: leave, onBack: vi.fn() }));
    };
    render(); render(); ui.buttons.find(button => button.accessibilityLabel === "Meeting chat").onPress(); render();
    ui.input.onChangeText("Pending"); render();
    const oldSend = ui.buttons.find(button => button.accessibilityLabel === "Send meeting message").onPress;
    f.publish.mockReturnValue(pending.promise); oldSend(); await Promise.resolve();
    ui.buttons.find(button => button.accessibilityLabel === "Leave meeting").onPress();
    await Promise.resolve(); await Promise.resolve(); pending.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.publish).toHaveBeenCalledTimes(1); oldSend(); await Promise.resolve(); expect(f.publish).toHaveBeenCalledTimes(1);
    render(); render(); expect(ui.modal.visible).toBe(false);
    expect(leave).toHaveBeenCalledTimes(1);
  });
  it.each(["matching", "other tenant", "other owner", "opaque media identity"])("host member avatars use only matching authorized workspace descriptors: %s", scenario => {
    const f = fixture();
    const participant = { identity: scenario === "opaque media identity" ? "opaque_hmac_identity" : "p11-t7-u3001",
      name: "You", local: true, speaking: false, microphone: false, camera: false, attributes: {} };
    const snapshot = { status: "connected", participants: [participant], error: null };
    const session = { getRoom: () => f.room, getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as BrowserMeetingSession;
    const descriptor = "/api/profile/photo/7/8?v=42345678-1234-4234-8234-123456789012";
    ui.people = [{ id: 8, photoUrl: descriptor, photoVersion: "42345678-1234-4234-8234-123456789012" }];
    if (scenario === "other owner") ui.directoryOwner = 999;
    const memberControls = (avatar: (target: { userId: number; name?: string }, tenantId: number) => ReactNode) =>
      avatar({ userId: 8, name: "Admitted Member" }, scenario === "other tenant" ? 42 : 7);
    const render = () => {
      ui.stateIndex = 0; ui.refIndex = 0; ui.effectIndex = 0; ui.buttons = []; ui.avatars = [];
      renderToStaticMarkup(createElement(MeetingRoomState, { session, nativeRoom: f.room, onBack: vi.fn(), memberControls }));
    };
    render(); ui.buttons.find(button => button.accessibilityLabel === "Participants").onPress(); render();
    const avatar = ui.avatars.find(value => value.name === "Admitted Member");
    expect(avatar).toMatchObject({ userId: 8, interactive: false });
    expect(avatar.photoUrl).toBe(scenario === "matching" ? descriptor : undefined);
  });
  it("retires the real parent member control scope when Leave fails, before rerender and afterward", async () => {
    const f = fixture(), wait = deferred();
    const snapshot = { status: "connected", participants: [{ identity: "opaque_hmac_identity", local: true, microphone: false, camera: false }], error: null };
    const session = { getRoom: () => f.room, getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as BrowserMeetingSession;
    let oldCurrent!: () => boolean;
    const render = () => {
      ui.stateIndex = 0; ui.refIndex = 0; ui.effectIndex = 0; ui.buttons = [];
      renderToStaticMarkup(createElement(MeetingRoomState, { session, nativeRoom: f.room, onBack: vi.fn(), onLeave: () => wait.promise,
        memberControls: (_avatar, current) => { oldCurrent = current; return null; } }));
    };
    render(); ui.buttons.find(button => button.accessibilityLabel === "Participants").onPress(); render();
    const retained = oldCurrent; expect(retained()).toBe(true);
    ui.buttons.find(button => button.accessibilityLabel === "Leave meeting").onPress(); expect(retained()).toBe(false);
    wait.reject(new Error("cleanup failed")); await Promise.resolve(); await Promise.resolve();
    expect(retained()).toBe(false); render(); expect(oldCurrent()).toBe(true);
  });
});
