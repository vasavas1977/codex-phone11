import { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

export default function ActiveCallScreen() {
  const colors = useColors();
  const { number, type } = useLocalSearchParams<{ number: string; type: string }>();
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);

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

  const KEYPAD = ["1","2","3","4","5","6","7","8","9","*","0","#"];

  return (
    <View style={[styles.container, { backgroundColor: "#0D0F14" }]}>
      {/* Caller Info */}
      <View style={styles.callerSection}>
        <View style={[styles.callerAvatar, { backgroundColor: colors.primary + "30" }]}>
          <Text style={styles.callerInitial}>
            {(number || "?").charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.callerName}>{number || "Unknown"}</Text>
        <Text style={[styles.callStatus, { color: held ? colors.warning : colors.success }]}>
          {held ? "On Hold" : formatTime(elapsed)}
        </Text>
      </View>

      {/* Keypad overlay */}
      {showKeypad && (
        <View style={styles.keypadOverlay}>
          <View style={styles.keypadGrid}>
            {KEYPAD.map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.keypadKey, { backgroundColor: "#ffffff15" }]}
                onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
              >
                <Text style={styles.keypadDigit}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <TouchableOpacity
            style={[styles.controlBtn, muted && { backgroundColor: colors.primary + "40" }]}
            onPress={() => { setMuted(!muted); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
          >
            <IconSymbol name={muted ? "mic.slash.fill" : "mic.fill"} size={24} color={muted ? colors.primary : "#fff"} />
            <Text style={styles.controlLabel}>{muted ? "Unmute" : "Mute"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlBtn, held && { backgroundColor: colors.warning + "40" }]}
            onPress={() => { setHeld(!held); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
          >
            <IconSymbol name="pause.fill" size={24} color={held ? colors.warning : "#fff"} />
            <Text style={styles.controlLabel}>{held ? "Resume" : "Hold"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlBtn, speaker && { backgroundColor: colors.primary + "40" }]}
            onPress={() => { setSpeaker(!speaker); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
          >
            <IconSymbol name={speaker ? "speaker.wave.3.fill" : "speaker.slash.fill"} size={24} color={speaker ? colors.primary : "#fff"} />
            <Text style={styles.controlLabel}>Speaker</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.controlRow}>
          <TouchableOpacity
            style={[styles.controlBtn, showKeypad && { backgroundColor: colors.primary + "40" }]}
            onPress={() => { setShowKeypad(!showKeypad); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <IconSymbol name="rectangle.grid.3x2.fill" size={24} color={showKeypad ? colors.primary : "#fff"} />
            <Text style={styles.controlLabel}>Keypad</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: "/call/transfer", params: { callId: `call_${Date.now()}` } });
            }}
          >
            <IconSymbol name="arrow.triangle.2.circlepath" size={24} color="#fff" />
            <Text style={styles.controlLabel}>Transfer</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => router.push("/call/video")}
          >
            <IconSymbol name="video.fill" size={24} color="#fff" />
            <Text style={styles.controlLabel}>Video</Text>
          </TouchableOpacity>
        </View>

        {/* End Call */}
        <TouchableOpacity style={[styles.endCallBtn, { backgroundColor: colors.error }]} onPress={handleEndCall}>
          <IconSymbol name="phone.down.fill" size={30} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "space-between",
    paddingTop: 60,
    paddingBottom: 48,
  },
  callerSection: {
    alignItems: "center",
    gap: 12,
  },
  callerAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  callerInitial: {
    fontSize: 40,
    fontWeight: "700",
    color: "#fff",
  },
  callerName: {
    fontSize: 28,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: 0.3,
  },
  callStatus: {
    fontSize: 16,
    fontWeight: "500",
  },
  keypadOverlay: {
    paddingHorizontal: 32,
  },
  keypadGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
  },
  keypadKey: {
    width: 72,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  keypadDigit: {
    fontSize: 22,
    fontWeight: "300",
    color: "#fff",
  },
  controls: {
    paddingHorizontal: 24,
    gap: 20,
    alignItems: "center",
  },
  controlRow: {
    flexDirection: "row",
    gap: 24,
    justifyContent: "center",
  },
  controlBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#ffffff18",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  controlLabel: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "500",
  },
  endCallBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF3B30",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
});
