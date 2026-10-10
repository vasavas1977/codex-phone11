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
  /** Absent for native/desktop adapters, which cannot publish browser screens. */
  screenShare?: { available: boolean; status: 'idle' | 'choosing' | 'publishing' | 'sharing' | 'stopping'; error: string | null };
}
export interface BrowserScreenTrack {
  readonly kind: string;
  readonly source: string;
  readonly mediaStreamTrack: Pick<MediaStreamTrack, 'readyState' | 'addEventListener' | 'removeEventListener'>;
  stop(): void;
}
export interface BrowserScreenAdapter {
  /** Checks the current authenticated admission AND connected SDK publication rights. */
  isAllowed(room: BrowserRoom): boolean;
  /** Must invoke the browser picker synchronously, before returning its promise. */
  capture(room: BrowserRoom): Promise<readonly BrowserScreenTrack[]>;
  /** Native consent retirement runs immediately, before waiting for a chooser. */
  cancelCapture?(): Promise<void>;
  publish(room: BrowserRoom, track: BrowserScreenTrack): Promise<unknown>;
  unpublish(room: BrowserRoom, track: BrowserScreenTrack): Promise<unknown>;
  isPublished(room: BrowserRoom, track: BrowserScreenTrack): boolean;
  publishedTracks(room: BrowserRoom): readonly BrowserScreenTrack[];
}
export interface BrowserSessionCapabilities {
  languageAttribute?: string;
  screen?: BrowserScreenAdapter;
  /** Optional local session lifetime guard; this never grants provider authority. */
  isCurrentOwner?: () => boolean;
}
const refreshEvents = ['participantConnected', 'participantDisconnected', 'participantNameChanged',
  'participantAttributesChanged', 'activeSpeakersChanged', 'trackMuted', 'trackUnmuted',
  'trackPublished', 'trackUnpublished', 'localTrackPublished', 'localTrackUnpublished',
  'trackSubscribed', 'trackUnsubscribed', 'participantPermissionsChanged'];

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
  private screenEpoch = 0;
  private screenTasks = new Set<Promise<void>>();
  private screenStopTask?: Promise<void>;
  private screenTracks = new Map<BrowserScreenTrack, { room: BrowserRoom; ended: () => void }>();
  private ownerIsCurrent(): boolean {
    try { return !this.capabilities.isCurrentOwner || this.capabilities.isCurrentOwner() === true; }
    catch { return false; }
  }
  constructor(private readonly createRoom: () => BrowserRoom,
    private readonly capabilities: BrowserSessionCapabilities = {}) {
    if (capabilities.screen) this.snapshot.screenShare = { available: false, status: 'idle', error: null };
  }
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
    if (!this.ownerIsCurrent()) {
      void this.disconnect().catch(() => undefined);
      return;
    }
    const map = (p: BrowserParticipant, local: boolean): MeetingParticipant => Object.freeze({
      identity: p.identity, name: p.name || p.identity, local, speaking: !!p.isSpeaking,
      microphone: !!p.isMicrophoneEnabled, camera: !!p.isCameraEnabled,
      attributes: Object.freeze({ ...p.attributes }),
    });
    this.update({ participants: Object.freeze([map(room.localParticipant, true),
      ...Array.from(room.remoteParticipants.values(), p => map(p, false))]) });
    if (this.snapshot.screenShare) {
      // A reconnect can republish a snapshot of an already stopped SDK track.
      // Adopt and retire that publication before permitting another local share.
      let stalePublication = false;
      for (const track of this.capabilities.screen!.publishedTracks(room)) if (!this.screenTracks.has(track)) {
        const ended = () => { void this.stopScreenShare().catch(() => undefined); };
        this.screenTracks.set(track, { room, ended });
        track.mediaStreamTrack.addEventListener('ended', ended);
        stalePublication = true;
      }
      this.updateScreen(this.snapshot.screenShare.status, this.snapshot.screenShare.error);
      const revoked = !this.screenAllowed(room);
      const unpublished = this.snapshot.screenShare.status === 'sharing' &&
        [...this.screenTracks.keys()].some(track => !this.capabilities.screen!.isPublished(room, track));
      if ((revoked || unpublished || stalePublication) && (this.screenTracks.size || this.screenTasks.size))
        void this.stopScreenShare().catch(() => undefined);
    }
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
    const screensStopped = this.stopScreenShare();
    this.cleanup?.(); this.cleanup = undefined; this.room = undefined;
    this.receiveOnly = options.receiveOnly === true;
    this.update({ status: 'connecting', participants: [], error: null });
    let room: BrowserRoom | undefined;
    let stage: BrowserMeetingConnectStage = 'room_cleanup';
    try {
      if (this.capabilities.screen) await screensStopped;
      if (previous) await this.stopRoom(previous);
      if (generation !== this.generation || !this.ownerIsCurrent()) throw new Error('Meeting connection cancelled');
      stage = 'room_create';
      room = this.createRoom();
      this.room = room;
      const current = () => generation === this.generation && room === this.room && this.ownerIsCurrent();
      const bindings: Array<[string, (...args: unknown[]) => void]> = [];
      const bind = (event: string, fn: (...args: unknown[]) => void) => {
        const listener = (...args: unknown[]) => {
          if (generation === this.generation && room === this.room && !this.ownerIsCurrent()) {
            void this.disconnect().catch(() => undefined);
            return;
          }
          if (current()) fn(...args);
        };
        bindings.push([event, listener]); room!.on(event, listener);
      };
      this.cleanup = () => bindings.forEach(([event, fn]) => room!.off(event, fn));
      stage = 'event_bind';
      refreshEvents.forEach(event => bind(event, () => this.refresh(room!)));
      const reconnecting = () => {
        this.update({ status: 'reconnecting' });
        void this.stopScreenShare().catch(() => undefined);
      };
      bind('reconnecting', reconnecting);
      if (this.capabilities.screen) bind('signalReconnecting', reconnecting);
      bind('reconnected', () => {
        if (this.capabilities.screen) { this.update({ status: 'connected' }); this.refresh(room!); }
        else { this.refresh(room!); this.update({ status: 'connected' }); }
      });
      bind('moved', () => {
        // Public RoomEvent.Moved changes rooms without a connection-state
        // transition. Retire this admitted room before any queued capture or
        // reconnect callback can act on the replacement provider room.
        ++this.generation;
        const stopping = this.disconnect();
        this.update({ status: 'disconnected', participants: [],
          error: 'Meeting changed. Rejoin to request fresh access.' });
        // The native owner observes the snapshot and awaits this same barrier;
        // failures retain the room and media lease for an explicit leave retry.
        void stopping.catch(() => undefined);
      });
      bind('disconnected', () => {
        this.update({ status: 'disconnected', participants: [], error: 'Meeting disconnected.' });
        // The SDK can signal disconnection while a native capture operation
        // is still pending. Keep the room available to the same stop barrier
        // used for SIP handoff, and retire it before the media lease releases.
        void this.disconnect().catch(() => undefined);
      });
      stage = 'signal_connect';
      if (!current()) throw new Error('Meeting connection cancelled');
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
      if (!current()) throw new Error('Meeting connection cancelled');
      this.update({ status: 'connected', error: unavailable.length ? unavailable.join(' ') : null });
      if (this.snapshot.screenShare) this.updateScreen('idle');
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
    if (!this.ownerIsCurrent()) this.update({ status: 'disconnected', participants: [], error: 'Meeting disconnected.' });
    if (this.capabilities.screen) void this.stopScreenShare().catch(() => undefined);
    void task.finally(() => {
      if (this.disconnectTask === task) this.disconnectTask = undefined;
    }).catch(() => undefined);
    return task;
  }
  private async disconnectInternal(): Promise<void> {
    const generation = ++this.generation, room = this.room;
    const screensStopped = this.stopScreenShare();
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
      const [stopResult, screenResult] = await Promise.allSettled([
        firstStop, screensStopped, pendingMedia, ...pendingConnections,
      ]);
      if (room && hadPendingWork) await this.stopRoom(room);
      // A failing connect may restore its room for retry only after the
      // disconnect barrier captured this.room. Re-read it after all join work
      // settles; otherwise SIP could acquire the lease with that room live.
      const lateRoom = this.room;
      if (lateRoom && lateRoom !== room) await this.stopRoom(lateRoom);
      if (stopResult.status === 'rejected') throw stopResult.reason;
      if (screenResult.status === 'rejected') throw screenResult.reason;
      if (generation === this.generation) this.room = undefined;
    }
    catch (error) { if (generation === this.generation) this.fail(error); throw error; }
  }
  private async stopRoom(room: BrowserRoom): Promise<void> {
    // Includes acquired-but-unpublished screens, which the SDK cannot discover.
    let captureStopError: unknown;
    for (const [track, entry] of this.screenTracks) if (entry.room === room) {
      try { track.stop(); } catch (error) { captureStopError = error; }
    }
    try {
      await room.disconnect(true);
      if (captureStopError) throw captureStopError;
    }
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
    for (const [track, entry] of this.screenTracks) if (entry.room === room) {
      track.mediaStreamTrack.removeEventListener('ended', entry.ended);
      this.screenTracks.delete(track);
    }
  }
  private screenAllowed(room: BrowserRoom | undefined): boolean {
    if (!room || room !== this.room || this.receiveOnly || this.snapshot.status !== 'connected' || !this.ownerIsCurrent()) return false;
    try { return this.capabilities.screen?.isAllowed(room) === true; }
    catch { return false; }
  }
  private updateScreen(status: NonNullable<BrowserSessionSnapshot['screenShare']>['status'], error: string | null = null) {
    if (this.capabilities.screen) this.update({ screenShare: Object.freeze({
      available: this.screenAllowed(this.room), status, error,
    }) });
  }
  refreshScreenCapability(): void {
    if (this.room && this.snapshot.screenShare) this.refresh(this.room);
  }
  /** Call directly from the user's click. Capture must never enter mediaQueue. */
  startScreenShare(): Promise<void> {
    const room = this.room, adapter = this.capabilities.screen;
    if (!adapter || !this.screenAllowed(room) || this.disconnectTask || this.screenStopTask ||
        this.screenTasks.size || this.screenTracks.size || adapter.publishedTracks(room!).length)
      return Promise.reject(new Error('Screen sharing is unavailable'));
    const generation = this.generation, epoch = ++this.screenEpoch;
    // Register before snapshots can reentrantly request leave/stop.
    let resolve!: () => void, reject!: (error: unknown) => void;
    const task = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    this.screenTasks.add(task);
    const current = () => !this.disconnectTask && generation === this.generation && epoch === this.screenEpoch && this.screenAllowed(room);
    const run = async () => {
      let tracks: readonly BrowserScreenTrack[] = [];
      try {
        this.updateScreen('choosing');
        if (!current()) throw new Error('Screen sharing cancelled');
        // This call executes now, in the trusted click stack, before the first await.
        tracks = await adapter.capture(room!);
        for (const track of tracks) {
          const ended = () => { void this.stopScreenShare().catch(() => undefined); };
          this.screenTracks.set(track, { room: room!, ended });
          track.mediaStreamTrack.addEventListener('ended', ended);
        }
        if (tracks.length !== 1 || tracks[0].kind !== 'video' || tracks[0].source !== 'screen_share')
          throw new Error('Screen capture is unavailable');
        const track = tracks[0];
        const live = () => track.mediaStreamTrack.readyState === 'live';
        if (!current() || !live()) throw new Error('Screen sharing cancelled');
        this.updateScreen('publishing');
        if (!current() || !live()) throw new Error('Screen sharing cancelled');
        await adapter.publish(room!, track);
        if (!current() || !live() || !adapter.isPublished(room!, track))
          throw new Error('Screen sharing cancelled');
        this.updateScreen('sharing');
      } catch (error) {
        // Stale picker/publish completions never publish again or alter a newer screen state.
        const stopped = tracks.map(track => {
          const entry = this.screenTracks.get(track);
          if (entry) track.mediaStreamTrack.removeEventListener('ended', entry.ended);
          try { track.stop(); return true; } catch { return false; }
        });
        const results = await Promise.allSettled(tracks.map(track => adapter.unpublish(room!, track)));
        for (let index = 0; index < tracks.length; index++) if (stopped[index] && results[index].status === 'fulfilled') {
          const entry = this.screenTracks.get(tracks[index]);
          if (entry) tracks[index].mediaStreamTrack.removeEventListener('ended', entry.ended);
          this.screenTracks.delete(tracks[index]);
        }
        if (generation === this.generation && epoch === this.screenEpoch) this.updateScreen(
          this.screenTracks.size ? 'stopping' : 'idle', 'Screen sharing did not start. Choose a screen and check your permissions, then retry.');
        throw error;
      }
    };
    // Calling run() directly is essential: Promise.then(run) loses the gesture.
    void run().then(resolve, reject);
    void task.finally(() => this.screenTasks.delete(task)).catch(() => undefined);
    return task;
  }
  /** Invalidates capture immediately; a still-open browser chooser must settle before teardown completes. */
  stopScreenShare(): Promise<void> {
    if (!this.capabilities.screen) return Promise.resolve();
    if (this.screenStopTask) return this.screenStopTask;
    ++this.screenEpoch;
    const pending = [...this.screenTasks];
    let resolve!: () => void, reject!: (error: unknown) => void;
    const task = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    this.screenStopTask = task;
    let cancellation: Promise<void>;
    try { cancellation = this.capabilities.screen.cancelCapture?.() ?? Promise.resolve(); }
    catch (error) { cancellation = Promise.reject(error); }
    // Observe failure now, even while an ordinary chooser remains pending.
    void cancellation.catch(() => undefined);
    // Stop capture synchronously, including a screen whose publish is still pending.
    for (const [track, entry] of this.screenTracks) {
      track.mediaStreamTrack.removeEventListener('ended', entry.ended);
      try { track.stop(); } catch { /* Retry below; retain ownership if stopping keeps failing. */ }
    }
    if (pending.length || this.screenTracks.size) this.updateScreen('stopping');
    const run = async () => {
      const cancellationResult = await cancellation.then(() => undefined, error => ({ error }));
      await Promise.allSettled(pending);
      const entries = [...this.screenTracks];
      const results = await Promise.allSettled(entries.map(async ([track, entry]) => {
        track.stop();
        await this.capabilities.screen!.unpublish(entry.room, track);
        this.screenTracks.delete(track);
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (cancellationResult || failed?.status === 'rejected') {
        this.updateScreen('stopping', 'Screen sharing could not finish stopping. Retry cleanup before leaving.');
        throw cancellationResult?.error ?? (failed as PromiseRejectedResult).reason;
      }
      this.updateScreen('idle');
    };
    void run().then(resolve, reject);
    void task.finally(() => { if (this.screenStopTask === task) this.screenStopTask = undefined; }).catch(() => undefined);
    return task;
  }
  private operation(action: (participant: BrowserLocalParticipant) => Promise<unknown>): Promise<void> {
    const generation = this.generation, room = this.room;
    // Refuse newly requested capture immediately, rather than queuing behind a
    // retiring room's still-pending publication. Preserve its teardown error.
    if (!this.ownerIsCurrent()) {
      void this.disconnect().catch(() => undefined);
      return Promise.reject(new Error('Meeting is not connected'));
    }
    if (!room || this.disconnectTask || this.snapshot.status !== 'connected')
      return Promise.reject(new Error('Meeting is not connected'));
    const run = async () => {
      if (!room || room !== this.room || generation !== this.generation || this.snapshot.status !== 'connected' || !this.ownerIsCurrent()) {
        if (room === this.room && generation === this.generation && !this.ownerIsCurrent())
          void this.disconnect().catch(() => undefined);
        const error = new Error('Meeting is not connected');
        if (generation === this.generation) this.fail(error);
        throw error;
      }
      try {
        await action(room.localParticipant);
        if (generation !== this.generation || room !== this.room || !this.ownerIsCurrent()) {
          if (generation === this.generation && room === this.room && !this.ownerIsCurrent())
            void this.disconnect().catch(() => undefined);
          await room.disconnect(true); throw new Error('Meeting operation cancelled');
        }
        this.refresh(room);
        if (!this.ownerIsCurrent()) {
          void this.disconnect().catch(() => undefined);
          throw new Error('Meeting operation cancelled');
        }
        this.update({ error: null });
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
