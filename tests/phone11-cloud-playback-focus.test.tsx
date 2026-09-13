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
}));
vi.mock("react-native", () => ({
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
  useAudioPlayer: () => m.player,
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
    getState: () => ({ incomingCall: null, activeCalls: {} }),
    subscribe: () => vi.fn(),
  },
}));
import { Playback } from "../components/cloud-recordings/cloud-playback";
const props = {
  callUuid: "11111111-1111-4111-8111-111111111111",
  path: "/api/recordings/play/11111111-1111-4111-8111-111111111111",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.focus = undefined;
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
