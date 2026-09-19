import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const rooms: any[] = [];
  return {
    authUser: { id: 11 },
    listeners,
    rooms,
    startAudioSession: vi.fn(async () => {}),
    stopAudioSession: vi.fn(async () => {}),
    registerGlobals: vi.fn(),
    sipState: { incomingCall: null, activeCalls: {} as Record<string, { status: string }> },
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: mocks.authUser, loading: false, error: null }),
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
vi.mock("livekit-client", () => ({
  Room: class FakeRoom {
    localParticipant = {
      identity: "local",
      name: "Local",
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      setMicrophoneEnabled: vi.fn(async (enabled: boolean) => { this.localParticipant.isMicrophoneEnabled = enabled; }),
      setCameraEnabled: vi.fn(async (enabled: boolean) => { this.localParticipant.isCameraEnabled = enabled; }),
    };
    remoteParticipants = new Map();
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    on = vi.fn();
    off = vi.fn();
    constructor() { mocks.rooms.push(this); }
  },
}));

let native: typeof import("./native-session");
let registry: typeof import("./native-session-registry");

const admission = { url: "wss://server-issued.example", token: "server-issued-token" };
const preferences = { microphone: true, camera: true };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.authUser = { id: 11 };
  mocks.listeners.clear();
  mocks.rooms.length = 0;
  mocks.sipState = { incomingCall: null, activeCalls: {} };
  mocks.startAudioSession.mockResolvedValue(undefined);
  mocks.stopAudioSession.mockResolvedValue(undefined);
  native = await import("./native-session");
  registry = await import("./native-session-registry");
});

afterEach(() => vi.restoreAllMocks());

describe("native meeting lifecycle", () => {
  it("rechecks ownership after native audio start and never registers a meeting raced by SIP", async () => {
    mocks.startAudioSession.mockImplementation(async () => {
      const sip = native.phone11MediaOwnership.requestSip("sip:race");
      await sip.ready;
    });

    await expect(native.NativeMeetingLifecycle.join("meeting-race", admission, preferences))
      .rejects.toThrow("Phone call started before the meeting audio could start");

    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(mocks.rooms[0].disconnect).toHaveBeenCalledWith(true);
    expect(native.phone11MediaOwnership.getSnapshot().owner).toMatchObject({ kind: "sip", id: "sip:race" });
  });

  it("uses the coordinator resume path only after SIP has released an interrupted meeting", async () => {
    const first = await native.NativeMeetingLifecycle.join("meeting-resume", admission, preferences);
    const sip = native.phone11MediaOwnership.requestSip("sip:resume");
    await sip.ready;
    native.releaseSipMediaOwnership(sip.lease);

    const resumed = await native.NativeMeetingLifecycle.join("meeting-resume", admission, preferences);

    expect(resumed).not.toBe(first);
    expect(registry.getActiveNativeMeeting(11)).toBe(resumed);
    expect(native.phone11MediaOwnership.getSnapshot().resumeRequired).toBe(false);
    await resumed.leave();
  });

  it("releases the lease and registry when audio stop fails, then retries only audio cleanup", async () => {
    const lifecycle = await native.NativeMeetingLifecycle.join("meeting-stop", admission, preferences);
    mocks.stopAudioSession.mockRejectedValueOnce(new Error("audio stop failed"));

    await expect(lifecycle.leave()).rejects.toThrow("audio stop failed");
    expect(registry.getActiveNativeMeeting()).toBeUndefined();
    expect(native.phone11MediaOwnership.getSnapshot().owner).toBeNull();
    expect(mocks.rooms[0].disconnect).toHaveBeenCalledWith(true);

    await expect(lifecycle.releaseAfterMediaStops()).resolves.toBeUndefined();
    expect(mocks.stopAudioSession).toHaveBeenCalledTimes(2);
  });

  it("disconnects an authenticated owner immediately when a different account replaces it", async () => {
    await native.NativeMeetingLifecycle.join("meeting-owner", admission, preferences);
    mocks.authUser = { id: 12 };
    for (const listener of [...mocks.listeners]) listener();
    await vi.waitFor(() => expect(registry.getActiveNativeMeeting()).toBeUndefined());

    expect(registry.getActiveNativeMeeting(12)).toBeUndefined();
    expect(mocks.rooms[0].disconnect).toHaveBeenCalledWith(true);
  });

  it("keeps an incoming SIP preparation pending for one verified prior-account voice-stop retry", async () => {
    const stopForSip = vi.fn().mockRejectedValueOnce(new Error("recorder still active")).mockResolvedValue(undefined);
    const voice = native.phone11MediaOwnership.requestVoiceNote("prior-account-voice", { stopForSip });
    await voice.ready;
    native.clearNativeMeetingMediaForAuth();
    await vi.waitFor(() => expect(stopForSip).toHaveBeenCalledTimes(1));

    const lease = await native.prepareSipMediaOwnership("retry-call");
    expect(stopForSip).toHaveBeenCalledTimes(2);
    expect(native.phone11MediaOwnership.isCurrent(lease)).toBe(true);
  });

  it("rejects SIP preparation when its one verified voice-stop retry fails", async () => {
    const stopForSip = vi.fn(async () => { throw new Error("recorder still active"); });
    const voice = native.phone11MediaOwnership.requestVoiceNote("prior-account-voice", { stopForSip });
    await voice.ready;
    native.clearNativeMeetingMediaForAuth();
    await vi.waitFor(() => expect(stopForSip).toHaveBeenCalledTimes(1));

    await expect(native.prepareSipMediaOwnership("retry-call")).rejects.toMatchObject({ code: "pause-failed" });
    expect(stopForSip).toHaveBeenCalledTimes(2);
    expect(() => native.phone11MediaOwnership.requestMeeting("still-blocked", { pauseForSip: async () => {} })).toThrow("pause-failed");
  });
});
