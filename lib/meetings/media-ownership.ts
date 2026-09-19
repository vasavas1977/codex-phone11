/** Coordinates permission to activate media, without owning either media SDK.
 * Await request.ready, then check isCurrent(request.lease) after every asynchronous
 * SDK operation. Stop engine media before release(). A stale completion must be
 * disposed by its adapter; this coordinator cannot undo external side effects.
 */
export type MediaKind = "meeting" | "sip" | "voice-note";
export interface MediaLease {
  readonly kind: MediaKind;
  readonly id: string;
  readonly generation: number;
}
export interface MediaRequest {
  readonly lease: MediaLease;
  readonly ready: Promise<void>;
}
export interface MeetingMediaHooks {
  /** Resolve only after meeting playback, mic, camera and share have stopped.
   * Never automatically restart them when this promise resolves or SIP ends.
   */
  pauseForSip: () => Promise<void>;
}
export interface VoiceNoteMediaHooks {
  /** Stop recording and any local preview before SIP may acquire the device. */
  stopForSip: () => Promise<void>;
}
export type MediaOwnershipErrorCode = "busy" | "resume-required" | "stale" | "pause-failed";
export class MediaOwnershipError extends Error {
  constructor(readonly code: MediaOwnershipErrorCode) { super(code); this.name = "MediaOwnershipError"; }
}
type Entry = {
  request: MediaRequest;
  state: "pending" | "active";
  hooks?: MeetingMediaHooks | VoiceNoteMediaHooks;
  resolve: () => void;
  reject: (error: Error) => void;
};
type InterruptedMeeting = { id: string; hooks: MeetingMediaHooks; pause: "pending" | "stopped" | "failed" };

export class MediaOwnershipCoordinator {
  private generation = 0;
  private owner?: Entry;
  private interrupted?: InterruptedMeeting;
  private pauseTask?: Promise<void>;
  private voiceBarrierFailed = false;
  // Retained only after a voice-note stop fails, so recovery repeats the same
  // SDK shutdown rather than treating a new account as proof that it stopped.
  private voiceBarrierHooks?: VoiceNoteMediaHooks;

  getSnapshot() {
    return {
      owner: this.owner ? { ...this.owner.request.lease, state: this.owner.state } : null,
      interruptedMeetingId: this.interrupted?.id ?? null,
      resumeRequired: Boolean(this.interrupted),
      meetingPause: this.interrupted?.pause ?? "none",
    } as const;
  }

  /** Valid only for the exact issued token, never a reconstructed ID/generation. */
  isCurrent(lease: MediaLease): boolean {
    return this.owner?.request.lease === lease && this.owner.state === "active";
  }

  requestMeeting(id: string, hooks: MeetingMediaHooks): MediaRequest {
    this.validateId(id);
    const existing = this.sameOwner("meeting", id);
    if (existing) return existing;
    if (this.interrupted) throw new MediaOwnershipError("resume-required");
    if (this.voiceBarrierFailed) throw new MediaOwnershipError("pause-failed");
    if (this.owner || this.pauseTask) throw new MediaOwnershipError("busy");
    return this.grantMeeting(id, hooks);
  }

  requestVoiceNote(id: string, hooks: VoiceNoteMediaHooks): MediaRequest {
    this.validateId(id);
    const existing = this.sameOwner("voice-note", id);
    if (existing) return existing;
    // Voice notes never pause a meeting or leave resumable state behind.
    if (this.voiceBarrierFailed) throw new MediaOwnershipError("pause-failed");
    if (this.owner || this.pauseTask || this.interrupted) throw new MediaOwnershipError("busy");
    const entry = this.createEntry("voice-note", id);
    entry.hooks = hooks; entry.state = "active"; this.owner = entry; entry.resolve();
    return entry.request;
  }

  /** A distinct, explicit user action. Always returns a new generation.
   * The adapter may reconnect listening audio; mic/camera/share remain off until
   * their own user actions. This method does not call a media start hook.
   */
  resumeMeeting(id: string, hooks: MeetingMediaHooks): MediaRequest {
    this.validateId(id);
    const existing = this.sameOwner("meeting", id);
    if (existing) return existing;
    if (!this.interrupted || this.interrupted.id !== id) throw new MediaOwnershipError("resume-required");
    if (this.owner || this.pauseTask || this.interrupted.pause !== "stopped") throw new MediaOwnershipError("busy");
    this.interrupted = undefined;
    return this.grantMeeting(id, hooks);
  }

  /** SIP arrival invalidates meeting authority immediately. SIP activation waits
   * for acknowledged meeting suspension; cancellation cannot bypass this barrier.
   */
  requestSip(id: string): MediaRequest {
    this.validateId(id);
    const existing = this.sameOwner("sip", id);
    if (existing) return existing;
    if (this.owner?.request.lease.kind === "sip") throw new MediaOwnershipError("busy");
    if (this.voiceBarrierFailed) {
      // An incoming SIP call is an explicit, bounded retry intent. Keep it
      // pending while the same recorder shutdown is retried once; it never
      // activates audio until that SDK acknowledgement succeeds. A failure
      // rejects this call and leaves the barrier in place for a later intent.
      if (!this.voiceBarrierHooks) throw new MediaOwnershipError("pause-failed");
      const entry = this.createEntry("sip", id);
      this.owner = entry;
      this.activateAfterBarrier(entry, this.retryVoiceStop());
      return entry.request;
    }
    if (!this.owner && this.pauseTask) {
      const entry = this.createEntry("sip", id); this.owner = entry;
      this.activateAfterBarrier(entry, this.pauseTask); return entry.request;
    }
    const prior = this.owner;
    if (prior?.request.lease.kind === "meeting") {
      const meeting = prior;
      this.interrupted = { id: meeting.request.lease.id, hooks: meeting.hooks as MeetingMediaHooks, pause: "pending" };
      this.owner = undefined;
      meeting.reject(new MediaOwnershipError("stale"));
    } else if (prior?.request.lease.kind === "voice-note") {
      this.owner = undefined;
      prior.reject(new MediaOwnershipError("stale"));
    }
    const entry = this.createEntry("sip", id);
    this.owner = entry;
    if (prior?.request.lease.kind === "voice-note") {
      const stop = this.beginVoiceStop(prior.hooks as VoiceNoteMediaHooks);
      this.activateAfterBarrier(entry, stop);
    } else if (!this.interrupted || this.interrupted.pause === "stopped") {
      entry.state = "active";
      entry.resolve();
    } else {
      void this.ensureMeetingStopped().then(() => {
        if (this.owner !== entry) return; // A cancellation/new request retired this generation.
        entry.state = "active";
        entry.resolve();
      }, () => {
        if (this.owner !== entry) return;
        this.owner = undefined;
        entry.reject(new MediaOwnershipError("pause-failed"));
      });
    }
    return entry.request;
  }

  /** Call only once the owning SDK has stopped its media. Stale release is a no-op.
   * Releasing a pending request cancels it, but does not cancel suspension safety.
   */
  release(lease: MediaLease): void {
    if (this.owner?.request.lease !== lease) return;
    const entry = this.owner;
    this.owner = undefined;
    entry.reject(new MediaOwnershipError("stale"));
  }

  /**
   * Auth teardown permanently retires all local ownership records. A paused
   * hook may finish later, but its stale completion cannot grant either SDK.
   */
  clearForAuth(): void {
    const owner = this.owner;
    this.owner = undefined;
    this.interrupted = undefined;
    // Retiring an account must not let a new account acquire audio while its
    // predecessor is still recording. Keep shutdown barriers across auth.
    if (owner?.request.lease.kind === "voice-note") {
      void this.beginVoiceStop(owner.hooks as VoiceNoteMediaHooks).catch(() => undefined);
    }
    if (owner) owner.reject(new MediaOwnershipError("stale"));
  }

  /** Retry failed suspension without inventing a SIP call. Does not grant media
   * authority or resume any media; useful after cancelling an incoming call.
   */
  retryMeetingPause(): Promise<void> {
    if (!this.interrupted || this.interrupted.pause === "stopped") return Promise.resolve();
    return this.ensureMeetingStopped();
  }

  /**
   * Repeat a failed voice-note shutdown before allowing any engine to acquire
   * audio. This is deliberately explicit: a later login cannot clear a stop
   * failure without the predecessor SDK acknowledging that it has stopped.
   */
  retryVoiceStop(): Promise<void> {
    if (!this.voiceBarrierHooks) return Promise.resolve();
    if (this.pauseTask) return this.pauseTask;
    return this.beginVoiceStop(this.voiceBarrierHooks);
  }

  /** Explicitly leave an interrupted meeting once suspension has completed. */
  forgetInterruptedMeeting(id: string): void {
    if (this.interrupted?.id !== id) return;
    if (this.pauseTask || this.interrupted.pause !== "stopped") throw new MediaOwnershipError("busy");
    this.interrupted = undefined;
  }

  private ensureMeetingStopped(): Promise<void> {
    if (this.pauseTask) return this.pauseTask;
    const interrupted = this.interrupted!;
    interrupted.pause = "pending";
    // Defer hooks so a synchronous throw follows the same fail-closed path.
    const task = Promise.resolve().then(() => interrupted.hooks.pauseForSip()).then(() => {
      interrupted.pause = "stopped";
    }, () => {
      interrupted.pause = "failed";
      throw new MediaOwnershipError("pause-failed");
    });
    this.pauseTask = task;
    void task.then(() => { if (this.pauseTask === task) this.pauseTask = undefined; },
      () => { if (this.pauseTask === task) this.pauseTask = undefined; });
    return task;
  }

  private beginVoiceStop(hooks: VoiceNoteMediaHooks): Promise<void> {
    this.voiceBarrierHooks = hooks;
    const task = Promise.resolve().then(() => hooks.stopForSip()).then(() => undefined, () => {
      throw new MediaOwnershipError("pause-failed");
    });
    this.pauseTask = task;
    void task.then(() => {
      if (this.pauseTask === task) this.pauseTask = undefined;
      if (this.voiceBarrierHooks === hooks) {
        this.voiceBarrierHooks = undefined;
        this.voiceBarrierFailed = false;
      }
    }, () => {
      if (this.pauseTask === task) this.pauseTask = undefined;
      if (this.voiceBarrierHooks === hooks) this.voiceBarrierFailed = true;
    });
    return task;
  }

  private activateAfterBarrier(entry: Entry, barrier: Promise<void>) {
    void barrier.then(() => {
      if (this.pauseTask === barrier) this.pauseTask = undefined;
      if (this.owner === entry) { entry.state = "active"; entry.resolve(); }
    }, () => {
      if (this.pauseTask === barrier) this.pauseTask = undefined;
      this.voiceBarrierFailed = true;
      if (this.owner === entry) { this.owner = undefined; entry.reject(new MediaOwnershipError("pause-failed")); }
    });
  }

  private grantMeeting(id: string, hooks: MeetingMediaHooks): MediaRequest {
    const entry = this.createEntry("meeting", id);
    entry.hooks = hooks;
    entry.state = "active";
    this.owner = entry;
    entry.resolve();
    return entry.request;
  }
  private sameOwner(kind: MediaKind, id: string): MediaRequest | undefined {
    return this.owner?.request.lease.kind === kind && this.owner.request.lease.id === id ? this.owner.request : undefined;
  }
  private createEntry(kind: MediaKind, id: string): Entry {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const lease = Object.freeze({ kind, id, generation: ++this.generation });
    return { request: Object.freeze({ lease, ready }), state: "pending", resolve, reject };
  }
  private validateId(id: string): void {
    if (!id || id.trim() !== id) throw new TypeError("Media session ID must be nonempty and trimmed.");
  }
}
