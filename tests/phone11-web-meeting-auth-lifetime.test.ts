import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebMeetingLifecycle } from "../lib/meetings/web-session";
import { getActiveNativeMeeting } from "../lib/meetings/native-session-registry";

const state = vi.hoisted(() => ({
  userId: 3001 as number | undefined,
  authUser: { id: 3001 } as { id: number } | null,
  listeners: new Set<() => void>(),
  rooms: [] as any[],
  connectError: undefined as Error | undefined,
  connectWait: undefined as Promise<void> | undefined,
  disconnectError: undefined as Error | undefined,
  disconnectWait: undefined as Promise<void> | undefined,
}));

vi.mock("@/lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: state.authUser }),
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
      createScreenTracks: vi.fn(async () => [
        {
          kind: "video",
          source: "screen_share",
          mediaStreamTrack: {
            readyState: "live",
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
          stop: vi.fn(),
        },
      ]),
      publishTrack: vi.fn(async (track: unknown) => {
        this.localParticipant.trackPublications.set("screen", {
          track,
          isMuted: false,
          source: "screen_share",
        });
      }),
      unpublishTrack: vi.fn(async () => {
        this.localParticipant.trackPublications.delete("screen");
      }),
    };
    remoteParticipants = new Map();
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    connect = vi.fn(async (_url: string, _token: string) => {
      await state.connectWait;
      if (state.connectError) throw state.connectError;
    });
    disconnect = vi.fn(async (_stopTracks?: boolean) => {
      await state.disconnectWait;
      if (state.disconnectError) throw state.disconnectError;
      for (const publication of this.localParticipant.trackPublications.values())
        publication.track?.stop();
      this.localParticipant.trackPublications.clear();
    });
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
    }
    emit(event: string) {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
    }
    off(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(listener);
    }
    constructor() {
      state.rooms.push(this);
    }
  }
  return {
    Room,
    Track: {
      Source: {
        ScreenShare: "screen_share",
        ScreenShareAudio: "screen_share_audio",
      },
      sourceToProto: () => 4,
    },
    ConnectionError: class ConnectionError extends Error {},
  };
});

const admission = {
  url: "wss://server-issued.invalid",
  token: "server-issued-token",
};

beforeEach(async () => {
  await getActiveNativeMeeting()?.leave();
  state.userId = 3001;
  state.authUser = { id: 3001 };
  state.connectError = undefined;
  state.connectWait = undefined;
  state.disconnectError = undefined;
  state.disconnectWait = undefined;
  state.rooms.length = 0;
  state.listeners.clear();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getDisplayMedia: vi.fn(() => {
        throw new Error("Tests must never capture");
      }),
    },
  });
});

it("independent same-ID auth replacement before pending web join owns listeners refuses old admission", async () => {
  const originalOwner = state.authUser;
  const pending = WebMeetingLifecycle.join(3001, "old-admitted-id", admission, {
    microphone: false,
    camera: false,
  });
  state.authUser = null;
  for (const listener of [...state.listeners]) listener();
  state.authUser = { id: 3001 };
  for (const listener of [...state.listeners]) listener();
  expect(state.authUser).not.toBe(originalOwner);
  const outcome = await pending.then(
    () => "accepted",
    () => "rejected",
  );

  try {
    expect(outcome).toBe("rejected");
    expect(state.rooms).toHaveLength(0);
  } finally {
    await getActiveNativeMeeting()?.leave();
  }
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function replaceOwner(user: { id: number } | null) {
  state.authUser = user;
  for (const listener of [...state.listeners]) listener();
}
const preferences = { microphone: false, camera: false };
const interactive = { ...admission, grant_profile: "interactive" as const };
function track() {
  return {
    kind: "video",
    source: "screen_share",
    mediaStreamTrack: {
      readyState: "live",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    stop: vi.fn(),
  };
}
afterEach(async () => {
  state.disconnectError = undefined;
  state.disconnectWait = undefined;
  await getActiveNativeMeeting()?.leave();
  expect(state.listeners.size).toBe(0);
});
it.each(["same-id", "same-object-restored", "different-id"] as const)(
  "retires queued admission for %s owner replacement",
  async (mode) => {
    const original = state.authUser;
    const pending = WebMeetingLifecycle.join(
      3001,
      "old-room",
      interactive,
      preferences,
    ).catch((error) => error);
    replaceOwner(null);
    replaceOwner(
      mode === "same-object-restored"
        ? original
        : { id: mode === "different-id" ? 3002 : 3001 },
    );
    expect(await pending).toMatchObject({
      name: "MeetingJoinFailure",
      stage: "admission",
    });
    expect(state.rooms).toHaveLength(0);
    expect(getActiveNativeMeeting()).toBeUndefined();
  },
);
it("refuses same-ID replacement without a null intermediate state", async () => {
  const pending = WebMeetingLifecycle.join(
    3001,
    "old-room",
    interactive,
    preferences,
  ).catch((error) => error);
  replaceOwner({ id: 3001 });
  expect(await pending).toMatchObject({
    name: "MeetingJoinFailure",
    stage: "admission",
  });
  expect(state.rooms).toHaveLength(0);
});
it("preserves the stable authenticated object through harmless refresh notification", async () => {
  const pending = WebMeetingLifecycle.join(3001, "current-room", interactive, {
    microphone: true,
    camera: true,
  });
  replaceOwner(state.authUser);
  const meeting = await pending,
    local = state.rooms[0].localParticipant;
  expect(local.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  expect(local.setCameraEnabled).toHaveBeenCalledWith(true);
  expect(meeting.session.getSnapshot().status).toBe("connected");
  expect(state.listeners.size).toBe(1);
  await meeting.leave();
});
it.each(["same-id", "same-object-restored"] as const)(
  "refuses delayed network connection and initial capture for %s",
  async (mode) => {
    const network = deferred();
    state.connectWait = network.promise;
    const pending = WebMeetingLifecycle.join(3001, "old-room", interactive, {
      microphone: true,
      camera: true,
    }).catch((error) => error);
    await vi.waitFor(() =>
      expect(state.rooms[0]?.connect).toHaveBeenCalledOnce(),
    );
    const original = state.authUser;
    replaceOwner(null);
    replaceOwner(mode === "same-object-restored" ? original : { id: 3001 });
    network.resolve();
    expect(await pending).toMatchObject({ name: "MeetingJoinFailure" });
    const local = state.rooms[0].localParticipant;
    expect(local.setMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    expect(local.setCameraEnabled).not.toHaveBeenCalledWith(true);
    expect(state.rooms[0].disconnect).toHaveBeenCalledWith(true);
    expect(getActiveNativeMeeting()).toBeUndefined();
  },
);
it("waits for late initial microphone cleanup and never starts camera for replacement owner", async () => {
  const network = deferred();
  state.connectWait = network.promise;
  const mic = deferred();
  const pending = WebMeetingLifecycle.join(3001, "old-room", interactive, {
    microphone: true,
    camera: true,
  }).catch((error) => error);
  await vi.waitFor(() =>
    expect(state.rooms[0]?.connect).toHaveBeenCalledOnce(),
  );
  const room = state.rooms[0],
    local = room.localParticipant,
    microphoneTrack = { stop: vi.fn() };
  local.setMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
    if (enabled) {
      await mic.promise;
      local.trackPublications.set("microphone", {
        track: microphoneTrack,
        isMuted: false,
        source: "microphone",
      });
    }
  });
  network.resolve();
  await vi.waitFor(() =>
    expect(local.setMicrophoneEnabled).toHaveBeenCalledWith(true),
  );
  replaceOwner({ id: 3001 });
  const replacement = WebMeetingLifecycle.join(
    3001,
    "new-room",
    interactive,
    preferences,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.rooms).toHaveLength(1);
  mic.resolve();
  expect(await pending).toMatchObject({ name: "MeetingJoinFailure" });
  const current = await replacement;
  expect(local.setCameraEnabled).not.toHaveBeenCalledWith(true);
  expect(microphoneTrack.stop).toHaveBeenCalled();
  expect(room.disconnect.mock.calls.length).toBeGreaterThan(1);
  expect(getActiveNativeMeeting()).toBe(current);
  expect(state.rooms).toHaveLength(2);
});
it("retires active snapshot synchronously and rejects all old controls on same-ID replacement", async () => {
  const meeting = await WebMeetingLifecycle.join(
      3001,
      "old-room",
      interactive,
      preferences,
    ),
    local = state.rooms[0].localParticipant;
  const stop = deferred();
  state.disconnectWait = stop.promise;
  replaceOwner({ id: 3001 });
  expect(meeting.session.getSnapshot()).toMatchObject({
    status: "disconnected",
    participants: [],
  });
  await expect(meeting.session.setMicrophone(true)).rejects.toThrow(
    "not connected",
  );
  await expect(meeting.session.setCamera(true)).rejects.toThrow(
    "not connected",
  );
  await expect(meeting.session.startScreenShare()).rejects.toThrow(
    "unavailable",
  );
  expect(local.setMicrophoneEnabled).not.toHaveBeenCalledWith(true);
  expect(local.setCameraEnabled).not.toHaveBeenCalledWith(true);
  stop.resolve();
  await meeting.leave();
  expect(getActiveNativeMeeting()).toBeUndefined();
});
it("retains failed owner cleanup, denies old screen controls and blocks replacement until explicit clean retry", async () => {
  const meeting = await WebMeetingLifecycle.join(
    3001,
    "old-room",
    interactive,
    preferences,
  );
  state.disconnectError = new Error("temporary stop failure");
  replaceOwner({ id: 3001 });
  await expect(meeting.leave()).rejects.toThrow("temporary stop failure");
  expect(getActiveNativeMeeting()).toBe(meeting);
  expect(meeting.room).toBeUndefined();
  expect(meeting.session.getRoom()).toBe(state.rooms[0]);
  expect(meeting.session.getSnapshot().screenShare?.available).toBe(false);
  await expect(
    WebMeetingLifecycle.join(3001, "new-room", interactive, preferences),
  ).rejects.toMatchObject({ name: "MeetingJoinFailure" });
  expect(state.rooms).toHaveLength(1);
  state.disconnectError = undefined;
  const current = await WebMeetingLifecycle.join(
    3001,
    "new-room",
    interactive,
    preferences,
  );
  expect(state.rooms).toHaveLength(2);
  expect(getActiveNativeMeeting()).toBe(current);
});
it("a join waiting for the previous leave cannot borrow a replacement same-ID owner", async () => {
  await WebMeetingLifecycle.join(
    3001,
    "previous-room",
    interactive,
    preferences,
  );
  const stop = deferred();
  state.disconnectWait = stop.promise;
  const queued = WebMeetingLifecycle.join(
    3001,
    "queued-old-room",
    interactive,
    preferences,
  ).catch((error) => error);
  await vi.waitFor(() => expect(state.rooms[0].disconnect).toHaveBeenCalled());
  replaceOwner(null);
  replaceOwner({ id: 3001 });
  stop.resolve();
  expect(await queued).toMatchObject({
    name: "MeetingJoinFailure",
    stage: "admission",
  });
  expect(state.rooms).toHaveLength(1);
  state.disconnectWait = undefined;
  const current = await WebMeetingLifecycle.join(
    3001,
    "fresh-room",
    interactive,
    preferences,
  );
  expect(getActiveNativeMeeting()).toBe(current);
  expect(state.rooms).toHaveLength(2);
});
it("stops a late picker result without publication after same-ID reauthentication", async () => {
  const meeting = await WebMeetingLifecycle.join(
      3001,
      "old-room",
      interactive,
      preferences,
    ),
    local = state.rooms[0].localParticipant;
  const chooser = deferred<ReturnType<typeof track>[]>();
  local.createScreenTracks.mockReturnValue(chooser.promise);
  const starting = meeting.session.startScreenShare().catch((error) => error),
    captured = track();
  replaceOwner(null);
  replaceOwner({ id: 3001 });
  chooser.resolve([captured]);
  expect(await starting).toBeInstanceOf(Error);
  await meeting.leave();
  expect(captured.stop).toHaveBeenCalled();
  expect(local.publishTrack).not.toHaveBeenCalled();
});
it("drains a late screen publish before a fresh same-ID room starts", async () => {
  const meeting = await WebMeetingLifecycle.join(
      3001,
      "old-room",
      interactive,
      preferences,
    ),
    local = state.rooms[0].localParticipant;
  const captured = track(),
    publish = deferred();
  local.createScreenTracks.mockResolvedValue([captured]);
  local.publishTrack.mockImplementation(async (value: unknown) => {
    await publish.promise;
    local.trackPublications.set("screen", {
      track: value,
      isMuted: false,
      source: "screen_share",
    });
  });
  const starting = meeting.session.startScreenShare().catch((error) => error);
  await vi.waitFor(() => expect(local.publishTrack).toHaveBeenCalledOnce());
  replaceOwner({ id: 3001 });
  const replacement = WebMeetingLifecycle.join(
    3001,
    "fresh-room",
    interactive,
    preferences,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.rooms).toHaveLength(1);
  publish.resolve();
  expect(await starting).toBeInstanceOf(Error);
  const current = await replacement;
  expect(captured.stop).toHaveBeenCalled();
  expect(local.unpublishTrack).toHaveBeenCalled();
  expect(local.trackPublications.size).toBe(0);
  expect(getActiveNativeMeeting()).toBe(current);
});
it("old provider events and repeated old leave cannot damage the replacement room", async () => {
  const old = await WebMeetingLifecycle.join(
      3001,
      "old-room",
      interactive,
      preferences,
    ),
    oldRoom = state.rooms[0];
  replaceOwner({ id: 3001 });
  await old.leave();
  const current = await WebMeetingLifecycle.join(
      3001,
      "current-room",
      interactive,
      preferences,
    ),
    currentRoom = state.rooms[1];
  oldRoom.emit("reconnected");
  oldRoom.emit("moved");
  oldRoom.emit("participantConnected");
  await old.leave();
  expect(getActiveNativeMeeting()).toBe(current);
  expect(current.session.getSnapshot().status).toBe("connected");
  expect(currentRoom.disconnect).not.toHaveBeenCalled();
});
