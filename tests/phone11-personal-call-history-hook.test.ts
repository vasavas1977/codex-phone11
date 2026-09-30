import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[] },
  user: { id: 1 } as { id: number } | null,
  listeners: new Set<() => void>(),
  appState: "active",
  appListeners: new Set<(state: string) => void>(),
  query: vi.fn(),
}));

function sameDependencies(left?: unknown[], right?: unknown[]) {
  return Boolean(left && right && left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index])));
}

vi.mock("react", () => ({
  useRef(initial: unknown) {
    const frame = m.frame;
    const index = frame.index++;
    return (frame.values[index] ??= { current: initial });
  },
  useState(initial: unknown) {
    const frame = m.frame;
    const index = frame.index++;
    if (!(index in frame.values))
      frame.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [frame.values[index], (value: unknown) => {
      frame.values[index] = typeof value === "function"
        ? (value as (current: unknown) => unknown)(frame.values[index])
        : value;
    }];
  },
  useCallback(callback: unknown, dependencies?: unknown[]) {
    const frame = m.frame;
    const index = frame.index++;
    const previous = frame.values[index] as { dependencies?: unknown[]; callback?: unknown } | undefined;
    if (sameDependencies(previous?.dependencies, dependencies)) return previous?.callback;
    frame.values[index] = { dependencies, callback };
    return callback;
  },
  useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
    const frame = m.frame;
    const index = frame.index++;
    const previous = frame.values[index] as { dependencies?: unknown[]; cleanup?: () => void } | undefined;
    if (sameDependencies(previous?.dependencies, dependencies)) return;
    previous?.cleanup?.();
    const cleanup = effect();
    frame.values[index] = { dependencies, ...(typeof cleanup === "function" ? { cleanup } : {}) };
  },
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() { return m.appState; },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      m.appListeners.add(listener);
      return { remove: () => m.appListeners.delete(listener) };
    },
  },
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.user }),
  addAuthChangeListener: (listener: () => void) => {
    m.listeners.add(listener);
    return () => m.listeners.delete(listener);
  },
}));
vi.mock("../lib/trpc", () => ({
  createTRPCClient: () => ({ pbx: { selfService: { callHistory: { query: m.query } } } }),
}));

import { usePersonalCallHistory } from "../hooks/use-personal-call-history";

function useRenderHistory(tenantId: number | undefined = 7, enabled = true) {
  m.frame.index = 0;
  return usePersonalCallHistory(tenantId, enabled);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const item = (id: number, startedAt = "2026-09-30T09:00:00.123456Z") => ({
  id,
  call_uuid: `uuid-${id}`,
  direction: "inbound" as const,
  disposition: "missed",
  caller_number: "+6620000001",
  callee_number: "3101",
  callback_number: "+6620000001",
  total_duration_seconds: 0,
  started_at: startedAt,
});

beforeEach(() => {
  m.frame = { index: 0, values: [] };
  m.user = { id: 1 };
  m.listeners.clear();
  m.appState = "active";
  m.appListeners.clear();
  m.query.mockReset();
});

it("requests only the selected tenant and preserves the fractional UTC cursor unchanged", async () => {
  const first = item(50);
  const cursor = { startedAt: "2026-09-30T09:00:00.123456Z", id: 50 };
  m.query.mockResolvedValueOnce({ tenantId: 7, items: [first], nextCursor: cursor })
    .mockResolvedValueOnce({ tenantId: 7, items: [item(50), item(49)], nextCursor: null });
  const history = useRenderHistory(7, true);
  await history.reload();
  await history.loadMore();
  expect(m.query).toHaveBeenNthCalledWith(1, { tenantId: 7, limit: 50 });
  expect(m.query).toHaveBeenNthCalledWith(2, { tenantId: 7, limit: 50, cursor });
  expect(useRenderHistory(7, true).items.map((row) => row.id)).toEqual([50, 49]);
});

it("clears synchronously on tenant changes and drops an old tenant response", async () => {
  const request = deferred<any>();
  m.query.mockReturnValueOnce(request.promise);
  const old = useRenderHistory(7, true);
  const pending = old.reload();
  expect(useRenderHistory(8, true).items).toEqual([]);
  request.resolve({ tenantId: 7, items: [item(7)], nextCursor: null });
  await pending;
  expect(useRenderHistory(8, true).items).toEqual([]);
});

it("clears on logout and discards an in-flight account response", async () => {
  const request = deferred<any>();
  m.query.mockReturnValueOnce(request.promise);
  const history = useRenderHistory(7, true);
  const pending = history.reload();
  m.user = null;
  m.listeners.forEach((listener) => listener());
  expect(useRenderHistory(7, true).items).toEqual([]);
  request.resolve({ tenantId: 7, items: [item(7)], nextCursor: null });
  await pending;
  expect(useRenderHistory(7, true).items).toEqual([]);
});

it("does not accept a late response after the app backgrounds", async () => {
  const request = deferred<any>();
  m.query.mockReturnValueOnce(request.promise);
  const history = useRenderHistory(7, true);
  const pending = history.reload();
  m.appState = "background";
  m.appListeners.forEach((listener) => listener("background"));
  request.resolve({ tenantId: 7, items: [item(7)], nextCursor: null });
  await pending;
  expect(useRenderHistory(7, true).items).toEqual([]);
});

it("keeps the Workspace source memory-only and reports unavailable server errors", async () => {
  m.query.mockRejectedValue(new Error("private CDR details"));
  const history = useRenderHistory(7, true);
  await history.reload();
  const current = useRenderHistory(7, true);
  expect(current.items).toEqual([]);
  expect(current.error).toContain("choose This device");
  expect(current.error).not.toContain("private");
});

it("reports missing workspace scope instead of treating it as an empty history", async () => {
  m.frame.index = 0;
  const noAccount = usePersonalCallHistory(undefined, true);
  expect(noAccount.items).toEqual([]);
  expect(noAccount.error).toContain("Select or restore an active workspace phone account");
  await noAccount.reload();
  expect(m.query).not.toHaveBeenCalled();

  m.user = null;
  m.frame.index = 0;
  const signedOut = usePersonalCallHistory(undefined, true);
  expect(signedOut.items).toEqual([]);
  expect(signedOut.error).toContain("Sign in");
  expect(m.query).not.toHaveBeenCalled();
});
