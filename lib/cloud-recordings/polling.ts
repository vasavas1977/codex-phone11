/** Bounded foreground polling. Background and disposal cancel the timer. */
export function startRecordingPoll(options: {
  active(): boolean;
  intervalMs(): number | undefined;
  shouldRefresh(): boolean;
  refresh(): void;
  subscribe(listener: () => void): () => void;
  now?(): number;
}) {
  const now = options.now ?? Date.now;
  // Covers three provider deadlines plus the one- and five-minute retry gaps.
  // The deadline is created once per mounted detail and never reset by renders.
  const deadline = now() + 15 * 60_000;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (disposed || !options.active() || now() >= deadline) return;
    const interval = options.intervalMs();
    if (interval === undefined) return;
    const refreshWhenDue = options.shouldRefresh();
    timer = setTimeout(() => {
      if (
        !disposed &&
        options.active() &&
        now() < deadline &&
        refreshWhenDue &&
        options.shouldRefresh()
      )
        options.refresh();
      schedule();
    }, Math.min(interval, deadline - now()));
  };
  const unsubscribe = options.subscribe(schedule);
  schedule();
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
