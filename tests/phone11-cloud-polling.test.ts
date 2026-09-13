import { afterEach, expect, it, vi } from "vitest";
import { startRecordingPoll } from "../lib/cloud-recordings/polling";
afterEach(() => vi.useRealTimers());
it("polls only pending foreground work and stops at fixed deadline and unmount", () => {
  vi.useFakeTimers();
  let active = true,
    pending = true;
  let notify = () => {};
  const refresh = vi.fn();
  const dispose = startRecordingPoll({
    active: () => active,
    pending: () => pending,
    refresh,
    subscribe: (f) => {
      notify = f;
      return vi.fn();
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
  pending = false;
  vi.advanceTimersByTime(10000);
  expect(refresh).toHaveBeenCalledTimes(2);
  pending = true;
  vi.advanceTimersByTime(300000);
  const count = refresh.mock.calls.length;
  expect(count).toBeLessThan(30);
  vi.advanceTimersByTime(60000);
  expect(refresh).toHaveBeenCalledTimes(count);
  dispose();
  vi.advanceTimersByTime(60000);
  expect(refresh).toHaveBeenCalledTimes(count);
});
it("never polls an initially background or logged out screen", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const dispose = startRecordingPoll({
    active: () => false,
    pending: () => true,
    refresh,
    subscribe: () => vi.fn(),
  });
  vi.advanceTimersByTime(600000);
  expect(refresh).not.toHaveBeenCalled();
  dispose();
});
