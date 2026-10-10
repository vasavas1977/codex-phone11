import { afterEach, expect, it, vi } from "vitest";
import type { BrowserMeetingSession } from "./browser-session";
import {
  clearActiveNativeMeeting, clearNativeMeetingForAuth, getActiveNativeMeeting,
  setActiveNativeMeeting, subscribeNativeMeetingRegistry, type ActiveNativeMeeting,
} from "./native-session-registry";

function meeting(leave = vi.fn(async () => {})): ActiveNativeMeeting {
  return {
    ownerId: 11, session: {} as BrowserMeetingSession, room: undefined,
    receiveOnly: false, wasInterruptedBySip: false, leave,
  };
}
afterEach(() => {
  const retained = getActiveNativeMeeting();
  if (retained) clearActiveNativeMeeting(retained);
});

it("hides a retiring room immediately while retaining exact cleanup custody", async () => {
  let finish!: () => void;
  const leave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const old = meeting(leave);
  setActiveNativeMeeting(old);
  const cleanup = clearNativeMeetingForAuth();
  expect(getActiveNativeMeeting(11)).toBeUndefined();
  expect(getActiveNativeMeeting()).toBe(old);
  await Promise.resolve();
  expect(leave).toHaveBeenCalledOnce();
  finish();
  await cleanup;
  expect(getActiveNativeMeeting()).toBeUndefined();
});

it("retains failed cleanup hidden and retries the same lifecycle", async () => {
  const leave = vi.fn().mockRejectedValueOnce(new Error("stop failed")).mockResolvedValue(undefined);
  const old = meeting(leave);
  setActiveNativeMeeting(old);
  await expect(clearNativeMeetingForAuth()).rejects.toThrow("stop failed");
  expect(getActiveNativeMeeting()).toBe(old);
  expect(getActiveNativeMeeting(11)).toBeUndefined();
  await clearNativeMeetingForAuth();
  expect(leave).toHaveBeenCalledTimes(2);
  expect(getActiveNativeMeeting()).toBeUndefined();
});

it("coalesces duplicate and synchronous reentrant auth cleanup", async () => {
  const old = meeting();
  setActiveNativeMeeting(old);
  let reentrant: Promise<void> | undefined;
  const unsubscribe = subscribeNativeMeetingRegistry(() => {
    if (getActiveNativeMeeting() === old && !getActiveNativeMeeting(11))
      reentrant = clearNativeMeetingForAuth();
  });
  try {
    const first = clearNativeMeetingForAuth();
    expect(clearNativeMeetingForAuth()).toBe(first);
    expect(reentrant).toBe(first);
    await first;
    expect(old.leave).toHaveBeenCalledOnce();
  } finally { unsubscribe(); }
});

it("failed lifecycle re-registration cannot restore visibility or replace custody", async () => {
  const old = meeting(vi.fn(async () => { throw new Error("stop failed"); }));
  setActiveNativeMeeting(old);
  await expect(clearNativeMeetingForAuth()).rejects.toThrow("stop failed");
  setActiveNativeMeeting(old);
  expect(getActiveNativeMeeting(11)).toBeUndefined();
  expect(() => setActiveNativeMeeting(meeting())).toThrow("cleanup must finish");
  expect(getActiveNativeMeeting()).toBe(old);
});

it("late old helper completion cannot clear a replacement registered after actual drain", async () => {
  const replacement = meeting();
  let old!: ActiveNativeMeeting;
  old = meeting(vi.fn(async () => {
    // Lifecycle adapters clear themselves only after acknowledged media stop.
    clearActiveNativeMeeting(old);
    setActiveNativeMeeting(replacement);
  }));
  setActiveNativeMeeting(old);
  await clearNativeMeetingForAuth();
  expect(getActiveNativeMeeting(11)).toBe(replacement);
  clearActiveNativeMeeting(old);
  expect(getActiveNativeMeeting()).toBe(replacement);
});

it("ownerless lookup is cleanup-only while route notifications expose no retired account", async () => {
  const old = meeting(vi.fn(async () => { throw new Error("stop failed"); }));
  setActiveNativeMeeting(old);
  const visible: (ActiveNativeMeeting | undefined)[] = [];
  const unsubscribe = subscribeNativeMeetingRegistry(() => { visible.push(getActiveNativeMeeting(11)); });
  try {
    await expect(clearNativeMeetingForAuth()).rejects.toThrow("stop failed");
    expect(visible).toEqual([undefined]);
    expect(getActiveNativeMeeting(12)).toBeUndefined();
    expect(getActiveNativeMeeting()).toBe(old);
  } finally { unsubscribe(); }
});

it("empty auth cleanup succeeds without retiring a subsequently registered room", async () => {
  const cleanup = clearNativeMeetingForAuth();
  const current = meeting();
  setActiveNativeMeeting(current);
  await cleanup;
  expect(getActiveNativeMeeting(11)).toBe(current);
});
