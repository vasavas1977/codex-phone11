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

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
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
      on() {}
      off() {}
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
  mocks.roomConstructorError = undefined;
  mocks.sipState = { incomingCall: null, activeCalls: {} };
  mocks.startAudioSession.mockImplementation(async () => {
    mocks.lifecycleEvents.push("audio-start");
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
  it("starts the manually managed native audio session before connecting the server-issued room", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join(
      "meeting-audio-order",
      admission,
      preferences,
    );

    expect(mocks.lifecycleEvents).toEqual(["audio-start", "room-connect"]);
    await lifecycle.leave();
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
    mocks.startAudioSession.mockImplementation(async () => {
      const sip = native.phone11MediaOwnership.requestSip("sip:race");
      await sip.ready;
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

  it("releases the lease and registry when audio stop fails, then retries only audio cleanup", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join(
      "meeting-stop",
      admission,
      preferences,
    );
    mocks.stopAudioSession.mockRejectedValueOnce(
      new Error("audio stop failed"),
    );

    await expect(lifecycle.leave()).rejects.toThrow("audio stop failed");
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
    expect(mocks.rooms[0].disconnect).toHaveBeenCalledWith(true);

    await expect(lifecycle.releaseAfterMediaStops()).resolves.toBeUndefined();
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(2);
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
