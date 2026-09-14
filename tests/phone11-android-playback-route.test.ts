import { beforeEach, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({
  setMode: vi.fn(async (_mode: unknown) => {}),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  NativeModules: {},
  NativeEventEmitter: class {
    addListener() {
      return { remove: vi.fn() };
    }
  },
}));

vi.mock("expo-audio", () => ({
  setAudioModeAsync: (mode: unknown) => audio.setMode(mode),
}));

// Imports follow the platform mocks so this file exercises the Android branch.
// eslint-disable-next-line import/first
import {
  playbackAudioMode,
  readPlaybackAudioRoute,
  resetPlaybackAudioRoute,
  setPlaybackAudioRoute,
} from "../lib/cloud-recordings/playback-route";

beforeEach(() => vi.clearAllMocks());

it.each([
  ["earpiece", true, true],
  ["speaker", false, false],
] as const)(
  "maps Android %s playback to the expected Expo audio mode",
  async (route, throughEarpiece, allowsRecording) => {
    await expect(setPlaybackAudioRoute(route, () => true)).resolves.toEqual({
      route,
      label: route === "speaker" ? "Speaker" : "Earpiece",
    });
    expect(audio.setMode).toHaveBeenCalledWith({
      allowsRecording,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: throughEarpiece,
    });
  },
);

it("does not change Android media routing while Phone11 call audio owns it", async () => {
  await expect(setPlaybackAudioRoute("speaker", () => false)).rejects.toThrow(
    "CALL_AUDIO_ACTIVE",
  );
  await expect(resetPlaybackAudioRoute(() => false)).resolves.toBe(false);
  expect(audio.setMode).not.toHaveBeenCalled();
});

it("restores the normal Android media route after owned playback", async () => {
  await expect(resetPlaybackAudioRoute(() => true)).resolves.toBe(true);
  expect(audio.setMode).toHaveBeenCalledWith(playbackAudioMode("speaker"));
  await expect(readPlaybackAudioRoute()).resolves.toEqual({
    route: "unknown",
    label: "Audio output",
  });
});
