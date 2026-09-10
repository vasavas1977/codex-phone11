import { useState, useEffect, useCallback } from "react";
import {
  Alert,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";

export default function ActiveCallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { number, callId: requestedCallId } = useLocalSearchParams<{
    number?: string;
    type?: string;
    callId?: string;
  }>();
  const { hangupCall, setMute, setHold, setSpeaker, sendDtmf } = useSip();
  const call = useSipCallStore((state) =>
    resolveCurrentCall(state, requestedCallId),
  );
  const callId = call?.id;
  const [ending, setEnding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showKeypad, setShowKeypad] = useState(false);

  const muted = call?.isMuted ?? false;
  const held = call?.isHeld ?? false;
  const speaker = call?.isSpeaker ?? false;
  const remoteNumber = call?.remoteNumber ?? number ?? "Unknown";
  const callMissing = !call;

  useEffect(() => {
    const timer = setInterval(() => {
      const startedAt = call?.connectTime ?? call?.startTime;
      if (!startedAt) {
        setElapsed(0);
        return;
      }
      setElapsed(
        Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [call?.connectTime, call?.startTime]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const callStatusLabel = () => {
    if (callMissing) return "Call ended";
    if (held) return "On Hold";
    if (!call) return formatTime(elapsed);
    if (call.status === "calling") return "Calling";
    if (call.status === "connecting") return "Connecting";
    if (call.status === "incoming") return "Incoming";
    if (call.status === "disconnected") return "Call ended";
    return formatTime(elapsed);
  };

  const handleEndCall = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (!callId) {
      router.canGoBack() ? router.back() : router.replace("/(tabs)");
      return;
    }
    if (ending) return;
    setEnding(true);
    try {
      await hangupCall(callId);
    } catch {
      Alert.alert(
        "Could not end call",
        "The call may still be connected. Please try End call again.",
      );
    } finally {
      setEnding(false);
    }
  }, [callId, ending, hangupCall]);

  const controlsReady = Boolean(
    call && (call.status === "active" || call.status === "held"),
  );
  const control = async (operation: () => Promise<void>) => {
    if (!controlsReady) return;
    try {
      await operation();
    } catch {
      Alert.alert(
        "Could not update call",
        "Your call is still available. Please try that control again.",
      );
    }
  };
  const handleMute = () => callId && control(() => setMute(callId, !muted));
  const handleHold = () => callId && control(() => setHold(callId, !held));
  const handleSpeaker = () =>
    callId && control(() => setSpeaker(callId, !speaker));
  const handleDtmf = (digit: string) =>
    callId && control(() => sendDtmf(callId, digit));

  const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: "#0D0F14",
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Caller Info */}
        <View style={styles.callerSection}>
          <View
            style={[
              styles.callerAvatar,
              { backgroundColor: colors.primary + "30" },
            ]}
          >
            <Text style={styles.callerInitial}>
              {remoteNumber.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.callerName}>{remoteNumber}</Text>
          <Text
            style={[
              styles.callStatus,
              { color: held ? colors.warning : colors.success },
            ]}
          >
            {callStatusLabel()}
          </Text>
        </View>

        {/* Keypad overlay */}
        {showKeypad && controlsReady && (
          <View style={styles.keypadOverlay}>
            <View style={styles.keypadGrid}>
              {KEYPAD.map((k) => (
                <TouchableOpacity
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${k}`}
                  style={[styles.keypadKey, { backgroundColor: "#ffffff15" }]}
                  onPress={() => handleDtmf(k)}
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
              style={[
                styles.controlBtn,
                muted && { backgroundColor: colors.primary + "40" },
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                muted ? "Unmute microphone" : "Mute microphone"
              }
              disabled={!controlsReady}
              onPress={handleMute}
            >
              <IconSymbol
                name={muted ? "mic.slash.fill" : "mic.fill"}
                size={24}
                color={muted ? colors.primary : "#fff"}
              />
              <Text style={styles.controlLabel}>
                {muted ? "Unmute" : "Mute"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.controlBtn,
                held && { backgroundColor: colors.warning + "40" },
              ]}
              accessibilityRole="button"
              accessibilityLabel={held ? "Resume call" : "Hold call"}
              disabled={!controlsReady}
              onPress={handleHold}
            >
              <IconSymbol
                name="pause.fill"
                size={24}
                color={held ? colors.warning : "#fff"}
              />
              <Text style={styles.controlLabel}>
                {held ? "Resume" : "Hold"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.controlBtn,
                speaker && { backgroundColor: colors.primary + "40" },
              ]}
              accessibilityRole="button"
              accessibilityLabel={speaker ? "Use earpiece" : "Use speaker"}
              disabled={!controlsReady}
              onPress={handleSpeaker}
            >
              <IconSymbol
                name={speaker ? "speaker.wave.3.fill" : "speaker.slash.fill"}
                size={24}
                color={speaker ? colors.primary : "#fff"}
              />
              <Text style={styles.controlLabel}>Speaker</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.controlRow}>
            <TouchableOpacity
              style={[
                styles.controlBtn,
                showKeypad && { backgroundColor: colors.primary + "40" },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Show call keypad"
              disabled={!controlsReady}
              onPress={() => {
                setShowKeypad(!showKeypad);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <IconSymbol
                name="rectangle.grid.3x2.fill"
                size={24}
                color={showKeypad ? colors.primary : "#fff"}
              />
              <Text style={styles.controlLabel}>Keypad</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* End stays visible while the caller, keypad and media controls scroll. */}
      <View style={styles.endFooter}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={call ? "End call" : "Close ended call"}
          disabled={ending}
          style={[
            styles.endCallBtn,
            { backgroundColor: colors.error, opacity: ending ? 0.6 : 1 },
          ]}
          onPress={handleEndCall}
        >
          <IconSymbol name="phone.down.fill" size={30} color="#fff" />
        </TouchableOpacity>
        <Text style={[styles.controlLabel, { textAlign: "center" }]}>
          {ending ? "Ending…" : call ? "End call" : "Close"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 16, paddingBottom: 20, gap: 24 },
  endFooter: { alignItems: "center", paddingTop: 12, gap: 8, flexShrink: 0 },
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
    textAlign: "center",
    paddingHorizontal: 24,
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
    minHeight: 56,
    paddingVertical: 10,
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
    gap: 12,
    width: "100%",
    justifyContent: "center",
  },
  controlBtn: {
    flex: 1,
    minWidth: 72,
    maxWidth: 120,
    minHeight: 80,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 24,
    backgroundColor: "#ffffff18",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  controlLabel: {
    fontSize: 13,
    textAlign: "center",
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
