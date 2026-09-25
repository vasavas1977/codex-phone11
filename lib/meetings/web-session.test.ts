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
  return { Room, ConnectionError: class ConnectionError extends Error {} };
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
