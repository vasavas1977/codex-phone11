import { describe, expect, it, vi } from "vitest";
import { BrowserMeetingSession, type BrowserRoom, type BrowserScreenAdapter, type BrowserScreenTrack } from "./browser-session";
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function track() {
  const listeners = new Set<() => void>();
  const media = { readyState: "live", addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) };
  const value = { kind: "video", source: "screen_share", mediaStreamTrack: media, stop: vi.fn(() => { media.readyState = "ended"; }) };
  return { value: value as unknown as BrowserScreenTrack, stop: value.stop, end: () => { media.readyState = "ended"; [...listeners].forEach(listener => listener()); } };
}
async function fixture(receiveOnly = false) {
  const events = new Map<string, Set<() => void>>(), captured = track(), publications = new Set<BrowserScreenTrack>();
  let allowed = true;
  const room: BrowserRoom = { localParticipant: { identity: "local", setCameraEnabled: vi.fn(), setMicrophoneEnabled: vi.fn() }, remoteParticipants: new Map(), connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
    on: (event, fn) => { if (!events.has(event)) events.set(event, new Set()); events.get(event)!.add(fn); }, off: (event, fn) => { events.get(event)?.delete(fn); } };
  const adapter: BrowserScreenAdapter = { isAllowed: () => allowed, capture: vi.fn(async () => [captured.value]),
    publish: vi.fn(async (_, value) => { publications.add(value); }), unpublish: vi.fn(async (_, value) => { publications.delete(value); }), isPublished: (_, value) => publications.has(value), publishedTracks: () => [...publications] };
  const session = new BrowserMeetingSession(() => room, { screen: adapter });
  await session.connect({ url: "wss://test.invalid", token: "test", receiveOnly });
  return { room, session, adapter, captured, publications, revoke: () => { allowed = false; }, emit: (event: string) => { [...events.get(event) ?? []].forEach(fn => fn()); } };
}
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
describe("browser screen publication lifecycle", () => {
  it("captures directly before start returns and only then publishes video", async () => {
    const f = await fixture();
    const start = f.session.startScreenShare();
    expect(f.adapter.capture).toHaveBeenCalledTimes(1);
    expect(f.adapter.publish).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().screenShare?.status).toBe("choosing");
    await start;
    expect(f.session.getSnapshot().screenShare?.status).toBe("sharing");
    await f.session.stopScreenShare();
    expect(f.captured.stop).toHaveBeenCalled();
    expect(f.publications.size).toBe(0);
  });
  it("never captures on connect or permits a second local publisher", async () => {
    const f = await fixture(); expect(f.adapter.capture).not.toHaveBeenCalled();
    const first = f.session.startScreenShare();
    await expect(f.session.startScreenShare()).rejects.toThrow("unavailable");
    await first;
    await expect(f.session.startScreenShare()).rejects.toThrow("unavailable");
    expect(f.adapter.capture).toHaveBeenCalledTimes(1);
    await f.session.disconnect();
  });
  it.each(["listener", "revoked", "native"])("fails closed for %s", async kind => {
    const f = await fixture(kind === "listener"); if (kind === "revoked") f.revoke();
    const session = kind === "native" ? new BrowserMeetingSession(() => f.room) : f.session;
    await expect(session.startScreenShare()).rejects.toThrow("unavailable");
    expect(f.adapter.capture).not.toHaveBeenCalled();
    await f.session.disconnect();
  });
  it("picker cancellation keeps receiving and exposes no SDK secret", async () => {
    const f = await fixture(); vi.mocked(f.adapter.capture).mockRejectedValue(new Error("denied token=secret"));
    await expect(f.session.startScreenShare()).rejects.toThrow("denied");
    expect(f.session.getSnapshot()).toMatchObject({ status: "connected", screenShare: { status: "idle" } });
    expect(f.session.getSnapshot().screenShare?.error).not.toContain("secret");
    expect(f.room.disconnect).not.toHaveBeenCalled(); await f.session.disconnect();
  });
  it("stops unexpected audio without publishing it", async () => {
    const f = await fixture(); const audio = track(); Object.assign(audio.value, { kind: "audio", source: "screen_share_audio" });
    vi.mocked(f.adapter.capture).mockResolvedValue([f.captured.value, audio.value]);
    await expect(f.session.startScreenShare()).rejects.toThrow("unavailable");
    expect(f.adapter.publish).not.toHaveBeenCalled(); expect(audio.stop).toHaveBeenCalled(); expect(f.captured.stop).toHaveBeenCalled();
    await f.session.disconnect();
  });
  it("stops a screen on failed publication", async () => {
    const f = await fixture(); vi.mocked(f.adapter.publish).mockRejectedValue(new Error("publish token=secret"));
    await expect(f.session.startScreenShare()).rejects.toThrow("publish");
    expect(f.captured.stop).toHaveBeenCalled(); expect(f.adapter.unpublish).toHaveBeenCalled();
    expect(f.session.getSnapshot().screenShare?.status).toBe("idle"); await f.session.disconnect();
  });
  it("rejects an already-ended picker result", async () => {
    const f = await fixture(); f.captured.end();
    await expect(f.session.startScreenShare()).rejects.toThrow("cancelled");
    expect(f.adapter.publish).not.toHaveBeenCalled(); await f.session.disconnect();
  });
  it("permission revoked while chooser is open prevents publication", async () => {
    const f = await fixture(), picker = deferred<readonly BrowserScreenTrack[]>(); vi.mocked(f.adapter.capture).mockReturnValue(picker.promise);
    const start = f.session.startScreenShare(); f.revoke(); f.emit("participantPermissionsChanged");
    picker.resolve([f.captured.value]); await expect(start).rejects.toThrow("cancelled"); await tick();
    expect(f.adapter.publish).not.toHaveBeenCalled(); expect(f.captured.stop).toHaveBeenCalled();
    expect(f.session.getSnapshot().screenShare).toMatchObject({ available: false, status: "idle" }); await f.session.disconnect();
  });
  it("Stop waits for the chooser and disposes its stale result", async () => {
    const f = await fixture(), picker = deferred<readonly BrowserScreenTrack[]>(); vi.mocked(f.adapter.capture).mockReturnValue(picker.promise);
    const start = f.session.startScreenShare(), stop = f.session.stopScreenShare(); let done = false; void stop.then(() => { done = true; }); await tick(); expect(done).toBe(false);
    picker.resolve([f.captured.value]); await expect(start).rejects.toThrow("cancelled"); await stop;
    expect(f.captured.stop).toHaveBeenCalled(); expect(f.adapter.publish).not.toHaveBeenCalled(); expect(f.session.getSnapshot().screenShare?.status).toBe("idle"); await f.session.disconnect();
  });
  it("leave drains pending chooser and prevents late publication", async () => {
    const f = await fixture(), picker = deferred<readonly BrowserScreenTrack[]>(); vi.mocked(f.adapter.capture).mockReturnValue(picker.promise);
    const start = f.session.startScreenShare(), leave = f.session.disconnect(); await tick();
    picker.resolve([f.captured.value]); await expect(start).rejects.toThrow("cancelled"); await leave;
    expect(f.adapter.publish).not.toHaveBeenCalled(); expect(f.captured.stop).toHaveBeenCalled(); expect(f.session.getRoom()).toBeUndefined();
  });
  it("stops an acquired unpublished screen immediately when leaving during publish", async () => {
    const f = await fixture(), published = deferred<void>(); vi.mocked(f.adapter.publish).mockImplementation(async (_, value) => { await published.promise; f.publications.add(value); });
    const start = f.session.startScreenShare(); await tick();
    const leave = f.session.disconnect(); await tick(); expect(f.captured.stop).toHaveBeenCalled();
    published.resolve(); await expect(start).rejects.toThrow("cancelled"); await leave;
    expect(f.publications.size).toBe(0); expect(f.session.getSnapshot().status).toBe("disconnected");
  });
  it.each(["choosing", "publishing", "sharing"])("browser ended in %s clears screen state", async phase => {
    const f = await fixture(), wait = deferred<void>();
    if (phase === "choosing") { f.captured.end(); await expect(f.session.startScreenShare()).rejects.toThrow("cancelled"); }
    else {
      if (phase === "publishing") vi.mocked(f.adapter.publish).mockImplementation(async (_, value) => { await wait.promise; f.publications.add(value); });
      const start = f.session.startScreenShare(); await tick(); f.captured.end(); wait.resolve();
      if (phase === "publishing") await expect(start).rejects.toThrow("cancelled"); else await start;
      await tick();
    }
    expect(f.session.getSnapshot().screenShare?.status).toBe("idle"); expect(f.publications.size).toBe(0); await f.session.disconnect();
  });
  it.each(["reconnecting", "signalReconnecting"])("%s stops screen and never restarts capture", async event => {
    const f = await fixture(); await f.session.startScreenShare(); f.emit(event); expect(f.captured.stop).toHaveBeenCalled(); await tick();
    f.emit("reconnected"); expect(f.adapter.capture).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot().screenShare).toMatchObject({ status: "idle", available: true }); expect(f.publications.size).toBe(0); await f.session.disconnect();
  });
  it("provider unpublish retires the local capture", async () => {
    const f = await fixture(); await f.session.startScreenShare(); f.publications.clear(); f.emit("localTrackUnpublished"); await tick();
    expect(f.captured.stop).toHaveBeenCalled(); expect(f.session.getSnapshot().screenShare?.status).toBe("idle"); await f.session.disconnect();
  });
  it("cleanup rejection blocks another capture until retry succeeds", async () => {
    const f = await fixture(); await f.session.startScreenShare(); vi.mocked(f.adapter.unpublish).mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(f.session.stopScreenShare()).rejects.toThrow("cleanup failed");
    expect(f.captured.stop).toHaveBeenCalled(); expect(f.session.getSnapshot().screenShare?.status).toBe("stopping");
    await expect(f.session.startScreenShare()).rejects.toThrow("unavailable"); await f.session.stopScreenShare(); expect(f.publications.size).toBe(0); await f.session.disconnect();
  });
  it.each(["reconnecting", "signalReconnecting"])("%s fences a chooser completion even after reconnected", async event => {
    const f = await fixture(), picker = deferred<readonly BrowserScreenTrack[]>(); vi.mocked(f.adapter.capture).mockReturnValue(picker.promise);
    const start = f.session.startScreenShare(); f.emit(event); f.emit("reconnected");
    picker.resolve([f.captured.value]); await expect(start).rejects.toThrow("cancelled"); await tick();
    expect(f.adapter.publish).not.toHaveBeenCalled(); expect(f.captured.stop).toHaveBeenCalled();
    expect(f.session.getSnapshot().screenShare).toMatchObject({ status: "idle", available: true }); await f.session.disconnect();
  });
  it("permission revoked during publication unpublishes its late result", async () => {
    const f = await fixture(), published = deferred<void>();
    vi.mocked(f.adapter.publish).mockImplementation(async (_, value) => { await published.promise; f.publications.add(value); });
    const start = f.session.startScreenShare(); await tick(); f.revoke(); published.resolve();
    await expect(start).rejects.toThrow("cancelled");
    expect(f.captured.stop).toHaveBeenCalled(); expect(f.publications.size).toBe(0); await f.session.disconnect();
  });
  it("reentrant leave from choosing snapshot prevents the picker call", async () => {
    const f = await fixture(); let leave: Promise<void> | undefined;
    f.session.subscribe(() => { if (!leave && f.session.getSnapshot().screenShare?.status === "choosing") leave = f.session.disconnect(); });
    await expect(f.session.startScreenShare()).rejects.toThrow("cancelled"); await leave;
    expect(f.adapter.capture).not.toHaveBeenCalled();
  });
  it("a throwing capture stop retains ownership and rejects leave until retry", async () => {
    const f = await fixture(); await f.session.startScreenShare(); f.captured.stop.mockImplementation(() => { throw new Error("stop failed"); });
    await expect(f.session.disconnect()).rejects.toThrow("stop failed");
    expect(f.session.getRoom()).toBe(f.room);
    await expect(f.session.startScreenShare()).rejects.toThrow("unavailable");
    f.captured.stop.mockImplementation(() => {}); await f.session.disconnect(); expect(f.session.getRoom()).toBeUndefined();
  });

  it("retires an SDK reconnect republish of an already stopped track before restart", async () => {
    const f = await fixture(); await f.session.startScreenShare(); f.emit("reconnecting"); await tick();
    f.publications.add(f.captured.value); f.emit("reconnected");
    await expect(f.session.startScreenShare()).rejects.toThrow("unavailable"); await tick();
    expect(f.captured.stop).toHaveBeenCalled(); expect(f.publications.size).toBe(0);
    expect(f.session.getSnapshot().screenShare?.status).toBe("idle"); await f.session.disconnect();
  });

});
