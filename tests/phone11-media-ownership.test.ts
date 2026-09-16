import { describe, expect, it, vi } from "vitest";
import { MediaOwnershipCoordinator } from "../lib/meetings/media-ownership";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const hooks = () => ({ pauseForSip: vi.fn(async () => {}) });

describe("media ownership", () => {
  it("grants one engine, is idempotent, and rejects reconstructed lease tokens", async () => {
    const c = new MediaOwnershipCoordinator();
    const h = hooks();
    const m = c.requestMeeting("meeting", h);
    await m.ready;
    expect(c.requestMeeting("meeting", h)).toBe(m);
    expect(c.isCurrent(m.lease)).toBe(true);
    expect(c.isCurrent({ ...m.lease })).toBe(false);
    expect(() => c.requestMeeting("other", h)).toThrow("busy");
    c.release({ ...m.lease });
    expect(c.isCurrent(m.lease)).toBe(true);
    c.release(m.lease); c.release(m.lease);
    expect(c.getSnapshot().owner).toBeNull();
    expect(h.pauseForSip).not.toHaveBeenCalled();
  });

  it("gives incoming SIP priority only after meeting suspension is acknowledged", async () => {
    const c = new MediaOwnershipCoordinator();
    const stop = deferred();
    const pauseForSip = vi.fn(() => stop.promise);
    const m = c.requestMeeting("meeting", { pauseForSip });
    await m.ready;
    const sip = c.requestSip("sip");
    expect(c.isCurrent(m.lease)).toBe(false);
    expect(c.isCurrent(sip.lease)).toBe(false);
    expect(c.requestSip("sip")).toBe(sip);
    expect(() => c.requestSip("second-call")).toThrow("busy");
    expect(() => c.requestMeeting("meeting", { pauseForSip })).toThrow("resume-required");
    await Promise.resolve();
    expect(pauseForSip).toHaveBeenCalledTimes(1);
    stop.resolve(); await sip.ready;
    expect(c.isCurrent(sip.lease)).toBe(true);
    c.release(m.lease); // A stale meeting teardown cannot release SIP.
    expect(c.isCurrent(sip.lease)).toBe(true);
    c.release(sip.lease);
    expect(c.getSnapshot().resumeRequired).toBe(true);
    expect(() => c.requestMeeting("meeting", { pauseForSip })).toThrow("resume-required");
    const resumed = c.resumeMeeting("meeting", { pauseForSip });
    await resumed.ready;
    expect(resumed.lease.generation).toBeGreaterThan(sip.lease.generation);
    expect(c.resumeMeeting("meeting", { pauseForSip })).toBe(resumed);
    expect(pauseForSip).toHaveBeenCalledTimes(1); // No automatic resume callback.
  });

  it("cancellation fences a late pause completion and keeps new requests behind it", async () => {
    const c = new MediaOwnershipCoordinator();
    const stop = deferred();
    const h = { pauseForSip: vi.fn(() => stop.promise) };
    const m = c.requestMeeting("meeting", h); await m.ready;
    const old = c.requestSip("cancelled");
    const rejected = expect(old.ready).rejects.toMatchObject({ code: "stale" });
    c.release(old.lease); await rejected;
    expect(() => c.resumeMeeting("meeting", h)).toThrow("busy");
    expect(() => c.forgetInterruptedMeeting("meeting")).toThrow("busy");
    const next = c.requestSip("new-call");
    c.release(old.lease);
    stop.resolve(); await next.ready;
    expect(c.isCurrent(old.lease)).toBe(false);
    expect(c.isCurrent(next.lease)).toBe(true);
    expect(h.pauseForSip).toHaveBeenCalledTimes(1);
  });

  it("fails closed on pause rejection and retries safely before granting SIP", async () => {
    const c = new MediaOwnershipCoordinator();
    const pauseForSip = vi.fn().mockRejectedValueOnce(new Error("SDK stop failed")).mockResolvedValue(undefined);
    const m = c.requestMeeting("meeting", { pauseForSip }); await m.ready;
    const failed = c.requestSip("call");
    await expect(failed.ready).rejects.toMatchObject({ code: "pause-failed" });
    expect(c.isCurrent(failed.lease)).toBe(false);
    expect(c.getSnapshot().meetingPause).toBe("failed");
    expect(() => c.resumeMeeting("meeting", { pauseForSip })).toThrow("busy");
    expect(() => c.forgetInterruptedMeeting("meeting")).toThrow("busy");
    const retry = c.requestSip("call"); await retry.ready;
    expect(c.isCurrent(retry.lease)).toBe(true);
    expect(pauseForSip).toHaveBeenCalledTimes(2);
  });

  it("handles synchronous hook errors, and never grants cancelled SIP after completion", async () => {
    const c = new MediaOwnershipCoordinator();
    c.requestMeeting("meeting", { pauseForSip: () => { throw new Error("sync"); } });
    const sip = c.requestSip("sip");
    await expect(sip.ready).rejects.toMatchObject({ code: "pause-failed" });
    expect(c.getSnapshot().owner).toBeNull();
  });

  it("requires a matching explicit resume and supports leaving a suspended meeting", async () => {
    const c = new MediaOwnershipCoordinator();
    const h = hooks();
    c.requestMeeting("meeting", h);
    const sip = c.requestSip("sip"); await sip.ready;
    expect(() => c.resumeMeeting("wrong", h)).toThrow("resume-required");
    expect(() => c.resumeMeeting("meeting", h)).toThrow("busy");
    c.forgetInterruptedMeeting("wrong");
    expect(c.getSnapshot().resumeRequired).toBe(true);
    c.forgetInterruptedMeeting("meeting");
    expect(() => c.requestMeeting("new", h)).toThrow("busy");
    c.release(sip.lease);
    const fresh = c.requestMeeting("new", h); await fresh.ready;
    expect(c.isCurrent(fresh.lease)).toBe(true);
  });

  it("fences a late meeting operation after SIP interruption and resume", async () => {
    const c = new MediaOwnershipCoordinator();
    const h = hooks();
    const meeting = c.requestMeeting("meeting", h); await meeting.ready;
    const late = deferred();
    let published = false;
    const operation = late.promise.then(() => { if (c.isCurrent(meeting.lease)) published = true; });
    const sip = c.requestSip("sip"); await sip.ready; c.release(sip.lease);
    const resumed = c.resumeMeeting("meeting", h); await resumed.ready;
    late.resolve(); await operation;
    expect(published).toBe(false);
    expect(c.isCurrent(resumed.lease)).toBe(true);
    c.release(meeting.lease);
    expect(c.isCurrent(resumed.lease)).toBe(true);
  });

  it("cancelled SIP never acquires after stop completes without a replacement", async () => {
    const c = new MediaOwnershipCoordinator();
    const stop = deferred();
    const h = { pauseForSip: () => stop.promise };
    c.requestMeeting("meeting", h);
    const sip = c.requestSip("sip");
    const rejected = expect(sip.ready).rejects.toMatchObject({ code: "stale" });
    c.release(sip.lease); await rejected;
    stop.resolve(); await c.retryMeetingPause();
    expect(c.getSnapshot().owner).toBeNull();
    expect(c.isCurrent(sip.lease)).toBe(false);
    const resumed = c.resumeMeeting("meeting", h); await resumed.ready;
    expect(c.isCurrent(resumed.lease)).toBe(true);
  });

  it("recovers failed suspension after SIP cancellation without activating either SDK", async () => {
    const c = new MediaOwnershipCoordinator();
    const pauseForSip = vi.fn().mockRejectedValueOnce(new Error("stop")).mockResolvedValue(undefined);
    c.requestMeeting("meeting", { pauseForSip });
    const sip = c.requestSip("sip");
    await expect(sip.ready).rejects.toMatchObject({ code: "pause-failed" });
    await c.retryMeetingPause();
    expect(c.getSnapshot().owner).toBeNull();
    expect(c.getSnapshot().resumeRequired).toBe(true);
    c.forgetInterruptedMeeting("meeting");
    expect(c.getSnapshot().resumeRequired).toBe(false);
  });

  it("validates IDs and never starts SDK media itself", async () => {
    const c = new MediaOwnershipCoordinator();
    expect(() => c.requestSip("")).toThrow(TypeError);
    expect(() => c.requestMeeting(" x ", hooks())).toThrow(TypeError);
    const sip = c.requestSip("sip"); await sip.ready;
    expect(() => c.requestMeeting("meeting", hooks())).toThrow("busy");
    c.release(sip.lease);
    expect(c.getSnapshot()).toEqual({ owner: null, interruptedMeetingId: null, resumeRequired: false, meetingPause: "none" });
  });
});
