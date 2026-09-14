import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const native = vi.hoisted(() => ({
  props: undefined as any,
  requireName: undefined as string | undefined,
}));

vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Modal: () => null,
  Platform: { OS: "ios" },
  ScrollView: ({ children }: any) => createElement("div", null, children),
  UIManager: {
    getViewManagerConfig: (name: string) =>
      name === "Phone11AudioRoutePickerView" ? {} : null,
  },
  requireNativeComponent: (name: string) => {
    native.requireName = name;
    return (props: any) => {
      native.props = props;
      return createElement("div", { "data-native-picker": name });
    };
  },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children }: any) =>
    createElement("button", null, children),
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({
  default: ({ name }: { name: string }) =>
    createElement("i", { "data-icon": name }),
}));

import { PlaybackOutputPickerButton } from "../components/cloud-recordings/playback-output-picker";

it("overlays the genuine iOS route picker and forwards its observed output", () => {
  const opened = vi.fn();
  const html = renderToStaticMarkup(
    createElement(PlaybackOutputPickerButton, {
      loaded: true,
      output: { route: "earpiece", label: "iPhone" },
      onRouteChange: vi.fn(),
      onOutputPickerOpened: opened,
      colors: {
        foreground: "#111111",
        muted: "#777777",
        primary: "#006FEE",
        border: "#DDDDDD",
        surface: "#F4F4F4",
        background: "#FFFFFF",
        error: "#CC0000",
      },
    }),
  );

  expect(native.requireName).toBe("Phone11AudioRoutePickerView");
  expect(html).toContain('data-native-picker="Phone11AudioRoutePickerView"');
  expect(native.props.style.opacity).toBeUndefined();

  const observed = { route: "external" as const, label: "Office AirPods" };
  native.props.onPickerOpened({ nativeEvent: observed });
  expect(opened).toHaveBeenCalledWith(observed);
});
