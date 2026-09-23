import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const image = vi.hoisted(() => ({ props: null as any }));
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  Text: ({ children }: any) => createElement("span", null, children),
  View: ({ children }: any) => createElement("div", null, children),
}));
vi.mock("expo-image", () => ({
  Image: (props: any) => {
    image.props = props;
    return createElement("img", null);
  },
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#07c" }) }));
vi.mock("../hooks/use-device-contacts", () => ({ useDeviceContacts: vi.fn() }));
vi.mock("../hooks/use-phone-call", () => ({ usePhoneCall: vi.fn() }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));

import { DeviceContactAvatar } from "../components/device-contacts-list";

beforeEach(() => { image.props = null; });

it("displays a native contact thumbnail without an image cache", () => {
  renderToStaticMarkup(createElement(DeviceContactAvatar, {
    name: "Local friend", imageUri: "content://contacts/photo/1",
  }));
  expect(image.props.source).toEqual({ uri: "content://contacts/photo/1" });
  expect(image.props.cachePolicy).toBe("none");
  expect(image.props.onError).toEqual(expect.any(Function));
});

it("falls back to the contact initial when no photo exists", () => {
  const html = renderToStaticMarkup(createElement(DeviceContactAvatar, { name: "Local friend" }));
  expect(image.props).toBeNull();
  expect(html).toContain("L");
});
