import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: storage }));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const event = (message: string) => ({ level: "info" as const, category: "call" as const, message });
const saved = (message: string) => ({ ...event(message), id: `saved-${message}`, timestamp: "2026-09-10T00:00:00.000Z" });
let disk: string | null;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); disk = null;
  storage.getItem.mockReset().mockImplementation(async () => disk);
  storage.setItem.mockReset().mockImplementation(async (_key, value) => { disk = value; });
  storage.removeItem.mockReset().mockImplementation(async () => { disk = null; });
});
const load = () => import("../lib/sip/diagnostics-store");
const messages = (value: string | null) => JSON.parse(value ?? "[]").map((entry: any) => entry.message);
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("ordered SIP diagnostic persistence", () => {
  it("serializes writes while keeping addEvent synchronous and immediately visible", async () => {
    const { useSipDiagnosticsStore: store, recordPersistentSipDiagnosticEvent: record } = await load();
    const firstWrite = deferred<void>();
    storage.setItem.mockImplementationOnce(async (_key, value) => { await firstWrite.promise; disk = value; });
    expect(store.getState().addEvent(event("first"))).toBeUndefined(); await tick();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const second = record(event("second")); store.getState().addEvent(event("third"));
    expect(store.getState().events.map(e => e.message)).toEqual(["third", "second", "first"]);
    await tick(); expect(storage.setItem).toHaveBeenCalledTimes(1);
    firstWrite.resolve(); await second; await store.getState().hydrateEvents();
    expect(messages(disk)).toEqual(["third", "second", "first"]);
  });

  it("merges a late startup read with events added during hydration instead of replacing them", async () => {
    const { useSipDiagnosticsStore: store } = await load();
    const read = deferred<string | null>(); storage.getItem.mockReturnValueOnce(read.promise);
    const hydration = store.getState().hydrateEvents(); await tick();
    store.getState().addEvent(event("during startup"));
    read.resolve(JSON.stringify([saved("previous run")])); await hydration; await store.getState().hydrateEvents();
    expect(store.getState().events.map(e => e.message)).toEqual(["during startup", "previous run"]);
    expect(messages(disk)).toEqual(["during startup", "previous run"]);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it("deduplicates overlapping startup persistence and hydration and retains the hundred newest events", async () => {
    const { useSipDiagnosticsStore: store } = await load();
    disk = JSON.stringify([saved("old")]);
    const firstHydration = store.getState().hydrateEvents();
    for (let index = 0; index < 105; index++) store.getState().addEvent(event(`new-${index}`));
    await firstHydration; await store.getState().hydrateEvents();
    expect(messages(disk)).toEqual(Array.from({ length: 100 }, (_, index) => `new-${104-index}`));
    expect(store.getState().events).toHaveLength(100);
    expect(new Set(store.getState().events.map(e => e.id)).size).toBe(100);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it("ignores an in-flight startup read invalidated by clear and persists only post-clear events", async () => {
    const { useSipDiagnosticsStore: store } = await load();
    const read = deferred<string | null>(); storage.getItem.mockReturnValueOnce(read.promise);
    const hydration = store.getState().hydrateEvents(); await tick();
    store.getState().addEvent(event("before clear")); store.getState().clearEvents();
    store.getState().addEvent(event("after clear"));
    read.resolve(JSON.stringify([saved("old disk")])); await hydration; await store.getState().hydrateEvents();
    expect(store.getState().events.map(e => e.message)).toEqual(["after clear"]);
    expect(messages(disk)).toEqual(["after clear"]);
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
  });

  it("orders removal after an already-running old write and before a new write", async () => {
    const { useSipDiagnosticsStore: store } = await load();
    const write = deferred<void>(); const order: string[] = [];
    storage.setItem.mockImplementationOnce(async (_key, value) => { order.push("old start"); await write.promise; disk = value; order.push("old finish"); });
    storage.removeItem.mockImplementation(async () => { order.push("clear"); disk = null; });
    store.getState().addEvent(event("old")); await tick();
    store.getState().clearEvents(); store.getState().addEvent(event("new"));
    await tick(); expect(storage.removeItem).not.toHaveBeenCalled();
    write.resolve(); await store.getState().hydrateEvents();
    expect(order).toEqual(["old start", "old finish", "clear"]); expect(messages(disk)).toEqual(["new"]);
  });

  it("cannot resurrect events from queued writes across repeated clears", async () => {
    const { useSipDiagnosticsStore: store, recordPersistentSipDiagnosticEvent: record } = await load();
    store.getState().addEvent(event("first generation")); store.getState().clearEvents();
    const oldPersistent = record(event("second generation")); store.getState().clearEvents();
    await oldPersistent; await store.getState().hydrateEvents();
    expect(store.getState().events).toEqual([]); expect(disk).toBeNull(); expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("does not let a hydration failure erase current events or poison later writes", async () => {
    const { useSipDiagnosticsStore: store, recordPersistentSipDiagnosticEvent: record } = await load();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      storage.getItem.mockRejectedValueOnce(new Error("private storage details"));
      disk = JSON.stringify([saved("previous run")]);
      await record(event("first")); expect(messages(disk)).toEqual(["previous run"]);
      expect(store.getState().hydrated).toBe(false);
      await record(event("second"));
      expect(messages(disk)).toEqual(["second", "first", "previous run"]); expect(store.getState().hydrated).toBe(true);
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
    } finally { warning.mockRestore(); }
  });

  it("keeps clear authoritative in memory even if removal fails, without reloading stale disk", async () => {
    const { useSipDiagnosticsStore: store, recordPersistentSipDiagnosticEvent: record } = await load();
    disk = JSON.stringify([saved("old disk")]); storage.removeItem.mockRejectedValueOnce(new Error("unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      store.getState().clearEvents(); await store.getState().hydrateEvents();
      expect(store.getState().events).toEqual([]); expect(storage.getItem).not.toHaveBeenCalled();
      await record(event("new")); expect(messages(disk)).toEqual(["new"]);
    } finally { warning.mockRestore(); }
  });
  it("recovers the serialized writer after a rejected write without losing queued entries", async () => {
    const { recordPersistentSipDiagnosticEvent: record } = await load();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      storage.setItem.mockRejectedValueOnce(new Error("unavailable"));
      await record(event("first")); await record(event("second"));
      expect(messages(disk)).toEqual(["second", "first"]);
    } finally { warning.mockRestore(); }
  });

});
