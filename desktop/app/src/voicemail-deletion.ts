/** Renderer lifetime only; main-process confirmation and fresh owner RPC remain authoritative. */
export class VoicemailDeletion {
  private scope: string | null = null;
  private epoch = 0;
  private pending = new Set<number>();
  private retired = new Set<number>();
  private failed = new Set<number>();
  constructor(private readonly options: {
    currentScope: () => string | null;
    hasMessage: (id: number) => boolean;
    remove: (revision: string, id: number) => Promise<unknown>;
    stopPlayback: (id: number) => void;
    changed: () => void;
  }) {}
  sync(): void {
    const scope = this.options.currentScope();
    if (scope === this.scope) return;
    this.scope = scope; this.epoch += 1;
    this.pending.clear(); this.retired.clear(); this.failed.clear();
  }
  get version(): number { this.sync(); return this.epoch; }
  isPending(id: number): boolean { this.sync(); return this.pending.has(id); }
  isRetired(id: number): boolean { this.sync(); return this.retired.has(id); }
  hasFailed(id: number): boolean { this.sync(); return this.failed.has(id); }
  canPlay(id: number): boolean { return !this.isPending(id) && !this.isRetired(id); }
  async run(revision: string, id: number): Promise<void> {
    this.sync();
    if (!this.scope || !revision || !Number.isSafeInteger(id) || id <= 0 ||
        !this.options.hasMessage(id) || this.pending.size > 0 || !this.canPlay(id)) return;
    const scope = this.scope;
    const epoch = ++this.epoch;
    this.pending.add(id); this.failed.delete(id);
    this.options.stopPlayback(id); this.options.changed();
    const current = () => { this.sync(); return this.scope === scope && this.epoch === epoch; };
    try {
      // The privileged method owns Cancel-default confirmation. Renderer supplies no confirmation bit.
      const result = await this.options.remove(revision, id);
      if (!current()) return;
      if (!result || typeof result !== 'object' || Array.isArray(result) ||
          Object.keys(result).sort().join(',') !== 'deleted,id,sessionRevision') throw new Error('Invalid delete reply');
      const response = result as Record<string, unknown>;
      if (response.sessionRevision !== revision || response.id !== id || typeof response.deleted !== 'boolean')
        throw new Error('Invalid delete reply');
      if (response.deleted) this.retired.add(id);
    } catch { if (current()) this.failed.add(id); }
    finally {
      if (current()) { this.pending.delete(id); this.options.changed(); }
    }
  }
}
