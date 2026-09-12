import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  data: new Map<string, string>(), listeners: new Set<() => void>(),
  getItem: vi.fn(), setItem: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: mock.getItem, setItem: mock.setItem } }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: mock.user }),
  addAuthChangeListener: (fn: () => void) => { mock.listeners.add(fn); return () => mock.listeners.delete(fn); },
}));
import { useCallHistoryStore as store, historyDuration, isMissedCall, mergeHistory, callNumber, importCompletedWakeCalls, type CallHistoryEntry } from "../lib/sip/call-history";
import { useSipCallStore as calls } from "../lib/sip/call-store";

const row = (overrides: Partial<CallHistoryEntry> = {}): CallHistoryEntry => ({
  id: "a", ownerUserId: 1, number: "2002", direction: "outbound", startedAt: 1000, updatedAt: 1000, ...overrides,
});
const flush = () => store.getState().reload();
beforeEach(async () => {
  await flush();
  mock.data.clear(); mock.user = { id: 1 };
  mock.getItem.mockReset().mockImplementation(async (key: string) => mock.data.get(key) ?? null);
  mock.setItem.mockReset().mockImplementation(async (key: string, value: string) => { mock.data.set(key, value); });
  store.setState({ ownerUserId: null, entries: [], loading: false, error: null });
  calls.setState({ activeCalls: {}, incomingCall: null });
});

describe("real call history", () => {
  it("persists and reloads without a sample list or fixed record limit", async () => {
    for (let i = 0; i < 110; i++) store.getState().upsert(row({ id: String(i), startedAt: i }));
    await flush();
    store.setState({ entries: [] }); await flush();
    expect(store.getState().entries).toHaveLength(110);
    expect(store.getState().entries[0].id).toBe("109");
  });
  it("merges updates, retaining the newest version and newest-first order", () => {
    expect(mergeHistory([row()], [row({ endedAt: 5000, updatedAt: 5000 })])).toEqual([row({ endedAt: 5000, updatedAt: 5000 })]);
  });
  it("uses answered time, not ringing time, for duration", () => {
    expect(historyDuration(row({ answeredAt: 10000, endedAt: 25500 }))).toBe(15);
    expect(historyDuration(row({ endedAt: 25500 }))).toBe(0);
    expect(historyDuration(row({ answeredAt: 30000, endedAt: 25500 }))).toBe(0);
  });
  it("never marks unanswered outgoing or interrupted incoming calls as missed", () => {
    expect(isMissedCall(row({ endedAt: 5000 }))).toBe(false);
    expect(isMissedCall(row({ direction: "inbound" }))).toBe(false);
    expect(isMissedCall(row({ direction: "inbound", endedAt: 5000 }))).toBe(true);
    expect(callNumber('Test <sip:+6612345@example.test>')).toBe("+6612345");
  });
  it("hides history immediately on account switch and restores only its owner", async () => {
    store.getState().upsert(row()); await flush();
    mock.user = { id: 2 }; mock.listeners.forEach(fn => fn());
    expect(store.getState().entries).toEqual([]); await flush();
    store.getState().upsert(row({ id: "b", ownerUserId: 2 })); await flush();
    mock.user = { id: 1 }; mock.listeners.forEach(fn => fn()); await flush();
    expect(store.getState().entries.map(x => x.id)).toEqual(["a"]);
    mock.user = null; mock.listeners.forEach(fn => fn());
    expect(store.getState().entries).toEqual([]);
  });
  it("does not overwrite a fresh call with a delayed storage read", async () => {
    let release!: (value: string | null) => void;
    mock.getItem.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const loading = flush(); await Promise.resolve(); await Promise.resolve();
    store.getState().upsert(row()); release(null); await loading; await flush();
    expect(store.getState().entries.map(x => x.id)).toEqual(["a"]);
  });
  it("keeps a failed save visible and reports the failure", async () => {
    mock.setItem.mockRejectedValueOnce(new Error("disk full"));
    store.getState().upsert(row());
    await vi.waitFor(() => expect(store.getState().error).toContain("could not be saved"));
    expect(store.getState().entries).toHaveLength(1);
  });
  it("records native call lifecycle once and allows reused native IDs", async () => {
    const native = { getId: () => "1", getState: () => "PJSIP_INV_STATE_CONFIRMED" };
    calls.getState().addOutgoingCall(native, "sip:2002@example.test");
    calls.getState().addOutgoingCall(native, "sip:2002@example.test");
    calls.getState().updateCallState(native);
    calls.getState().terminateCall("1"); calls.getState().terminateCall("1");
    await flush();
    expect(store.getState().entries).toHaveLength(1);
    expect(store.getState().entries[0].answeredAt).toBeDefined();
    expect(store.getState().entries[0].endedAt).toBeDefined();
    calls.getState().addOutgoingCall(native, "2003"); calls.getState().terminateCall("1");
    await flush(); expect(store.getState().entries).toHaveLength(2);
  });
  it("records missed incoming calls and ignores unknown states", async () => {
    const native = { getId: () => "2", getRemoteUri: () => "sip:2003@example.test", getState: () => "unknown" };
    calls.getState().setIncomingCall(native); calls.getState().updateCallState(native);
    calls.getState().terminateCall("2"); await flush();
    expect(isMissedCall(store.getState().entries[0])).toBe(true);
  });
});

describe("native completed call import", () => {
  const id = "native-wake:11111111-1111-4111-8111-111111111111";
  it("merges a native-only completed call durably and retry is idempotent", async () => {
    const native = row({ id, direction: "inbound", startedAt: 100, answeredAt: 200, endedAt: 500, updatedAt: 500 });
    await importCompletedWakeCalls([native], 1, () => true);
    await importCompletedWakeCalls([native], 1, () => true);
    expect(JSON.parse(mock.data.get("phone11_call_history_v1_user_1")!)).toHaveLength(1);
    expect(store.getState().entries[0]).toMatchObject({ id, answeredAt: 200, endedAt: 500 });
  });
  it("reconciles the same live wake ID using authoritative native times", async () => {
    store.getState().upsert(row({ id, startedAt: 110, answeredAt: 220, endedAt: 600, updatedAt: 600 }));
    await flush();
    await importCompletedWakeCalls([row({ id, startedAt: 100, answeredAt: 200, endedAt: 500, updatedAt: 500 })], 1, () => true);
    store.getState().upsert(row({ id, startedAt: 110, updatedAt: 900 })); await flush();
    expect(store.getState().entries).toHaveLength(1);
    expect(store.getState().entries[0]).toMatchObject({ startedAt: 100, answeredAt: 200, endedAt: 500 });
  });
  it("rejects disk failure and owner change instead of authorizing ack", async () => {
    mock.setItem.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(importCompletedWakeCalls([row({ id, endedAt: 2000 })], 1, () => true)).rejects.toThrow();
    await expect(importCompletedWakeCalls([row({ id, endedAt: 2000 })], 1, () => false)).rejects.toThrow("owner changed");
    expect(mock.data.has("phone11_call_history_v1_user_1")).toBe(false);
  });
});
