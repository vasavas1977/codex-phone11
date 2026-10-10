export type ScreenTrack = { kind: string; mediaStreamTrack: Pick<MediaStreamTrack, 'readyState' | 'addEventListener' | 'removeEventListener'>;
  stop(): void };
export type ScreenShareView = Readonly<{ available: boolean; status: 'idle' | 'choosing' | 'publishing' | 'sharing' | 'stopping'; error: string | null }>;
export type ScreenShareAdapter<T extends ScreenTrack> = {
  allowed(): boolean; capture(): Promise<T[]>; publish(track: T): Promise<unknown>;
  unpublish(track: T): Promise<unknown>; publications(): T[]; isPublished(track: T): boolean;
  cancelCapture(): void;
};
const cleanupMessage = 'Screen sharing could not finish stopping. Tap Stop sharing to retry cleanup before leaving.';
export function screenPublishingPermitted(input: { interactive: boolean; connected: boolean; secure: boolean; captureApi: boolean;
  permissions?: { canPublish?: boolean; canPublishSources?: number[] }; source: number }): boolean {
  const permissions = input.permissions;
  return input.interactive && input.connected && input.secure && input.captureApi && permissions?.canPublish === true &&
    Array.isArray(permissions.canPublishSources) &&
    (permissions.canPublishSources.length === 0 || permissions.canPublishSources.includes(input.source));
}
/** One admitted Room's display tracks, including late capture/publish and failed cleanup. */
export class DesktopMeetingScreenShare<T extends ScreenTrack> {
  private epoch = 0;
  private retired = false;
  private view: ScreenShareView = { available: false, status: 'idle', error: null };
  private tracks = new Map<T, () => void>();
  private pending = new Set<Promise<void>>();
  private stopping?: Promise<void>;
  constructor(private readonly adapter: ScreenShareAdapter<T>, private readonly current: () => boolean,
    private readonly render: (view: ScreenShareView) => void) { this.update('idle'); }
  getSnapshot(): ScreenShareView { return this.view; }
  private allowed(): boolean {
    try { return !this.retired && this.current() && this.adapter.allowed(); } catch { return false; }
  }
  private update(status: ScreenShareView['status'], error: string | null = null): void {
    this.view = Object.freeze({ available: this.allowed(), status, error }); this.render(this.view);
  }
  private own(track: T): void {
    if (this.tracks.has(track)) return;
    const ended = () => { void this.stop().catch(() => undefined); };
    this.tracks.set(track, ended); track.mediaStreamTrack.addEventListener('ended', ended);
  }
  private async remove(track: T): Promise<void> {
    track.stop(); await this.adapter.unpublish(track);
    track.mediaStreamTrack.removeEventListener('ended', this.tracks.get(track)!); this.tracks.delete(track);
  }
  refresh(): void {
    let stale = false;
    for (const track of this.adapter.publications()) if (!this.tracks.has(track)) { this.own(track); stale = true; }
    this.update(this.view.status, this.view.error);
    if ((stale || !this.allowed() || (this.view.status === 'sharing' && [...this.tracks].some(([track]) =>
      track.mediaStreamTrack.readyState !== 'live' || !this.adapter.isPublished(track)))) &&
      (this.tracks.size || this.pending.size)) void this.stop().catch(() => undefined);
  }
  start(): Promise<void> {
    if (!this.allowed() || this.view.status !== 'idle' || this.pending.size || this.tracks.size || this.stopping)
      return Promise.reject(new Error('Screen sharing is unavailable'));
    const epoch = ++this.epoch;
    let resolve!: () => void, reject!: (reason: unknown) => void;
    const task = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    this.pending.add(task); this.update('choosing');
    const current = () => epoch === this.epoch && this.allowed();
    const run = async () => {
      try {
        if (!current()) return;
        // This call occurs in the original Share click, before any await or queued work.
        const tracks = await this.adapter.capture();
        tracks.forEach(track => this.own(track));
        if (tracks.length !== 1 || tracks[0].kind !== 'video') throw new Error('Video-only capture required');
        if (!current()) { await Promise.all(tracks.map(track => this.remove(track))); this.update('idle'); return; }
        this.update('publishing');
        if (!current()) { await Promise.all(tracks.map(track => this.remove(track))); this.update('idle'); return; }
        await this.adapter.publish(tracks[0]);
        if (!current() || tracks[0].mediaStreamTrack.readyState !== 'live' || !this.adapter.isPublished(tracks[0])) {
          await Promise.all(tracks.map(track => this.remove(track))); this.update('idle'); return;
        }
        this.update('sharing');
      } catch {
        const results = await Promise.allSettled([...this.tracks.keys()].map(track => this.remove(track)));
        const cleanupFailed = results.some(result => result.status === 'rejected');
        this.update(cleanupFailed ? 'stopping' : 'idle', cleanupFailed ? cleanupMessage :
          epoch === this.epoch && !this.retired ? 'Screen sharing did not start. Choose a screen and check system screen-recording permission, then retry.' : null);
        throw new Error(cleanupFailed ? cleanupMessage : 'Screen sharing did not start');
      }
    };
    void run().then(resolve, reject);
    void task.finally(() => this.pending.delete(task)).catch(() => undefined);
    return task;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    ++this.epoch;
    this.adapter.cancelCapture();
    let resolve!: () => void, reject!: (reason: unknown) => void;
    const task = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    this.stopping = task;
    // Stop local capture synchronously; ownership remains until unpublish succeeds.
    for (const [track, ended] of this.tracks) {
      track.mediaStreamTrack.removeEventListener('ended', ended);
      try { track.stop(); } catch { /* Retain for retry below. */ }
    }
    if (this.pending.size || this.tracks.size) this.update('stopping');
    const run = async () => {
      await Promise.allSettled([...this.pending]);
      const results = await Promise.allSettled([...this.tracks.keys()].map(track => this.remove(track)));
      if (results.some(result => result.status === 'rejected')) {
        this.update('stopping', cleanupMessage); throw new Error(cleanupMessage);
      }
      this.update('idle');
    };
    void run().then(resolve, reject);
    void task.finally(() => { if (this.stopping === task) this.stopping = undefined; }).catch(() => undefined);
    return task;
  }
  retire(): Promise<void> { this.retired = true; return this.stop(); }
}
