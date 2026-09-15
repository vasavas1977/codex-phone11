import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChatStore, type ChatTransport } from "../lib/chat/state";
import { startChatForegroundRefresh } from "../lib/chat/foreground";
const page = (tenant = 10, unreadCount = 2) => ({ workspace: { id: tenant, name: "Work" }, workspaces: [{ id: tenant, name: "Work" }], channels: [{ id: "room", kind: "group" as const, name: "Team", memberIds: [1, 2], lastMessage: null, lastMessageAt: 1, unreadCount }] });
function deferred() { let resolve!: (value: ReturnType<typeof page>) => void; let reject!: (error: unknown) => void; const promise = new Promise<ReturnType<typeof page>>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.useRealTimers(); });
function setup(options: { signedOut?: boolean; inactive?: boolean; list?: ChatTransport["list"] } = {}) {
  let auth = { user: options.signedOut ? null : { id: 1 }, loading: false }; let active = !options.inactive;
  const authListeners = new Set<() => void>(), activityListeners = new Set<() => void>();
  const api: ChatTransport = { list: vi.fn(options.list || (async () => page())), directory: vi.fn(async () => []), create: vi.fn(), history: vi.fn(), search: vi.fn(), send: vi.fn(), read: vi.fn() };
  const store = createChatStore(api);
  const stop = startChatForegroundRefresh({ auth: () => auth, active: () => active, state: store.getState,
    onAuth: f => { authListeners.add(f); return () => authListeners.delete(f); },
    onActivity: f => { activityListeners.add(f); return () => activityListeners.delete(f); } });
  cleanups.push(stop);
  return { api, store, stop, authListeners, activityListeners,
    login: (id: number | null, loading = false) => { auth = { user: id ? { id } : null, loading }; authListeners.forEach(f => f()); },
    activity: (value: boolean) => { active = value; activityListeners.forEach(f => f()); } };
}
it("refreshes real unread state without a focused Team screen and never marks it read", async () => {
  const { store, api } = setup(); await vi.advanceTimersByTimeAsync(0);
  expect(store.getState().channels[0].unreadCount).toBe(2);
  vi.mocked(api.list).mockResolvedValue(page(10, 7)); await vi.advanceTimersByTimeAsync(5000);
  expect(store.getState().channels[0].unreadCount).toBe(7); expect(api.list).toHaveBeenCalledTimes(2);
  expect(api.read).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled(); expect(api.history).not.toHaveBeenCalled();
});
it("waits for authenticated active state, immediately refreshes on return, and stops on logout", async () => {
  const x = setup({ signedOut: true }); await vi.advanceTimersByTimeAsync(10000); expect(x.api.list).not.toHaveBeenCalled();
  x.activity(false); x.login(1); await vi.advanceTimersByTimeAsync(10000); expect(x.api.list).not.toHaveBeenCalled();
  x.activity(true); await vi.advanceTimersByTimeAsync(0); expect(x.api.list).toHaveBeenCalledTimes(1);
  x.login(null); await vi.advanceTimersByTimeAsync(10000); expect(x.api.list).toHaveBeenCalledTimes(1); expect(x.store.getState().channels).toEqual([]);
});
it("does not overlap slow requests even with screen-triggered refreshes", async () => {
  const wait = deferred(), x = setup({ list: () => wait.promise });
  await x.store.getState().loadChannels(); await vi.advanceTimersByTimeAsync(20000); expect(x.api.list).toHaveBeenCalledTimes(1);
  wait.resolve(page()); await vi.advanceTimersByTimeAsync(0); expect(x.store.getState().loading).toBe(false);
});
it("cancels background results and an old rejection cannot clear a new refresh", async () => {
  const old = deferred(), next = deferred(); const x = setup({ list: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise) });
  x.activity(false); expect(x.store.getState().loading).toBe(false); x.activity(true); expect(x.store.getState().loading).toBe(true);
  old.reject({ data: { code: "FORBIDDEN" } }); await vi.advanceTimersByTimeAsync(0);
  expect(x.store.getState().loading).toBe(true); expect(x.store.getState().error).toBeNull();
  next.resolve(page(10, 5)); await vi.advanceTimersByTimeAsync(0); expect(x.store.getState().channels[0].unreadCount).toBe(5);
});
it("discards old-owner responses and starts the new owner's own request", async () => {
  const old = deferred(), next = deferred(); const x = setup({ list: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise) });
  x.login(2); next.resolve(page(20, 3)); await vi.advanceTimersByTimeAsync(0); old.resolve(page(10, 99)); await vi.advanceTimersByTimeAsync(0);
  expect(x.store.getState().userId).toBe(2); expect(x.store.getState().workspace?.id).toBe(20); expect(x.store.getState().channels[0].unreadCount).toBe(3);
});
it("same-user session replacement cancels the old request without losing drafts", async () => {
  const x = setup(); await vi.advanceTimersByTimeAsync(0); x.store.getState().setDraft("room", "Keep me");
  const old = deferred(), next = deferred(); vi.mocked(x.api.list).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await vi.advanceTimersByTimeAsync(5000); x.login(1); next.resolve(page(10, 4)); await vi.advanceTimersByTimeAsync(0); old.resolve(page(10, 99)); await vi.advanceTimersByTimeAsync(0);
  expect(x.store.getState().drafts.room).toBe("Keep me"); expect(x.store.getState().channels[0].unreadCount).toBe(4);
});
it("uses the current pending workspace rather than restoring an old timer selection", async () => {
  const x = setup(); await vi.advanceTimersByTimeAsync(0); const old = deferred(), next = deferred();
  vi.mocked(x.api.list).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise).mockResolvedValue(page(20));
  await vi.advanceTimersByTimeAsync(5000); const selection = x.store.getState().loadChannels(20);
  old.resolve(page(10, 99)); await vi.advanceTimersByTimeAsync(0); next.resolve(page(20, 5)); await selection;
  await vi.advanceTimersByTimeAsync(5000); expect(x.api.list).toHaveBeenLastCalledWith(20); expect(x.store.getState().workspace?.id).toBe(20);
});
it("keeps cached counts on network failure then recovers on the next interval", async () => {
  const x = setup(); await vi.advanceTimersByTimeAsync(0); vi.mocked(x.api.list).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(page(10, 6));
  await vi.advanceTimersByTimeAsync(5000); expect(x.store.getState().channels[0].unreadCount).toBe(2);
  await vi.advanceTimersByTimeAsync(5000); expect(x.store.getState().channels[0].unreadCount).toBe(6); expect(x.store.getState().error).toBeNull();
});
it("cleanup removes listeners/timers and cannot publish its late response", async () => {
  const wait = deferred(), x = setup({ list: () => wait.promise }); x.stop(); wait.resolve(page()); await vi.advanceTimersByTimeAsync(20000);
  expect(x.store.getState().channels).toEqual([]); expect(x.api.list).toHaveBeenCalledTimes(1); expect(x.authListeners.size).toBe(0); expect(x.activityListeners.size).toBe(0);
});
it("background list cancellation preserves an in-flight send and the next draft; logout rejects its late result", async () => {
  const x = setup(); await vi.advanceTimersByTimeAsync(0);
  let accept!: (message: any) => void;
  vi.mocked(x.api.send).mockImplementation(() => new Promise(resolve => { accept = resolve; }));
  const sending = x.store.getState().sendMessage("room", "First message"); await vi.advanceTimersByTimeAsync(0);
  const pending = x.store.getState().messages.room[0]; x.store.getState().setDraft("room", "Next draft");
  const list = deferred(); vi.mocked(x.api.list).mockReturnValueOnce(list.promise);
  await vi.advanceTimersByTimeAsync(5000); x.activity(false); list.resolve(page(10, 99)); await vi.advanceTimersByTimeAsync(0);
  expect(x.store.getState().drafts.room).toBe("Next draft"); expect(x.store.getState().messages.room[0].status).toBe("sending");
  accept({ ...pending, id: "saved", status: "sent", sequence: 1 }); await sending;
  expect(x.store.getState().messages.room[0].status).toBe("sent"); expect(x.store.getState().drafts.room).toBe("Next draft");
  const second = x.store.getState().sendMessage("room", "Later message"); await vi.advanceTimersByTimeAsync(0);
  const nextPending = x.store.getState().messages.room[1]; x.login(null);
  accept({ ...nextPending, id: "later-saved", status: "sent", sequence: 2 }); await second;
  expect(x.store.getState().messages).toEqual({}); expect(x.store.getState().drafts).toEqual({}); expect(x.api.send).toHaveBeenCalledTimes(2);
});
