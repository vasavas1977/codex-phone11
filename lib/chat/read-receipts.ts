export const READ_RECEIPT_DWELL_MS = 800;
export const READ_RECEIPT_VIEW_AREA_PERCENT = 60;

export function createReadReceiptRequestGuard<Scope>(options: {
  currentScope: () => Scope | null;
  currentTarget: () => string | null;
  sameScope: (left: Scope | null, right: Scope | null) => boolean;
}) {
  let revision = 0;
  return {
    begin(scope: Scope, targetId: string) { return { revision: ++revision, scope, targetId }; },
    invalidate() { revision++; },
    current(ticket: { revision: number; scope: Scope; targetId: string }) {
      return ticket.revision === revision && options.currentTarget() === ticket.targetId &&
        options.sameScope(options.currentScope(), ticket.scope);
    },
  };
}

export function createReadReceiptSummaryLoader<Scope, Row>(options: {
  load: (scope: Scope, ids: string[]) => Promise<Row[]>;
  current: (scope: Scope) => boolean;
  apply: (scope: Scope, rows: Row[]) => void;
  clear: (scope: Scope, ids: string[]) => void;
  latest: () => { scope: Scope; ids: string[] } | null;
  sameScope: (left: Scope, right: Scope) => boolean;
}) {
  let revision = 0, inFlight = false, pending = false;
  let active: { scope: Scope; idsKey: string } | null = null;
  const request = (scope: Scope, ids: string[]) => {
    if (!ids.length) return;
    const requested = ids.slice(0, 50), idsKey = requested.join("\u0000");
    if (inFlight) {
      pending = true;
      // Repeated polling of the same visible set must not invalidate a slow,
      // otherwise-current response. A different scope/set still invalidates it.
      if (!active || !options.sameScope(active.scope, scope) || active.idsKey !== idsKey) revision++;
      return;
    }
    const captured = ++revision;
    inFlight = true;
    active = { scope, idsKey };
    void options.load(scope, requested).then(rows => {
      if (captured === revision && options.current(scope)) options.apply(scope, rows);
    }).catch(() => {
      if (captured === revision && options.current(scope)) options.clear(scope, requested);
    }).finally(() => {
      inFlight = false;
      active = null;
      if (!pending) return;
      pending = false;
      const latest = options.latest();
      if (latest) request(latest.scope, latest.ids);
    });
  };
  return { request, replaceScope() { revision++; pending = false; active = null; } };
}

type Timer = ReturnType<typeof setTimeout>;
type Scheduler = { set: (fn: () => void, ms: number) => Timer; clear: (timer: Timer) => void };

/**
 * Turns viewport-relative visibility into bounded, explicit acknowledgements.
 * Scope replacement and obscuring overlays synchronously cancel every pending
 * dwell. Completed IDs are retained only for the current authenticated scope.
 */
export function createReadReceiptController<Scope>(options: {
  dwellMs?: number;
  retryMs?: number;
  maxAttempts?: number;
  capture: () => Scope | null;
  send: (messageIds: string[], scope: Scope) => Promise<unknown>;
  current: (scope: Scope) => boolean;
  scheduler?: Scheduler;
}) {
  const scheduler = options.scheduler || { set: (fn, ms) => setTimeout(fn, ms), clear: clearTimeout };
  const dwellMs = options.dwellMs ?? READ_RECEIPT_DWELL_MS;
  const retryMs = options.retryMs ?? 5_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const timers = new Map<string, Timer>();
  const acknowledged = new Set<string>();
  let latestVisible: { ids: string[]; scope: Scope } | null = null;
  let enabled = false;
  let generation = 0;
  const cancel = () => {
    generation++;
    timers.forEach(timer => scheduler.clear(timer));
    timers.clear();
  };
  const schedule = (id: string, attempt = 1, capturedScope?: Scope) => {
    if (!enabled || acknowledged.has(id) || timers.has(id)) return;
    const scope = capturedScope ?? options.capture();
    if (!scope) return;
    const captured = generation;
    timers.set(id, scheduler.set(() => {
      timers.delete(id);
      if (!enabled || captured !== generation || !options.current(scope)) return;
      // The server still validates every id and generates the timestamp.
      void options.send([id], scope).then(() => {
        if (captured === generation && options.current(scope)) acknowledged.add(id);
      }).catch(() => {
        // Missing endpoints/migrations and transient outages both fail closed.
        // Retry only a bounded number of times so an older server is not polled
        // indefinitely, while a short outage can recover without reopening chat.
        if (captured === generation && enabled && attempt < maxAttempts && options.current(scope)) {
          timers.set(id, scheduler.set(() => {
            timers.delete(id);
            if (captured === generation && options.current(scope)) schedule(id, attempt + 1, scope);
          }, retryMs * attempt));
        }
      });
    }, dwellMs));
  };
  return {
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) cancel();
      else if (latestVisible && options.current(latestVisible.scope)) latestVisible.ids.forEach(id => schedule(id, 1, latestVisible!.scope));
    },
    visible(ids: string[]) {
      const scope = options.capture();
      if (!scope) { latestVisible = null; return; }
      if (latestVisible && !options.current(latestVisible.scope)) cancel();
      latestVisible = { ids, scope };
      if (!enabled || !options.current(scope)) return;
      const current = new Set(ids);
      for (const [id, timer] of timers) if (!current.has(id)) { scheduler.clear(timer); timers.delete(id); }
      current.forEach(id => schedule(id, 1, scope));
    },
    replaceScope() {
      cancel(); acknowledged.clear();
      if (enabled && latestVisible && options.current(latestVisible.scope)) latestVisible.ids.forEach(id => schedule(id, 1, latestVisible!.scope));
    },
    dispose() { enabled = false; cancel(); acknowledged.clear(); latestVisible = null; },
  };
}
