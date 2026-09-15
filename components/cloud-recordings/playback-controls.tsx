import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type {
  PlaybackAudioRoute,
  PlaybackAudioRouteStatus,
} from "@/lib/cloud-recordings/playback-route";
import {
  PlaybackOutputPickerButton,
  type PlaybackExternalOutput,
} from "./playback-output-picker";

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
  onOutputPickerOpened,
  availableOutputs,
  onOutputSelect,
  onShare,
  sharing = false,
  error,
  shareError,
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
  onOutputPickerOpened?(output: PlaybackAudioRouteStatus): void | Promise<void>;
  availableOutputs?: readonly PlaybackExternalOutput[];
  onOutputSelect?(output: PlaybackExternalOutput): void | Promise<void>;
  onShare?(): void | Promise<void>;
  sharing?: boolean;
  error?: string;
  shareError?: string;
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
              justifyContent: "space-between",
              alignSelf: "center",
              width: "100%",
              maxWidth: 320,
              gap: 4,
            }}
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back 15 seconds"
              accessibilityHint="Moves playback back 15 seconds"
              accessibilityState={{ disabled: !loaded }}
              disabled={!loaded}
              onPress={() => adjust(-15)}
              style={{
                height: 44,
                width: 44,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <IconSymbol
                name="backward.fill"
                size={26}
                color={loaded ? colors.primary : colors.muted}
              />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                playing ? "Pause recording" : "Play recording"
              }
              accessibilityHint={
                playing
                  ? "Pauses recording playback"
                  : "Starts recording playback"
              }
              accessibilityState={{ disabled: !loaded }}
              disabled={!loaded}
              onPress={onToggle}
              style={{
                height: 48,
                width: 48,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: loaded ? colors.primary : colors.border,
                borderRadius: 24,
              }}
            >
              {!loaded ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : (
                <IconSymbol
                  name={playing ? "pause.fill" : "play.fill"}
                  size={24}
                  color="white"
                  style={!playing ? { marginLeft: 2 } : undefined}
                />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Forward 15 seconds"
              accessibilityHint="Moves playback forward 15 seconds"
              accessibilityState={{ disabled: !loaded }}
              disabled={!loaded}
              onPress={() => adjust(15)}
              style={{
                height: 44,
                width: 44,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <IconSymbol
                name="forward.fill"
                size={26}
                color={loaded ? colors.primary : colors.muted}
              />
            </TouchableOpacity>
            <PlaybackOutputPickerButton
              loaded={loaded}
              output={output}
              routeChanging={routeChanging}
              availableOutputs={availableOutputs}
              onRouteChange={onRouteChange}
              onOutputSelect={onOutputSelect}
              onOutputPickerOpened={onOutputPickerOpened}
              colors={colors}
            />
            {onShare && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Share recording"
                accessibilityHint="Downloads this recording and opens the share sheet"
                accessibilityState={{ disabled: !loaded || sharing }}
                disabled={!loaded || sharing}
                onPress={onShare}
                style={{
                  height: 44,
                  width: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                {sharing ? (
                  <ActivityIndicator size="small" color={colors.muted} />
                ) : (
                  <IconSymbol
                    name="square.and.arrow.up"
                    size={23}
                    color={loaded ? colors.primary : colors.muted}
                  />
                )}
              </TouchableOpacity>
            )}
          </View>
          {(shareError || routeError || output.route === "external") && (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                textAlign: "center",
                fontSize: 12,
                color: shareError || routeError ? colors.error : colors.muted,
              }}
            >
              {shareError || routeError || `Connected to ${output.label}`}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
