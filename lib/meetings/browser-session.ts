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
  /** LiveKit's local publications are the fallback stop path if signalling teardown fails. */
  trackPublications?: ReadonlyMap<string, { track?: { stop(): void | Promise<void> } }>;
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
  private pendingMediaOperations = 0;
  private connectionTasks = new Set<Promise<void>>();
  private disconnectTask?: Promise<void>;
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
  connect(options: { url: string; token: string; microphone?: boolean; camera?: boolean; receiveOnly?: boolean }): Promise<void> {
    const task = this.connectInternal(options);
    this.connectionTasks.add(task);
    void task.finally(() => this.connectionTasks.delete(task)).catch(() => undefined);
    return task;
  }
  private async connectInternal(options: { url: string; token: string; microphone?: boolean; camera?: boolean; receiveOnly?: boolean }): Promise<void> {
    const generation = ++this.generation;
    const previous = this.room;
    this.cleanup?.(); this.cleanup = undefined; this.room = undefined;
    this.receiveOnly = options.receiveOnly === true;
    this.update({ status: 'connecting', participants: [], error: null });
    let room: BrowserRoom | undefined;
    let stage: BrowserMeetingConnectStage = 'room_cleanup';
    try {
      if (previous) await this.stopRoom(previous);
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
        this.update({ status: 'disconnected', participants: [], error: 'Meeting disconnected.' });
        // The SDK can signal disconnection while a native capture operation
        // is still pending. Keep the room available to the same stop barrier
        // used for SIP handoff, and retire it before the media lease releases.
        void this.disconnect().catch(() => undefined);
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
      if (room) {
        try { await this.stopRoom(room); }
        catch (cleanupError) {
          // Keep the room reachable by leave() so a failed SDK teardown can
          // never release the native media lease with live capture behind it.
          this.room = room;
          throw cleanupError;
        }
      }
      throw error instanceof BrowserMeetingConnectionFailure
        ? error
        : new BrowserMeetingConnectionFailure(stage, error);
    }
  }
  disconnect(): Promise<void> {
    if (this.disconnectTask) return this.disconnectTask;
    // Assign before cleanup emits a snapshot: the native owner may call leave
    // reentrantly from its subscription to an external disconnect event.
    const task = Promise.resolve().then(() => this.disconnectInternal());
    this.disconnectTask = task;
    void task.finally(() => {
      if (this.disconnectTask === task) this.disconnectTask = undefined;
    }).catch(() => undefined);
    return task;
  }
  private async disconnectInternal(): Promise<void> {
    const generation = ++this.generation, room = this.room;
    const pendingMedia = this.mediaQueue;
    const hadPendingWork = this.pendingMediaOperations > 0 || this.connectionTasks.size > 0;
    const pendingConnections = [...this.connectionTasks];
    this.cleanup?.(); this.cleanup = undefined;
    this.receiveOnly = false;
    this.update({ status: 'disconnected', participants: [],
      error: this.snapshot.status === 'disconnected' ? this.snapshot.error : null });
    try {
      // Stop capture promptly, then wait for every operation that could still
      // publish a native track. A final stop closes the late-publish window
      // before NativeMeetingLifecycle hands the audio device to SIP.
      const firstStop = room ? this.stopRoom(room) : Promise.resolve();
      const [stopResult] = await Promise.allSettled([
        firstStop, pendingMedia, ...pendingConnections,
      ]);
      if (room && hadPendingWork) await this.stopRoom(room);
      // A failing connect may restore its room for retry only after the
      // disconnect barrier captured this.room. Re-read it after all join work
      // settles; otherwise SIP could acquire the lease with that room live.
      const lateRoom = this.room;
      if (lateRoom && lateRoom !== room) await this.stopRoom(lateRoom);
      if (stopResult.status === 'rejected') throw stopResult.reason;
      if (generation === this.generation) this.room = undefined;
    }
    catch (error) { if (generation === this.generation) this.fail(error); throw error; }
  }
  private async stopRoom(room: BrowserRoom): Promise<void> {
    try { await room.disconnect(true); }
    catch (error) {
      // LiveKit may reject sendLeave()/engine.close() before handleDisconnect
      // stops tracks. Stop published capture ourselves, but still reject so
      // the native owner retains the SIP/media lease until teardown retries.
      const publications = room.localParticipant.trackPublications;
      if (publications) {
        await Promise.allSettled(Array.from(publications.values(), publication =>
          Promise.resolve().then(() => publication.track?.stop())));
      }
      throw error;
    }
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
    this.pendingMediaOperations += 1;
    const result = this.mediaQueue.then(run, run);
    const settled = result.finally(() => { this.pendingMediaOperations -= 1; });
    this.mediaQueue = settled.catch(() => undefined);
    return settled;
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
