import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const rooms: any[] = [];
  const lifecycleEvents: string[] = [];
  return {
    authUser: { id: 11 } as { id: number; name?: string } | null,
    listeners,
    sipListeners: new Set<() => void>(),
    rooms,
    lifecycleEvents,
    platformOS: "ios" as "ios" | "android",
    configureMeetingAudio: vi.fn(async () => {
      lifecycleEvents.push("audio-config");
    }),
    startAudioSession: vi.fn(async () => {
      lifecycleEvents.push("audio-start");
    }),
    stopAudioSession: vi.fn(async () => {}),
    getAudioOutputs: vi.fn(async () => ["speaker", "earpiece"]),
    selectAudioOutput: vi.fn(async (_deviceId: string) => {}),
    roomConnect: vi.fn(async () => {
      lifecycleEvents.push("room-connect");
    }),
    roomConstructorError: undefined as unknown,
    bindingsLoad: undefined as Promise<void> | undefined,
    bindingsLoadEntered: vi.fn(),
    registerGlobals: vi.fn(),
    screenBridge: {
      phone11ScreenSupported: vi.fn(async () => true),
      phone11ScreenBegin: vi.fn(async () => ({ streamId: "native-screen", track: { id: "screen", kind: "video", remote: false, readyState: "live" } })),
      phone11ScreenCancel: vi.fn(async () => {}),
      phone11ScreenStop: vi.fn(async () => {}),
    },
    ConnectionError: undefined as unknown as new (
      message: string,
      reason: number,
      status?: number,
      context?: unknown,
    ) => Error & { reason: number; status?: number; context?: unknown },
    sipState: {
      incomingCall: null,
      activeCalls: {} as Record<string, { status: string }>,
    },
  };
});

vi.mock("react-native", () => ({ NativeModules: { WebRTCModule: mocks.screenBridge }, Platform: { get OS() { return mocks.platformOS; } } }));
vi.mock("@/lib/_core/auth", () => ({
  getAuthSnapshot: () => ({
    user: mocks.authUser,
    loading: false,
    error: null,
  }),
  addAuthChangeListener: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));
vi.mock("@/lib/sip/call-store", () => ({
  useSipCallStore: { getState: () => mocks.sipState, subscribe: (listener: () => void) => { mocks.sipListeners.add(listener); return () => mocks.sipListeners.delete(listener); } },
}));
function nativeBindingsMock() {
  return {
  registerGlobals: mocks.registerGlobals,
  AudioSession: {
    setAppleAudioConfiguration: mocks.configureMeetingAudio,
    startAudioSession: mocks.startAudioSession,
    stopAudioSession: mocks.stopAudioSession,
    getAudioOutputs: mocks.getAudioOutputs,
    selectAudioOutput: mocks.selectAudioOutput,
  },
  };
}
vi.mock("@livekit/react-native", () => nativeBindingsMock());
vi.mock("livekit-client", () => {
  class ConnectionError extends Error {
    constructor(
      message: string,
      readonly reason: number,
      readonly status?: number,
      readonly context?: unknown,
    ) {
      super(message);
    }
  }
  mocks.ConnectionError = ConnectionError;
  return {
    ConnectionError,
    Track: { Source: { ScreenShare: "screen_share" }, sourceToProto: () => 3 },
    LocalVideoTrack: class {
      kind = "video"; source = "screen_share";
      constructor(readonly mediaStreamTrack: any) {}
      stop() { this.mediaStreamTrack.readyState = "ended"; }
    },
    ConnectionErrorReason: {
      NotAllowed: 0,
      ServerUnreachable: 1,
      InternalError: 2,
      Cancelled: 3,
      LeaveRequest: 4,
      Timeout: 5,
      WebSocket: 6,
      ServiceNotFound: 7,
    },
    Room: class FakeRoom {
      private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      localParticipant = {
        identity: "local",
        name: "Local",
        permissions: { canPublish: true, canPublishSources: [3] },
        trackPublications: new Map(),
        publishTrack: vi.fn(async (track: any) => { this.localParticipant.trackPublications.set("screen", { track, isMuted: false }); }),
        unpublishTrack: vi.fn(async (track: any) => { this.localParticipant.trackPublications.delete("screen"); }),
        isMicrophoneEnabled: false,
        isCameraEnabled: false,
        setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
          this.localParticipant.isMicrophoneEnabled = enabled;
        }),
        setCameraEnabled: vi.fn(async (enabled: boolean) => {
          this.localParticipant.isCameraEnabled = enabled;
        }),
      };
      remoteParticipants = new Map();
      connect = vi.fn(async () => mocks.roomConnect());
      disconnect = vi.fn(async () => {});
      on(event: string, listener: (...args: unknown[]) => void) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(listener);
      }
      off(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.get(event)?.delete(listener);
      }
      emit(event: string) {
        this.listeners.get(event)?.forEach((listener) => listener());
      }
      setMaxListeners() {
        return this;
      }
      constructor() {
        if (mocks.roomConstructorError !== undefined)
          throw mocks.roomConstructorError;
        mocks.rooms.push(this);
      }
    },
  };
});

vi.mock("@livekit/react-native-webrtc", () => ({
  MediaStream: class {
    constructor(readonly data: any) {}
    getVideoTracks() { return this.data.tracks.map((info: any) => ({ ...info, addEventListener: vi.fn(), removeEventListener: vi.fn() })); }
    getAudioTracks() { return []; }
  },
}));
let native: typeof import("./native-session");
let registry: typeof import("./native-session-registry");

const admission = {
  url: "wss://server-issued.example",
  token: "server-issued-token",
};
const preferences = { microphone: true, camera: true };

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION", "0");
  vi.clearAllMocks();
  mocks.authUser = { id: 11 };
  mocks.listeners.clear();
  mocks.sipListeners.clear();
  mocks.rooms.length = 0;
  mocks.lifecycleEvents.length = 0;
  mocks.platformOS = "ios";
  mocks.roomConstructorError = undefined;
  mocks.bindingsLoad = undefined;
  mocks.sipState = { incomingCall: null, activeCalls: {} };
  mocks.screenBridge.phone11ScreenSupported.mockResolvedValue(true);
  mocks.screenBridge.phone11ScreenBegin.mockResolvedValue({ streamId: "native-screen", track: { id: "screen", kind: "video", remote: false, readyState: "live" } });
  mocks.screenBridge.phone11ScreenCancel.mockResolvedValue(undefined);
  mocks.screenBridge.phone11ScreenStop.mockResolvedValue(undefined);
  mocks.startAudioSession.mockImplementation(async () => {
    mocks.lifecycleEvents.push("audio-start");
  });
  mocks.configureMeetingAudio.mockImplementation(async () => {
    mocks.lifecycleEvents.push("audio-config");
  });
  mocks.stopAudioSession.mockResolvedValue(undefined);
  mocks.getAudioOutputs.mockResolvedValue(["speaker", "earpiece"]);
  mocks.selectAudioOutput.mockResolvedValue(undefined);
  vi.doMock("@livekit/react-native", async () => {
    mocks.bindingsLoadEntered();
    await mocks.bindingsLoad;
    return nativeBindingsMock();
  });
  mocks.roomConnect.mockImplementation(async () => {
    mocks.lifecycleEvents.push("room-connect");
  });
  native = await import("./native-session");
  registry = await import("./native-session-registry");
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("native meeting lifecycle", () => {

  it.each(["same-id replacement", "null then same-object restoration"])("refuses native admission interrupted before its first await: %s", async (change) => {
    const original = mocks.authUser;
    const joining = native.NativeMeetingLifecycle.join("early-auth-change", admission, preferences).catch(error => error);
    mocks.authUser = change === "same-id replacement" ? { id: 11 } : null;
    for (const listener of [...mocks.listeners]) listener();
    if (change !== "same-id replacement") {
      mocks.authUser = original;
      for (const listener of [...mocks.listeners]) listener();
    }
    const result = await joining;
    if (result instanceof native.NativeMeetingLifecycle) await result.leave();
    expect(result).toMatchObject({ name: "MeetingJoinFailure" });
    expect(mocks.rooms).toHaveLength(0);
    expect(mocks.startAudioSession).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });

  it("refuses queued same-ID admission after the captured sign-in is replaced", async () => {
    let finishConnect!: () => void;
    mocks.roomConnect.mockImplementationOnce(() => new Promise(resolve => { finishConnect = resolve; }));
    const first = native.NativeMeetingLifecycle.join("auth-queue-first", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalledOnce());
    const queued = native.NativeMeetingLifecycle.join("auth-queue-next", admission, preferences).catch(error => error);
    mocks.authUser = { id: 11 };
    for (const listener of [...mocks.listeners]) listener();
    finishConnect();
    await first;
    const result = await queued;
    if (result instanceof native.NativeMeetingLifecycle) await result.leave();
    expect(result).toMatchObject({ name: "MeetingJoinFailure" });
    expect(mocks.rooms).toHaveLength(1);
    expect(mocks.startAudioSession).toHaveBeenCalledTimes(1);
    expect(mocks.listeners.size).toBe(0);
  });

  it("never publishes initial native media after connect finishes for a replaced same-ID owner", async () => {
    let finishConnect!: () => void;
    mocks.roomConnect.mockImplementationOnce(() => new Promise(resolve => { finishConnect = resolve; }));
    const joining = native.NativeMeetingLifecycle.join("auth-late-connect", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalledOnce());
    mocks.authUser = { id: 11 };
    for (const listener of [...mocks.listeners]) listener();
    finishConnect();
    const result = await joining;
    if (result instanceof native.NativeMeetingLifecycle) await result.leave();
    expect(result).toMatchObject({ name: "MeetingJoinFailure" });
    expect(mocks.rooms[0].localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(mocks.rooms[0].localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
  });

  it("retires a connected native room when a new sign-in has the same numeric owner", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("auth-same-id-connected", admission, preferences);
    mocks.authUser = { id: 11 };
    for (const listener of [...mocks.listeners]) listener();
    await new Promise(resolve => setTimeout(resolve, 0));
    const stillConnected = lifecycle.session.getSnapshot().status;
    await lifecycle.leave();
    expect(stillConnected).toBe("disconnected");
  });
  it.each(["same-id replacement", "null then same-object restoration"])("refuses a native binding load interrupted by %s", async (change) => {
    const original = mocks.authUser;
    let finishLoad!: () => void;
    mocks.bindingsLoad = new Promise(resolve => { finishLoad = resolve; });
    const joining = native.NativeMeetingLifecycle.join("auth-bindings", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.bindingsLoadEntered).toHaveBeenCalledOnce());
    mocks.authUser = change === "same-id replacement" ? { id: 11 } : null;
    for (const listener of [...mocks.listeners]) listener();
    if (change !== "same-id replacement") {
      mocks.authUser = original;
      for (const listener of [...mocks.listeners]) listener();
    }
    finishLoad();
    expect(await joining).toMatchObject({ name: "MeetingJoinFailure", stage: "admission" });
    expect(mocks.configureMeetingAudio).not.toHaveBeenCalled();
    expect(mocks.startAudioSession).not.toHaveBeenCalled();
    expect(mocks.rooms).toHaveLength(0);
    expect(mocks.listeners.size).toBe(0);
  });

  it("retires before audio activation after auth loss during native configuration", async () => {
    let finishConfigure!: () => void;
    mocks.configureMeetingAudio.mockImplementationOnce(() => new Promise(resolve => { finishConfigure = resolve; }));
    const joining = native.NativeMeetingLifecycle.join("auth-audio-config", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.configureMeetingAudio).toHaveBeenCalledOnce());
    const original = mocks.authUser;
    mocks.authUser = null;
    for (const listener of [...mocks.listeners]) listener();
    mocks.authUser = original;
    for (const listener of [...mocks.listeners]) listener();
    finishConfigure();
    expect(await joining).toMatchObject({ name: "MeetingJoinFailure" });
    expect(mocks.startAudioSession).not.toHaveBeenCalled();
    expect(mocks.rooms).toHaveLength(0);
    expect(mocks.stopAudioSession).toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });

  it.each(["ios", "android"] as const)("stops late %s audio activation for a replaced same-ID owner", async (platform) => {
    mocks.platformOS = platform;
    let finishStart!: () => void;
    mocks.startAudioSession.mockImplementationOnce(() => new Promise(resolve => { finishStart = resolve; }));
    const joining = native.NativeMeetingLifecycle.join("auth-audio-start", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.startAudioSession).toHaveBeenCalledOnce());
    mocks.authUser = { id: 11 };
    for (const listener of [...mocks.listeners]) listener();
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();
    finishStart();
    expect(await joining).toMatchObject({ name: "MeetingJoinFailure" });
    expect(mocks.stopAudioSession).toHaveBeenCalled();
    expect(mocks.rooms).toHaveLength(0);
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  });

  it("retains cleanup custody and refuses replacement/SIP after same-ID auth loss with failed SDK stop", async () => {
    const old = await native.NativeMeetingLifecycle.join("auth-native-stop-failed", admission, preferences);
    const original = mocks.authUser;
    const room = mocks.rooms[0];
    room.disconnect.mockRejectedValue(new Error("persistent native room stop failure"));
    mocks.authUser = { id: 11 };
    for (const listener of [...mocks.listeners]) listener();
    expect(registry.getActiveNativeMeeting(11)).toBeUndefined();
    expect(registry.getActiveNativeMeeting()).toBe(old);
    expect(old.ownerIsCurrent()).toBe(false);
    expect(old.room).toBeUndefined();
    await vi.waitFor(() => expect(room.disconnect).toHaveBeenCalled());
    await expect(old.session.setCamera(true)).rejects.toThrow();
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1);
    await expect(native.NativeMeetingLifecycle.join("new-native-after-auth", admission, preferences))
      .rejects.toMatchObject({ name: "MeetingJoinFailure", stage: "bindings" });
    expect(mocks.rooms).toHaveLength(1);
    await expect(native.prepareSipMediaOwnership("sip:auth-stop-failed")).rejects.toMatchObject({ code: "pause-failed" });
    expect(native.phone11MediaOwnership.getSnapshot().owner?.kind).not.toBe("sip");
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();
    expect(registry.getActiveNativeMeeting()).toBe(old);
    mocks.authUser = original;
    for (const listener of [...mocks.listeners]) listener();
    expect(old.ownerIsCurrent()).toBe(false);
    expect(registry.getActiveNativeMeeting(11)).toBeUndefined();
    room.disconnect.mockResolvedValue(undefined);
    await registry.clearNativeMeetingForAuth();
    expect(mocks.listeners.size).toBe(0);
    await native.phone11MediaOwnership.retryMeetingPause();
    const current = await native.NativeMeetingLifecycle.join("auth-native-stop-failed", admission, preferences);
    expect(current.ownerIsCurrent()).toBe(true);
    expect(old.ownerIsCurrent()).toBe(false);
    await current.leave();
  });

  it("releases the pending auth subscription when native media acquisition is refused", async () => {
    const voice = native.phone11MediaOwnership.requestVoiceNote("active-recorder", { stopForSip: async () => undefined });
    await voice.ready;
    await expect(native.NativeMeetingLifecycle.join("auth-busy-media", admission, preferences))
      .rejects.toMatchObject({ name: "MediaOwnershipError", code: "busy" });
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.startAudioSession).not.toHaveBeenCalled();
    native.phone11MediaOwnership.release(voice.lease);
  });

  it("preserves the exact owner through a stable-object profile refresh", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("auth-native-refresh", admission, preferences);
    mocks.authUser!.name = "Updated visible profile";
    for (const listener of [...mocks.listeners]) listener();
    expect(lifecycle.ownerIsCurrent()).toBe(true);
    expect(lifecycle.room).toBe(mocks.rooms[0]);
    expect(lifecycle.session.getSnapshot().status).toBe("connected");
    expect(mocks.listeners.size).toBe(1);
    await lifecycle.selectAudioOutput("speaker");
    expect(mocks.selectAudioOutput).toHaveBeenCalledOnce();
    await lifecycle.leave();
    expect(mocks.listeners.size).toBe(0);
  });

  it("blocks camera and SIP takeover until a late microphone publication for the retired owner drains", async () => {
    let finishConnect!: () => void;
    mocks.roomConnect.mockImplementationOnce(() => new Promise(resolve => { finishConnect = resolve; }));
    const joining = native.NativeMeetingLifecycle.join("auth-native-late-mic", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalledOnce());
    const room = mocks.rooms[0];
    let finishMicrophone!: () => void;
    room.localParticipant.setMicrophoneEnabled.mockImplementationOnce(async (enabled: boolean) => {
      await new Promise<void>(resolve => { finishMicrophone = resolve; });
      room.localParticipant.isMicrophoneEnabled = enabled;
    });
    finishConnect();
    await vi.waitFor(() => expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledOnce());
    mocks.authUser = { id: 11 };
    for (const listener of [...mocks.listeners]) listener();
    const sip = native.phone11MediaOwnership.requestSip("sip:auth-late-mic");
    let sipReady = false;
    void sip.ready.then(() => { sipReady = true; });
    await Promise.resolve();
    expect(sipReady).toBe(false);
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();
    finishMicrophone();
    expect(await joining).toMatchObject({ name: "MeetingJoinFailure" });
    await sip.ready;
    expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(room.disconnect).toHaveBeenCalledWith(true);
    expect(mocks.stopAudioSession).toHaveBeenCalled();
    expect(native.phone11MediaOwnership.isCurrent(sip.lease)).toBe(true);
    native.releaseSipMediaOwnership(sip.lease);
  });

  it("guards native audio routing and provider callbacks even before an auth notification", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("auth-native-callback", admission, preferences);
    const room = mocks.rooms[0];
    let finishOutputs!: (outputs: string[]) => void;
    mocks.getAudioOutputs.mockImplementationOnce(() => new Promise(resolve => { finishOutputs = resolve; }));
    const routing = lifecycle.selectAudioOutput("speaker").catch(error => error);
    await vi.waitFor(() => expect(mocks.getAudioOutputs).toHaveBeenCalledOnce());
    mocks.authUser = { id: 11 };
    finishOutputs(["speaker"]);
    expect(await routing).toBeInstanceOf(Error);
    expect(mocks.selectAudioOutput).not.toHaveBeenCalled();
    room.emit("reconnected");
    await vi.waitFor(() => expect(registry.getActiveNativeMeeting()).toBeUndefined());
    expect(lifecycle.ownerIsCurrent()).toBe(false);
    expect(room.disconnect).toHaveBeenCalledWith(true);
  });

  it("configures duplex speaker audio before starting the native session and connecting the room", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join(
      "meeting-audio-order",
      admission,
      preferences,
    );

    expect(mocks.configureMeetingAudio).toHaveBeenCalledWith({
      audioCategory: "playAndRecord",
      audioCategoryOptions: [
        "allowBluetooth",
        "allowBluetoothA2DP",
        "allowAirPlay",
        "defaultToSpeaker",
      ],
      audioMode: "videoChat",
    });
    expect(mocks.lifecycleEvents).toEqual(["audio-config", "audio-start", "room-connect"]);
    await lifecycle.leave();
  });

  it("does not configure Apple audio on Android", async () => {
    mocks.platformOS = "android";
    const lifecycle = await native.NativeMeetingLifecycle.join(
      "meeting-android-audio",
      admission,
      preferences,
    );

    expect(mocks.configureMeetingAudio).not.toHaveBeenCalled();
    expect(mocks.lifecycleEvents).toEqual(["audio-start", "room-connect"]);
    await lifecycle.leave();
  });

  it.each([
    ["ios", "meeting-overlap"],
    ["android", "meeting-overlap"],
    ["ios", "meeting-replacement"],
    ["android", "meeting-replacement"],
  ] as const)("stops a superseded native join before %s starts %s", async (platform, nextMeetingId) => {
    mocks.platformOS = platform;
    let finishConnect!: () => void;
    mocks.roomConnect.mockImplementationOnce(() => new Promise(resolve => { finishConnect = resolve; }));
    mocks.stopAudioSession.mockImplementation(async () => { mocks.lifecycleEvents.push("audio-stop"); });
    const first = native.NativeMeetingLifecycle.join("meeting-overlap", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalledOnce());

    const replacement = native.NativeMeetingLifecycle.join(nextMeetingId, admission, preferences);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.rooms).toHaveLength(1);
    expect(mocks.startAudioSession).toHaveBeenCalledTimes(1);
    finishConnect();

    expect(await first).toMatchObject({ name: "MeetingJoinFailure", stage: "post_connect_guard" });
    const current = await replacement;
    expect(mocks.rooms).toHaveLength(2);
    expect(mocks.rooms[0].disconnect).toHaveBeenCalledWith(true);
    expect(mocks.lifecycleEvents.indexOf("audio-stop")).toBeLessThan(mocks.lifecycleEvents.lastIndexOf("audio-start"));
    expect(registry.getActiveNativeMeeting(11)).toBe(current);

    // The SIP hook must belong to the sole current room, including a same-ID
    // replacement. No obsolete room may retain capture outside that barrier.
    const sip = native.phone11MediaOwnership.requestSip("sip:overlap");
    await sip.ready;
    expect(mocks.rooms[1].disconnect).toHaveBeenCalledWith(true);
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(2);
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    native.releaseSipMediaOwnership(sip.lease);
  });

  it("denies replacement capture while superseded native audio cleanup fails, then permits a clean retry", async () => {
    let finishConnect!: () => void;
    mocks.roomConnect.mockImplementationOnce(() => new Promise(resolve => { finishConnect = resolve; }));
    const first = native.NativeMeetingLifecycle.join("meeting-overlap", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalledOnce());
    mocks.stopAudioSession.mockRejectedValue(new Error("native audio stop failed"));
    const replacement = native.NativeMeetingLifecycle.join("meeting-overlap", admission, preferences).catch(error => error);
    finishConnect();

    expect(await first).toMatchObject({ stage: "post_connect_guard" });
    expect(await replacement).toMatchObject({ name: "MeetingJoinFailure", stage: "bindings" });
    expect(mocks.rooms).toHaveLength(1);
    expect(mocks.startAudioSession).toHaveBeenCalledTimes(1);
    expect(registry.getActiveNativeMeeting(11)).toBeDefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({ kind: "meeting" });

    mocks.stopAudioSession.mockResolvedValue(undefined);
    const retried = await native.NativeMeetingLifecycle.join("meeting-overlap", admission, preferences);
    expect(mocks.rooms).toHaveLength(2);
    expect(registry.getActiveNativeMeeting(11)).toBe(retried);
    await retried.leave();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
    expect(mocks.listeners.size).toBe(0);
  });

  it("rejects a queued native admission when the initiating account changes", async () => {
    let finishConnect!: () => void;
    mocks.roomConnect.mockImplementationOnce(() => new Promise(resolve => { finishConnect = resolve; }));
    const first = native.NativeMeetingLifecycle.join("meeting-overlap", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalledOnce());
    const replacement = native.NativeMeetingLifecycle.join("meeting-replacement", admission, preferences).catch(error => error);
    mocks.authUser = { id: 12 };
    finishConnect();

    expect(await first).toMatchObject({ stage: "post_connect_guard" });
    expect(await replacement).toMatchObject({ stage: "admission" });
    expect(mocks.rooms).toHaveLength(1);
    expect(mocks.startAudioSession).toHaveBeenCalledTimes(1);
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
    expect(mocks.listeners.size).toBe(0);
  });

  it("cancels a superseded iOS configuration before starting audio or creating a room", async () => {
    let finishConfigure!: () => void;
    mocks.configureMeetingAudio.mockImplementationOnce(() => new Promise(resolve => { finishConfigure = resolve; }));
    const first = native.NativeMeetingLifecycle.join("meeting-overlap", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.configureMeetingAudio).toHaveBeenCalledOnce());
    const replacement = native.NativeMeetingLifecycle.join("meeting-replacement", admission, preferences);
    expect(mocks.startAudioSession).not.toHaveBeenCalled();
    expect(mocks.rooms).toHaveLength(0);
    finishConfigure();

    expect(await first).toMatchObject({ stage: "post_connect_guard" });
    const current = await replacement;
    expect(mocks.startAudioSession).toHaveBeenCalledTimes(1);
    expect(mocks.rooms).toHaveLength(1);
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
    expect(registry.getActiveNativeMeeting(11)).toBe(current);
    await current.leave();
  });

  it.each(["ios", "android"] as const)("waits for superseded %s audio activation to stop before replacement capture", async (platform) => {
    mocks.platformOS = platform;
    let finishAudioStart!: () => void;
    mocks.startAudioSession.mockImplementationOnce(() => new Promise(resolve => { finishAudioStart = resolve; }));
    const first = native.NativeMeetingLifecycle.join("meeting-overlap", admission, preferences).catch(error => error);
    await vi.waitFor(() => expect(mocks.startAudioSession).toHaveBeenCalledOnce());
    const replacement = native.NativeMeetingLifecycle.join("meeting-replacement", admission, preferences);
    expect(mocks.rooms).toHaveLength(0);
    finishAudioStart();

    expect(await first).toMatchObject({ stage: "post_connect_guard" });
    const current = await replacement;
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
    expect(mocks.rooms).toHaveLength(1);
    expect(registry.getActiveNativeMeeting(11)).toBe(current);
    await current.leave();
  });

  it("offers native outputs and rejects an unavailable route", async () => {
    mocks.platformOS = "android";
    const lifecycle = await native.NativeMeetingLifecycle.join("meeting-route", admission, preferences);
    await expect(lifecycle.getAudioOutputs()).resolves.toEqual(["speaker", "earpiece"]);
    await lifecycle.selectAudioOutput("earpiece");
    expect(mocks.selectAudioOutput).toHaveBeenCalledWith("earpiece");
    await expect(lifecycle.selectAudioOutput("bluetooth")).rejects.toThrow("unavailable");
    expect(mocks.selectAudioOutput).toHaveBeenCalledTimes(1);
    await lifecycle.leave();
  });

  it("uses the installed iOS default and speaker output choices", async () => {
    mocks.getAudioOutputs.mockResolvedValue(["default", "force_speaker"]);
    const lifecycle = await native.NativeMeetingLifecycle.join("meeting-ios-route", admission, preferences);
    await expect(lifecycle.getAudioOutputs()).resolves.toEqual(["default", "force_speaker"]);
    await lifecycle.selectAudioOutput("force_speaker");
    expect(mocks.selectAudioOutput).toHaveBeenCalledWith("force_speaker");
    await lifecycle.leave();
  });

  it("does not issue a late route change after SIP takes the media lease", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("meeting-route-sip", admission, preferences);
    let resolveOutputs!: (outputs: string[]) => void;
    mocks.getAudioOutputs.mockImplementationOnce(() => new Promise(resolve => { resolveOutputs = resolve; }));
    const selection = lifecycle.selectAudioOutput("speaker");
    await vi.waitFor(() => expect(mocks.getAudioOutputs).toHaveBeenCalledTimes(1));
    const sip = native.phone11MediaOwnership.requestSip("sip:route-race");
    resolveOutputs(["speaker"]);
    await expect(selection).rejects.toThrow("unavailable");
    await sip.ready;
    expect(mocks.selectAudioOutput).not.toHaveBeenCalled();
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
    native.releaseSipMediaOwnership(sip.lease);
  });

  it("waits for an in-flight route request before stopping native audio", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("meeting-route-leave", admission, preferences);
    let finishSelection!: () => void;
    mocks.selectAudioOutput.mockImplementationOnce(() => new Promise(resolve => { finishSelection = resolve; }));
    const selection = lifecycle.selectAudioOutput("speaker");
    await vi.waitFor(() => expect(mocks.selectAudioOutput).toHaveBeenCalledTimes(1));
    const leaving = lifecycle.leave();
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();
    finishSelection();
    await selection;
    await leaving;
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
  });

  it("stops a partially configured session and releases media when Apple configuration fails", async () => {
    mocks.configureMeetingAudio.mockRejectedValueOnce(
      new Error("private native audio configuration detail"),
    );

    const failure = await native.NativeMeetingLifecycle.join(
      "meeting-audio-config-reject",
      admission,
      preferences,
    ).catch((error) => error);

    expect(failure).toMatchObject({ name: "MeetingJoinFailure", stage: "audio_start" });
    expect(failure.message).not.toContain("private");
    expect(mocks.startAudioSession).not.toHaveBeenCalled();
    expect(mocks.rooms).toHaveLength(0);
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  });

  it("keeps SIP waiting for native configuration before retiring meeting audio", async () => {
    let finishConfiguration!: () => void;
    mocks.configureMeetingAudio.mockImplementationOnce(async () => {
      mocks.lifecycleEvents.push("audio-config");
      await new Promise<void>((resolve) => { finishConfiguration = resolve; });
    });
    const join = native.NativeMeetingLifecycle.join(
      "meeting-config-sip-race",
      admission,
      preferences,
    );
    await vi.waitFor(() => expect(mocks.configureMeetingAudio).toHaveBeenCalledTimes(1));

    const sip = native.phone11MediaOwnership.requestSip("sip:during-config");
    let sipReady = false;
    void sip.ready.then(() => { sipReady = true; });
    await Promise.resolve();
    expect(sipReady).toBe(false);

    finishConfiguration();
    await expect(join).rejects.toMatchObject({ stage: "audio_start" });
    await sip.ready;
    expect(mocks.startAudioSession).not.toHaveBeenCalled();
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({ kind: "sip", id: "sip:during-config" });
    native.releaseSipMediaOwnership(sip.lease);
  });

  it("keeps SIP waiting for an in-flight microphone publication to stop", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join(
      "meeting-publish-sip-race",
      admission,
      { microphone: false, camera: false },
    );
    const room = mocks.rooms[0];
    let finishPublish!: () => void;
    room.localParticipant.setMicrophoneEnabled.mockImplementationOnce(async (enabled: boolean) => {
      await new Promise<void>((resolve) => { finishPublish = resolve; });
      room.localParticipant.isMicrophoneEnabled = enabled;
      mocks.lifecycleEvents.push("late-microphone-publish");
    });
    mocks.stopAudioSession.mockImplementationOnce(async () => {
      mocks.lifecycleEvents.push("audio-stop");
    });
    const publish = lifecycle.session.setMicrophone(true);
    await vi.waitFor(() => expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1));

    const sip = native.phone11MediaOwnership.requestSip("sip:during-publish");
    let sipReady = false;
    void sip.ready.then(() => { sipReady = true; });
    await Promise.resolve();
    expect(sipReady).toBe(false);
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();

    finishPublish();
    await expect(publish).rejects.toThrow("cancelled");
    await sip.ready;
    expect(mocks.lifecycleEvents.indexOf("audio-stop")).toBeGreaterThan(
      mocks.lifecycleEvents.indexOf("late-microphone-publish"),
    );
    expect(room.disconnect).toHaveBeenCalled();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({
      kind: "sip",
      id: "sip:during-publish",
    });
    native.releaseSipMediaOwnership(sip.lease);
  });

  it("does not release meeting audio before an external disconnect finishes a late publish", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join(
      "meeting-external-publish-race",
      admission,
      { microphone: false, camera: false },
    );
    const room = mocks.rooms[0];
    let finishPublish!: () => void;
    room.localParticipant.setCameraEnabled.mockImplementationOnce(async (enabled: boolean) => {
      await new Promise<void>((resolve) => { finishPublish = resolve; });
      room.localParticipant.isCameraEnabled = enabled;
    });
    const publish = lifecycle.session.setCamera(true);
    await vi.waitFor(() => expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1));

    room.emit("disconnected");
    await Promise.resolve();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({
      kind: "meeting",
      id: "meeting-external-publish-race",
    });
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();

    finishPublish();
    await expect(publish).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1));
    expect(room.disconnect).toHaveBeenCalled();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  });

  it("retires a moved native room immediately and holds audio through late publication and concurrent leave", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("meeting-moved", admission,
      { microphone: false, camera: false });
    const room = mocks.rooms[0];
    let finishPublish!: () => void;
    room.localParticipant.setCameraEnabled.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finishPublish = resolve; });
    });
    const publish = lifecycle.session.setCamera(true);
    await vi.waitFor(() => expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1));
    room.emit("moved");
    expect(lifecycle.session.getSnapshot().status).toBe("disconnected");
    const leave = lifecycle.leave(); let left = false;
    void leave.then(() => { left = true; });
    await expect(lifecycle.session.setMicrophone(true)).rejects.toThrow("not connected");
    await expect(lifecycle.session.setCamera(true)).rejects.toThrow("not connected");
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.stopAudioSession).not.toHaveBeenCalled(); expect(left).toBe(false);
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({ kind: "meeting", id: "meeting-moved" });
    finishPublish(); await expect(publish).rejects.toThrow("cancelled"); await leave;
    expect(mocks.stopAudioSession).toHaveBeenCalled();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
  });

  it("keeps a failed moved-room cleanup owned and refuses SIP until a real disconnect retry succeeds", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("meeting-moved-failed", admission, preferences);
    const room = mocks.rooms[0], stop = vi.fn();
    room.localParticipant.trackPublications = new Map([["camera", { track: { stop } }]]);
    room.disconnect.mockRejectedValue(new Error("sendLeave failed"));
    room.emit("moved");
    await expect(lifecycle.leave()).rejects.toThrow("sendLeave failed");
    expect(stop).toHaveBeenCalled(); expect(mocks.stopAudioSession).not.toHaveBeenCalled();
    expect(registry.getActiveNativeMeeting()).toBe(lifecycle);
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({ kind: "meeting" });
    const sip = native.phone11MediaOwnership.requestSip("sip:moved-cleanup-failed");
    await expect(sip.ready).rejects.toMatchObject({ code: "pause-failed" });
    expect(native.phone11MediaOwnership.getSnapshot().owner?.kind).not.toBe("sip");
    expect(registry.getActiveNativeMeeting()).toBe(lifecycle);
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();
    room.disconnect.mockResolvedValue(undefined);
    await lifecycle.leave();
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    const retriedSip = native.phone11MediaOwnership.requestSip("sip:after-moved-cleanup");
    await retriedSip.ready;
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({ kind: "sip" });
    native.releaseSipMediaOwnership(retriedSip.lease);
  });

  it("rejects a timed-out SIP handoff without releasing still-publishing media", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join(
      "meeting-stuck-publish",
      admission,
      { microphone: false, camera: false },
    );
    const room = mocks.rooms[0];
    let finishPublish!: () => void;
    room.localParticipant.setMicrophoneEnabled.mockImplementationOnce(async (enabled: boolean) => {
      await new Promise<void>((resolve) => { finishPublish = resolve; });
      room.localParticipant.isMicrophoneEnabled = enabled;
    });
    const publish = lifecycle.session.setMicrophone(true);
    await vi.waitFor(() => expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    try {
      const sip = native.phone11MediaOwnership.requestSip("sip:stuck-publish");
      const rejectedHandoff = expect(sip.ready).rejects.toMatchObject({ code: "pause-failed" });
      await vi.advanceTimersByTimeAsync(8001);
      await rejectedHandoff;
      expect(mocks.stopAudioSession).not.toHaveBeenCalled();
      expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
    } finally {
      vi.useRealTimers();
      finishPublish();
      await expect(publish).rejects.toThrow("cancelled");
      await lifecycle.leave();
    }
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
  });

  it("best-effort stops native audio when activation rejects before room creation", async () => {
    mocks.startAudioSession.mockRejectedValueOnce(
      new Error("native audio activation failed"),
    );

    await expect(
      native.NativeMeetingLifecycle.join(
        "meeting-audio-reject",
        admission,
        preferences,
      ),
    ).rejects.toMatchObject({
      name: "MeetingJoinFailure",
      stage: "audio_start",
    });

    expect(mocks.rooms).toHaveLength(0);
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  });

  it("returns only a signal-connect stage when an unknown SDK connection error rejects", async () => {
    mocks.rooms.length = 0;
    mocks.roomConnect.mockRejectedValueOnce(
      new Error("native connection failed"),
    );

    await expect(
      native.NativeMeetingLifecycle.join(
        "meeting-room-reject",
        admission,
        preferences,
      ),
    ).rejects.toMatchObject({
      name: "MeetingJoinFailure",
      stage: "signal_connect",
      reason: undefined,
      httpStatus: undefined,
    });

    expect(mocks.rooms[0].disconnect).toHaveBeenCalledWith(true);
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  });

  it.each([
    [
      new ReferenceError("private constructor URL wss://secret"),
      "reference_error",
    ],
    [new TypeError("private constructor token=secret"), "type_error"],
    [new RangeError("private constructor participant=user-1"), "range_error"],
    [new SyntaxError("private constructor room=private"), "syntax_error"],
    [new EvalError("private constructor detail"), "eval_error"],
    [new URIError("private constructor detail"), "uri_error"],
    [new Error("private constructor detail"), "error"],
  ] as const)(
    "reduces a Room constructor %s to its fixed built-in class",
    async (constructorError, errorType) => {
      mocks.roomConstructorError = constructorError;

      const failure = await native.NativeMeetingLifecycle.join(
        `meeting-constructor-${errorType}`,
        admission,
        preferences,
      ).catch((error) => error);

      expect(failure).toMatchObject({
        name: "MeetingJoinFailure",
        stage: "room_create",
        reason: undefined,
        errorType,
      });
      expect(failure.message).not.toContain("private");
      expect(failure.cause).toMatchObject({ cause: constructorError });
      expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
    },
  );

  it("identifies a missing AbortController without exposing its raw constructor error", async () => {
    const originalAbortController = globalThis.AbortController;
    mocks.roomConstructorError = new ReferenceError(
      "wss://private.example token=secret AbortController",
    );
    Object.defineProperty(globalThis, "AbortController", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      const failure = await native.NativeMeetingLifecycle.join(
        "meeting-missing-abort-controller",
        admission,
        preferences,
      ).catch((error) => error);

      expect(failure).toMatchObject({
        stage: "room_create",
        reason: "abort_controller_missing",
        constructorSite: "data_channel",
        errorType: "reference_error",
      });
      expect(failure.message).not.toContain("private.example");
      expect(failure.message).not.toContain("secret");
    } finally {
      Object.defineProperty(globalThis, "AbortController", {
        configurable: true,
        value: originalAbortController,
        writable: true,
      });
    }
  });

  it("identifies the EventEmitter methods required by the installed Room constructor", async () => {
    const client = await import("livekit-client");
    const roomPrototype = client.Room.prototype as {
      setMaxListeners?: unknown;
    };
    const originalSetMaxListeners = roomPrototype.setMaxListeners;
    mocks.roomConstructorError = new TypeError(
      "wss://private.example token=secret setMaxListeners",
    );
    roomPrototype.setMaxListeners = undefined;

    try {
      const failure = await native.NativeMeetingLifecycle.join(
        "meeting-event-emitter-incompatible",
        admission,
        preferences,
      ).catch((error) => error);

      expect(failure).toMatchObject({
        stage: "room_create",
        reason: "event_emitter_incompatible",
        constructorSite: "room",
        errorType: "type_error",
      });
      expect(failure.message).not.toContain("private");
      expect(failure.message).not.toContain("secret");
    } finally {
      roomPrototype.setMaxListeners = originalSetMaxListeners;
    }
  });

  it("reduces a LiveKit connection error to allowlisted reason and HTTP status only", async () => {
    const privateDetail =
      "wss://private.example/rtc?access_token=secret participant=user-1";
    mocks.roomConnect.mockRejectedValueOnce(
      new mocks.ConnectionError(privateDetail, 0, 401, { token: "secret" }),
    );

    const failure = await native.NativeMeetingLifecycle.join(
      "meeting-safe-diagnostic",
      admission,
      preferences,
    ).catch((error) => error);

    expect(failure).toMatchObject({
      name: "MeetingJoinFailure",
      stage: "signal_connect",
      reason: "not_allowed",
      httpStatus: 401,
    });
    expect(failure.message).not.toContain("private.example");
    expect(failure.message).not.toContain("secret");
    expect(failure.cause).toMatchObject({
      name: "BrowserMeetingConnectionFailure",
      cause: expect.objectContaining({ message: privateDetail }),
    });
  });

  it.each([
    [0, "not_allowed"],
    [1, "server_unreachable"],
    [2, "internal"],
    [3, "cancelled"],
    [4, "server_leave"],
    [5, "timeout"],
    [6, "websocket"],
    [7, "service_not_found"],
  ] as const)(
    "maps SDK connection reason %s to %s",
    async (sdkReason, safeReason) => {
      mocks.roomConnect.mockRejectedValueOnce(
        new mocks.ConnectionError("private SDK detail", sdkReason),
      );

      await expect(
        native.NativeMeetingLifecycle.join(
          `meeting-reason-${sdkReason}`,
          admission,
          preferences,
        ),
      ).rejects.toMatchObject({
        stage: "signal_connect",
        reason: safeReason,
        httpStatus: undefined,
      });
    },
  );

  it("drops undefined SDK reason values and non-HTTP numeric status", async () => {
    mocks.roomConnect.mockRejectedValueOnce(
      new mocks.ConnectionError("private unknown error", 999, 200),
    );

    await expect(
      native.NativeMeetingLifecycle.join(
        "meeting-unknown-diagnostic",
        admission,
        preferences,
      ),
    ).rejects.toMatchObject({
      stage: "signal_connect",
      reason: undefined,
      httpStatus: undefined,
    });
  });

  it("rechecks ownership after native audio start and never registers a meeting raced by SIP", async () => {
    let sipReady: Promise<void> | undefined;
    mocks.startAudioSession.mockImplementation(async () => {
      const sip = native.phone11MediaOwnership.requestSip("sip:race");
      sipReady = sip.ready;
    });

    await expect(
      native.NativeMeetingLifecycle.join(
        "meeting-race",
        admission,
        preferences,
      ),
    ).rejects.toMatchObject({
      name: "MeetingJoinFailure",
      stage: "audio_start",
    });
    await sipReady;

    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(mocks.rooms).toHaveLength(0);
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(1);
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({
      kind: "sip",
      id: "sip:race",
    });
  });

  it("uses the coordinator resume path only after SIP has released an interrupted meeting", async () => {
    const first = await native.NativeMeetingLifecycle.join(
      "meeting-resume",
      admission,
      preferences,
    );
    const sip = native.phone11MediaOwnership.requestSip("sip:resume");
    await sip.ready;
    native.releaseSipMediaOwnership(sip.lease);

    const resumed = await native.NativeMeetingLifecycle.join(
      "meeting-resume",
      admission,
      preferences,
    );

    expect(resumed).not.toBe(first);
    expect(registry.getActiveNativeMeeting(11)).toBe(resumed);
    expect(native.phone11MediaOwnership.getSnapshot().resumeRequired).toBe(
      false,
    );
    await resumed.leave();
  });

  it("holds the lease when audio stop fails, then retries cleanup", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join(
      "meeting-stop",
      admission,
      preferences,
    );
    mocks.stopAudioSession.mockRejectedValueOnce(
      new Error("audio stop failed"),
    );

    await expect(lifecycle.leave()).rejects.toThrow("audio stop failed");
    expect(registry.getActiveNativeMeeting()).toBe(lifecycle);
    expect(native.phone11MediaOwnership.getSnapshot().owner).not.toBeNull();
    expect(mocks.rooms[0].disconnect).toHaveBeenCalledWith(true);

    await expect(lifecycle.leave()).resolves.toBeUndefined();
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(2);
  });

  it("holds the SIP lease when LiveKit disconnect rejects before local tracks stop", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("meeting-stop-error", admission, preferences);
    const room = mocks.rooms[0];
    const stop = vi.fn();
    room.localParticipant.trackPublications = new Map([["audio", { track: { stop } }]]);
    room.disconnect.mockRejectedValueOnce(new Error("sendLeave failed"));
    await expect(lifecycle.leave()).rejects.toThrow("sendLeave failed");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(native.phone11MediaOwnership.getSnapshot().owner).not.toBeNull();
    expect(registry.getActiveNativeMeeting()).toBe(lifecycle);
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();
    await expect(lifecycle.leave()).resolves.toBeUndefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  });

  it("retains failed auth cleanup custody across native replacement and SIP handoff", async () => {
    const old = await native.NativeMeetingLifecycle.join("auth-retired-room", admission, preferences);
    const room = mocks.rooms[0];
    room.disconnect.mockRejectedValue(new Error("persistent old room stop failure"));
    await expect(registry.clearNativeMeetingForAuth()).rejects.toThrow("persistent old room stop failure");
    expect(registry.getActiveNativeMeeting(11)).toBeUndefined();
    expect(registry.getActiveNativeMeeting()).toBe(old);
    expect(native.phone11MediaOwnership.getSnapshot().owner?.kind).toBe("meeting");
    mocks.authUser = { id: 11 };
    await expect(native.NativeMeetingLifecycle.join("replacement-room", admission, preferences))
      .rejects.toMatchObject({ name: "MeetingJoinFailure" });
    expect(mocks.rooms).toHaveLength(1);
    await expect(native.prepareSipMediaOwnership("incoming-while-cleanup-failed"))
      .rejects.toMatchObject({ code: "pause-failed" });
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
    expect(native.phone11MediaOwnership.getSnapshot().meetingPause).toBe("failed");
    expect(registry.getActiveNativeMeeting()).toBe(old);
    expect(mocks.stopAudioSession).not.toHaveBeenCalled();
    room.disconnect.mockResolvedValue(undefined);
    await registry.clearNativeMeetingForAuth();
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    const sip = await native.prepareSipMediaOwnership("incoming-after-clean-retry");
    expect(native.phone11MediaOwnership.isCurrent(sip)).toBe(true);
    expect(mocks.rooms).toHaveLength(1);
    native.releaseSipMediaOwnership(sip);
  });

  it("disconnects an authenticated owner immediately when a different account replaces it", async () => {
    await native.NativeMeetingLifecycle.join(
      "meeting-owner",
      admission,
      preferences,
    );
    mocks.authUser = { id: 12 };
    for (const listener of [...mocks.listeners]) listener();
    await vi.waitFor(() =>
      expect(registry.getActiveNativeMeeting()).toBeUndefined(),
    );

    expect(registry.getActiveNativeMeeting(12)).toBeUndefined();
    expect(mocks.rooms[0].disconnect).toHaveBeenCalledWith(true);
  });

  it("keeps an incoming SIP preparation pending for one verified prior-account voice-stop retry", async () => {
    const stopForSip = vi
      .fn()
      .mockRejectedValueOnce(new Error("recorder still active"))
      .mockResolvedValue(undefined);
    const voice = native.phone11MediaOwnership.requestVoiceNote(
      "prior-account-voice",
      { stopForSip },
    );
    await voice.ready;
    native.clearNativeMeetingMediaForAuth();
    await vi.waitFor(() => expect(stopForSip).toHaveBeenCalledTimes(1));

    const lease = await native.prepareSipMediaOwnership("retry-call");
    expect(stopForSip).toHaveBeenCalledTimes(2);
    expect(native.phone11MediaOwnership.isCurrent(lease)).toBe(true);
  });

  it("rejects SIP preparation when its one verified voice-stop retry fails", async () => {
    const stopForSip = vi.fn(async () => {
      throw new Error("recorder still active");
    });
    const voice = native.phone11MediaOwnership.requestVoiceNote(
      "prior-account-voice",
      { stopForSip },
    );
    await voice.ready;
    native.clearNativeMeetingMediaForAuth();
    await vi.waitFor(() => expect(stopForSip).toHaveBeenCalledTimes(1));

    await expect(
      native.prepareSipMediaOwnership("retry-call"),
    ).rejects.toMatchObject({ code: "pause-failed" });
    expect(stopForSip).toHaveBeenCalledTimes(2);
    expect(() =>
      native.phone11MediaOwnership.requestMeeting("still-blocked", {
        pauseForSip: async () => {},
      }),
    ).toThrow("pause-failed");
  });
});

function screenDeferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const screenTick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function screenJoin(grant_profile: "interactive" | "listener" | undefined = "interactive") {
  mocks.platformOS = "android"; vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION", "1");
  return native.NativeMeetingLifecycle.join("screen-room", { ...admission, grant_profile }, { microphone: false, camera: false });
}
describe("Android screen transaction uses original native lifecycle authority", () => {
  it("ordinary Android and iOS never ask native support or expose sharing", async () => {
    mocks.platformOS = "android";
    const ordinary = await native.NativeMeetingLifecycle.join("ordinary", admission, preferences);
    expect(ordinary.session.getSnapshot().screenShare).toBeUndefined(); await ordinary.leave();
    mocks.platformOS = "ios"; vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION", "1");
    const ios = await native.NativeMeetingLifecycle.join("ios", admission, preferences);
    expect(ios.session.getSnapshot().screenShare).toBeUndefined(); expect(mocks.screenBridge.phone11ScreenSupported).not.toHaveBeenCalled(); await ios.leave();
  });
  it.each(["listener", "missing"])("%s admission cannot use the native screen API", async grant => {
    const life = grant === "listener" ? await screenJoin("listener") : await (async () => { mocks.platformOS = "android"; vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION", "1"); return native.NativeMeetingLifecycle.join("screen-room", admission, preferences); })();
    expect(life.session.getSnapshot().screenShare).toBeUndefined(); await expect(life.session.startScreenShare()).rejects.toThrow("unavailable");
    expect(mocks.screenBridge.phone11ScreenBegin).not.toHaveBeenCalled(); await life.leave();
  });
  it("rejects an ON source build without the installed native gate", async () => {
    mocks.screenBridge.phone11ScreenSupported.mockResolvedValue(false);
    await expect(screenJoin()).rejects.toMatchObject({ stage: "bindings" }); expect(mocks.rooms).toHaveLength(0);
  });
  it("requires explicit Share and publishes one video using the existing room", async () => {
    const life = await screenJoin(); expect(life.session.getSnapshot().screenShare?.available).toBe(true);
    expect(mocks.screenBridge.phone11ScreenBegin).not.toHaveBeenCalled(); await life.session.startScreenShare();
    expect(mocks.screenBridge.phone11ScreenBegin).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^phone11-room-/));
    expect(mocks.rooms).toHaveLength(1); const room = mocks.rooms[0];
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(expect.objectContaining({ kind: "video", source: "screen_share" }));
    await life.leave(); expect(mocks.screenBridge.phone11ScreenCancel).toHaveBeenCalled();
  });
  it.each(["same-owner", "null-restore", "leave", "reconnect", "permission"])("%s retires a pending chooser before late consent", async reason => {
    const pending = screenDeferred<any>(); mocks.screenBridge.phone11ScreenBegin.mockReturnValue(pending.promise);
    mocks.screenBridge.phone11ScreenCancel.mockImplementation(async () => { pending.reject(new Error("native chooser retired")); });
    const life = await screenJoin(), share = life.session.startScreenShare(), rejected = expect(share).rejects.toThrow();
    let leaving: Promise<void> | undefined;
    if (reason === "same-owner") { mocks.authUser = { id: 11 }; [...mocks.listeners].forEach(fn => fn()); }
    if (reason === "null-restore") { const original = mocks.authUser; mocks.authUser = null; [...mocks.listeners].forEach(fn => fn()); mocks.authUser = original; [...mocks.listeners].forEach(fn => fn()); }
    if (reason === "leave") leaving = life.leave();
    if (reason === "reconnect") mocks.rooms[0].emit("reconnecting");
    if (reason === "permission") { mocks.rooms[0].localParticipant.permissions.canPublish = false; mocks.rooms[0].emit("participantPermissionsChanged"); }
    expect(mocks.screenBridge.phone11ScreenCancel).toHaveBeenCalled(); await rejected; await leaving; await screenTick();
    pending.resolve({ streamId: "late", track: { id: "late", kind: "video", remote: false, readyState: "live" } });
    expect(mocks.rooms[0].localParticipant.publishTrack).not.toHaveBeenCalled();
    await life.leave();
  });
  it("SIP handoff waits for native destruction ACK and never resumes capture", async () => {
    const life = await screenJoin(); await life.session.startScreenShare();
    const ack = screenDeferred<void>(); mocks.screenBridge.phone11ScreenCancel.mockReturnValue(ack.promise);
    const sip = native.phone11MediaOwnership.requestSip("sip:screen"); let ready = false; void sip.ready.then(() => { ready = true; });
    await screenTick(); expect(ready).toBe(false); expect(mocks.screenBridge.phone11ScreenCancel).toHaveBeenCalled();
    ack.resolve(undefined); await sip.ready; expect(mocks.screenBridge.phone11ScreenBegin).toHaveBeenCalledTimes(1);
    native.phone11MediaOwnership.release(sip.lease); await life.leave();
  });
  it("failed native destruction retains lease and cleanup custody until retry", async () => {
    const life = await screenJoin(); await life.session.startScreenShare();
    mocks.screenBridge.phone11ScreenCancel.mockRejectedValue(new Error("destroy not acknowledged"));
    mocks.screenBridge.phone11ScreenStop.mockRejectedValue(new Error("destroy not acknowledged"));
    await expect(life.leave()).rejects.toThrow("destroy not acknowledged");
    expect(native.phone11MediaOwnership.getSnapshot().owner?.kind).toBe("meeting"); expect(registry.getActiveNativeMeeting()).toBe(life);
    await expect(life.session.startScreenShare()).rejects.toThrow("unavailable");
    mocks.screenBridge.phone11ScreenCancel.mockResolvedValue(undefined); mocks.screenBridge.phone11ScreenStop.mockResolvedValue(undefined);
    await life.leave(); expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull(); expect(registry.getActiveNativeMeeting()).toBeUndefined();
  });
  it("late publication after logout drains the same track and original lease", async () => {
    const life = await screenJoin(), publish = screenDeferred<void>(), room = mocks.rooms[0];
    room.localParticipant.publishTrack.mockImplementation(async (track: any) => { await publish.promise; room.localParticipant.trackPublications.set("screen", { track }); });
    const share = life.session.startScreenShare(), rejected = expect(share).rejects.toThrow(); await screenTick();
    mocks.authUser = null; [...mocks.listeners].forEach(fn => fn()); expect(mocks.screenBridge.phone11ScreenCancel).toHaveBeenCalled();
    expect(native.phone11MediaOwnership.getSnapshot().owner?.kind).toBe("meeting"); publish.resolve(undefined);
    await rejected; await life.leave(); expect(room.localParticipant.trackPublications.size).toBe(0); expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
  });
});

it("live SIP state retires native consent immediately even before coordinated handoff", async () => {
  const pending = screenDeferred<any>(); mocks.screenBridge.phone11ScreenBegin.mockReturnValue(pending.promise);
  mocks.screenBridge.phone11ScreenCancel.mockImplementation(async () => { pending.reject(new Error("SIP interrupted chooser")); });
  const life = await screenJoin(), sharing = life.session.startScreenShare(), rejected = expect(sharing).rejects.toThrow();
  mocks.sipState.activeCalls = { live: { status: "connected" } }; [...mocks.sipListeners].forEach(fn => fn());
  expect(mocks.screenBridge.phone11ScreenCancel).toHaveBeenCalled(); await rejected;
  expect(mocks.rooms[0].localParticipant.publishTrack).not.toHaveBeenCalled(); await life.leave(); expect(mocks.sipListeners.size).toBe(0);
});
