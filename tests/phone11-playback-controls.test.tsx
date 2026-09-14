import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { createPlaybackController } from "../lib/cloud-recordings/playback-controller";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  scrubber: {} as any,
  native: vi.fn(),
  mode: vi.fn(),
  os: "ios",
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return m.os;
    },
  },
  NativeModules: {
    Phone11Siprix: {
      setRecordingPlaybackSpeaker: (speaker: boolean) => m.native(speaker),
    },
  },
  View: ({ children, ...props }: any) => {
    if (props.accessibilityRole === "adjustable") m.scrubber = props;
    return createElement("div", null, children);
  },
}));
vi.mock("expo-audio", () => ({
  setAudioModeAsync: (...args: any[]) => m.mode(...args),
}));
import {
  PlaybackScrubber,
  scrubPosition,
} from "../components/cloud-recordings/playback-scrubber";
import {
  configurePlaybackRoute,
  supportsPlaybackSpeaker,
} from "../lib/cloud-recordings/playback-route";
beforeEach(() => {
  vi.clearAllMocks();
  m.os = "ios";
});
function setup() {
  let allowed = true;
  const player = {
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(async () => {}),
    volume: 0.2,
    muted: true,
  };
  const configure = vi.fn(async (_speaker: boolean) => {}),
    failed = vi.fn();
  return {
    player,
    configure,
    failed,
    deny: () => {
      allowed = false;
    },
    controller: createPlaybackController({
      player,
      configure,
      failed,
      allowed: () => allowed,
    }),
  };
}
it("prepares media output, unmutes, and replays completed recordings from zero", async () => {
  const t = setup();
  await t.controller.play(true, true);
  expect(t.configure).toHaveBeenCalledWith(true);
  expect(t.player.seekTo).toHaveBeenCalledWith(0);
  expect(t.player.volume).toBe(1);
  expect(t.player.muted).toBe(false);
  expect(t.player.play).toHaveBeenCalledOnce();
});
it.each(["call", "blur", "pause"])(
  "a %s during asynchronous route setup cannot restart audio",
  async (reason) => {
    const t = setup();
    let finish!: () => void;
    t.configure.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const done = t.controller.play(true, false);
    await Promise.resolve();
    if (reason === "call") t.deny();
    else if (reason === "blur") t.controller.dispose();
    else t.controller.pause();
    finish();
    await done;
    expect(t.player.play).not.toHaveBeenCalled();
  },
);
it("does not touch the session when an incoming call already owns audio", async () => {
  const t = setup();
  t.deny();
  await t.controller.play(false, false);
  expect(t.configure).not.toHaveBeenCalled();
});
it("reports route errors and never claims playback started", async () => {
  const t = setup();
  t.configure.mockRejectedValue(new Error("route failed"));
  await t.controller.play(true, false);
  expect(t.failed).toHaveBeenCalledOnce();
  expect(t.player.play).not.toHaveBeenCalled();
});
it("serializes rapid route selections and plays only the newest selection", async () => {
  const t = setup();
  const first = t.controller.play(false, false),
    second = t.controller.play(true, false);
  await Promise.all([first, second]);
  expect(t.configure).toHaveBeenCalledTimes(1);
  expect(t.configure).toHaveBeenCalledWith(true);
  expect(t.player.play).toHaveBeenCalledOnce();
});
it("uses native iOS call-guarded media routing instead of an Android-only flag", async () => {
  expect(supportsPlaybackSpeaker()).toBe(true);
  await configurePlaybackRoute(true);
  expect(m.native).toHaveBeenCalledWith(true);
  expect(m.mode).not.toHaveBeenCalled();
});
it.each([
  [false, true],
  [true, false],
] as const)(
  "maps Android speaker %s to earpiece routing %s",
  async (speaker, shouldRouteThroughEarpiece) => {
    m.os = "android";
    expect(supportsPlaybackSpeaker()).toBe(true);
    await configurePlaybackRoute(speaker);
    expect(m.mode).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldRouteThroughEarpiece,
        interruptionModeAndroid: "doNotMix",
      }),
    );
  },
);
function scrub(loaded = true) {
  const seek = vi.fn();
  renderToStaticMarkup(
    createElement(PlaybackScrubber, {
      loaded,
      currentTime: 30,
      duration: 100,
      onSeek: seek,
      primary: "blue",
      border: "gray",
    }),
  );
  m.scrubber.onLayout({ nativeEvent: { layout: { width: 200 } } });
  return seek;
}
it("previews dragging and commits one clamped seek on release", () => {
  const seek = scrub();
  expect(m.scrubber.onStartShouldSetResponder()).toBe(true);
  m.scrubber.onResponderGrant({ nativeEvent: { pageX: 120, locationX: 20 } });
  m.scrubber.onResponderMove({ nativeEvent: { pageX: 240 } });
  expect(seek).not.toHaveBeenCalled();
  m.scrubber.onResponderRelease();
  expect(seek).toHaveBeenCalledTimes(1);
  expect(seek).toHaveBeenCalledWith(70);
});
it("cancels interrupted gestures and disables unknown/loading playback", () => {
  const seek = scrub();
  m.scrubber.onResponderGrant({ nativeEvent: { pageX: 120, locationX: 20 } });
  m.scrubber.onResponderTerminate();
  m.scrubber.onResponderRelease();
  expect(seek).not.toHaveBeenCalled();
  scrub(false);
  expect(m.scrubber.onStartShouldSetResponder()).toBe(false);
});
it("supports screen-reader seeking and clamps gesture endpoints", () => {
  const seek = scrub();
  m.scrubber.onAccessibilityAction({
    nativeEvent: { actionName: "increment" },
  });
  expect(seek).toHaveBeenCalledWith(45);
  expect(scrubPosition(-20, 200, 100)).toBe(0);
  expect(scrubPosition(500, 200, 100)).toBe(100);
  expect(scrubPosition(1, 0, 100)).toBe(0);
  expect(scrubPosition(NaN, 200, 100)).toBe(0);
});
