import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  focus: undefined as undefined | (() => () => void),
  identity: { id: 1 },
  player: { pause: vi.fn(), replace: vi.fn(), play: vi.fn(), seekTo: vi.fn() },
  token: vi.fn(async () => "token"),
  audioOptions: undefined as unknown,
  callListener: undefined as undefined | (() => void),
  busy: false,
  controls: {} as any,
  configure: vi.fn(async (_speaker: boolean) => {}),
  speakerSupported: false,
  playing: false,
}));
vi.mock("react-native", () => ({
  NativeModules: {},
  Platform: { OS: "ios" },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children }: any) =>
    createElement("button", null, children),
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (effect: () => () => void) => {
    m.focus = effect;
  },
}));
vi.mock("expo-audio", () => ({
  useAudioPlayer: (_source: unknown, options: unknown) => {
    m.audioOptions = options;
    return m.player;
  },
  useAudioPlayerStatus: () => ({
    currentTime: 0,
    duration: 100,
    playing: m.playing,
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
      incomingCall: m.busy ? { id: "incoming" } : null,
      activeCalls: {},
    }),
    subscribe: (listener: () => void) => {
      m.callListener = listener;
      return vi.fn();
    },
  },
}));
vi.mock("../components/cloud-recordings/call-history-view", () => ({
  PlaybackControls: (props: unknown) => {
    m.controls = props;
    return null;
  },
}));
vi.mock("../lib/cloud-recordings/playback-route", () => ({
  configurePlaybackRoute: (speaker: boolean) => m.configure(speaker),
  supportsPlaybackSpeaker: () => m.speakerSupported,
  releasePlaybackRoute: vi.fn(async () => {}),
}));
import { Playback } from "../components/cloud-recordings/cloud-playback";
const props = {
  callUuid: "11111111-1111-4111-8111-111111111111",
  path: "/api/recordings/play/11111111-1111-4111-8111-111111111111",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.focus = undefined;
  m.busy = false;
  m.callListener = undefined;
  m.speakerSupported = false;
  m.playing = false;
  m.configure.mockResolvedValue(undefined);
  m.token.mockResolvedValue("token");
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
  const again = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  expect(m.player.play).not.toHaveBeenCalled();
  again();
});
it("exposes and applies the playback speaker choice when the platform supports it", async () => {
  m.speakerSupported = true;
  m.playing = true;
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  expect(m.controls.onSpeakerChange).toEqual(expect.any(Function));
  m.controls.onSpeakerChange(true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(m.configure).toHaveBeenCalledWith(true);
  blur();
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

it("disables Expo delayed deactivation and revokes recording playback when an incoming call arrives", async () => {
  renderToStaticMarkup(createElement(Playback, props));
  expect(m.audioOptions).toMatchObject({ keepAudioSessionActive: true });
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  m.controls.onToggle();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(m.player.play).toHaveBeenCalledOnce();
  m.busy = true;
  m.callListener!();
  expect(m.player.pause).toHaveBeenCalled();
  expect(m.player.replace).toHaveBeenLastCalledWith(null);
  m.controls.onToggle();
  expect(m.player.play).toHaveBeenCalledTimes(1);
  blur();
});
it("an incoming call during route preparation cancels the focused player's pending start", async () => {
  let finish!: () => void;
  m.configure.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  renderToStaticMarkup(createElement(Playback, props));
  const blur = m.focus!();
  await Promise.resolve();
  await Promise.resolve();
  m.controls.onToggle();
  await Promise.resolve();
  m.busy = true;
  m.callListener!();
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(m.player.play).not.toHaveBeenCalled();
  expect(m.player.replace).toHaveBeenLastCalledWith(null);
  blur();
});
