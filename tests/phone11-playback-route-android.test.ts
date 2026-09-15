import { beforeEach, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: unknown) => void),
  native: {
    getPlaybackAudioOutputs: vi.fn(),
    selectPlaybackAudioOutput: vi.fn(),
    resetPlaybackAudioOutput: vi.fn(),
  },
  setMode: vi.fn(async (_mode: unknown) => {}),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
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

// Import after platform/audio mocks so this exercises the Android bridge.
// eslint-disable-next-line import/first
import {
  normalizePlaybackAudioOutputs,
  playbackAudioOutputStatus,
  readPlaybackAudioOutputs,
  readPlaybackAudioRoute,
  resetPlaybackAudioRoute,
  selectPlaybackAudioOutput,
  setPlaybackAudioRoute,
  subscribeToPlaybackAudioOutputs,
} from "../lib/cloud-recordings/playback-route";

const inventory = (selectedId: string | null = "android:9") => ({
  outputs: [
    { id: "android:2", kind: "phone", label: "private phone", selected: false },
    {
      id: "android:4",
      kind: "speaker",
      label: "private speaker",
      selected: false,
    },
    {
      id: "android:9",
      kind: "bluetooth",
      label: "Owner's headset",
      selected: selectedId === "android:9",
    },
  ],
  selectedId,
});

beforeEach(() => {
  vi.clearAllMocks();
  audio.listener = undefined;
  audio.native.getPlaybackAudioOutputs.mockResolvedValue(inventory());
  audio.native.selectPlaybackAudioOutput.mockImplementation(
    async (id: string) => ({
      ...inventory(id),
      outputs: inventory(id).outputs.map((item) => ({
        ...item,
        selected: item.id === id,
      })),
    }),
  );
  audio.native.resetPlaybackAudioOutput.mockResolvedValue(inventory(null));
});

it("normalizes the Android inventory without exposing native device names", () => {
  const result = normalizePlaybackAudioOutputs(inventory());
  expect(result.outputs).toEqual([
    { id: "android:2", kind: "phone", label: "Phone", selected: false },
    { id: "android:4", kind: "speaker", label: "Speaker", selected: false },
    {
      id: "android:9",
      kind: "bluetooth",
      label: "Bluetooth audio",
      selected: true,
    },
  ]);
  expect(playbackAudioOutputStatus(result)).toEqual({
    route: "external",
    label: "Bluetooth audio",
  });
});

it("routes Phone and Speaker through their current native device IDs", async () => {
  await expect(setPlaybackAudioRoute("earpiece", () => true)).resolves.toEqual({
    route: "earpiece",
    label: "Phone",
  });
  expect(audio.native.selectPlaybackAudioOutput).toHaveBeenCalledWith(
    "android:2",
  );

  await expect(setPlaybackAudioRoute("speaker", () => true)).resolves.toEqual({
    route: "speaker",
    label: "Speaker",
  });
  expect(audio.native.selectPlaybackAudioOutput).toHaveBeenLastCalledWith(
    "android:4",
  );
  expect(audio.setMode).not.toHaveBeenCalled();
});

it("keeps an actual Android system selection for the next Play", async () => {
  await expect(setPlaybackAudioRoute("system", () => true)).resolves.toEqual({
    route: "external",
    label: "Bluetooth audio",
  });
  expect(audio.native.getPlaybackAudioOutputs).toHaveBeenCalledOnce();
  expect(audio.native.selectPlaybackAudioOutput).not.toHaveBeenCalled();
  await expect(readPlaybackAudioRoute()).resolves.toEqual({
    route: "external",
    label: "Bluetooth audio",
  });
});

it("selects only a real native output while call audio is free", async () => {
  await expect(
    selectPlaybackAudioOutput("android:9", () => true),
  ).resolves.toEqual(expect.objectContaining({ selectedId: "android:9" }));
  expect(audio.native.selectPlaybackAudioOutput).toHaveBeenCalledWith(
    "android:9",
  );
  await expect(
    selectPlaybackAudioOutput("android:9", () => false),
  ).rejects.toThrow("CALL_AUDIO_ACTIVE");
  await expect(
    selectPlaybackAudioOutput("invented-device", () => true),
  ).rejects.toThrow("PLAYBACK_ROUTE_UNAVAILABLE");
});

it("reads route changes from the real Android inventory event", async () => {
  await expect(readPlaybackAudioOutputs()).resolves.toEqual(
    normalizePlaybackAudioOutputs(inventory()),
  );
  const listener = vi.fn();
  const unsubscribe = subscribeToPlaybackAudioOutputs(listener);
  audio.listener?.({ type: "playbackAudioOutputsChanged", ...inventory() });
  expect(listener).toHaveBeenCalledWith(
    normalizePlaybackAudioOutputs(inventory()),
  );
  unsubscribe();
});

it("resets native playback routing only while no call owns audio", async () => {
  await expect(resetPlaybackAudioRoute(() => true)).resolves.toBe(true);
  expect(audio.native.resetPlaybackAudioOutput).toHaveBeenCalledOnce();
  await expect(resetPlaybackAudioRoute(() => false)).resolves.toBe(false);
  expect(audio.native.resetPlaybackAudioOutput).toHaveBeenCalledOnce();
});
