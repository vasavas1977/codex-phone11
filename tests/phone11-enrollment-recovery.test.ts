import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEnrollmentRecovery } from "../lib/notifications/enrollment-recovery";
import { createChatNotificationCoordinator, ChatNotificationSetupError, type NotificationIdentity } from "../lib/notifications/coordinator";
const cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(f => f()); vi.useRealTimers(); });
function fixture() {
  let identity: NotificationIdentity = { owner: {}, tenantId: 10, active: true, enabled: true };
  const deps = { identity: () => identity, permission: vi.fn(async (_explicit: boolean) => true), token: vi.fn(async () => "a".repeat(64)),
    register: vi.fn(async () => true), resolve: vi.fn(async () => null), open: vi.fn() };
  const coordinator = createChatNotificationCoordinator(deps);
  const recovery = createEnrollmentRecovery({ identity: deps.identity, refresh: explicit => coordinator.refresh(explicit) });
  const stop = () => { recovery.stop(); coordinator.stop(); }; cleanups.push(stop);
  return { deps, coordinator, recovery, stop, change: (next: Partial<NotificationIdentity>) => { identity = { ...identity, ...next }; recovery.invalidate(); coordinator.invalidate(); } };
}
it("recovers a transient enrollment failure while continuously active without another permission prompt", async () => {
  const f = fixture(); f.deps.register.mockRejectedValueOnce(new Error("offline"));
  expect(await f.recovery.refresh()).toEqual({ status: "unavailable", retryable: true });
  await vi.advanceTimersByTimeAsync(4999); expect(f.deps.register).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(f.deps.register).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(120000); expect(f.deps.register).toHaveBeenCalledTimes(2);
  expect(f.deps.permission.mock.calls.every(args => args[0] === false)).toBe(true);
});
it("backs off repeated network failures to once a minute instead of busy polling", async () => {
  const f = fixture(); f.deps.register.mockRejectedValue(new Error("network")); await f.recovery.refresh();
  let expected = 1;
  for (const delay of [5000, 15000, 30000, 60000, 60000]) {
    await vi.advanceTimersByTimeAsync(delay - 1); expect(f.deps.register).toHaveBeenCalledTimes(expected);
    await vi.advanceTimersByTimeAsync(1); expect(f.deps.register).toHaveBeenCalledTimes(++expected);
  }
});
it.each(["denied", "configuration", "authorization", "native-rejected"])("does not retry permanent %s failures", async kind => {
  const f = fixture();
  if (kind === "denied") f.deps.permission.mockResolvedValue(false);
  if (kind === "configuration") f.deps.register.mockResolvedValue(false);
  if (kind === "authorization") f.deps.register.mockRejectedValue({ data: { code: "FORBIDDEN" } });
  if (kind === "native-rejected") f.deps.token.mockRejectedValue(new ChatNotificationSetupError(false));
  await f.recovery.refresh(); const count = f.deps.permission.mock.calls.length;
  await vi.advanceTimersByTimeAsync(300000); expect(f.deps.permission).toHaveBeenCalledTimes(count);
});
it.each([{ active: false }, { owner: null }, { owner: {} }, { tenantId: 20 }, { enabled: false }])("cancels scheduled retries after context changes (%#)", async change => {
  const f = fixture(); f.deps.register.mockRejectedValue(new Error("offline")); await f.recovery.refresh();
  f.change(change); await vi.advanceTimersByTimeAsync(120000); expect(f.deps.register).toHaveBeenCalledTimes(1);
});
it("a late failed old request cannot schedule work in a replacement account", async () => {
  const f = fixture(); let reject!: (e: Error) => void;
  f.deps.register.mockReturnValueOnce(new Promise((_, no) => { reject = no; })); const old = f.recovery.refresh();
  await vi.advanceTimersByTimeAsync(0); f.change({ owner: {} }); await f.recovery.refresh(); reject(new Error("old failure")); await old;
  await vi.advanceTimersByTimeAsync(120000); expect(f.deps.register).toHaveBeenCalledTimes(2);
});
it("manual success supersedes a scheduled retry and unmount removes retry work", async () => {
  const f = fixture(); f.deps.register.mockRejectedValueOnce(new Error("offline")); await f.recovery.refresh();
  expect(await f.recovery.refresh(true)).toEqual({ status: "enabled" });
  await vi.advanceTimersByTimeAsync(10000); expect(f.deps.register).toHaveBeenCalledTimes(2);
  f.deps.register.mockRejectedValue(new Error("offline")); await f.recovery.refresh(); f.stop();
  await vi.advanceTimersByTimeAsync(120000); expect(f.deps.register).toHaveBeenCalledTimes(3);
});
