/** Browser-only controller. The adapter must create a fresh, unpublished room per call. */
import type { MeetingJoinStage } from "./join-failure";

type BrowserMeetingConnectStage = Extract<MeetingJoinStage,
  "room_cleanup" | "room_create" | "event_bind" | "signal_connect" |
  "post_connect_guard" | "participant_refresh">;

/** Keeps the original error in memory while exposing only a fixed join boundary. */
export class BrowserMeetingConnectionFailure extends Error {
  readonly name = "BrowserMeetingConnectionFailure";

  constructor(readonly stage: BrowserMeetingConnectStage, cause: unknown) {
    super(`Meeting connection failed at ${stage}.`, { cause });
  }
}

export interface BrowserParticipant {
  identity: string;
  name?: string;
  isSpeaking?: boolean;
  isMicrophoneEnabled?: boolean;
  isCameraEnabled?: boolean;
  attributes?: Readonly<Record<string, string>>;
}
export interface BrowserLocalParticipant extends BrowserParticipant {
  setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  setCameraEnabled(enabled: boolean): Promise<unknown>;
  setAttributes?(attributes: Record<string, string>): Promise<unknown>;
}
export interface BrowserRoom {
  localParticipant: BrowserLocalParticipant;
  remoteParticipants: ReadonlyMap<string, BrowserParticipant>;
  connect(url: string, token: string): Promise<unknown>;
  /** Must stop local tracks (LiveKit's disconnect(true)). */
  disconnect(stopTracks?: boolean): Promise<unknown> | void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}
export interface MeetingParticipant {
  identity: string; name: string; local: boolean; speaking: boolean;
  microphone: boolean; camera: boolean; attributes: Readonly<Record<string, string>>;
}
export interface BrowserSessionSnapshot {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  participants: readonly MeetingParticipant[];
  error: string | null;
}
export interface BrowserSessionCapabilities { languageAttribute?: string }
const refreshEvents = ['participantConnected', 'participantDisconnected', 'participantNameChanged',
  'participantAttributesChanged', 'activeSpeakersChanged', 'trackMuted', 'trackUnmuted',
  'trackPublished', 'trackUnpublished', 'localTrackPublished', 'localTrackUnpublished',
  'trackSubscribed', 'trackUnsubscribed'];

export class BrowserMeetingSession {
  private room?: BrowserRoom;
  private generation = 0;
  private cleanup?: () => void;
  private listeners = new Set<() => void>();
  private snapshot: BrowserSessionSnapshot = { status: 'idle', participants: [], error: null };
  private mediaQueue: Promise<unknown> = Promise.resolve();
  private receiveOnly = false;
  constructor(private readonly createRoom: () => BrowserRoom,
    private readonly capabilities: BrowserSessionCapabilities = {}) {}
  getSnapshot = (): BrowserSessionSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  /** The authenticated native lifecycle owns this room; callers may render only its existing tracks. */
  getRoom = (): BrowserRoom | undefined => this.room;
  private update(patch: Partial<BrowserSessionSnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    this.listeners.forEach(listener => listener());
  }
  private refresh(room: BrowserRoom) {
    const map = (p: BrowserParticipant, local: boolean): MeetingParticipant => Object.freeze({
      identity: p.identity, name: p.name || p.identity, local, speaking: !!p.isSpeaking,
      microphone: !!p.isMicrophoneEnabled, camera: !!p.isCameraEnabled,
      attributes: Object.freeze({ ...p.attributes }),
    });
    this.update({ participants: Object.freeze([map(room.localParticipant, true),
      ...Array.from(room.remoteParticipants.values(), p => map(p, false))]) });
  }
  private fail(error: unknown) {
    // Do not expose SDK error strings, which can contain credential-bearing URLs.
    this.update({ error: 'Meeting operation failed. Check permissions and connection, then retry.' });
    return error instanceof Error ? error : new Error('Meeting operation failed');
  }
  async connect(options: { url: string; token: string; microphone?: boolean; camera?: boolean; receiveOnly?: boolean }): Promise<void> {
    const generation = ++this.generation;
    const previous = this.room;
    this.cleanup?.(); this.cleanup = undefined; this.room = undefined;
    this.receiveOnly = options.receiveOnly === true;
    this.update({ status: 'connecting', participants: [], error: null });
    let room: BrowserRoom | undefined;
    let stage: BrowserMeetingConnectStage = 'room_cleanup';
    try {
      if (previous) await previous.disconnect(true);
      if (generation !== this.generation) throw new Error('Meeting connection cancelled');
      stage = 'room_create';
      room = this.createRoom();
      this.room = room;
      const current = () => generation === this.generation && room === this.room;
      const bindings: Array<[string, (...args: unknown[]) => void]> = [];
      const bind = (event: string, fn: (...args: unknown[]) => void) => {
        const listener = (...args: unknown[]) => { if (current()) fn(...args); };
        bindings.push([event, listener]); room!.on(event, listener);
      };
      this.cleanup = () => bindings.forEach(([event, fn]) => room!.off(event, fn));
      stage = 'event_bind';
      refreshEvents.forEach(event => bind(event, () => this.refresh(room!)));
      bind('reconnecting', () => this.update({ status: 'reconnecting' }));
      bind('reconnected', () => { this.refresh(room!); this.update({ status: 'connected' }); });
      bind('disconnected', () => {
        ++this.generation; this.cleanup?.(); this.cleanup = undefined; this.room = undefined;
        this.update({ status: 'disconnected', participants: [], error: 'Meeting disconnected.' });
      });
      stage = 'signal_connect';
      await room.connect(options.url, options.token);
      stage = 'post_connect_guard';
      if (!current()) throw new Error('Meeting connection cancelled');
      // No capture is requested until explicit opt-in. Permission rejection is
      // non-fatal: the meeting stays connected in receive mode with a truthful
      // local state instead of losing remote audio/video.
      const unavailable: string[] = [];
      if (!this.receiveOnly && options.microphone === true) {
        try { await room.localParticipant.setMicrophoneEnabled(true); }
        catch { unavailable.push('Microphone unavailable. You joined muted.'); }
      }
      if (!current()) throw new Error('Meeting connection cancelled');
      if (!this.receiveOnly && options.camera === true) {
        try { await room.localParticipant.setCameraEnabled(true); }
        catch { unavailable.push('Camera unavailable. You joined with video off.'); }
      }
      if (!current()) throw new Error('Meeting connection cancelled');
      stage = 'participant_refresh';
      this.refresh(room);
      stage = 'post_connect_guard';
      this.update({ status: 'connected', error: unavailable.length ? unavailable.join(' ') : null });
    } catch (error) {
      if (generation === this.generation) {
        this.cleanup?.(); this.cleanup = undefined; this.room = undefined;
        this.update({ status: 'error', participants: [] }); this.fail(error);
      }
      // A delayed connect/capture can complete after disconnect. Stop it again.
      if (room) await Promise.resolve(room.disconnect(true)).catch(() => undefined);
      throw error instanceof BrowserMeetingConnectionFailure
        ? error
        : new BrowserMeetingConnectionFailure(stage, error);
    }
  }
  async disconnect(): Promise<void> {
    const generation = ++this.generation, room = this.room;
    this.cleanup?.(); this.cleanup = undefined; this.room = undefined;
    this.receiveOnly = false;
    this.update({ status: 'disconnected', participants: [], error: null });
    try { if (room) await room.disconnect(true); }
    catch (error) { if (generation === this.generation) this.fail(error); throw error; }
  }
  private operation(action: (participant: BrowserLocalParticipant) => Promise<unknown>): Promise<void> {
    const generation = this.generation, room = this.room;
    const run = async () => {
      if (!room || room !== this.room || generation !== this.generation || this.snapshot.status !== 'connected') {
        const error = new Error('Meeting is not connected');
        if (generation === this.generation) this.fail(error);
        throw error;
      }
      try {
        await action(room.localParticipant);
        if (generation !== this.generation || room !== this.room) {
          await room.disconnect(true); throw new Error('Meeting operation cancelled');
        }
        this.refresh(room); this.update({ error: null });
      } catch (error) { if (generation === this.generation) this.fail(error); throw error; }
    };
    const result = this.mediaQueue.then(run, run);
    this.mediaQueue = result.catch(() => undefined);
    return result;
  }
  private denyPublish(): Promise<void> {
    const error = new Error('This meeting is listen-only');
    this.fail(error);
    return Promise.reject(error);
  }
  setMicrophone(enabled: boolean) {
    return enabled && this.receiveOnly ? this.denyPublish() : this.operation(p => p.setMicrophoneEnabled(enabled));
  }
  setCamera(enabled: boolean) {
    return enabled && this.receiveOnly ? this.denyPublish() : this.operation(p => p.setCameraEnabled(enabled));
  }
  setLanguage(language: string): Promise<void> {
    return this.operation(async p => {
      const key = this.capabilities.languageAttribute;
      if (!key || !p.setAttributes) throw new Error('Language attributes are unsupported');
      if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) throw new Error('Invalid language tag');
      await p.setAttributes({ [key]: language });
    });
  }
}
