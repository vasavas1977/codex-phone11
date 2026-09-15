import { beforeEach, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({
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
  Platform: { OS: "ios" },
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
