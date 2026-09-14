import { useRef, useState } from "react";
import { View } from "react-native";

export function scrubPosition(x: number, width: number, duration: number) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    return 0;
  return Math.max(0, Math.min(duration, (x / width) * duration));
}

/** One seek on release; pointer movement previews without flooding the decoder. */
export function PlaybackScrubber({
  currentTime,
  duration,
  loaded,
  onSeek,
  primary,
  border,
}: {
  currentTime: number;
  duration: number;
  loaded: boolean;
  onSeek(seconds: number): void;
  primary: string;
  border: string;
}) {
  const width = useRef(0);
  const drag = useRef<{ pageX: number; x: number; position: number } | null>(
    null,
  );
  const [preview, setPreview] = useState<number | null>(null);
  const enabled = loaded && Number.isFinite(duration) && duration > 0;
  const position = Math.max(0, Math.min(duration || 0, preview ?? currentTime));
  const percent = duration > 0 ? (position / duration) * 100 : 0;
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Recording playback position"
      accessibilityHint="Drag to seek. Swipe up or down to move 15 seconds."
      accessibilityState={{ disabled: !enabled }}
      accessibilityValue={{
        min: 0,
        max: duration || 0,
        now: position,
        text: `${Math.floor(position)} of ${Math.floor(duration || 0)} seconds`,
      }}
      accessibilityActions={[
        { name: "increment", label: "Forward 15 seconds" },
        { name: "decrement", label: "Back 15 seconds" },
      ]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (!enabled) return;
        if (nativeEvent.actionName === "increment")
          onSeek(Math.min(duration, currentTime + 15));
        if (nativeEvent.actionName === "decrement")
          onSeek(Math.max(0, currentTime - 15));
      }}
      onLayout={({ nativeEvent }) => {
        width.current = nativeEvent.layout.width;
      }}
      onStartShouldSetResponder={() => enabled}
      onMoveShouldSetResponder={() => enabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={({ nativeEvent }) => {
        const position = scrubPosition(
          nativeEvent.locationX,
          width.current,
          duration,
        );
        drag.current = {
          pageX: nativeEvent.pageX,
          x: nativeEvent.locationX,
          position,
        };
        setPreview(position);
      }}
      onResponderMove={({ nativeEvent }) => {
        if (!drag.current) return;
        drag.current.position = scrubPosition(
          drag.current.x + nativeEvent.pageX - drag.current.pageX,
          width.current,
          duration,
        );
        setPreview(drag.current.position);
      }}
      onResponderRelease={() => {
        const position = drag.current?.position;
        drag.current = null;
        setPreview(null);
        if (enabled && position !== undefined) onSeek(position);
      }}
      onResponderTerminate={() => {
        drag.current = null;
        setPreview(null);
      }}
      style={{
        height: 44,
        justifyContent: "center",
        opacity: enabled ? 1 : 0.5,
      }}
    >
      <View
        pointerEvents="none"
        style={{ height: 4, borderRadius: 2, backgroundColor: border }}
      >
        <View
          style={{
            height: 4,
            borderRadius: 2,
            width: `${percent}%`,
            backgroundColor: primary,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: `${percent}%`,
          marginLeft: -8,
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: primary,
        }}
      />
    </View>
  );
}
