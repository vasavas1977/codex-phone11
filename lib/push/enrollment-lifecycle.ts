type Snapshot = { owner: object | null; account: object | null; ready: boolean; busy: boolean };
/** Foreground maintenance only: callers never await this scheduler. */
export function createVoipEnrollmentLifecycle(deps: {
  snapshot(): Snapshot;
  refresh(signal: AbortSignal): Promise<void>;
}, initiallyActive: boolean) {
  let active = initiallyActive, disposed = false, running = false, nextDue = 0;
  let owner: object | null = null, account: object | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const eligible = () => {
    const state = deps.snapshot();
    return active && !disposed && !!state.owner && !!state.account && state.ready && !state.busy;
  };
  const schedule = () => {
    clearTimeout(timer);
    if (disposed || !active || running) return;
    timer = setTimeout(run, eligible() ? Math.max(0, nextDue - Date.now()) : 30000);
  };
  const run = () => {
    if (!eligible()) { schedule(); return; }
    running = true;
    const attempt = new AbortController(); controller = attempt;
    let budget: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const work = Promise.resolve().then(() => {
      if (attempt.signal.aborted || !eligible()) throw new Error("Enrollment refresh deferred");
      return deps.refresh(attempt.signal);
    });
    void Promise.race([work, new Promise<never>((_, reject) => {
      budget = setTimeout(() => { timedOut = true; attempt.abort(); reject(new Error("Enrollment refresh timed out")); }, 10000);
    })]).then(() => { nextDue = Date.now() + (attempt.signal.aborted ? 0 : 15 * 60_000); },
      () => { nextDue = Date.now() + (attempt.signal.aborted && !timedOut ? 0 : 30000); })
      .finally(() => { clearTimeout(budget); running = false; if (controller === attempt) controller = undefined; schedule(); });
  };
  const changed = () => {
    const state = deps.snapshot();
    if (owner !== state.owner || account !== state.account) {
      owner = state.owner; account = state.account; nextDue = 0; controller?.abort();
    }
    if (!eligible()) { controller?.abort(); nextDue = 0; }
    schedule();
  };
  return {
    start: changed,
    changed,
    setActive(value: boolean) { active = value; if (value) nextDue = 0; changed(); },
    dispose() { disposed = true; controller?.abort(); clearTimeout(timer); },
  };
}
