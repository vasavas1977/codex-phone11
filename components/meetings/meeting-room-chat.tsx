import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import type { BrowserMeetingSession, BrowserParticipant, BrowserRoom } from "@/lib/meetings/browser-session";
import { meetingParticipantDisplayName } from "@/lib/meetings/participant-display-name";
import { decodeRoomChatMessage, encodeRoomChatMessage, ROOM_CHAT_MAX_MESSAGES, ROOM_CHAT_MAX_TEXT_LENGTH, ROOM_CHAT_TOPIC } from "@/lib/meetings/room-chat-message";

type DataParticipant = BrowserParticipant & { permissions?: { canPublishData?: boolean; canSubscribe?: boolean } };
export type NativeChatRoom = BrowserRoom & {
  state: string;
  localParticipant: BrowserRoom["localParticipant"] & DataParticipant & {
    publishData(data: Uint8Array<ArrayBuffer>, options: { reliable: true; topic: string }): Promise<void>;
  };
};
export type MobileChatEntry = Readonly<{ id: string; text: string; senderIdentity: string; senderName: string; local: boolean }>;
export type MobileChatSnapshot = Readonly<{ messages: readonly MobileChatEntry[]; canSend: boolean; sending: boolean; error: string | null }>;
const empty: MobileChatSnapshot = Object.freeze({ messages: Object.freeze([]), canSend: false, sending: false, error: null });
const noSubscription = () => () => undefined;
const emptySnapshot = () => empty;
// Public events and reliable packet kind from the pinned livekit-client 2.22.3 SDK.
// Avoid eagerly importing the media engine in a default-off/restored mobile room.
const events = ["dataReceived", "participantPermissionsChanged", "connectionStateChanged", "disconnected"] as const;
const reliablePacketKind = 0;

/** Old/restored rooms must not expose a Chat control without the real SDK data surface. */
export function supportsNativeRoomChat(room: BrowserRoom | undefined): room is NativeChatRoom {
  if (!room) return false;
  const value = room as Partial<NativeChatRoom>;
  return typeof value.state === "string" && typeof value.on === "function" && typeof value.off === "function" &&
    typeof value.localParticipant?.publishData === "function" && typeof value.localParticipant.identity === "string" &&
    value.localParticipant.identity.length > 0 && value.localParticipant.identity.length <= 256 &&
    typeof value.remoteParticipants?.get === "function";
}

// This UUID is only a bounded duplicate-suppression key, never authentication or participant identity.
function messageId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}

/** One ephemeral chat scope; SDK participant objects supply all sender authority. */
export class MobileMeetingChat {
  private disposed = false;
  private generation = 0;
  private messages: MobileChatEntry[] = [];
  private seen = new Set<string>();
  private sending = false;
  private error: string | null = null;
  private failedAttempt?: { text: string; id: string };
  private permissionToSend = false;
  private receiveWindow = { since: 0, count: 0 };
  private listeners = new Set<() => void>();
  private snapshot = empty;
  private handlers: ((...args: unknown[]) => void)[];

  constructor(private readonly room: NativeChatRoom, private readonly interactive: boolean,
    private readonly current: () => boolean, private readonly nextId = messageId) {
    this.handlers = [this.receive, this.refresh, this.refresh, this.dispose];
    events.forEach((event, index) => room.on(event, this.handlers[index]));
    this.refresh();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private active = () => !this.disposed && this.current() && this.room.state === "connected";
  private allowed = () => this.active() && this.interactive && this.room.localParticipant.permissions?.canPublishData === true;
  private notify() {
    this.snapshot = Object.freeze({ messages: Object.freeze([...this.messages]), canSend: this.allowed(), sending: this.sending, error: this.error });
    this.listeners.forEach(listener => listener());
  }
  private refresh = () => {
    if (!this.active()) { this.dispose(); return; }
    const allowed = this.allowed();
    if (this.permissionToSend && !allowed) { this.generation++; this.sending = false; this.failedAttempt = undefined; this.error = null; }
    this.permissionToSend = allowed;
    if (this.room.localParticipant.permissions?.canSubscribe !== true) { this.messages = []; this.seen.clear(); }
    this.notify();
  };
  private append(entry: MobileChatEntry) {
    const key = `${entry.senderIdentity}:${entry.id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > ROOM_CHAT_MAX_MESSAGES * 2) this.seen.delete(this.seen.values().next().value!);
    this.messages = [...this.messages, Object.freeze(entry)].slice(-ROOM_CHAT_MAX_MESSAGES);
    this.notify();
  }
  private receive = (payload: unknown, sender: unknown, kind: unknown, topic: unknown) => {
    if (!this.active() || this.room.localParticipant.permissions?.canSubscribe !== true ||
      topic !== ROOM_CHAT_TOPIC || kind !== reliablePacketKind || !sender || typeof sender !== "object") return;
    const participant = sender as BrowserParticipant;
    if (typeof participant.identity !== "string" || !participant.identity || participant.identity.length > 256 ||
      this.room.remoteParticipants.get(participant.identity) !== participant || !(payload instanceof Uint8Array)) return;
    const now = Date.now();
    if (now - this.receiveWindow.since >= 10_000) this.receiveWindow = { since: now, count: 0 };
    if (++this.receiveWindow.count > 100) return;
    const message = decodeRoomChatMessage(payload);
    if (!message) return;
    const name = typeof participant.name === "string" ? participant.name.slice(0, 80) : undefined;
    this.append({ id: message.id, text: message.text, senderIdentity: participant.identity,
      senderName: meetingParticipantDisplayName(name, participant.identity, "Participant"), local: false });
  };
  async send(text: string): Promise<boolean> {
    if (!this.allowed() || this.sending) return false;
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    const id = this.failedAttempt?.text === normalized ? this.failedAttempt.id : this.nextId();
    const payload = encodeRoomChatMessage(id, normalized);
    if (!payload) { this.error = "Enter a message of up to 1,000 characters."; this.notify(); return false; }
    const local = this.room.localParticipant, identity = local.identity, generation = this.generation;
    this.failedAttempt = { text: normalized, id }; this.sending = true; this.error = null; this.notify();
    try {
      if (!this.allowed() || this.room.localParticipant !== local) return false;
      await local.publishData(payload, { reliable: true, topic: ROOM_CHAT_TOPIC });
      if (generation !== this.generation || !this.allowed() || this.room.localParticipant !== local || local.identity !== identity) return false;
      this.append({ id, text: normalized, senderIdentity: identity, senderName: "You", local: true });
      this.failedAttempt = undefined;
      return true;
    } catch {
      if (generation === this.generation && this.allowed()) this.error = "Could not confirm sending. Retry the same message to avoid duplicates.";
      return false;
    } finally {
      if (!this.disposed && generation === this.generation) { this.sending = false; this.notify(); }
    }
  }
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.sending = false; this.error = null; this.failedAttempt = undefined;
    this.messages = []; this.seen.clear();
    events.forEach((event, index) => this.room.off(event, this.handlers[index]));
    this.notify();
  };
}

export type MeetingRoomChatProps = {
  room?: BrowserRoom;
  session?: BrowserMeetingSession;
  receiveOnly: boolean;
  connected: boolean;
  interrupted: boolean;
  leaving: boolean;
  /** Advances synchronously when Leave starts, even if native teardown later fails. */
  scopeEpoch?: number;
  /** Includes the live authenticated owner, interruption and synchronous leave checks. */
  isCurrent: () => boolean;
  onOpen: () => void;
  renderAvatar?: (entry: MobileChatEntry) => ReactNode;
  participantName?: (entry: MobileChatEntry) => string;
};

export function MeetingRoomChat(props: MeetingRoomChatProps) {
  const current = useRef(props); current.current = props;
  const [binding, setBinding] = useState<{ room: BrowserRoom; session: BrowserMeetingSession; interactive: boolean; scopeEpoch: number | undefined; controller: MobileMeetingChat } | null>(null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState("");
  const sameBinding = binding?.room === props.room && binding?.session === props.session && binding?.interactive === !props.receiveOnly && binding?.scopeEpoch === props.scopeEpoch;
  const usable = sameBinding && props.connected && !props.interrupted && !props.leaving && props.isCurrent() &&
    props.session?.getRoom() === props.room && props.session?.getSnapshot().status === "connected";
  const controller = usable ? binding?.controller : undefined;
  const liveController = useRef(controller); liveController.current = controller;
  const snapshot = useSyncExternalStore(controller?.subscribe ?? noSubscription, controller?.getSnapshot ?? emptySnapshot, emptySnapshot);
  useEffect(() => {
    const { room, session, receiveOnly, connected, interrupted, leaving, scopeEpoch } = props;
    setVisible(false); setDraft("");
    if (!supportsNativeRoomChat(room) || !session || !connected || interrupted || leaving || !props.isCurrent()) {
      setBinding(null); return;
    }
    const chat = new MobileMeetingChat(room, !receiveOnly, () => {
      const latest = current.current;
      return latest.room === room && latest.session === session && latest.receiveOnly === receiveOnly &&
        latest.scopeEpoch === scopeEpoch &&
        latest.connected && !latest.interrupted && !latest.leaving && latest.isCurrent() &&
        session.getRoom() === room && session.getSnapshot().status === "connected";
    });
    setBinding({ room, session, interactive: !receiveOnly, scopeEpoch, controller: chat });
    return () => chat.dispose();
  // isCurrent is read live through current; changing its closure alone must not reset chat history.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.room, props.session, props.receiveOnly, props.connected, props.interrupted, props.leaving, props.scopeEpoch]);

  if (!supportsNativeRoomChat(props.room)) return null;
  const close = () => { setVisible(false); setDraft(""); };
  const send = async () => {
    if (!controller || !snapshot.canSend || snapshot.sending || !draft.trim()) return;
    const text = draft;
    if (await controller.send(text) && liveController.current === controller) setDraft("");
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Meeting chat" accessibilityHint="Opens messages for everyone in this meeting."
      accessibilityState={{ disabled: !usable, selected: visible && usable }} disabled={!usable}
      onPress={() => { props.onOpen(); setVisible(true); }} style={[styles.control, !usable && styles.disabled]}>
      <IconSymbol name="bubble.left.and.bubble.right.fill" size={22} color="#FFFFFF" />
      <Text style={styles.controlText}>Chat</Text>
    </Pressable>
    <Modal transparent visible={visible && !!usable} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.backdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel meeting chat" onPress={close} style={StyleSheet.absoluteFillObject} />
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.heading}>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel meeting chat" onPress={close} style={styles.headerButton}><Text style={styles.action}>Cancel</Text></Pressable>
              <Text accessibilityRole="header" style={styles.title}>Meeting chat</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Done with meeting chat" onPress={close} style={styles.headerButton}><Text style={styles.action}>Done</Text></Pressable>
            </View>
            <Text style={styles.hint}>Messages are visible to everyone currently in this meeting.</Text>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={styles.messages} contentContainerStyle={styles.messageContent}>
              {snapshot.messages.length === 0 && <Text style={styles.hint}>No messages yet.</Text>}
              {snapshot.messages.map(entry => <View key={`${entry.senderIdentity}:${entry.id}`} style={styles.message}>
                {props.renderAvatar?.(entry) ?? <ProfileAvatar name={entry.senderName} size={32} interactive={false} />}
                <View style={styles.messageCopy}><Text style={styles.sender}>{props.participantName?.(entry) ?? entry.senderName}</Text><Text selectable style={styles.messageText}>{entry.text}</Text></View>
              </View>)}
            </ScrollView>
            {snapshot.error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{snapshot.error}</Text>}
            {!snapshot.canSend && <Text accessibilityLiveRegion="polite" style={styles.hint}>You can read chat. Sending is unavailable for your current meeting permissions.</Text>}
            <View style={styles.composer}>
              <TextInput accessibilityLabel="Message everyone in the meeting" value={draft} onChangeText={setDraft} editable={snapshot.canSend && !snapshot.sending}
                multiline maxLength={ROOM_CHAT_MAX_TEXT_LENGTH} placeholder="Message everyone" placeholderTextColor="#B4BAC6" style={styles.input} />
              <Pressable accessibilityRole="button" accessibilityLabel="Send meeting message" accessibilityState={{ disabled: !snapshot.canSend || snapshot.sending || !draft.trim(), busy: snapshot.sending }}
                disabled={!snapshot.canSend || snapshot.sending || !draft.trim()} onPress={() => void send()} style={[styles.send, (!snapshot.canSend || snapshot.sending || !draft.trim()) && styles.disabled]}>
                {snapshot.sending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sender}>Send</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  control: { flex: 1, minWidth: 60, minHeight: 58, borderWidth: 1, borderColor: "#FFFFFF2B", borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 2 },
  controlText: { color: "#FFFFFF", fontSize: 10, lineHeight: 15, fontWeight: "700" }, disabled: { opacity: 0.42 },
  keyboard: { flex: 1 }, backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000088" },
  sheet: { maxHeight: "85%", minHeight: 0, backgroundColor: "#191D26", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 24, gap: 12 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  headerButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }, title: { flexShrink: 1, color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  action: { color: "#69AFFF", fontSize: 16 }, hint: { color: "#B4BAC6", fontSize: 13, lineHeight: 19 },
  messages: { flexGrow: 0, flexShrink: 1, minHeight: 0 }, messageContent: { gap: 12, paddingVertical: 8 },
  message: { flexDirection: "row", alignItems: "flex-start", gap: 8 }, messageCopy: { flex: 1, gap: 4 },
  sender: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" }, messageText: { color: "#FFFFFF", fontSize: 15, lineHeight: 22 },
  error: { color: "#FF9C9C", fontSize: 14 }, composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 12, backgroundColor: "#FFFFFF12", color: "#FFFFFF", padding: 12, fontSize: 16 },
  send: { minHeight: 44, minWidth: 56, borderRadius: 12, backgroundColor: "#2D8CFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
});
