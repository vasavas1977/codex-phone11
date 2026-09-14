import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const ui = vi.hoisted(() => ({
  buttons: new Map<string, any>(),
  timeline: undefined as any,
}));

vi.mock("react-native", () => ({
  ActivityIndicator: () => createElement("span", { "data-loading": true }),
  Modal: ({ children, visible }: any) =>
    visible ? createElement("section", { "data-modal": true }, children) : null,
  Platform: { OS: "web" },
  ScrollView: ({ children }: any) => createElement("div", null, children),
  UIManager: { getViewManagerConfig: () => null },
  View: ({ children, accessibilityRole, ...props }: any) => {
    if (accessibilityRole === "adjustable") ui.timeline = props;
    return createElement("div", null, children);
  },
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children, accessibilityLabel, ...props }: any) => {
    ui.buttons.set(accessibilityLabel, props);
    return createElement("button", null, children);
  },
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({
  default: ({ name }: { name: string }) =>
    createElement("i", { "data-material-icon": name }),
}));
vi.mock("../components/ui/icon-symbol", () => ({
  IconSymbol: ({ name }: { name: string }) =>
    createElement("i", { "data-icon": name }),
}));

import {
  clampPlaybackSeconds,
  formatPlaybackTime,
  PlaybackControls,
  playbackSecondsForTrack,
} from "../components/cloud-recordings/playback-controls";

beforeEach(() => {
  ui.buttons.clear();
  ui.timeline = undefined;
});

it("formats and bounds elapsed, remaining, and track positions", () => {
  expect(formatPlaybackTime(65.9)).toBe("1:05");
  expect(clampPlaybackSeconds(-2, 90)).toBe(0);
  expect(clampPlaybackSeconds(95, 90)).toBe(90);
  expect(playbackSecondsForTrack(50, 200, 120)).toBe(30);
  expect(playbackSecondsForTrack(300, 200, 120)).toBe(120);
});

it("supports tap or drag seeking and accessible fifteen-second seeking", () => {
  const seek = vi.fn();
  const html = renderToStaticMarkup(
    createElement(PlaybackControls, {
      currentTime: 30,
      duration: 120,
      playing: false,
      loaded: true,
      route: "earpiece",
      output: { route: "earpiece", label: "Earpiece" },
      onToggle: vi.fn(),
      onSeek: seek,
      onRouteChange: vi.fn(),
    }),
  );

  expect(html).toContain("0:30");
  expect(html).toContain("−1:30");
  expect(html).toContain('data-icon="play.fill"');
  expect(html).toContain('data-icon="backward.fill"');
  expect(html).toContain('data-icon="forward.fill"');
  expect(html).toContain('data-material-icon="volume-up"');
  expect(html).toContain("Speaker");
  expect(html).not.toContain(">Play<");
  expect(html).not.toContain("−15s");
  expect(html).not.toContain("+15s");
  expect(html).not.toContain("Output:");
  expect(ui.timeline["aria-valuemin"]).toBe(0);
  expect(ui.timeline["aria-valuemax"]).toBe(120);
  expect(ui.timeline["aria-valuenow"]).toBe(30);
  ui.timeline.onLayout({ nativeEvent: { layout: { width: 200 } } });
  ui.timeline.onResponderRelease({ nativeEvent: { locationX: 100 } });
  expect(seek).toHaveBeenCalledWith(60);
  ui.timeline.onAccessibilityAction({
    nativeEvent: { actionName: "increment" },
  });
  expect(seek).toHaveBeenLastCalledWith(45);
  ui.timeline.onKeyDown({ key: "End", preventDefault: vi.fn() });
  expect(seek).toHaveBeenLastCalledWith(120);
  ui.buttons.get("Back 15 seconds").onPress();
  expect(seek).toHaveBeenLastCalledWith(15);
});

it("opens the audio output chooser instead of changing route directly", () => {
  const change = vi.fn();
  const loadingHtml = renderToStaticMarkup(
    createElement(PlaybackControls, {
      currentTime: 0,
      duration: 0,
      playing: false,
      loaded: false,
      route: "earpiece",
      output: { route: "earpiece", label: "Earpiece" },
      onToggle: vi.fn(),
      onSeek: vi.fn(),
      onRouteChange: change,
    }),
  );
  expect(ui.buttons.get("Choose audio output").disabled).toBe(true);
  expect(loadingHtml).toContain('data-loading="true"');

  ui.buttons.clear();
  const html = renderToStaticMarkup(
    createElement(PlaybackControls, {
      currentTime: 1,
      duration: 10,
      playing: false,
      loaded: true,
      route: "earpiece",
      output: { route: "external", label: "Bluetooth" },
      onToggle: vi.fn(),
      onSeek: vi.fn(),
      onRouteChange: change,
    }),
  );
  ui.buttons.get("Choose audio output").onPress();
  expect(change).not.toHaveBeenCalled();
  expect(html).toContain("Connected to ");
  expect(html).toContain("Bluetooth");

  ui.buttons.clear();
  const speakerHtml = renderToStaticMarkup(
    createElement(PlaybackControls, {
      currentTime: 1,
      duration: 10,
      playing: true,
      loaded: true,
      route: "speaker",
      output: { route: "speaker", label: "Speaker" },
      onToggle: vi.fn(),
      onSeek: vi.fn(),
      onRouteChange: change,
    }),
  );
  expect(speakerHtml).toContain('data-icon="pause.fill"');
  expect(speakerHtml).toContain('data-material-icon="volume-up"');
  expect(
    ui.buttons.get("Choose audio output").accessibilityState.selected,
  ).toBe(true);
});
