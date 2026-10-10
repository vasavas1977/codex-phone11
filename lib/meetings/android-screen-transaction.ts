import type { BrowserRoom, BrowserScreenAdapter, BrowserScreenTrack } from "./browser-session";

type NativeTrackData = { streamId: string; track: { id: string; kind: string; remote: boolean; readyState: string } };
export type AndroidScreenBridge = {
  phone11ScreenBegin(operation: string, lifetime: string): Promise<NativeTrackData>;
  phone11ScreenCancel(operation: string): Promise<void>;
  phone11ScreenStop(operation: string): Promise<void>;
};
type ScreenParticipant = {
  permissions?: { canPublish?: boolean; canPublishSources?: readonly number[] };
  publishTrack(track: BrowserScreenTrack): Promise<unknown>;
  unpublishTrack(track: BrowserScreenTrack, stop: boolean): Promise<unknown>;
  trackPublications: ReadonlyMap<string, { track?: BrowserScreenTrack; isMuted?: boolean }>;
};
export type AndroidScreenBinding = {
  bridge: AndroidScreenBridge;
  createVideoTrack(data: NativeTrackData): BrowserScreenTrack;
  screenSource: number;
};
type Operation = {
  id: string; retired: boolean; capturing: boolean; track?: BrowserScreenTrack;
  nativeStopped: boolean; stopping?: Promise<void>;
};
let sequence = 0;

/** Native receipt custody, intersected with the existing admitted lifecycle; no auth store. */
export function createAndroidScreenAdapter(binding: AndroidScreenBinding, lifetime: string,
  current: (room: BrowserRoom) => boolean): BrowserScreenAdapter & { cancelCapture(): Promise<void> } {
  let operation: Operation | undefined;
  const participant = (room: BrowserRoom) => room.localParticipant as unknown as ScreenParticipant;
  const eligible = (room: BrowserRoom) => {
    if (!current(room)) return false;
    const permissions = participant(room).permissions;
    return permissions?.canPublish === true && Array.isArray(permissions.canPublishSources) &&
      (permissions.canPublishSources.length === 0 || permissions.canPublishSources.includes(binding.screenSource));
  };
  const stopNative = (owned: Operation, cancel = false): Promise<void> => {
    owned.retired = true;
    if (owned.nativeStopped) return Promise.resolve();
    if (owned.stopping) return owned.stopping;
    // Invoke now: do not wait for the still-open OS consent chooser.
    const task = (cancel ? binding.bridge.phone11ScreenCancel(owned.id) : binding.bridge.phone11ScreenStop(owned.id))
      .then(() => { owned.nativeStopped = true; });
    owned.stopping = task;
    void task.finally(() => { if (owned.stopping === task) owned.stopping = undefined; }).catch(() => undefined);
    return task;
  };
  const clearDrainedChooser = (owned: Operation) => {
    if (operation === owned && owned.nativeStopped && !owned.capturing && !owned.track) operation = undefined;
  };
  return {
    isAllowed: room => eligible(room) && (!operation || !operation.retired),
    async capture(room) {
      if (!eligible(room) || operation) throw new Error("Screen sharing is unavailable");
      const owned: Operation = { id: `phone11-screen-${Date.now()}-${++sequence}`, retired: false, capturing: true, nativeStopped: false };
      operation = owned;
      try {
        const data = await binding.bridge.phone11ScreenBegin(owned.id, lifetime);
        if (operation !== owned || owned.retired || !eligible(room)) throw new Error("Screen capture retired");
        if (!data?.streamId || !data.track?.id || data.track.kind !== "video" || data.track.remote || data.track.readyState !== "live")
          throw new Error("Expected one native screen video track");
        const track = binding.createVideoTrack(data);
        owned.track = track;
        if (track.kind !== "video" || track.source !== "screen_share") throw new Error("Screen video unavailable");
        return [track];
      } catch (error) {
        await stopNative(owned);
        // No publication was requested by this capture call; retire its JS wrapper too.
        if (owned.track) { owned.track.stop(); owned.track = undefined; }
        throw error;
      } finally { owned.capturing = false; clearDrainedChooser(owned); }
    },
    async publish(room, track) {
      const owned = operation;
      if (!owned || owned.track !== track || owned.retired || !eligible(room)) throw new Error("Screen publication retired");
      await participant(room).publishTrack(track);
      if (operation !== owned || owned.retired || !eligible(room)) throw new Error("Screen publication retired");
    },
    async unpublish(room, track) {
      const owned = operation;
      if (!owned || owned.track !== track) throw new Error("Screen cleanup custody changed");
      const results = await Promise.allSettled([stopNative(owned), participant(room).unpublishTrack(track, true)]);
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      if (operation === owned) operation = undefined;
    },
    async cancelCapture() {
      const owned = operation;
      if (!owned) return;
      await stopNative(owned, true);
      clearDrainedChooser(owned);
    },
    isPublished(room, track) {
      return [...participant(room).trackPublications.values()].some(publication =>
        publication.track === track && !publication.isMuted && track.mediaStreamTrack.readyState === "live");
    },
    publishedTracks(room) {
      return [...participant(room).trackPublications.values()].flatMap(publication =>
        publication.track?.source === "screen_share" ? [publication.track] : []);
    },
  };
}
