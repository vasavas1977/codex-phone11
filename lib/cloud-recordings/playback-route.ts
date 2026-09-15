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
}

interface NativePlaybackRouteBridge {
  getPlaybackAudioRoute?(): Promise<unknown>;
  setPlaybackAudioRoute?(route: PlaybackAudioRoute): Promise<unknown>;
  resetPlaybackAudioRoute?(): Promise<unknown>;
  getPlaybackAudioOutputs?(): Promise<unknown>;
  selectPlaybackAudioOutput?(outputId: string): Promise<unknown>;
  resetPlaybackAudioOutput?(): Promise<unknown>;
}

export interface PlaybackAudioOutput {
  id: string;
  kind: "phone" | "speaker" | "bluetooth";
  label: string;
  selected: boolean;
}

export interface PlaybackAudioOutputs {
  outputs: PlaybackAudioOutput[];
  selectedId: string | null;
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
const androidOutputId = /^android:(?:0|[1-9][0-9]{0,9})$/;

export const normalizePlaybackAudioOutputs = (
  value: unknown,
): PlaybackAudioOutputs => {
  if (!value || typeof value !== "object")
    return { outputs: [], selectedId: null };
  const raw = value as { outputs?: unknown; selectedId?: unknown };
  const selectedId =
    typeof raw.selectedId === "string" && androidOutputId.test(raw.selectedId)
      ? raw.selectedId
      : null;
  let bluetoothIndex = 0;
  const seen = new Set<string>();
  const outputs = Array.isArray(raw.outputs)
    ? raw.outputs.flatMap((item): PlaybackAudioOutput[] => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as {
          id?: unknown;
          kind?: unknown;
          selected?: unknown;
        };
        if (
          typeof candidate.id !== "string" ||
          !androidOutputId.test(candidate.id) ||
          (candidate.kind !== "phone" &&
            candidate.kind !== "speaker" &&
            candidate.kind !== "bluetooth") ||
          seen.has(candidate.id)
        )
          return [];
        seen.add(candidate.id);
        if (candidate.kind === "bluetooth") bluetoothIndex += 1;
        return [
          {
            id: candidate.id,
            kind: candidate.kind,
            label:
              candidate.kind === "phone"
                ? "Phone"
                : candidate.kind === "speaker"
                  ? "Speaker"
                  : bluetoothIndex === 1
                    ? "Bluetooth audio"
                    : `Bluetooth audio ${bluetoothIndex}`,
            selected:
              candidate.selected === true && candidate.id === selectedId,
          },
        ];
      })
    : [];
  const boundedOutputs = outputs.slice(0, 10);
  return {
    outputs: boundedOutputs,
    selectedId:
      selectedId && boundedOutputs.some((item) => item.id === selectedId)
        ? selectedId
        : null,
  };
};

export const playbackAudioOutputStatus = (
  inventory: PlaybackAudioOutputs,
): PlaybackAudioRouteStatus => {
  const selected = inventory.outputs.find(
    (item) => item.id === inventory.selectedId && item.selected,
  );
  if (!selected) return { route: "unknown", label: labels.unknown };
  if (selected.kind === "phone")
    return { route: "earpiece", label: selected.label };
  if (selected.kind === "speaker")
    return { route: "speaker", label: selected.label };
  return { route: "external", label: selected.label };
};

export async function readPlaybackAudioOutputs(): Promise<PlaybackAudioOutputs> {
  if (Platform.OS !== "android" || !bridge?.getPlaybackAudioOutputs)
    return { outputs: [], selectedId: null };
  return normalizePlaybackAudioOutputs(await bridge.getPlaybackAudioOutputs());
}

export async function selectPlaybackAudioOutput(
  outputId: string,
  canChangeRoute: () => boolean,
) {
  if (!canChangeRoute()) throw new Error("CALL_AUDIO_ACTIVE");
  if (
    Platform.OS !== "android" ||
    !androidOutputId.test(outputId) ||
    !bridge?.selectPlaybackAudioOutput
  )
    throw new Error("PLAYBACK_ROUTE_UNAVAILABLE");
  return normalizePlaybackAudioOutputs(
    await bridge.selectPlaybackAudioOutput(outputId),
  );
}

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
  return { route, label };
};

export const playbackAudioMode = (route: PlaybackAudioRoute) => ({
  allowsRecording: route === "earpiece",
  interruptionMode: "doNotMix" as const,
  interruptionModeAndroid: "doNotMix" as const,
  playsInSilentMode: true,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: route === "earpiece",
});

/** The iOS bridge applies and verifies the AVAudioSession route on its main queue. */
export async function setPlaybackAudioRoute(
  route: PlaybackAudioRoute,
  canChangeRoute: () => boolean,
) {
  if (!canChangeRoute()) throw new Error("CALL_AUDIO_ACTIVE");
  if (Platform.OS === "ios") {
    if (!bridge?.setPlaybackAudioRoute)
      throw new Error("PLAYBACK_ROUTE_UNAVAILABLE");
    return normalizePlaybackAudioRoute(
      await bridge.setPlaybackAudioRoute(route),
    );
  }
  if (
    Platform.OS === "android" &&
    bridge?.getPlaybackAudioOutputs &&
    bridge.selectPlaybackAudioOutput
  ) {
    const current = normalizePlaybackAudioOutputs(
      await bridge.getPlaybackAudioOutputs(),
    );
    if (route === "system") {
      const effective = playbackAudioOutputStatus(current);
      if (effective.route === "unknown")
        throw new Error("PLAYBACK_ROUTE_UNAVAILABLE");
      return effective;
    }
    const requestedKind = route === "earpiece" ? "phone" : "speaker";
    const requested = current.outputs.find(
      (output) => output.kind === requestedKind,
    );
    if (!requested) throw new Error("PLAYBACK_ROUTE_UNAVAILABLE");
    return playbackAudioOutputStatus(
      normalizePlaybackAudioOutputs(
        await bridge.selectPlaybackAudioOutput(requested.id),
      ),
    );
  }
  // The system picker owns this choice on iOS. Never map it to an invented
  // speaker route on platforms without that native picker.
  if (route === "system") throw new Error("PLAYBACK_ROUTE_UNAVAILABLE");
  await setAudioModeAsync(playbackAudioMode(route));
  return { route, label: labels[route] } satisfies PlaybackAudioRouteStatus;
}

/** Restore normal media playback only after this screen actually changed it. */
export async function resetPlaybackAudioRoute(canChangeRoute: () => boolean) {
  if (!canChangeRoute()) return false;
  if (Platform.OS === "ios") {
    if (!bridge?.resetPlaybackAudioRoute) return false;
    await bridge.resetPlaybackAudioRoute();
    return true;
  }
  if (Platform.OS === "android" && bridge?.resetPlaybackAudioOutput) {
    await bridge.resetPlaybackAudioOutput();
    return canChangeRoute();
  }
  await setAudioModeAsync(playbackAudioMode("speaker"));
  return canChangeRoute();
}

export async function readPlaybackAudioRoute() {
  if (Platform.OS === "android" && bridge?.getPlaybackAudioOutputs)
    return playbackAudioOutputStatus(
      normalizePlaybackAudioOutputs(await bridge.getPlaybackAudioOutputs()),
    );
  if (Platform.OS !== "ios" || !bridge?.getPlaybackAudioRoute)
    return {
      route: "unknown",
      label: labels.unknown,
    } satisfies PlaybackAudioRouteStatus;
  return normalizePlaybackAudioRoute(await bridge.getPlaybackAudioRoute());
}

export function subscribeToPlaybackAudioRoute(
  listener: (status: PlaybackAudioRouteStatus) => void,
) {
  if ((Platform.OS !== "ios" && Platform.OS !== "android") || !bridge)
    return () => {};
  const subscription = new NativeEventEmitter(bridge as never).addListener(
    "Phone11SiprixEvent",
    (event: unknown) => {
      if (!event || typeof event !== "object") return;
      const type = (event as { type?: unknown }).type;
      if (Platform.OS === "ios" && type === "playbackAudioRoute")
        listener(normalizePlaybackAudioRoute(event));
      if (Platform.OS === "android" && type === "playbackAudioOutputsChanged")
        listener(
          playbackAudioOutputStatus(normalizePlaybackAudioOutputs(event)),
        );
    },
  );
  return () => subscription.remove();
}

export function subscribeToPlaybackAudioOutputs(
  listener: (outputs: PlaybackAudioOutputs) => void,
) {
  if (Platform.OS !== "android" || !bridge) return () => {};
  const subscription = new NativeEventEmitter(bridge as never).addListener(
    "Phone11SiprixEvent",
    (event: unknown) => {
      if (
        event &&
        typeof event === "object" &&
        (event as { type?: unknown }).type === "playbackAudioOutputsChanged"
      )
        listener(normalizePlaybackAudioOutputs(event));
    },
  );
  return () => subscription.remove();
}
