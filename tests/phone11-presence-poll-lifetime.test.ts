import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetPresenceOwner, useChatPresenceStore, usePresencePolling } from "../lib/chat/presence-store";

const m = vi.hoisted(() => ({
  owner: { id: 1 } as { id: number; name?: string } | null,
  effects: [] as (() => void | (() => void))[],
  listeners: new Set<() => void>(),
  capability: vi.fn(),
  presence: vi.fn(),
}));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void | (() => void)) => m.effects.push(effect),
}));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.owner }),
  addAuthChangeListener: (listener: () => void) => {
    m.listeners.add(listener);
    return () => m.listeners.delete(listener);
  },
}));
vi.mock("../lib/chat/transport", () => ({
  createChatTransport: () => ({ presenceCapability: m.capability, presence: m.presence }),
}));


let cleanup: (() => void) | undefined;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function PresencePollingProbe() {
  usePresencePolling(10, [2]);
  cleanup = m.effects.splice(0)[0]?.() || undefined;
}
function auth(owner: typeof m.owner) {
  m.owner = owner;
  m.listeners.forEach(listener => listener());
}
function freshRows() {
  resetPresenceOwner(1);
  useChatPresenceStore.getState().merge(1, 10, [2, 3], [
    { userId: 2, status: "in_meeting", available: true, lastSeenAt: 7 },
    { userId: 3, status: "away", available: true, lastSeenAt: 8 },
  ]);
}
function status() {
  return useChatPresenceStore.getState().byWorkspace[10]?.[2]?.status;
}

beforeEach(() => {
  vi.useFakeTimers();
  m.owner = { id: 1 };
  m.effects = [];
  m.listeners.clear();
  m.capability.mockReset().mockResolvedValue({ version: 2 });
  m.presence.mockReset().mockResolvedValue([
    { userId: 2, status: "available", available: true, lastSeenAt: 1 },
  ]);
  resetPresenceOwner(1);
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); });

it("merges a current authorized poll and releases its auth subscription on unmount", async () => {
  PresencePollingProbe(); await flush();
  expect(status()).toBe("available");
  expect(m.presence).toHaveBeenCalledWith(10, [2]);
  cleanup?.();
  expect(m.listeners.size).toBe(0);
});

it("clears only requested rows when current capability is unsupported", async () => {
  freshRows(); m.capability.mockResolvedValue({ version: 1 });
  PresencePollingProbe(); await flush();
  expect(status()).toBeUndefined();
  expect(useChatPresenceStore.getState().byWorkspace[10]?.[3]?.status).toBe("away");
  expect(m.presence).not.toHaveBeenCalled();
});

it.each(["unmount", "replacement", "retirement and return"])(
  "keeps fresh presence when unsupported capability settles after %s",
  async boundary => {
    const wait = deferred<{ version: number }>();
    m.capability.mockReturnValue(wait.promise);
    const owner = m.owner;
    PresencePollingProbe();
    if (boundary === "unmount") cleanup?.();
    else if (boundary === "replacement") auth({ id: 1 });
    else { auth(null); auth(owner); }
    freshRows();
    wait.resolve({ version: 1 }); await flush();
    expect(status()).toBe("in_meeting");
    expect(m.presence).not.toHaveBeenCalled();
  },
);

it.each(["replacement", "retirement and return"])(
  "does not start a presence request after capability settles across %s",
  async boundary => {
    const wait = deferred<{ version: number }>();
    m.capability.mockReturnValue(wait.promise);
    const owner = m.owner;
    PresencePollingProbe();
    if (boundary === "replacement") auth({ id: 1 });
    else { auth(null); auth(owner); }
    wait.resolve({ version: 2 }); await flush();
    expect(m.presence).not.toHaveBeenCalled();
  },
);

it.each(["success", "failure"])(
  "discards a pending row %s after transient auth retirement, even if the original object returns",
  async result => {
    const wait = deferred<unknown>();
    m.presence.mockReturnValue(wait.promise);
    const owner = m.owner;
    PresencePollingProbe(); await flush();
    expect(m.presence).toHaveBeenCalledOnce();
    auth(null); auth(owner); freshRows();
    if (result === "success") wait.resolve([
      { userId: 2, status: "offline", available: true, lastSeenAt: 1 },
    ]);
    else wait.reject(new Error("retired request"));
    await flush();
    expect(status()).toBe("in_meeting");
    vi.advanceTimersByTime(10_000); await flush();
    expect(m.presence).toHaveBeenCalledOnce();
  },
);

it("accepts a profile refresh within the same exact authenticated lifetime", async () => {
  const wait = deferred<unknown>();
  m.presence.mockReturnValue(wait.promise);
  PresencePollingProbe(); await flush();
  m.owner!.name = "Updated profile"; auth(m.owner);
  wait.resolve([{ userId: 2, status: "on_call", available: true, lastSeenAt: 3 }]);
  await flush();
  expect(status()).toBe("on_call");
});
