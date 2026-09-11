/** No session or SIP credentials are persisted in this revocation ledger. */
export type PushBinding = {
  ownerUserId: number;
  token: string;
  deviceId: string;
  platform: "ios";
  sipUri: string;
  bundleId: string;
  sandbox: boolean;
};

export interface TokenDependencies {
  currentOwner(): number | null;
  read(): Promise<PushBinding[]>;
  write(bindings: PushBinding[]): Promise<void>;
  register(binding: PushBinding, signal: AbortSignal): Promise<void>;
  unregister(binding: PushBinding, signal: AbortSignal): Promise<void>;
  stopNative(): Promise<void>;
}

export class VoipTokenCoordinator {
  private queue: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private controller = new AbortController();
  constructor(private readonly deps: TokenDependencies) {}
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation, operation);
    this.queue = task.catch(() => undefined);
    return task;
  }
  private ownerIs(owner: number) { return this.deps.currentOwner() === owner; }

  /** Persist first: even a lost registration response leaves revocation evidence. */
  bind(binding: PushBinding): Promise<void> {
    const revision = this.revision;
    const signal = this.controller.signal;
    return this.serialize(async () => {
      if (revision !== this.revision || !this.ownerIs(binding.ownerUserId)) return;
      const entries = await this.deps.read();
      const previousEntries = entries.filter(entry => entry.ownerUserId === binding.ownerUserId &&
        (entry.token !== binding.token || entry.deviceId !== binding.deviceId || entry.sipUri !== binding.sipUri));
      const exists = entries.some(entry => entry.ownerUserId === binding.ownerUserId &&
        entry.token === binding.token && entry.deviceId === binding.deviceId && entry.sipUri === binding.sipUri);
      if (!exists) {
        entries.push(binding);
        await this.deps.write(entries);
      }
      if (revision !== this.revision || !this.ownerIs(binding.ownerUserId)) return;
      // Register first so a same-session provider rotation can atomically move
      // the existing wake grant to the new server revision without a deletion gap.
      await this.deps.register(binding, signal);
      for (const previous of previousEntries) {
        if (revision !== this.revision || !this.ownerIs(binding.ownerUserId)) return;
        // unregister is token/device scoped; the same token/device now names the
        // NEW assignment and must never be removed as an old sipUri cleanup.
        if (previous.token !== binding.token || previous.deviceId !== binding.deviceId) {
          await this.deps.unregister(previous, signal);
          if (revision !== this.revision || !this.ownerIs(binding.ownerUserId)) return;
        }
        entries.splice(entries.indexOf(previous), 1);
        await this.deps.write(entries);
      }
    });
  }

  /** Stop immediately; never race queued registration with logout. The server's
   * session FK cascade remains authoritative even if device cleanup is offline. */
  async beforeLogout(budgetMs = 1000): Promise<void> {
    const owner = this.deps.currentOwner();
    const revision = ++this.revision;
    this.controller.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const current = () => revision === this.revision && !signal.aborted && !!owner && this.ownerIs(owner);
    const cleanup = (async () => {
      await this.deps.stopNative();
      if (!current()) return;
      await this.serialize(async () => {
        if (!current()) return;
        const entries = await this.deps.read();
        for (const entry of [...entries].filter(value => value.ownerUserId === owner)) {
          if (!current()) return;
          try { await this.deps.unregister(entry, signal); } catch { continue; }
          if (!current()) return;
          entries.splice(entries.indexOf(entry), 1);
          await this.deps.write(entries);
        }
      });
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Observe eventual rejection even after the total deadline wins. Native or
      // SecureStore promises cannot always be interrupted, but cannot hold logout.
      await Promise.race([cleanup.catch(() => undefined), new Promise<void>(resolve => {
        timer = setTimeout(resolve, budgetMs);
      })]);
    } finally {
      clearTimeout(timer);
      if (revision === this.revision) {
        ++this.revision;
        this.controller.abort();
        this.controller = new AbortController();
      }
    }
  }
}
