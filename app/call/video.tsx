import { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

export default function VideoCallScreen() {
  const colors = useColors();
  const { number } = useLocalSearchParams<{ number: string }>();
  const [elapsed, setElapsed] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [frontCamera, setFrontCamera] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const handleEndCall = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    router.back();
  }, []);

  return (
    <View style={styles.container}>
      {/* Remote video placeholder */}
      <View style={[styles.remoteVideo, { backgroundColor: "#1a1f2e" }]}>
        <View style={[styles.remoteAvatar, { backgroundColor: colors.primary + "30" }]}>
          <Text style={styles.remoteInitial}>{(number || "?").charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.remoteName}>{number || "Unknown"}</Text>
        <Text style={[styles.callTimer, { color: colors.success }]}>{formatTime(elapsed)}</Text>
      </View>

      {/* Local video PiP */}
      <View style={[styles.localVideo, { backgroundColor: "#0d1117", borderColor: "#ffffff30" }]}>
        {videoMuted ? (
          <IconSymbol name="video.slash.fill" size={24} color="#ffffff60" />
        ) : (
          <Text style={{ color: "#ffffff60", fontSize: 11 }}>Camera Preview</Text>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.ctrlBtn, micMuted && { backgroundColor: colors.primary + "40" }]}
          onPress={() => { setMicMuted(!micMuted); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
        >
          <IconSymbol name={micMuted ? "mic.slash.fill" : "mic.fill"} size={22} color={micMuted ? colors.primary : "#fff"} />
          <Text style={styles.ctrlLabel}>{micMuted ? "Unmute" : "Mute"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.ctrlBtn, videoMuted && { backgroundColor: colors.primary + "40" }]}
          onPress={() => { setVideoMuted(!videoMuted); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
        >
          <IconSymbol name={videoMuted ? "video.slash.fill" : "video.fill"} size={22} color={videoMuted ? colors.primary : "#fff"} />
          <Text style={styles.ctrlLabel}>{videoMuted ? "Start Video" : "Stop Video"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.ctrlBtn}
          onPress={() => { setFrontCamera(!frontCamera); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <IconSymbol name="arrow.triangle.2.circlepath" size={22} color="#fff" />
          <Text style={styles.ctrlLabel}>Flip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.ctrlBtn, { backgroundColor: colors.error }]}
          onPress={handleEndCall}
        >
          <IconSymbol name="phone.down.fill" size={22} color="#fff" />
          <Text style={styles.ctrlLabel}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0F14",
  },
  remoteVideo: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  remoteAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  remoteInitial: {
    fontSize: 44,
    fontWeight: "700",
    color: "#fff",
  },
  remoteName: {
    fontSize: 24,
    fontWeight: "600",
    color: "#fff",
  },
  callTimer: {
    fontSize: 16,
    fontWeight: "500",
  },
  localVideo: {
    position: "absolute",
    top: 60,
    right: 20,
    width: 100,
    height: 140,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  controls: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    paddingBottom: 48,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: "#00000080",
  },
  ctrlBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#ffffff18",
    gap: 4,
  },
  ctrlLabel: {
    fontSize: 10,
    color: "#fff",
    fontWeight: "500",
  },
});
