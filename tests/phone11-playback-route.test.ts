import { beforeEach, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({
  platform: { OS: "ios" },
  listener: undefined as undefined | ((event: unknown) => void),
  native: {
    getPlaybackAudioRoute: vi.fn(async () => ({
      route: "earpiece",
      label: "Earpiece",
    })),
    setPlaybackAudioRoute: vi.fn(async (route: string) => ({
      route,
      label: route === "speaker" ? "Speaker" : "Earpiece",
    })),
    resetPlaybackAudioRoute: vi.fn(async () => ({
      route: "speaker",
      label: "Speaker",
    })),
  },
  setMode: vi.fn(async (_mode: unknown) => {}),
}));
vi.mock("react-native", () => ({
  Platform: audio.platform,
  NativeModules: { Phone11Siprix: audio.native },
  NativeEventEmitter: class {
    addListener(_name: string, listener: (event: unknown) => void) {
      audio.listener = listener;
      return { remove: vi.fn() };
    }
  },
}));
vi.mock("expo-audio", () => ({
  setAudioModeAsync: (mode: unknown) => audio.setMode(mode),
}));

import {
  normalizePlaybackAudioRoute,
  readPlaybackAudioRoute,
  resetPlaybackAudioRoute,
  setPlaybackAudioRoute,
  subscribeToPlaybackAudioRoute,
} from "../lib/cloud-recordings/playback-route";

beforeEach(() => {
  vi.clearAllMocks();
  audio.listener = undefined;
  audio.platform.OS = "ios";
});

it("uses the guarded native iOS route and reads its effective output", async () => {
  await expect(setPlaybackAudioRoute("earpiece", () => true)).resolves.toEqual({
    route: "earpiece",
    label: "Earpiece",
  });
  expect(audio.native.setPlaybackAudioRoute).toHaveBeenCalledWith("earpiece");
  await expect(readPlaybackAudioRoute()).resolves.toEqual({
    route: "earpiece",
    label: "Earpiece",
  });
  expect(audio.setMode).not.toHaveBeenCalled();
});

it("restores only when safe and leaves call audio untouched", async () => {
  await expect(resetPlaybackAudioRoute(() => true)).resolves.toBe(true);
  expect(audio.native.resetPlaybackAudioRoute).toHaveBeenCalledOnce();
  audio.native.resetPlaybackAudioRoute.mockClear();
  await expect(setPlaybackAudioRoute("speaker", () => false)).rejects.toThrow(
    "CALL_AUDIO_ACTIVE",
  );
  await expect(resetPlaybackAudioRoute(() => false)).resolves.toBe(false);
  expect(audio.native.resetPlaybackAudioRoute).not.toHaveBeenCalled();
});

it("preserves the native picker choice without pretending system is an output", async () => {
  audio.native.setPlaybackAudioRoute.mockResolvedValueOnce({
    route: "external",
    label: "Bluetooth",
  });
  await expect(setPlaybackAudioRoute("system", () => true)).resolves.toEqual({
    route: "external",
    label: "Bluetooth",
  });
  expect(audio.native.setPlaybackAudioRoute).toHaveBeenCalledWith("system");
  expect(audio.setMode).not.toHaveBeenCalled();
  expect(normalizePlaybackAudioRoute({ route: "system" })).toEqual({
    route: "unknown",
    label: "Audio output",
  });
});

it("reports external route events without exposing arbitrary native labels", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeToPlaybackAudioRoute(listener);
  audio.listener?.({
    type: "playbackAudioRoute",
    route: "external",
    label: "Bluetooth",
  });
  expect(listener).toHaveBeenCalledWith({
    route: "external",
    label: "Bluetooth",
  });
  expect(
    normalizePlaybackAudioRoute({
      route: "external",
      label: "private device name",
    }),
  ).toEqual({
    route: "external",
    label: "Connected audio",
  });
  unsubscribe();
});

const androidPlayer = () => ({
  getPlaybackAudioRoute: vi.fn(() => ({
    route: "unknown",
    availableRoutes: ["speaker", "system"],
  })),
  setPlaybackAudioRoute: vi.fn((_route: string): unknown => ({
    route: "unknown",
    availableRoutes: ["earpiece", "speaker", "system"],
  })),
  addListener: vi.fn((_event: string, listener: (event: unknown) => void) => {
    audio.listener = listener;
    return { remove: vi.fn() };
  }),
});

it("uses the Android player capability without inventing a requested output or touching global call routing", async () => {
  audio.platform.OS = "android";
  const player = androidPlayer();
  await expect(
    setPlaybackAudioRoute("earpiece", () => true, player),
  ).resolves.toEqual({
    route: "unknown",
    label: "Audio output",
    availableRoutes: ["earpiece", "speaker", "system"],
  });
  expect(player.setPlaybackAudioRoute).toHaveBeenCalledWith("earpiece");
  expect(audio.setMode).not.toHaveBeenCalled();
  expect(audio.native.setPlaybackAudioRoute).not.toHaveBeenCalled();
  await expect(readPlaybackAudioRoute(player)).resolves.toEqual({
    route: "unknown",
    label: "Audio output",
    availableRoutes: ["speaker", "system"],
  });
});

it("fails closed when the Android native patch or receiver capability is absent", async () => {
  audio.platform.OS = "android";
  await expect(
    setPlaybackAudioRoute("earpiece", () => true, {}),
  ).rejects.toThrow("PLAYBACK_ROUTE_UNAVAILABLE");
  await expect(readPlaybackAudioRoute({})).resolves.toEqual({
    route: "unknown",
    label: "Audio output",
    availableRoutes: [],
  });
  await expect(resetPlaybackAudioRoute(() => true, {})).resolves.toBe(false);
  expect(audio.setMode).not.toHaveBeenCalled();
});

it("rechecks call takeover after Android async routing and never resets call output", async () => {
  audio.platform.OS = "android";
  const player = androidPlayer();
  let allowed = true;
  let finish!: (value: unknown) => void;
  player.setPlaybackAudioRoute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const selection = setPlaybackAudioRoute("speaker", () => allowed, player);
  allowed = false;
  finish({ route: "speaker" });
  await expect(selection).rejects.toThrow("CALL_AUDIO_ACTIVE");
  await expect(resetPlaybackAudioRoute(() => allowed, player)).resolves.toBe(
    false,
  );
  expect(player.setPlaybackAudioRoute).toHaveBeenCalledTimes(1);
  expect(audio.setMode).not.toHaveBeenCalled();
});

it("accepts truthful Android accessory observations, strips device names, and ignores queued events after cleanup", () => {
  audio.platform.OS = "android";
  const player = androidPlayer(),
    listener = vi.fn();
  const remove = subscribeToPlaybackAudioRoute(listener, player);
  expect(player.addListener).toHaveBeenCalledWith(
    "playbackAudioRoute",
    expect.any(Function),
  );
  audio.listener?.({
    route: "external",
    label: "Bluetooth",
    availableRoutes: ["system", "speaker", "bad"],
  });
  expect(listener).toHaveBeenLastCalledWith({
    route: "external",
    label: "Bluetooth",
    availableRoutes: ["speaker", "system"],
  });
  audio.listener?.({
    route: "external",
    label: "Private device name",
    unavailable: true,
  });
  expect(listener).toHaveBeenLastCalledWith({
    route: "external",
    label: "Connected audio",
    unavailable: true,
  });
  remove();
  expect(
    player.addListener.mock.results[0].value.remove,
  ).toHaveBeenCalledOnce();
  listener.mockClear();
  audio.listener?.({ route: "speaker" });
  expect(listener).not.toHaveBeenCalled();
});

it("restores Android default media routing on only this player and surfaces released-player failures", async () => {
  audio.platform.OS = "android";
  const player = androidPlayer();
  await expect(
    setPlaybackAudioRoute("system", () => true, player),
  ).resolves.toMatchObject({ route: "unknown" });
  await expect(resetPlaybackAudioRoute(() => true, player)).resolves.toBe(true);
  expect(player.setPlaybackAudioRoute).toHaveBeenLastCalledWith("system");
  player.getPlaybackAudioRoute.mockImplementationOnce(() => {
    throw new Error("released");
  });
  await expect(readPlaybackAudioRoute(player)).rejects.toThrow("released");
  expect(audio.setMode).not.toHaveBeenCalled();
});
