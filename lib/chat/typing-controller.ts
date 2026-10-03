export type TypingWireState = { sequence: number; active: boolean };

type Timer = ReturnType<typeof setTimeout>;

export function createTypingLifecycleController(options: {
  nextSequence: () => number;
  canSend: (state: TypingWireState) => boolean;
  send: (state: TypingWireState) => Promise<unknown>;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => Timer;
  cancel?: (timer: Timer) => void;
  inactivityMs?: number;
  refreshMs?: number;
  requestDeadlineMs?: number;
}) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const inactivityMs = options.inactivityMs ?? 5_000;
  const refreshMs = options.refreshMs ?? 3_000;
  const requestDeadlineMs = options.requestDeadlineMs ?? 4_000;
  let active = false;
  let disposed = false;
  let sending = false;
  let desired: TypingWireState | undefined;
  let inactivityTimer: Timer | undefined;
  let lastTrueAt = 0;

  const deliverWithDeadline = async (state: TypingWireState) => {
    let deadline: Timer | undefined;
    const request = Promise.resolve(options.send(state)).catch(() => undefined);
    await Promise.race([
      request,
      new Promise<void>((resolve) => {
        deadline = schedule(resolve, requestDeadlineMs);
      }),
    ]);
    if (deadline !== undefined) cancel(deadline);
  };

  const flush = async () => {
    if (sending) return;
    sending = true;
    try {
      while (desired) {
        const next = desired;
        desired = undefined;
        if (!options.canSend(next)) continue;
        await deliverWithDeadline(next);
      }
    } finally {
      sending = false;
      if (desired) void flush();
    }
  };

  const publish = (nextActive: boolean) => {
    desired = { sequence: options.nextSequence(), active: nextActive };
    void flush();
  };

  const stop = () => {
    if (inactivityTimer !== undefined) cancel(inactivityTimer);
    inactivityTimer = undefined;
    if (!active && desired?.active !== true) return;
    active = false;
    publish(false);
  };

  const onUserEdit = (text: string) => {
    if (disposed) return;
    if (!text.trim()) {
      stop();
      return;
    }
    const timestamp = now();
    if (!active || timestamp - lastTrueAt >= refreshMs) {
      active = true;
      lastTrueAt = timestamp;
      publish(true);
    }
    if (inactivityTimer !== undefined) cancel(inactivityTimer);
    inactivityTimer = schedule(stop, inactivityMs);
  };

  const dispose = () => {
    if (disposed) return;
    stop();
    disposed = true;
  };

  return { onUserEdit, stop, dispose };
}
