import { useEffect, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type {
  PlaybackAudioRoute,
  PlaybackAudioRouteStatus,
} from "@/lib/cloud-recordings/playback-route";

export interface PlaybackControlColors {
  foreground: string;
  muted: string;
  primary: string;
  border: string;
  surface: string;
  background: string;
  error: string;
}

export const defaultPlaybackColors: PlaybackControlColors = {
  foreground: "#182536",
  muted: "#687584",
  primary: "#1672D4",
  border: "#E6EBF0",
  surface: "#F4F7FA",
  background: "#FFFFFF",
  error: "#D64B60",
};

export const clampPlaybackSeconds = (seconds: number, duration: number) =>
  Math.min(
    Math.max(0, Number.isFinite(duration) ? duration : 0),
    Math.max(0, Number.isFinite(seconds) ? seconds : 0),
  );

export const playbackSecondsForTrack = (
  locationX: number,
  width: number,
  duration: number,
) =>
  width > 0 && duration > 0
    ? clampPlaybackSeconds((locationX / width) * duration, duration)
    : 0;

export const formatPlaybackTime = (seconds: number) => {
  const whole = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

export function PlaybackControls({
  currentTime,
  duration,
  playing,
  loaded,
  route,
  output,
  routeChanging = false,
  onToggle,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onRouteChange,
  error,
  routeError,
  colors = defaultPlaybackColors,
}: {
  currentTime: number;
  duration: number;
  playing: boolean;
  loaded: boolean;
  route: PlaybackAudioRoute;
  output: PlaybackAudioRouteStatus;
  routeChanging?: boolean;
  onToggle(): void | Promise<void>;
  onSeek(seconds: number): void | Promise<void>;
  onScrubStart?(): void;
  onScrubEnd?(): void;
  onRouteChange(route: PlaybackAudioRoute): void | Promise<void>;
  error?: string;
  routeError?: string;
  colors?: PlaybackControlColors;
}) {
  const width = useRef(0);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const shownTime = dragTime ?? clampPlaybackSeconds(currentTime, duration);
  const remaining = Math.max(0, duration - shownTime);
  const progress = duration > 0 ? Math.min(1, shownTime / duration) : 0;

  useEffect(
    () =>
      setDragTime((value) =>
        value === null ? null : clampPlaybackSeconds(value, duration),
      ),
    [duration],
  );

  const seekFromEvent = (event: GestureResponderEvent, commit: boolean) => {
    const seconds = playbackSecondsForTrack(
      event.nativeEvent.locationX,
      width.current,
      duration,
    );
    setDragTime(commit ? null : seconds);
    if (commit)
      void Promise.resolve(onSeek(seconds)).finally(() => onScrubEnd?.());
  };
  const adjust = (delta: number) =>
    onSeek(clampPlaybackSeconds(shownTime + delta, duration));
  const speakerSelected = output.route === "speaker";
  const webSliderProps =
    Platform.OS === "web"
      ? ({
          "aria-valuemin": 0,
          "aria-valuemax": Math.max(0, Math.floor(duration)),
          "aria-valuenow": Math.floor(shownTime),
          tabIndex: loaded ? 0 : -1,
          onKeyDown: (event: {
            key?: string;
            nativeEvent?: { key?: string };
            preventDefault?(): void;
          }) => {
            const key = event.nativeEvent?.key ?? event.key;
            if (
              [
                "ArrowRight",
                "ArrowUp",
                "ArrowLeft",
                "ArrowDown",
                "Home",
                "End",
              ].includes(key ?? "")
            )
              event.preventDefault?.();
            if (key === "ArrowRight" || key === "ArrowUp") adjust(15);
            if (key === "ArrowLeft" || key === "ArrowDown") adjust(-15);
            if (key === "Home") onSeek(0);
            if (key === "End") onSeek(duration);
          },
        } as const)
      : {};

  return (
    <View style={{ gap: 10, paddingBottom: 12 }}>
      {error ? (
        <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>
          {error}
        </Text>
      ) : (
        <>
          <View
            {...webSliderProps}
            accessibilityRole="adjustable"
            accessibilityLabel="Recording position"
            accessibilityHint="Swipe up or down to move 15 seconds, or drag along the timeline"
            accessibilityValue={{
              min: 0,
              max: Math.max(0, Math.floor(duration)),
              now: Math.floor(shownTime),
              text: `${formatPlaybackTime(shownTime)} elapsed, ${formatPlaybackTime(remaining)} remaining`,
            }}
            accessibilityActions={[
              { name: "increment", label: "Forward 15 seconds" },
              { name: "decrement", label: "Back 15 seconds" },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "increment") adjust(15);
              if (event.nativeEvent.actionName === "decrement") adjust(-15);
            }}
            onLayout={(event) => {
              width.current = event.nativeEvent.layout.width;
            }}
            onStartShouldSetResponder={() => loaded && duration > 0}
            onMoveShouldSetResponder={() => loaded && duration > 0}
            onResponderGrant={(event) => {
              onScrubStart?.();
              seekFromEvent(event, false);
            }}
            onResponderMove={(event) => seekFromEvent(event, false)}
            onResponderRelease={(event) => seekFromEvent(event, true)}
            onResponderTerminate={() => {
              setDragTime(null);
              onScrubEnd?.();
            }}
            style={{ height: 28, justifyContent: "center" }}
          >
            <View
              pointerEvents="none"
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.border,
              }}
            >
              <View
                style={{
                  height: 4,
                  width: `${progress * 100}%`,
                  borderRadius: 2,
                  backgroundColor: colors.primary,
                }}
              />
            </View>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: `${progress * 100}%`,
                marginLeft: -9,
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: colors.primary,
              }}
            />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {formatPlaybackTime(shownTime)}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              −{formatPlaybackTime(remaining)}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back 15 seconds"
              disabled={!loaded}
              onPress={() => adjust(-15)}
              style={{
                minHeight: 48,
                minWidth: 48,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ color: loaded ? colors.primary : colors.muted }}>
                −15s
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                playing ? "Pause recording" : "Play recording"
              }
              disabled={!loaded}
              onPress={onToggle}
              style={{
                minHeight: 48,
                minWidth: 72,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: loaded ? colors.primary : colors.border,
                borderRadius: 24,
              }}
            >
              <Text style={{ color: "white", fontWeight: "600" }}>
                {!loaded ? "Loading" : playing ? "Pause" : "Play"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Forward 15 seconds"
              disabled={!loaded}
              onPress={() => adjust(15)}
              style={{
                minHeight: 48,
                minWidth: 48,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ color: loaded ? colors.primary : colors.muted }}>
                +15s
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                speakerSelected ? "Turn speaker off" : "Play through speaker"
              }
              accessibilityState={{
                selected: speakerSelected,
                busy: routeChanging,
              }}
              disabled={!loaded || routeChanging}
              onPress={() =>
                onRouteChange(speakerSelected ? "earpiece" : "speaker")
              }
              style={{
                minHeight: 44,
                minWidth: 78,
                paddingHorizontal: 12,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: speakerSelected
                  ? colors.primary
                  : colors.surface,
              }}
            >
              <Text
                style={{
                  color: speakerSelected ? "white" : colors.foreground,
                  fontWeight: "600",
                }}
              >
                {routeChanging ? "Changing…" : "Speaker"}
              </Text>
            </TouchableOpacity>
          </View>
          {(routeError || output.route === "external") && (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                textAlign: "center",
                fontSize: 12,
                color: routeError ? colors.error : colors.muted,
              }}
            >
              {routeError || `Connected to ${output.label}`}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
