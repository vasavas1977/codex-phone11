import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({ source: null as any, imageProps: null as any, press: null as any }));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  Text: ({ children }: any) => createElement("div", null, children),
  View: ({ children }: any) => createElement("div", null, children),
  Pressable: ({ children, onPress, accessibilityLabel }: any) => {
    m.press = onPress;
    return createElement("button", { "aria-label": accessibilityLabel }, children);
  },
}));
vi.mock("expo-image", () => {
  const Image = (props: any) => {
    m.source = props.source;
    m.imageProps = props;
    return createElement("img", null);
  };
  Object.assign(Image, { clearMemoryCache: vi.fn(async () => true), clearDiskCache: vi.fn(async () => true) });
  return { Image };
});
vi.mock("../constants/oauth", () => ({ getApiBaseUrl: () => "https://api.phone11.ai" }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: { id: 1 }, loading: false }),
  getSessionToken: vi.fn(async () => null),
  addAuthChangeListener: () => () => {},
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#07c", foreground: "#111" }) }));

import { ProfileAvatar, profileInitials } from "../components/profile/profile-avatar";
import { ProfileCardContext } from "../components/profile/profile-card-context";

beforeEach(() => { m.source = null; m.imageProps = null; m.press = null; });

it("uses the authenticated versioned, tenant-bound descriptor as the cache identity", () => {
  const version = "123e4567-e89b-42d3-a456-426614174000";
  renderToStaticMarkup(createElement(ProfileAvatar, {
    name: "Nathasa W.", tenantId: 20, userId: 2, size: 34, rounded: true,
    photoUrl: `/api/profile/photo/20/2?v=${version}`, photoVersion: version,
  }));
  expect(m.source).toMatchObject({
    uri: `https://api.phone11.ai/api/profile/photo/20/2?v=${version}`,
    cacheKey: `profile-photo:1:20:2:${version}`,
  });
  expect(m.imageProps.cachePolicy).toBe("none");
  expect(m.imageProps.onError).toEqual(expect.any(Function));
});

it("rejects non-server and mismatched descriptors, then shows initials", () => {
  const html = renderToStaticMarkup(createElement(ProfileAvatar, {
    name: "Nathasa W.", tenantId: 20, userId: 2, size: 34,
    photoUrl: "https://example.invalid/avatar.jpg",
  }));
  expect(m.source).toBeNull();
  expect(html).toContain("NW");
  expect(profileInitials("สมชาย ใจดี")).toBe("สใ");
});

it("opens the exact person profile and consumes the parent row's selection gesture", () => {
  const open = vi.fn();
  const html = renderToStaticMarkup(createElement(ProfileCardContext.Provider, { value: open },
    createElement(ProfileAvatar, { name: "Nathasa W.", tenantId: 20, userId: 2, size: 36 })));
  expect(html).toContain("View Nathasa W. profile");
  const event = { stopPropagation: vi.fn() };
  m.press(event);
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith({ tenantId: 20, userId: 2 });
});

it.each([
  { tenantId: 20, userId: undefined },
  { tenantId: undefined, userId: 2 },
  { tenantId: -1, userId: 2 },
  { tenantId: 20, userId: 2, interactive: false },
])("leaves unbound identities and photo-edit heroes noninteractive: %s", (identity) => {
  const open = vi.fn();
  renderToStaticMarkup(createElement(ProfileCardContext.Provider, { value: open },
    createElement(ProfileAvatar, { name: "Profile", size: 44, ...identity })));
  expect(m.press).toBeNull();
  expect(open).not.toHaveBeenCalled();
});
