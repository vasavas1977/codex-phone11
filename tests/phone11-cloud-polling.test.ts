import { afterEach, expect, it, vi } from "vitest";
import { startRecordingPoll } from "../lib/cloud-recordings/polling";
afterEach(() => vi.useRealTimers());
it("polls active foreground work and keeps one fixed fifteen-minute budget", () => {
  vi.useFakeTimers();
  let active = true,
    interval: number | undefined = 10_000;
  let notify = () => {};
  const refresh = vi.fn();
  const unsubscribe = vi.fn();
  const dispose = startRecordingPoll({
    active: () => active,
    intervalMs: () => interval,
    shouldRefresh: () => interval !== undefined,
    refresh,
    subscribe: (f) => {
      notify = f;
      return unsubscribe;
    },
  });
  vi.advanceTimersByTime(10000);
  expect(refresh).toHaveBeenCalledTimes(1);
  active = false;
  notify();
  vi.advanceTimersByTime(30000);
  expect(refresh).toHaveBeenCalledTimes(1);
  active = true;
  notify();
  vi.advanceTimersByTime(10000);
  expect(refresh).toHaveBeenCalledTimes(2);
  interval = undefined;
  notify();
  vi.advanceTimersByTime(10000);
  expect(refresh).toHaveBeenCalledTimes(2);
  interval = 10_000;
  notify();
  vi.advanceTimersByTime(849_999);
  const count = refresh.mock.calls.length;
  expect(count).toBeGreaterThan(2);
  notify();
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(count);
  dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(60000);
  expect(refresh).toHaveBeenCalledTimes(count);
});
it("recovers a first-load failed result without remounting, then stops after ready", () => {
  vi.useFakeTimers();
  let status: "loading" | "failed" | "ready" = "loading";
  const refresh = vi.fn(() => {
    status = "ready";
  });
  const dispose = startRecordingPoll({
    active: () => true,
    intervalMs: () =>
      status === "loading" ? 1_000 : status === "failed" ? 60_000 : undefined,
    shouldRefresh: () => status === "failed",
    refresh,
    subscribe: () => vi.fn(),
  });
  status = "failed";
  vi.advanceTimersByTime(1_000);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(59_999);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(15 * 60_000);
  expect(refresh).toHaveBeenCalledOnce();
  dispose();
});
it("waits for an in-flight detail request without replacing it, then starts polling", () => {
  vi.useFakeTimers();
  let loading = true;
  const refresh = vi.fn();
  const dispose = startRecordingPoll({
    active: () => true,
    intervalMs: () => (loading ? 1_000 : 10_000),
    shouldRefresh: () => !loading,
    refresh,
    subscribe: () => vi.fn(),
  });
  vi.advanceTimersByTime(1_000);
  expect(refresh).not.toHaveBeenCalled();
  loading = false;
  vi.advanceTimersByTime(11_000);
  expect(refresh).toHaveBeenCalledOnce();
  dispose();
});
it("never polls an initially background or logged out screen", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const dispose = startRecordingPoll({
    active: () => false,
    intervalMs: () => 10_000,
    shouldRefresh: () => true,
    refresh,
    subscribe: () => vi.fn(),
  });
  vi.advanceTimersByTime(600000);
  expect(refresh).not.toHaveBeenCalled();
  dispose();
});
