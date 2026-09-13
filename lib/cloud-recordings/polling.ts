/** Bounded foreground polling. Background and disposal cancel the timer. */
export function startRecordingPoll(options: {
  active(): boolean;
  pending(): boolean;
  refresh(): void;
  subscribe(listener: () => void): () => void;
  now?(): number;
}) {
  const now = options.now ?? Date.now;
  const deadline = now() + 5 * 60_000;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (disposed || !options.active() || now() >= deadline) return;
    timer = setTimeout(() => {
      if (
        !disposed &&
        options.active() &&
        now() < deadline &&
        options.pending()
      )
        options.refresh();
      schedule();
    }, 10_000);
  };
  const unsubscribe = options.subscribe(schedule);
  schedule();
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
