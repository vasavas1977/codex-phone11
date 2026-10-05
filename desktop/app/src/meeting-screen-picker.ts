/** Main owns source objects; the trusted meeting UI receives disposable choices only. */
export type ScreenChoice = Readonly<{ handle: string; name: string }>;
export type ScreenChoices = Readonly<{ request: string; choices: readonly ScreenChoice[] }>;
export class MeetingScreenPicker<S extends { id: string; name: string }> {
  private pending?: { request: string; current: () => boolean; sources: Map<string, S>;
    callback: (source?: S) => void; choosing: boolean };
  constructor(private readonly sources: () => Promise<S[]>, private readonly handle: () => string,
    private readonly show: (choices: ScreenChoices | null) => void) {}
  request(current: () => boolean, callback: (source?: S) => void): void {
    if (this.pending || !current()) { try { callback(); } catch { /* Requesting frame is already gone. */ } return; }
    const pending = { request: this.handle(), current, sources: new Map<string, S>(), callback, choosing: false };
    this.pending = pending;
    void Promise.resolve().then(() => this.sources()).then(sources => {
      if (this.pending !== pending) return;
      if (!current() || !sources.length || sources.length > 128) { this.cancel(); return; }
      for (const source of sources) {
        if (!source.id || !source.name) continue;
        pending.sources.set(this.handle(), source);
      }
      if (!pending.sources.size) { this.cancel(); return; }
      this.show({ request: pending.request, choices: [...pending.sources].map(([handle, source]) =>
        ({ handle, name: source.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160) })) });
    }).catch(() => { if (this.pending === pending) this.cancel(); });
  }
  async choose(request: string, handle: string | null): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.request !== request || pending.choosing) return;
    if (handle === null || !pending.current()) { this.cancel(); return; }
    const chosen = pending.sources.get(handle);
    if (!chosen) { this.cancel(); return; }
    pending.choosing = true;
    // A window may disappear or change while the user is choosing. Resolve it again.
    try {
      const sources = await this.sources();
      if (this.pending !== pending) return;
      const source = sources.find(source => source.id === chosen.id && source.name === chosen.name);
      this.finish(pending.current() ? source : undefined);
    } catch { if (this.pending === pending) this.cancel(); }
  }
  cancel(): void { if (this.pending) this.finish(); }
  private finish(source?: S): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    try { this.show(null); } catch { /* A destroyed window cannot show its chooser. */ }
    // Electron can destroy the requesting frame while enumeration is in flight.
    try { pending.callback(source); } catch { /* No stream is granted to a destroyed frame. */ }
  }
}
