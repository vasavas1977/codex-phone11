import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const ui = vi.hoisted(() => ({
  buttons: new Map<string, any>(),
}));

vi.mock("react-native", () => ({
  ActivityIndicator: () => createElement("span", { "data-loading": true }),
  Modal: ({ children, visible }: any) =>
    visible ? createElement("section", null, children) : null,
  Platform: { OS: "android" },
  ScrollView: ({ children }: any) => createElement("div", null, children),
  UIManager: { getViewManagerConfig: () => null },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children, accessibilityLabel, ...props }: any) => {
    ui.buttons.set(accessibilityLabel, props);
    return createElement("button", null, children);
  },
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({
  default: ({ name }: { name: string }) =>
    createElement("i", { "data-icon": name }),
}));

import {
  PlaybackOutputPickerSheet,
  type PlaybackExternalOutput,
} from "../components/cloud-recordings/playback-output-picker";
import { defaultPlaybackColors } from "../components/cloud-recordings/playback-controls";

beforeEach(() => ui.buttons.clear());

function renderPicker(
  output: {
    route: "earpiece" | "speaker" | "external" | "unknown";
    label: string;
    availableRoutes?: readonly ("earpiece" | "speaker" | "system")[];
  },
  availableOutputs: readonly PlaybackExternalOutput[] = [],
  onRouteChange = vi.fn(),
  onOutputSelect?: (output: PlaybackExternalOutput) => void,
) {
  return {
    onRouteChange,
    html: renderToStaticMarkup(
      createElement(PlaybackOutputPickerSheet, {
        visible: true,
        output,
        availableOutputs,
        onRouteChange,
        onOutputSelect,
        onClose: vi.fn(),
        colors: defaultPlaybackColors,
      }),
    ),
  };
}

it("offers built-in preferences and the Android system output fallback", () => {
  const { html, onRouteChange } = renderPicker({
    route: "earpiece",
    label: "Earpiece",
  });

  expect(html).toContain("Audio output");
  expect(html).toContain("Phone");
  expect(html).toContain("Speaker");
  expect(html).not.toContain("Bluetooth");
  expect(html).not.toContain("AirPlay");
  expect(ui.buttons.get("Phone").accessibilityState.selected).toBe(true);
  expect(ui.buttons.get("Speaker").accessibilityState.selected).toBe(false);

  ui.buttons.get("Speaker").onPress();
  expect(onRouteChange).toHaveBeenCalledWith("speaker");
});

it("shows supplied real external outputs without pretending it can select them", () => {
  const { html } = renderPicker(
    { route: "external", label: "Office AirPods" },
    [
      {
        id: "airpods-id",
        label: "Office AirPods",
        icon: "bluetooth-audio",
      },
      {
        id: "meeting-room-id",
        label: "Meeting room",
        icon: "airplay",
      },
    ],
  );

  expect(html).toContain("Office AirPods");
  expect(html).toContain("Meeting room");
  expect(html).toContain("Connected");
  expect(html).toContain("Choose from your system audio controls");
  expect(ui.buttons.get("Office AirPods").accessibilityState.selected).toBe(
    true,
  );
  expect(ui.buttons.get("Office AirPods").disabled).toBe(true);
  expect(ui.buttons.get("Meeting room").accessibilityState.selected).toBe(
    false,
  );
  expect(ui.buttons.get("Meeting room").disabled).toBe(true);
});

it("marks the reported output rather than the requested route", () => {
  renderPicker({ route: "speaker", label: "Speaker" });

  expect(ui.buttons.get("Phone").accessibilityState.selected).toBe(false);
  expect(ui.buttons.get("Speaker").accessibilityState.selected).toBe(true);
});

it("selects an external output only when a real adapter is supplied", () => {
  const select = vi.fn();
  const external = {
    id: "dock",
    label: "USB audio",
    icon: "headphones",
  } as const;
  renderPicker(
    { route: "earpiece", label: "Earpiece" },
    [external],
    vi.fn(),
    select,
  );

  expect(ui.buttons.get("USB audio").disabled).toBe(false);
  ui.buttons.get("USB audio").onPress();
  expect(select).toHaveBeenCalledWith(external);
});

it("disables absent receiver hardware and offers only the real system fallback", () => {
  const { html, onRouteChange } = renderPicker({
    route: "unknown",
    label: "Audio output",
    availableRoutes: ["speaker", "system"],
  });
  expect(ui.buttons.get("Phone").disabled).toBe(true);
  expect(ui.buttons.get("Speaker").disabled).toBe(false);
  expect(html).not.toContain("iPhone audio output picker");
  expect(html).not.toContain("Bluetooth audio");
  ui.buttons.get("System audio").onPress();
  expect(onRouteChange).toHaveBeenCalledWith("system");
});

it("disables route choices when the Android native capability is missing", () => {
  renderPicker({
    route: "unknown",
    label: "Audio output",
    availableRoutes: [],
  });
  expect(ui.buttons.get("Phone").disabled).toBe(true);
  expect(ui.buttons.get("Speaker").disabled).toBe(true);
  expect(ui.buttons.has("System audio")).toBe(false);
});
