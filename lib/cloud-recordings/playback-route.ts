import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { setAudioModeAsync } from "expo-audio";

export type PlaybackAudioRoute = "speaker" | "earpiece" | "system";
export type EffectivePlaybackAudioRoute =
  | "speaker"
  | "earpiece"
  | "external"
  | "unknown";
export interface PlaybackAudioRouteStatus {
  route: EffectivePlaybackAudioRoute;
  label: string;
  /** Android reports only routes present in the actual output inventory. */
  availableRoutes?: readonly PlaybackAudioRoute[];
  unavailable?: boolean;
}

/** Optional patched Expo methods live on the individual recording player. */
export interface PlaybackRoutePlayer {
  getPlaybackAudioRoute?(): unknown;
  setPlaybackAudioRoute?(route: PlaybackAudioRoute): unknown;
  addListener?(
    event: string,
    listener: (value: unknown) => void,
  ): { remove(): void };
}

interface NativePlaybackRouteBridge {
  getPlaybackAudioRoute?(): Promise<unknown>;
  setPlaybackAudioRoute?(route: PlaybackAudioRoute): Promise<unknown>;
  resetPlaybackAudioRoute?(): Promise<unknown>;
}

const bridge = NativeModules.Phone11Siprix as
  | NativePlaybackRouteBridge
  | undefined;
const labels: Record<EffectivePlaybackAudioRoute, string> = {
  speaker: "Speaker",
  earpiece: "Earpiece",
  external: "Connected audio",
  unknown: "Audio output",
};
const externalLabels = new Set([
  "AirPlay",
  "Bluetooth",
  "Connected audio",
  "HDMI",
  "Headphones",
  "USB audio",
]);

export const normalizePlaybackAudioRoute = (
  value: unknown,
): PlaybackAudioRouteStatus => {
  if (!value || typeof value !== "object")
    return { route: "unknown", label: labels.unknown };
  const raw = value as { route?: unknown; label?: unknown };
  const route =
    raw.route === "speaker" ||
    raw.route === "earpiece" ||
    raw.route === "external"
      ? raw.route
      : "unknown";
  const label =
    route === "external" &&
    typeof raw.label === "string" &&
    externalLabels.has(raw.label)
      ? raw.label
      : labels[route];
  const capabilities = value as {
    availableRoutes?: unknown;
    unavailable?: unknown;
  };
  const rawRoutes = capabilities.availableRoutes;
  const availableRoutes = Array.isArray(rawRoutes)
    ? (["earpiece", "speaker", "system"] as const).filter((candidate) =>
        rawRoutes.includes(candidate),
      )
    : undefined;
  return {
    route,
    label,
    ...(availableRoutes ? { availableRoutes } : {}),
    ...(capabilities.unavailable === true ? { unavailable: true } : {}),
  };
};

export const playbackAudioMode = (route: PlaybackAudioRoute) => ({
  allowsRecording: route === "earpiece",
  interruptionMode: "doNotMix" as const,
  playsInSilentMode: true,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: route === "earpiece",
});

/** The iOS bridge applies and verifies the AVAudioSession route on its main queue. */
export async function setPlaybackAudioRoute(
  route: PlaybackAudioRoute,
  canChangeRoute: () => boolean,
  player?: object,
) {
  if (!canChangeRoute()) throw new Error("CALL_AUDIO_ACTIVE");
  if (Platform.OS === "ios") {
    if (!bridge?.setPlaybackAudioRoute)
      throw new Error("PLAYBACK_ROUTE_UNAVAILABLE");
    return normalizePlaybackAudioRoute(
      await bridge.setPlaybackAudioRoute(route),
    );
  }
  if (Platform.OS === "android") {
    const nativePlayer = player as PlaybackRoutePlayer | undefined;
    if (!nativePlayer?.setPlaybackAudioRoute)
      throw new Error("PLAYBACK_ROUTE_UNAVAILABLE");
    const result = await nativePlayer.setPlaybackAudioRoute(route);
    if (!canChangeRoute()) throw new Error("CALL_AUDIO_ACTIVE");
    return normalizePlaybackAudioRoute(result);
  }
  // The system picker owns this choice on iOS. Never map it to an invented
  // speaker route on platforms without that native picker.
  if (route === "system") throw new Error("PLAYBACK_ROUTE_UNAVAILABLE");
  await setAudioModeAsync(playbackAudioMode(route));
  return { route, label: labels[route] } satisfies PlaybackAudioRouteStatus;
}

/** Restore normal media playback only after this screen actually changed it. */
export async function resetPlaybackAudioRoute(
  canChangeRoute: () => boolean,
  player?: object,
) {
  if (!canChangeRoute()) return false;
  if (Platform.OS === "ios") {
    if (!bridge?.resetPlaybackAudioRoute) return false;
    await bridge.resetPlaybackAudioRoute();
    return true;
  }
  if (Platform.OS === "android") {
    const nativePlayer = player as PlaybackRoutePlayer | undefined;
    if (!nativePlayer?.setPlaybackAudioRoute) return false;
    await nativePlayer.setPlaybackAudioRoute("system");
    return canChangeRoute();
  }
  await setAudioModeAsync(playbackAudioMode("speaker"));
  return canChangeRoute();
}

export async function readPlaybackAudioRoute(player?: object) {
  if (Platform.OS === "android") {
    const nativePlayer = player as PlaybackRoutePlayer | undefined;
    return normalizePlaybackAudioRoute(
      nativePlayer?.getPlaybackAudioRoute
        ? await nativePlayer.getPlaybackAudioRoute()
        : { route: "unknown", availableRoutes: [] },
    );
  }
  if (Platform.OS !== "ios" || !bridge?.getPlaybackAudioRoute)
    return {
      route: "unknown",
      label: labels.unknown,
    } satisfies PlaybackAudioRouteStatus;
  return normalizePlaybackAudioRoute(await bridge.getPlaybackAudioRoute());
}

export function subscribeToPlaybackAudioRoute(
  listener: (status: PlaybackAudioRouteStatus) => void,
  player?: object,
) {
  if (Platform.OS === "android") {
    const nativePlayer = player as PlaybackRoutePlayer | undefined;
    if (!nativePlayer?.addListener || !nativePlayer.getPlaybackAudioRoute)
      return () => {};
    let active = true;
    const subscription = nativePlayer.addListener(
      "playbackAudioRoute",
      (value) => {
        if (active) listener(normalizePlaybackAudioRoute(value));
      },
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }
  if (Platform.OS !== "ios" || !bridge) return () => {};
  const subscription = new NativeEventEmitter(bridge as never).addListener(
    "Phone11SiprixEvent",
    (event: unknown) => {
      if (
        event &&
        typeof event === "object" &&
        (event as { type?: unknown }).type === "playbackAudioRoute"
      )
        listener(normalizePlaybackAudioRoute(event));
    },
  );
  return () => subscription.remove();
}
