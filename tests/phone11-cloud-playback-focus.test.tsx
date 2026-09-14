import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  focus: undefined as undefined | (() => () => void),
  identity: { id: 1 },
  busy: false,
  buttons: new Map<string, any>(),
  player: { pause: vi.fn(), replace: vi.fn(), play: vi.fn(), seekTo: vi.fn() },
  setAudioMode: vi.fn(async (_mode: unknown) => {}),
  nativeRoute: {
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
  routeListener: undefined as undefined | ((event: unknown) => void),
  token: vi.fn(async () => "token"),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: { Phone11Siprix: m.nativeRoute },
  NativeEventEmitter: class {
    addListener(_name: string, listener: (event: unknown) => void) {
      m.routeListener = listener;
      return { remove: vi.fn() };
    }
  },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children, accessibilityLabel, ...props }: any) => {
    m.buttons.set(accessibilityLabel, props);
    return createElement("button", null, children);
  },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (effect: () => () => void) => {
    m.focus = effect;
  },
}));
vi.mock("expo-audio", () => ({
  useAudioPlayer: () => m.player,
  setAudioModeAsync: (mode: unknown) => m.setAudioMode(mode),
  useAudioPlayerStatus: () => ({
    currentTime: 0,
    duration: 100,
    playing: false,
    isLoaded: true,
  }),
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    foreground: "black",
    muted: "gray",
    primary: "blue",
    border: "gray",
    surface: "white",
    background: "white",
    error: "red",
  }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.identity }),
  getSessionToken: () => m.token(),
  addAuthChangeListener: () => vi.fn(),
}));
vi.mock("../constants/oauth", () => ({
  getApiBaseUrl: () => "https://api.phone11.ai",
}));
vi.mock("../lib/sip/call-store", () => ({
  useSipCallStore: {
    getState: () => ({
      incomingCall: null,
      activeCalls: m.busy ? { live: { id: "live", status: "connected" } } : {},
    }),
    subscribe: () => vi.fn(),
  },
}));
import {
  Playback,
  playbackOutputForPreference,
  revokePlaybackAuthorization,
} from "../components/cloud-recordings/cloud-playback";
const props = {
  callUuid: "11111111-1111-4111-8111-111111111111",
  path: "/api/recordings/play/11111111-1111-4111-8111-111111111111",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.focus = undefined;
  m.busy = false;
  m.buttons.clear();
  m.routeListener = undefined;
  m.token.mockResolvedValue("token");
});

it("shows the earpiece preference before routing, while preserving external outputs", () => {
  expect(
    playbackOutputForPreference({ route: "speaker", label: "Speaker" }, false),
  ).toEqual({ route: "earpiece", label: "Earpiece" });
  expect(
    playbackOutputForPreference(
      { route: "external", label: "Bluetooth" },
      false,
    ),
  ).toEqual({ route: "external", label: "Bluetooth" });
  expect(
    playbackOutputForPreference({ route: "speaker", label: "Speaker" }, true),
  ).toEqual({ route: "speaker", label: "Speaker" });
});

it("revokes playback authorization before clearing a failed source", () => {
  const authorization = { current: true };
  const player = {
    pause: vi.fn(),
    replace: vi.fn(() => expect(authorization.current).toBe(false)),
  };
  const setReady = vi.fn();
  const setError = vi.fn();
  revokePlaybackAuthorization(authorization, player, setReady, setError);
  expect(player.pause).toHaveBeenCalledOnce();
  expect(player.replace).toHaveBeenCalledWith(null);
  expect(setReady).toHaveBeenCalledWith(false);
  expect(setError).toHaveBeenCalledWith(true);
});

it("changes the native media route only while no Phone11 call is active", async () => {
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  await m.buttons.get("Play recording").onPress();
  expect(m.nativeRoute.setPlaybackAudioRoute).toHaveBeenCalledWith("earpiece");
  expect(m.player.play).toHaveBeenCalledOnce();

  m.nativeRoute.setPlaybackAudioRoute.mockClear();
  await m.buttons.get("Play through speaker").onPress();
  expect(m.nativeRoute.setPlaybackAudioRoute).toHaveBeenCalledWith("speaker");

  m.nativeRoute.setPlaybackAudioRoute.mockClear();
  m.busy = true;
  await m.buttons.get("Play through speaker").onPress();
  expect(m.nativeRoute.setPlaybackAudioRoute).not.toHaveBeenCalled();
  expect(m.player.pause).toHaveBeenCalled();
  blur();
});
it("a mounted screen loads only on focus and clears audio on blur without autoplaying on return", async () => {
  renderToStaticMarkup(createElement(Playback, props));
  expect(m.player.replace).not.toHaveBeenCalled();
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  expect(m.player.replace).toHaveBeenCalledWith(
    expect.objectContaining({ uri: expect.any(String) }),
  );
  blur();
  expect(m.player.pause).toHaveBeenCalled();
  expect(m.player.replace).toHaveBeenLastCalledWith(null);
  expect(m.nativeRoute.resetPlaybackAudioRoute).not.toHaveBeenCalled();
  const again = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  expect(m.player.play).not.toHaveBeenCalled();
  again();
});
it("a late credential result after navigation blur cannot restore hidden playback", async () => {
  let resolve!: (value: string) => void;
  m.token.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  blur();
  resolve("late-token");
  await Promise.resolve();
  await Promise.resolve();
  expect(m.player.replace).toHaveBeenCalledTimes(1);
  expect(m.player.replace).toHaveBeenLastCalledWith(null);
});
