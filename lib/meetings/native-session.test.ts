import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const rooms: any[] = [];
  const lifecycleEvents: string[] = [];
  return {
    authUser: { id: 11 },
    listeners,
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
    roomConnect: vi.fn(async () => {
      lifecycleEvents.push("room-connect");
    }),
    roomConstructorError: undefined as unknown,
    registerGlobals: vi.fn(),
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

vi.mock("react-native", () => ({ Platform: { get OS() { return mocks.platformOS; } } }));
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
  useSipCallStore: { getState: () => mocks.sipState },
}));
vi.mock("@livekit/react-native", () => ({
  registerGlobals: mocks.registerGlobals,
  AudioSession: {
    setAppleAudioConfiguration: mocks.configureMeetingAudio,
    startAudioSession: mocks.startAudioSession,
    stopAudioSession: mocks.stopAudioSession,
  },
}));
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

let native: typeof import("./native-session");
let registry: typeof import("./native-session-registry");

const admission = {
  url: "wss://server-issued.example",
  token: "server-issued-token",
};
const preferences = { microphone: true, camera: true };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.authUser = { id: 11 };
  mocks.listeners.clear();
  mocks.rooms.length = 0;
  mocks.lifecycleEvents.length = 0;
  mocks.platformOS = "ios";
  mocks.roomConstructorError = undefined;
  mocks.sipState = { incomingCall: null, activeCalls: {} };
  mocks.startAudioSession.mockImplementation(async () => {
    mocks.lifecycleEvents.push("audio-start");
  });
  mocks.configureMeetingAudio.mockImplementation(async () => {
    mocks.lifecycleEvents.push("audio-config");
  });
  mocks.stopAudioSession.mockResolvedValue(undefined);
  mocks.roomConnect.mockImplementation(async () => {
    mocks.lifecycleEvents.push("room-connect");
  });
  native = await import("./native-session");
  registry = await import("./native-session-registry");
});

afterEach(() => vi.restoreAllMocks());

describe("native meeting lifecycle", () => {
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
