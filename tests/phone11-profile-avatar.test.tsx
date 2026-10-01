import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  source: null as any, imageProps: null as any, press: null as any,
  hooks: null as any[] | null, cursor: 0,
  auth: { user: { id: 1 }, loading: false },
}));
// Keep React's element/context rendering, while explicitly controlling the
// avatar's client hook state and image events without a native image loader.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: any) => {
      if (!m.hooks) return react.useState(initial);
      const slot = m.cursor++;
      if (!(slot in m.hooks)) m.hooks[slot] = typeof initial === "function" ? initial() : initial;
      return [m.hooks[slot], (next: any) => {
        m.hooks![slot] = typeof next === "function" ? next(m.hooks![slot]) : next;
      }];
    },
    useMemo: (factory: () => any, deps: any[]) => {
      if (!m.hooks) return react.useMemo(factory, deps);
      const slot = m.cursor++;
      const previous = m.hooks[slot];
      if (!previous || deps.some((dep, index) => !Object.is(dep, previous.deps[index]))) {
        m.hooks[slot] = { deps, value: factory() };
      }
      return m.hooks[slot].value;
    },
    useRef: (initial: any) => {
      if (!m.hooks) return react.useRef(initial);
      const slot = m.cursor++;
      if (!(slot in m.hooks)) m.hooks[slot] = { current: initial };
      return m.hooks[slot];
    },
    // Web auth is available synchronously; lifecycle tests control only image
    // callbacks. Authentication effects remain covered by their own tests.
    useEffect: (effect: any, deps: any[]) => {
      if (!m.hooks) react.useEffect(effect, deps);
    },
  };
});
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  Text: ({ children }: any) => createElement("div", null, children),
  View: ({ children, accessibilityLabel, style }: any) => createElement("div", { "aria-label": accessibilityLabel, style }, children),
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
  getAuthSnapshot: () => m.auth,
  getSessionToken: vi.fn(async () => null),
  addAuthChangeListener: () => () => {},
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#07c", foreground: "#111" }) }));

import { ProfileAvatar, profileInitials, type ProfileAvatarProps } from "../components/profile/profile-avatar";
import { ProfileCardContext } from "../components/profile/profile-card-context";

beforeEach(() => { m.source = null; m.imageProps = null; m.press = null; m.hooks = null; m.cursor = 0; });

const firstVersion = "123e4567-e89b-42d3-a456-426614174000";
const secondVersion = "123e4567-e89b-42d3-a456-426614174001";
const photoProps: ProfileAvatarProps = {
  name: "Nathasa W.", tenantId: 20, userId: 2, size: 34, rounded: true,
  photoUrl: `/api/profile/photo/20/2?v=${firstVersion}`, photoVersion: firstVersion,
};
function renderControlledAvatar(props: ProfileAvatarProps = photoProps) {
  m.hooks ??= [];
  m.cursor = 0;
  m.source = null;
  m.imageProps = null;
  return renderToStaticMarkup(createElement(ProfileAvatar, props));
}

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
  expect(m.imageProps.onLoad).toEqual(expect.any(Function));
  expect(m.imageProps.onError).toEqual(expect.any(Function));
});

it("keeps initials visible for a pending or stalled request, then reveals only the loaded photo", () => {
  const pending = renderControlledAvatar();
  expect(pending).toContain("NW");
  expect(pending).toContain("Nathasa W. initials");
  expect(m.imageProps.style).toMatchObject({ position: "absolute", opacity: 0, width: 34, height: 34, borderRadius: 10 });
  expect(renderControlledAvatar()).toContain("NW");
  m.imageProps.onLoad();
  const loaded = renderControlledAvatar();
  expect(loaded).not.toContain("NW");
  expect(loaded).toContain("Nathasa W. profile photo");
  expect(m.imageProps.style.opacity).toBe(1);
});

it.each([false, true])("shows initials when the photo fails, including after success: %s", (loadedFirst) => {
  renderControlledAvatar();
  if (loadedFirst) {
    m.imageProps.onLoad();
    renderControlledAvatar();
  }
  m.imageProps.onError();
  const failed = renderControlledAvatar();
  expect(failed).toContain("NW");
  expect(failed).toContain("Nathasa W. initials");
  expect(m.imageProps).toBeNull();
});

it.each(["onLoad", "onError"] as const)("resets loaded and failed state when the version changes: %s", (event) => {
  renderControlledAvatar();
  m.imageProps[event]();
  renderControlledAvatar();
  const replacement = { ...photoProps, photoUrl: `/api/profile/photo/20/2?v=${secondVersion}`, photoVersion: secondVersion };
  expect(renderControlledAvatar(replacement)).toContain("NW");
  expect(m.imageProps.style.opacity).toBe(0);
  expect(m.source.cacheKey).toBe(`profile-photo:1:20:2:${secondVersion}`);
  m.imageProps.onLoad();
  expect(renderControlledAvatar(replacement)).not.toContain("NW");
});

it("ignores stale image events after another person's photo replaces the source", () => {
  renderControlledAvatar();
  const oldImage = m.imageProps;
  const replacement = { ...photoProps, name: "Somchai Jaidee", tenantId: 21, userId: 3,
    photoUrl: `/api/profile/photo/21/3?v=${firstVersion}` };
  expect(renderControlledAvatar(replacement)).toContain("SJ");
  oldImage.onLoad();
  expect(renderControlledAvatar(replacement)).toContain("SJ");
  expect(m.imageProps.style.opacity).toBe(0);
  m.imageProps.onLoad();
  oldImage.onError();
  const loaded = renderControlledAvatar(replacement);
  expect(loaded).not.toContain("SJ");
  expect(m.imageProps.style.opacity).toBe(1);
  expect(m.source.cacheKey).toBe(`profile-photo:1:21:3:${firstVersion}`);
});

it("treats returning to the same descriptor after removal as a new pending request", () => {
  renderControlledAvatar();
  const oldImage = m.imageProps;
  oldImage.onLoad();
  renderControlledAvatar();
  expect(renderControlledAvatar({ ...photoProps, photoUrl: null })).toContain("NW");
  expect(m.imageProps).toBeNull();
  expect(renderControlledAvatar()).toContain("NW");
  oldImage.onLoad();
  oldImage.onError();
  expect(renderControlledAvatar()).toContain("NW");
  expect(m.imageProps.style.opacity).toBe(0);
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
  expect(open).toHaveBeenCalledWith(expect.objectContaining({
    tenantId: 20,
    userId: 2,
    name: "Nathasa W.",
  }));
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
