import { ConnectionState, DataPacket_Kind, RoomEvent, type RemoteParticipant, type Room } from 'livekit-client';
import { decodeRoomChatMessage, encodeRoomChatMessage, ROOM_CHAT_MAX_MESSAGES, ROOM_CHAT_TOPIC } from '../../../lib/meetings/room-chat-message';
import { meetingAvatarTenant } from '../../../lib/meetings/participant-avatar';
import { MAX_MEETING_AVATAR_BYTES, MAX_MEETING_PHOTO_CACHE_BYTES, MAX_MEETING_PHOTO_PEOPLE, meetingPhotoBytesMatch, type MeetingPhotoScope, type MeetingProfilePhoto } from './meeting-channels';

/** Bounded room-local image bytes, never URLs or account credentials. */
export class DesktopMeetingPhotos {
  private disposed = false;
  private bytes = 0;
  private readonly entries = new Map<string, { participant: unknown; photo: MeetingProfilePhoto | null }>();

  constructor(private readonly room: Room, private readonly scope: MeetingPhotoScope,
    private readonly current: () => boolean,
    private readonly fetchPhoto: (localIdentity: string, identity: string) => Promise<MeetingProfilePhoto | null>,
    private readonly changed: () => void) {}

  private active = () => !this.disposed && this.current() && this.room.state === ConnectionState.Connected;
  private participant(identity: string) {
    return this.room.localParticipant.identity === identity ? this.room.localParticipant : this.room.remoteParticipants.get(identity);
  }
  get(identity: string): MeetingProfilePhoto | null {
    if (!this.active() || meetingAvatarTenant(this.room.localParticipant.identity, this.scope.ownerId) !== this.scope.tenantId) return null;
    const targetId = Number(identity.split('-u')[1]);
    if (meetingAvatarTenant(identity, targetId) !== this.scope.tenantId) return null;
    const participant = this.participant(identity);
    if (!participant) return null;
    const existing = this.entries.get(identity);
    if (existing) return existing.participant === participant ? existing.photo : null;
    if (this.entries.size >= MAX_MEETING_PHOTO_PEOPLE) return null;
    const entry = { participant, photo: null as MeetingProfilePhoto | null };
    this.entries.set(identity, entry);
    void this.fetchPhoto(this.room.localParticipant.identity, identity).then(photo => {
      if (!this.active() || this.participant(identity) !== participant || this.entries.get(identity) !== entry ||
          !photo || photo.identity !== identity || photo.bytes.byteLength > MAX_MEETING_AVATAR_BYTES ||
          photo.mimeType !== 'image/png' || !meetingPhotoBytesMatch(photo.bytes, photo.mimeType) ||
          this.bytes + photo.bytes.byteLength > MAX_MEETING_PHOTO_CACHE_BYTES) return;
      this.bytes += photo.bytes.byteLength;
      entry.photo = photo;
      this.changed();
    }).catch(() => undefined);
    return null;
  }
  dispose(): void { this.disposed = true; this.entries.clear(); this.bytes = 0; }
}

export type DesktopChatEntry = Readonly<{
  id: string; senderIdentity: string; senderName: string; local: boolean; text: string;
}>;
export type DesktopChatSnapshot = Readonly<{
  messages: readonly DesktopChatEntry[]; canSend: boolean; sending: boolean; error: string | null;
}>;

/** Ephemeral chat belongs to one exact SDK Room in the isolated meeting preload. */
export class DesktopMeetingChat {
  private disposed = false;
  private sending = false;
  private error: string | null = null;
  private messages: DesktopChatEntry[] = [];
  private readonly seen = new Set<string>();
  private failedAttempt?: { text: string; id: string };
  private receiveWindow = { since: 0, count: 0 };

  constructor(private readonly room: Room, private readonly interactive: boolean,
    private readonly current: () => boolean,
    private readonly changed: (snapshot: DesktopChatSnapshot) => void) {
    room.on(RoomEvent.DataReceived, this.receive);
    room.on(RoomEvent.ParticipantPermissionsChanged, this.refresh);
    room.on(RoomEvent.ConnectionStateChanged, this.refresh);
    room.on(RoomEvent.Disconnected, this.dispose);
    this.refresh();
  }

  private active = () => !this.disposed && this.current() && this.room.state === ConnectionState.Connected;
  private allowed = () => this.active() && this.interactive &&
    this.room.localParticipant.permissions?.canPublishData === true;
  getSnapshot = (): DesktopChatSnapshot => Object.freeze({
    messages: Object.freeze([...this.messages]), canSend: this.allowed(), sending: this.sending, error: this.error,
  });
  private refresh = () => { if (!this.disposed && this.current()) this.changed(this.getSnapshot()); };

  private append(entry: DesktopChatEntry, key: string): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    // Bound both the visible history and duplicate suppression, even in a long meeting.
    if (this.seen.size > ROOM_CHAT_MAX_MESSAGES * 2) this.seen.delete(this.seen.values().next().value!);
    this.messages = [...this.messages, Object.freeze(entry)].slice(-ROOM_CHAT_MAX_MESSAGES);
    this.refresh();
  }

  private receive = (payload: Uint8Array, participant?: RemoteParticipant, kind?: DataPacket_Kind, topic?: string) => {
    if (!this.active() || this.room.localParticipant.permissions?.canSubscribe !== true ||
        topic !== ROOM_CHAT_TOPIC || kind !== DataPacket_Kind.RELIABLE || !participant ||
        !participant.identity || participant.identity.length > 256 ||
        this.room.remoteParticipants.get(participant.identity) !== participant) return;
    // A packet storm cannot repeatedly parse/render unbounded traffic in this window.
    const now = Date.now();
    if (now - this.receiveWindow.since >= 10_000) this.receiveWindow = { since: now, count: 0 };
    if (++this.receiveWindow.count > 100) return;
    const message = decodeRoomChatMessage(payload);
    if (!message) return;
    this.append({ ...message, senderIdentity: participant.identity,
      senderName: participant.name?.trim().slice(0, 80) || 'Participant', local: false },
      `${participant.identity}:${message.id}`);
  };

  async send(text: string): Promise<boolean> {
    if (!this.allowed() || this.sending) return false;
    const normalized = text.replace(/\r\n?/g, '\n').trim();
    const id = this.failedAttempt?.text === normalized ? this.failedAttempt.id : crypto.randomUUID();
    const payload = encodeRoomChatMessage(id, normalized);
    if (!payload) { this.error = 'Enter a message of up to 1,000 characters.'; this.refresh(); return false; }
    const local = this.room.localParticipant;
    this.failedAttempt = { text: normalized, id };
    this.sending = true;
    this.error = null;
    this.refresh();
    try {
      // No await separates the current SDK permission check from this exact room's publish.
      if (!this.allowed()) return false;
      await local.publishData(payload, { reliable: true, topic: ROOM_CHAT_TOPIC });
      if (!this.allowed() || this.room.localParticipant !== local) return false;
      const message = decodeRoomChatMessage(payload)!;
      this.append({ ...message, senderIdentity: local.identity, senderName: 'You', local: true }, `${local.identity}:${id}`);
      this.failedAttempt = undefined;
      return true;
    } catch {
      if (this.active()) this.error = 'Could not confirm sending. Retry the same message to avoid duplicates.';
      return false;
    } finally {
      this.sending = false;
      this.refresh();
    }
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.room.off(RoomEvent.DataReceived, this.receive);
    this.room.off(RoomEvent.ParticipantPermissionsChanged, this.refresh);
    this.room.off(RoomEvent.ConnectionStateChanged, this.refresh);
    this.room.off(RoomEvent.Disconnected, this.dispose);
    this.messages = [];
    this.seen.clear();
    this.failedAttempt = undefined;
    this.sending = false;
    this.error = null;
    this.changed(this.getSnapshot());
  };
}
