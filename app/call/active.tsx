import { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";

export default function ActiveCallScreen() {
  const colors = useColors();
  const { number, type, callId } = useLocalSearchParams<{ number?: string; type?: string; callId?: string }>();
  const { hangupCall, setMute, setHold, setSpeaker, sendDtmf } = useSip();
  const call = useSipCallStore((state) =>
    callId
      ? state.activeCalls[callId] ?? (state.incomingCall?.id === callId ? state.incomingCall : null)
      : null
  );
  const [elapsed, setElapsed] = useState(0);
  const [fallbackMuted, setFallbackMuted] = useState(false);
  const [fallbackHeld, setFallbackHeld] = useState(false);
  const [fallbackSpeaker, setFallbackSpeaker] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);

  const muted = call?.isMuted ?? fallbackMuted;
  const held = call?.isHeld ?? fallbackHeld;
  const speaker = call?.isSpeaker ?? fallbackSpeaker;
  const remoteNumber = call?.remoteNumber ?? number ?? "Unknown";
  const callMissing = Boolean(callId && !call);

  useEffect(() => {
    const timer = setInterval(() => {
      const startedAt = call?.connectTime ?? call?.startTime;
      if (!startedAt) {
        setElapsed((s) => s + 1);
        return;
      }
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [call?.connectTime, call?.startTime]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
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
    if (callId && call) {
      await hangupCall(callId);
    }
    router.back();
  }, [call, callId, hangupCall]);

  const handleMute = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (callId && call) {
      await setMute(callId, !muted);
      return;
    }
    setFallbackMuted((value) => !value);
  }, [call, callId, muted, setMute]);

  const handleHold = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (callId && call) {
      await setHold(callId, !held);
      return;
    }
    setFallbackHeld((value) => !value);
  }, [call, callId, held, setHold]);

  const handleSpeaker = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (callId && call) {
      await setSpeaker(callId, !speaker);
      return;
    }
    setFallbackSpeaker((value) => !value);
  }, [call, callId, setSpeaker, speaker]);

  const handleDtmf = useCallback(async (digit: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (callId && call) {
      await sendDtmf(callId, digit);
    }
  }, [call, callId, sendDtmf]);

  const openVideo = useCallback(() => {
    const params: Record<string, string> = {
      number: remoteNumber,
      type: type ?? "voice",
    };
    if (callId) params.callId = callId;
    router.push({ pathname: "/call/video", params });
  }, [callId, remoteNumber, type]);

  const KEYPAD = ["1","2","3","4","5","6","7","8","9","*","0","#"];

  return (
    <View style={[styles.container, { backgroundColor: "#0D0F14" }]}>
      {/* Caller Info */}
      <View style={styles.callerSection}>
        <View style={[styles.callerAvatar, { backgroundColor: colors.primary + "30" }]}>
          <Text style={styles.callerInitial}>
            {remoteNumber.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.callerName}>{remoteNumber}</Text>
        <Text style={[styles.callStatus, { color: held ? colors.warning : colors.success }]}>
          {callStatusLabel()}
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
            style={[styles.controlBtn, muted && { backgroundColor: colors.primary + "40" }]}
            onPress={handleMute}
          >
            <IconSymbol name={muted ? "mic.slash.fill" : "mic.fill"} size={24} color={muted ? colors.primary : "#fff"} />
            <Text style={styles.controlLabel}>{muted ? "Unmute" : "Mute"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlBtn, held && { backgroundColor: colors.warning + "40" }]}
            onPress={handleHold}
          >
            <IconSymbol name="pause.fill" size={24} color={held ? colors.warning : "#fff"} />
            <Text style={styles.controlLabel}>{held ? "Resume" : "Hold"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlBtn, speaker && { backgroundColor: colors.primary + "40" }]}
            onPress={handleSpeaker}
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
              router.push({ pathname: "/call/transfer", params: { callId: callId ?? `preview_${Date.now()}` } });
            }}
          >
            <IconSymbol name="arrow.triangle.2.circlepath" size={24} color="#fff" />
            <Text style={styles.controlLabel}>Transfer</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={openVideo}
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
