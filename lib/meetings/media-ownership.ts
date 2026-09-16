/** Coordinates permission to activate media, without owning either media SDK.
 * Await request.ready, then check isCurrent(request.lease) after every asynchronous
 * SDK operation. Stop engine media before release(). A stale completion must be
 * disposed by its adapter; this coordinator cannot undo external side effects.
 */
export type MediaKind = "meeting" | "sip";
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
export type MediaOwnershipErrorCode = "busy" | "resume-required" | "stale" | "pause-failed";
export class MediaOwnershipError extends Error {
  constructor(readonly code: MediaOwnershipErrorCode) { super(code); this.name = "MediaOwnershipError"; }
}
type Entry = {
  request: MediaRequest;
  state: "pending" | "active";
  hooks?: MeetingMediaHooks;
  resolve: () => void;
  reject: (error: Error) => void;
};
type InterruptedMeeting = { id: string; hooks: MeetingMediaHooks; pause: "pending" | "stopped" | "failed" };

export class MediaOwnershipCoordinator {
  private generation = 0;
  private owner?: Entry;
  private interrupted?: InterruptedMeeting;
  private pauseTask?: Promise<void>;

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
    if (this.owner || this.pauseTask) throw new MediaOwnershipError("busy");
    return this.grantMeeting(id, hooks);
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
    if (this.owner) {
      const meeting = this.owner;
      this.interrupted = { id: meeting.request.lease.id, hooks: meeting.hooks!, pause: "pending" };
      this.owner = undefined;
      meeting.reject(new MediaOwnershipError("stale"));
    }
    const entry = this.createEntry("sip", id);
    this.owner = entry;
    if (!this.interrupted || this.interrupted.pause === "stopped") {
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

  /** Retry failed suspension without inventing a SIP call. Does not grant media
   * authority or resume any media; useful after cancelling an incoming call.
   */
  retryMeetingPause(): Promise<void> {
    if (!this.interrupted || this.interrupted.pause === "stopped") return Promise.resolve();
    return this.ensureMeetingStopped();
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
