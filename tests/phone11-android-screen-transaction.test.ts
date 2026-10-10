import { expect, it, vi } from "vitest";
import { createAndroidScreenAdapter } from "../lib/meetings/android-screen-transaction";
import type { BrowserRoom, BrowserScreenTrack } from "../lib/meetings/browser-session";
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let current = true;
  const native = deferred<{ streamId: string; track: { id: string; kind: string; remote: boolean; readyState: string } }>();
  const data = { streamId: "stream", track: { id: "screen", kind: "video", remote: false, readyState: "live" } };
  const track = { kind: "video", source: "screen_share", mediaStreamTrack: { readyState: "live", addEventListener: vi.fn(), removeEventListener: vi.fn() }, stop: vi.fn() } as BrowserScreenTrack;
  const bridge = { phone11ScreenBegin: vi.fn(() => native.promise), phone11ScreenCancel: vi.fn(async () => { native.reject(new Error("cancelled")); }), phone11ScreenStop: vi.fn(async () => {}) };
  const local = { permissions: { canPublish: true, canPublishSources: [3] as number[] }, publishTrack: vi.fn(async () => {}), unpublishTrack: vi.fn(async () => {}), trackPublications: new Map() };
  const room = { localParticipant: local } as unknown as BrowserRoom;
  const createVideoTrack = vi.fn(() => track);
  const adapter = createAndroidScreenAdapter({ bridge, createVideoTrack, screenSource: 3 }, "original-lifetime", candidate => current && candidate === room);
  return { adapter, room, local, bridge, native, data, track, createVideoTrack, retire: () => { current = false; } };
}
it("starts only from an eligible explicit capture with its original lifetime", async () => {
  const f = fixture(); expect(f.bridge.phone11ScreenBegin).not.toHaveBeenCalled();
  const capture = f.adapter.capture(f.room); expect(f.bridge.phone11ScreenBegin).toHaveBeenCalledWith(expect.any(String), "original-lifetime");
  f.native.resolve(f.data); expect(await capture).toEqual([f.track]); await f.adapter.publish(f.room, f.track); expect(f.local.publishTrack).toHaveBeenCalledOnce();
});
it.each(["owner", "room", "publish", "sources"])("refuses %s without invoking native consent", async condition => {
  const f = fixture(); if (condition === "owner") f.retire(); if (condition === "publish") f.local.permissions.canPublish = false; if (condition === "sources") f.local.permissions.canPublishSources = [1];
  const room = condition === "room" ? {} as BrowserRoom : f.room;
  await expect(f.adapter.capture(room)).rejects.toThrow("unavailable"); expect(f.bridge.phone11ScreenBegin).not.toHaveBeenCalled();
});
it("accepts the SDK unrestricted empty source grant", async () => { const f = fixture(); f.local.permissions.canPublishSources = []; expect(f.adapter.isAllowed(f.room)).toBe(true); });
it("refuses duplicate consent while the OS chooser is pending", async () => {
  const f = fixture(), first = f.adapter.capture(f.room); await expect(f.adapter.capture(f.room)).rejects.toThrow();
  f.native.resolve(f.data); await first; expect(f.bridge.phone11ScreenBegin).toHaveBeenCalledOnce();
});
it("cancel invokes native retirement before the chooser settles and discards late metadata", async () => {
  const f = fixture(), capture = f.adapter.capture(f.room); const rejection = expect(capture).rejects.toThrow();
  const cleanup = f.adapter.cancelCapture(); expect(f.bridge.phone11ScreenCancel).toHaveBeenCalledOnce();
  f.native.resolve(f.data); await cleanup; await rejection; expect(f.createVideoTrack).not.toHaveBeenCalled(); expect(f.local.publishTrack).not.toHaveBeenCalled();
});
it("auth/SIP/room lifetime loss after consent cleans natively without publication", async () => {
  const f = fixture(), capture = f.adapter.capture(f.room); f.retire(); f.native.resolve(f.data);
  await expect(capture).rejects.toThrow("retired"); expect(f.bridge.phone11ScreenStop).toHaveBeenCalledOnce(); expect(f.createVideoTrack).not.toHaveBeenCalled();
});
it("service/start refusal drains native custody before another capture", async () => {
  const f = fixture(), capture = f.adapter.capture(f.room); f.native.reject(new Error("service refused"));
  await expect(capture).rejects.toThrow("service refused"); expect(f.bridge.phone11ScreenStop).toHaveBeenCalledOnce(); expect(f.adapter.isAllowed(f.room)).toBe(true);
});
it.each(["audio", "remote", "ended"])("refuses %s native metadata and acknowledges disposal", async invalid => {
  const f = fixture(), capture = f.adapter.capture(f.room); if (invalid === "audio") f.data.track.kind = "audio"; if (invalid === "remote") f.data.track.remote = true; if (invalid === "ended") f.data.track.readyState = "ended"; f.native.resolve(f.data);
  await expect(capture).rejects.toThrow("video"); expect(f.bridge.phone11ScreenStop).toHaveBeenCalledOnce(); expect(f.createVideoTrack).not.toHaveBeenCalled();
});
it("does not publish an old track after retirement", async () => {
  const f = fixture(), capture = f.adapter.capture(f.room); f.native.resolve(f.data); await capture; f.retire();
  await expect(f.adapter.publish(f.room, f.track)).rejects.toThrow("retired"); expect(f.local.publishTrack).not.toHaveBeenCalled(); await f.adapter.unpublish(f.room, f.track);
});
it("late publication cannot become sharing and both native/SDK cleanup are awaited", async () => {
  const f = fixture(), capture = f.adapter.capture(f.room); f.native.resolve(f.data); await capture;
  const publish = deferred<void>(); f.local.publishTrack.mockImplementation(() => publish.promise);
  const task = f.adapter.publish(f.room, f.track); f.retire(); publish.resolve(undefined); await expect(task).rejects.toThrow("retired");
  const stop = deferred<void>(); f.bridge.phone11ScreenStop.mockImplementation(() => stop.promise);
  let drained = false; const cleanup = f.adapter.unpublish(f.room, f.track).then(() => { drained = true; }); await Promise.resolve(undefined); expect(drained).toBe(false); expect(f.local.unpublishTrack).toHaveBeenCalledOnce(); stop.resolve(undefined); await cleanup;
});
it("failed native stop retains custody, coalesces duplicate and allows cleanup retry", async () => {
  const f = fixture(), capture = f.adapter.capture(f.room); f.native.resolve(f.data); await capture;
  f.bridge.phone11ScreenStop.mockRejectedValueOnce(new Error("native disposal failed"));
  await expect(f.adapter.unpublish(f.room, f.track)).rejects.toThrow("native disposal failed");
  await expect(f.adapter.capture(f.room)).rejects.toThrow(); expect(f.adapter.isAllowed(f.room)).toBe(false);
  await f.adapter.unpublish(f.room, f.track); expect(f.bridge.phone11ScreenStop).toHaveBeenCalledTimes(2); expect(f.adapter.isAllowed(f.room)).toBe(true);
});
it("successful native stop alone cannot unlock failed SDK unpublication", async () => {
  const f = fixture(), capture = f.adapter.capture(f.room); f.native.resolve(f.data); await capture;
  f.local.unpublishTrack.mockRejectedValueOnce(new Error("SDK drain failed")); await expect(f.adapter.unpublish(f.room, f.track)).rejects.toThrow("SDK drain failed");
  await expect(f.adapter.capture(f.room)).rejects.toThrow(); await f.adapter.unpublish(f.room, f.track); expect(f.bridge.phone11ScreenStop).toHaveBeenCalledOnce();
});
it("failed cancellation remains unavailable until a native stop ACK retry", async () => {
  const f = fixture(), capture = f.adapter.capture(f.room); const rejected = expect(capture).rejects.toThrow();
  f.bridge.phone11ScreenCancel.mockRejectedValueOnce(new Error("destroy failed")); await expect(f.adapter.cancelCapture()).rejects.toThrow("destroy failed");
  f.native.reject(new Error("capture retired")); f.bridge.phone11ScreenStop.mockRejectedValueOnce(new Error("stop held")); await rejected; expect(f.adapter.isAllowed(f.room)).toBe(false);
  await f.adapter.cancelCapture(); expect(f.adapter.isAllowed(f.room)).toBe(true);
});
