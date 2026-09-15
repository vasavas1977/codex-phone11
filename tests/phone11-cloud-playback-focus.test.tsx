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
  platform: "ios",
  buttons: new Map<string, any>(),
  controls: undefined as any,
  player: {
    pause: vi.fn(),
    replace: vi.fn(),
    play: vi.fn(),
    seekTo: vi.fn(async (_seconds: number) => {}),
    volume: 1,
    muted: false,
  },
  status: {
    currentTime: 0,
    duration: 100,
    playing: false,
    isLoaded: true,
    didJustFinish: false,
    playbackState: "ready",
  },
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
    getPlaybackAudioOutputs: vi.fn(async () => ({
      outputs: [
        { id: "android:2", kind: "phone", label: "Phone", selected: false },
        {
          id: "android:4",
          kind: "speaker",
          label: "Speaker",
          selected: false,
        },
        {
          id: "android:9",
          kind: "bluetooth",
          label: "Bluetooth audio",
          selected: true,
        },
      ],
      selectedId: "android:9",
    })),
    selectPlaybackAudioOutput: vi.fn(async (id: string) => ({
      outputs: [
        {
          id,
          kind: "bluetooth",
          label: "Bluetooth audio",
          selected: true,
        },
      ],
      selectedId: id,
    })),
    resetPlaybackAudioOutput: vi.fn(async () => ({
      outputs: [],
      selectedId: null,
    })),
  },
  routeListener: undefined as undefined | ((event: unknown) => void),
  token: vi.fn(async () => "token"),
  share: vi.fn(async (_options: unknown) => {}),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => createElement("span", null),
  Platform: {
    get OS() {
      return m.platform;
    },
  },
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
vi.mock("../components/ui/icon-symbol", () => ({
  IconSymbol: ({ name }: { name: string }) =>
    createElement("i", { "data-icon": name }),
}));
// UI rendering is covered separately; here capture the callback boundary to
// exercise native picker ownership and playback lifecycle together.
vi.mock("../components/cloud-recordings/playback-controls", () => ({
  PlaybackControls: (props: any) => {
    m.controls = props;
    m.buttons.set("Play recording", { onPress: props.onToggle });
    m.buttons.set("Play through speaker", {
      onPress: () => props.onRouteChange("speaker"),
    });
    return createElement("span", null);
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
  useAudioPlayerStatus: () => m.status,
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
vi.mock("../lib/cloud-recordings/recording-share", () => ({
  shareAuthenticatedRecording: (options: unknown) => m.share(options),
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
// Import after platform/audio mocks so this test exercises the guarded wrapper.
// eslint-disable-next-line import/first
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
  m.platform = "ios";
  m.buttons.clear();
  m.controls = undefined;
  m.routeListener = undefined;
  m.token.mockResolvedValue("token");
  m.share.mockResolvedValue(undefined);
  m.status.currentTime = 0;
  m.status.duration = 100;
  m.status.playing = false;
  m.status.isLoaded = true;
  m.status.didJustFinish = false;
  m.status.playbackState = "ready";
  m.player.volume = 1;
  m.player.muted = false;
  m.player.seekTo.mockResolvedValue(undefined);
  m.nativeRoute.getPlaybackAudioRoute.mockResolvedValue({
    route: "earpiece",
    label: "Earpiece",
  });
  m.nativeRoute.setPlaybackAudioRoute.mockImplementation(
    async (route: string) => ({
      route,
      label: route === "speaker" ? "Speaker" : "Earpiece",
    }),
  );
});

it("selects an actual Android output and preserves it for Play", async () => {
  m.platform = "android";
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();

  await m.controls.onOutputSelect({
    id: "android:9",
    label: "Bluetooth audio",
    selected: true,
  });
  expect(m.nativeRoute.selectPlaybackAudioOutput).toHaveBeenCalledWith(
    "android:9",
  );
  await m.controls.onToggle();
  expect(m.nativeRoute.getPlaybackAudioOutputs).toHaveBeenCalled();
  expect(m.player.play).toHaveBeenCalledOnce();
  blur();
  expect(m.nativeRoute.resetPlaybackAudioOutput).toHaveBeenCalled();
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

it("pauses playback and preserves Android output state while sharing once", async () => {
  m.platform = "android";
  let finish!: () => void;
  m.share.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();

  const first = m.controls.onShare();
  await m.controls.onShare();
  expect(m.player.pause).toHaveBeenCalled();
  expect(m.share).toHaveBeenCalledOnce();
  expect(m.share).toHaveBeenCalledWith(
    expect.objectContaining({
      callUuid: props.callUuid,
      path: props.path,
      platform: "android",
      canShare: expect.any(Function),
    }),
  );
  expect(m.nativeRoute.selectPlaybackAudioOutput).not.toHaveBeenCalled();
  finish();
  await first;
  blur();
});

it("a second Play tap cancels pending route setup before audio starts", async () => {
  let finish!: () => void;
  m.nativeRoute.setPlaybackAudioRoute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ route: "earpiece", label: "Earpiece" });
      }),
  );
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  const firstTap = m.buttons.get("Play recording").onPress();
  await Promise.resolve();
  m.buttons.get("Play recording").onPress();
  finish();
  await firstTap;
  expect(m.player.pause).toHaveBeenCalled();
  expect(m.player.play).not.toHaveBeenCalled();
  blur();
});

it("keeps the native picker output when Play is pressed after choosing it", async () => {
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  m.controls.onOutputPickerOpened();
  await m.controls.onToggle();
  expect(m.nativeRoute.setPlaybackAudioRoute).toHaveBeenCalledWith("system");
  expect(m.player.play).toHaveBeenCalledOnce();
  blur();
  expect(m.nativeRoute.resetPlaybackAudioRoute).toHaveBeenCalledOnce();
});

it("does not claim picker ownership or resume playback during a call", async () => {
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  m.busy = true;
  m.controls.onOutputPickerOpened();
  await m.controls.onToggle();
  expect(m.nativeRoute.setPlaybackAudioRoute).not.toHaveBeenCalled();
  expect(m.player.play).not.toHaveBeenCalled();
  blur();
});

it("preserves an already-connected accessory on first Play", async () => {
  m.nativeRoute.getPlaybackAudioRoute.mockResolvedValueOnce({
    route: "external",
    label: "Bluetooth",
  });
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  await m.controls.onToggle();
  expect(m.nativeRoute.setPlaybackAudioRoute).toHaveBeenCalledWith("system");
  blur();
});

it("does not replace a chosen output with a delayed initial route read", async () => {
  let finish!: () => void;
  m.nativeRoute.getPlaybackAudioRoute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ route: "external", label: "Bluetooth" });
      }),
  );
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  await m.controls.onRouteChange("speaker");
  finish();
  await Promise.resolve();
  await Promise.resolve();
  await m.controls.onToggle();
  expect(m.nativeRoute.setPlaybackAudioRoute).toHaveBeenLastCalledWith(
    "speaker",
  );
  blur();
});

it("ignores a route change that finishes after a newer picker choice", async () => {
  let finish!: () => void;
  m.nativeRoute.setPlaybackAudioRoute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ route: "speaker", label: "Speaker" });
      }),
  );
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  const pending = m.controls.onToggle();
  await Promise.resolve();
  m.controls.onOutputPickerOpened({ route: "external", label: "Bluetooth" });
  finish();
  await pending;
  expect(m.player.play).not.toHaveBeenCalled();
  await m.controls.onToggle();
  expect(m.nativeRoute.setPlaybackAudioRoute).toHaveBeenLastCalledWith(
    "system",
  );
  blur();
});

it("allows playback after refocus while an old route request settles", async () => {
  let finish!: () => void;
  m.nativeRoute.setPlaybackAudioRoute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ route: "earpiece", label: "Earpiece" });
      }),
  );
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  const pending = m.controls.onToggle();
  await Promise.resolve();
  blur();
  const blurAgain = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  await m.controls.onToggle();
  expect(m.player.play).toHaveBeenCalledOnce();
  finish();
  await pending;
  expect(m.player.play).toHaveBeenCalledOnce();
  blurAgain();
});

it("the Play wrapper restarts completed playback audibly", async () => {
  m.status.currentTime = 100;
  m.status.didJustFinish = true;
  m.player.volume = 0.2;
  m.player.muted = true;
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  await m.buttons.get("Play recording").onPress();
  expect(m.player.seekTo).toHaveBeenCalledWith(0);
  expect(m.player.volume).toBe(1);
  expect(m.player.muted).toBe(false);
  expect(m.player.play).toHaveBeenCalledOnce();
  blur();
});

it("fails closed when a playback seek is rejected", async () => {
  m.player.seekTo.mockRejectedValueOnce(new Error("seek failed"));
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  await m.controls.onSeek(15);
  expect(m.player.replace).toHaveBeenLastCalledWith(null);
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
