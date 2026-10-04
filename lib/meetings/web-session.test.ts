import { beforeEach, expect, it, vi } from "vitest";
import { WebMeetingLifecycle } from "./web-session";
import { getActiveNativeMeeting } from "./native-session-registry";

const state = vi.hoisted(() => ({
  userId: 3001 as number | undefined,
  listeners: new Set<() => void>(),
  rooms: [] as any[],
  connectError: undefined as Error | undefined,
  connectWait: undefined as Promise<void> | undefined,
  disconnectError: undefined as Error | undefined,
}));

vi.mock("@/lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: state.userId ? { id: state.userId } : null }),
  addAuthChangeListener: (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
}));

vi.mock("livekit-client", () => {
  class Room {
    localParticipant = {
      identity: "local",
      trackPublications: new Map(),
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async () => undefined),
      permissions: { canPublish: true, canPublishSources: [] as number[] },
      createScreenTracks: vi.fn(async () => [{ kind: "video", source: "screen_share", mediaStreamTrack: {
        readyState: "live", addEventListener: vi.fn(), removeEventListener: vi.fn(),
      }, stop: vi.fn() }]),
      publishTrack: vi.fn(async (track: unknown) => { this.localParticipant.trackPublications.set("screen", { track, isMuted: false, source: "screen_share" }); }),
      unpublishTrack: vi.fn(async () => { this.localParticipant.trackPublications.delete("screen"); }),
    };
    remoteParticipants = new Map();
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    connect = vi.fn(async (_url: string, _token: string) => {
      await state.connectWait;
      if (state.connectError) throw state.connectError;
    });
    disconnect = vi.fn(async (_stopTracks?: boolean) => {
      if (state.disconnectError) throw state.disconnectError;
    });
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
    }
    off(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(listener);
    }
    constructor() { state.rooms.push(this); }
  }
  return { Room, Track: { Source: { ScreenShare: "screen_share", ScreenShareAudio: "screen_share_audio" }, sourceToProto: () => 4 }, ConnectionError: class ConnectionError extends Error {} };
});

const admission = { url: "wss://server-issued.invalid", token: "server-issued-token" };

beforeEach(async () => {
  await getActiveNativeMeeting()?.leave();
  state.userId = 3001;
  state.connectError = undefined;
  state.connectWait = undefined;
  state.disconnectError = undefined;
  state.rooms.length = 0;
  state.listeners.clear();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn(() => { throw new Error("Tests must never capture"); }) } });
});

it("uses the server admission and joins muted without requesting capture", async () => {
  const meeting = await WebMeetingLifecycle.join(3001, "admitted-id", admission, { microphone: false, camera: false });
  const room = state.rooms[0];
  expect(room.connect).toHaveBeenCalledWith(admission.url, admission.token);
  expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  expect(getActiveNativeMeeting(3001)).toBe(meeting);
  await meeting.leave();
  expect(room.disconnect).toHaveBeenCalledWith(true);
  expect(getActiveNativeMeeting()).toBeUndefined();
});

it("rejects a token admitted for a different initiating account before creating a room", async () => {
  state.userId = 3002;
  await expect(WebMeetingLifecycle.join(3001, "admitted-id", admission, { microphone: false, camera: false }))
    .rejects.toMatchObject({ name: "MeetingJoinFailure", stage: "admission" });
  expect(state.rooms).toHaveLength(0);
  expect(getActiveNativeMeeting()).toBeUndefined();
});

it("cleans a failed connection without publishing a room or leaking an owner listener", async () => {
  state.connectError = new Error("private token diagnostic");
  await expect(WebMeetingLifecycle.join(3001, "admitted-id", admission, { microphone: false, camera: false }))
    .rejects.toMatchObject({ name: "MeetingJoinFailure", stage: "signal_connect" });
  expect(state.rooms[0].disconnect).toHaveBeenCalledWith(true);
  expect(getActiveNativeMeeting()).toBeUndefined();
  expect(state.listeners.size).toBe(0);
});

it("disconnects the browser room when the authenticated account changes", async () => {
  await WebMeetingLifecycle.join(3001, "admitted-id", admission, { microphone: false, camera: false });
  state.userId = 3002;
  for (const listener of [...state.listeners]) listener();
  await vi.waitFor(() => expect(getActiveNativeMeeting()).toBeUndefined());
  expect(state.rooms[0].disconnect).toHaveBeenCalledWith(true);
  expect(state.listeners.size).toBe(0);
});

it("rejects and disconnects if the account changes during room connection", async () => {
  let releaseConnect!: () => void;
  state.connectWait = new Promise<void>(resolve => { releaseConnect = resolve; });
  const pendingJoin = WebMeetingLifecycle.join(3001, "admitted-id", admission, { microphone: false, camera: false });
  await vi.waitFor(() => expect(state.rooms[0]?.connect).toHaveBeenCalledOnce());
  state.userId = 3002;
  releaseConnect();
  await expect(pendingJoin).rejects.toMatchObject({ name: "MeetingJoinFailure", stage: "post_connect_guard" });
  expect(state.rooms[0].disconnect).toHaveBeenCalledWith(true);
  expect(getActiveNativeMeeting()).toBeUndefined();
});

it("does not ask for capture for a server-issued listener grant", async () => {
  const meeting = await WebMeetingLifecycle.join(3001, "admitted-id", { ...admission, grant_profile: "listener" }, { microphone: true, camera: true });
  expect(meeting.receiveOnly).toBe(true);
  expect(state.rooms[0].localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  expect(state.rooms[0].localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  await meeting.leave();
});

it("retains a failed teardown for a later retry", async () => {
  const meeting = await WebMeetingLifecycle.join(3001, "admitted-id", admission, { microphone: false, camera: false });
  state.disconnectError = new Error("temporary SDK stop failure");
  await expect(meeting.leave()).rejects.toThrow("temporary SDK stop failure");
  expect(getActiveNativeMeeting(3001)).toBe(meeting);
  state.disconnectError = undefined;
  await meeting.leave();
  expect(getActiveNativeMeeting()).toBeUndefined();
});

it("retires a superseded pending join before a replacement room can start", async () => {
  let finishFirst!: () => void;
  state.connectWait = new Promise<void>(resolve => { finishFirst = resolve; });
  const first = WebMeetingLifecycle.join(3001, "first-room", admission, { microphone: true, camera: true });
  // Observe the rejection immediately so a cancellation cannot be unhandled.
  const firstResult = first.catch(error => error);
  await vi.waitFor(() => expect(state.rooms[0]?.connect).toHaveBeenCalledOnce());
  state.connectWait = undefined;
  const replacement = WebMeetingLifecycle.join(3001, "replacement-room", admission, { microphone: false, camera: false });
  await new Promise(resolve => setTimeout(resolve, 0));
  const roomsBeforeFirstStopped = state.rooms.length;
  finishFirst();
  const [failure, meeting] = await Promise.all([firstResult, replacement]);
  expect(roomsBeforeFirstStopped).toBe(1);
  expect(failure).toMatchObject({ name: "MeetingJoinFailure", stage: "post_connect_guard" });
  expect(state.rooms[0].disconnect).toHaveBeenCalledWith(true);
  expect(getActiveNativeMeeting(3001)).toBe(meeting);
  await meeting.leave();
  expect(state.listeners.size).toBe(0);
  expect(getActiveNativeMeeting()).toBeUndefined();
});

it("blocks replacement media when superseded join cleanup still fails, then allows a clean retry", async () => {
  let finishFirst!: () => void;
  state.connectWait = new Promise<void>(resolve => { finishFirst = resolve; });
  const first = WebMeetingLifecycle.join(3001, "first-room", admission, { microphone: true, camera: true }).catch(error => error);
  await vi.waitFor(() => expect(state.rooms[0]?.connect).toHaveBeenCalledOnce());
  state.connectWait = undefined;
  state.disconnectError = new Error("temporary SDK stop failure");
  const replacement = WebMeetingLifecycle.join(3001, "replacement-room", admission, { microphone: true, camera: true }).catch(error => error);
  finishFirst();
  const [firstFailure, replacementFailure] = await Promise.all([first, replacement]);
  expect(firstFailure).toMatchObject({ name: "MeetingJoinFailure", stage: "post_connect_guard" });
  expect(replacementFailure).toMatchObject({ name: "MeetingJoinFailure", stage: "bindings" });
  expect(state.rooms).toHaveLength(1);
  expect(getActiveNativeMeeting(3001)).toBeDefined();
  state.disconnectError = undefined;
  const retried = await WebMeetingLifecycle.join(3001, "replacement-room", admission, { microphone: false, camera: false });
  expect(state.rooms).toHaveLength(2);
  expect(getActiveNativeMeeting(3001)).toBe(retried);
  await retried.leave();
  expect(state.listeners.size).toBe(0);
});

it.each([undefined, 'listener'] as const)('does not infer screen entitlement from absent/listener admission %s', async grant_profile => {
  const meeting = await WebMeetingLifecycle.join(3001, 'admitted-id', { ...admission, grant_profile }, { microphone: false, camera: false });
  expect(meeting.session.getSnapshot().screenShare).toBeUndefined();
  await expect(meeting.session.startScreenShare()).rejects.toThrow('unavailable');
  expect(state.rooms[0].localParticipant.createScreenTracks).not.toHaveBeenCalled();
  await meeting.leave();
});
it('interactive admission plus connected SDK entitlement permits video-only capture', async () => {
  const meeting = await WebMeetingLifecycle.join(3001, 'admitted-id', { ...admission, grant_profile: 'interactive' }, { microphone: false, camera: false });
  const local = state.rooms[0].localParticipant;
  expect(meeting.session.getSnapshot().screenShare?.available).toBe(true);
  await meeting.session.startScreenShare();
  expect(local.createScreenTracks).toHaveBeenCalledWith({ audio: false });
  expect(local.publishTrack).toHaveBeenCalledTimes(1);
  await meeting.leave();
});
it.each(['noPublish', 'cameraOnly', 'unknownPermissions', 'insecure', 'unsupported'])(
  'interactive profile cannot bypass %s', async restriction => {
    const meeting = await WebMeetingLifecycle.join(3001, 'admitted-id', { ...admission, grant_profile: 'interactive' }, { microphone: false, camera: false });
    const local = state.rooms[0].localParticipant;
    if (restriction === 'noPublish') local.permissions.canPublish = false;
    if (restriction === 'cameraOnly') local.permissions.canPublishSources = [1];
    if (restriction === 'unknownPermissions') local.permissions = undefined;
    if (restriction === 'insecure') vi.stubGlobal('isSecureContext', false);
    if (restriction === 'unsupported') vi.stubGlobal('navigator', {});
    meeting.session.refreshScreenCapability();
    expect(meeting.session.getSnapshot().screenShare?.available).toBe(false);
    await expect(meeting.session.startScreenShare()).rejects.toThrow('unavailable');
    expect(local.createScreenTracks).not.toHaveBeenCalled();
    await meeting.leave();
  });
it('explicit SDK screen source permits sharing without granting host actions', async () => {
  const meeting = await WebMeetingLifecycle.join(3001, 'admitted-id', { ...admission, grant_profile: 'interactive' }, { microphone: false, camera: false });
  state.rooms[0].localParticipant.permissions.canPublishSources = [4];
  await meeting.session.startScreenShare();
  expect(meeting.session.getSnapshot().screenShare?.status).toBe('sharing');
  await meeting.leave();
});
it('owner change while chooser is pending stops the result without publishing', async () => {
  const meeting = await WebMeetingLifecycle.join(3001, 'admitted-id', { ...admission, grant_profile: 'interactive' }, { microphone: false, camera: false });
  const local = state.rooms[0].localParticipant;
  let resolve!: (tracks: unknown[]) => void;
  local.createScreenTracks.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  const start = meeting.session.startScreenShare();
  state.userId = 1020;
  state.listeners.forEach(listener => listener());
  const captured = { kind: 'video', source: 'screen_share', mediaStreamTrack: { readyState: 'live', addEventListener: vi.fn(), removeEventListener: vi.fn() }, stop: vi.fn() };
  resolve([captured]);
  await expect(start).rejects.toThrow('cancelled');
  await meeting.leave();
  expect(captured.stop).toHaveBeenCalled(); expect(local.publishTrack).not.toHaveBeenCalled();
});
