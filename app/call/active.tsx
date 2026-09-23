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

import { ActiveCallRecordingControls } from "@/components/cloud-recordings/active-call-recording-controls";
import { CallPersonAvatar } from "@/components/phone/call-person-avatar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useDeviceContacts } from "@/hooks/use-device-contacts";
import { callDisplayIdentity } from "@/lib/phone/call-display";
import { useColors } from "@/hooks/use-colors";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";
import { useSipDiagnosticsStore } from "@/lib/sip/diagnostics-store";

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
  const contacts = useDeviceContacts();
  const identity = callDisplayIdentity(
    call?.remoteNumber ?? number,
    call?.remoteName,
    contacts.people,
  );
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
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)");
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
  const handleMute = () => {
    useSipDiagnosticsStore.getState().addEvent({
      level: "info",
      category: "media",
      message: "In-app microphone control tapped",
      context: {
        ...(callId && /^\d{1,10}$/.test(callId) ? { callId } : {}),
        muted: !muted,
        controlsReady,
      },
    });
    return callId && control(() => setMute(callId, !muted));
  };
  const handleHold = () => callId && control(() => setHold(callId, !held));
  const handleSpeaker = () =>
    callId && control(() => setSpeaker(callId, !speaker));
  const handleDtmf = (digit: string) =>
    callId && control(() => sendDtmf(callId, digit));

  const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  const callControl = (
    key: string,
    label: string,
    icon: Parameters<typeof IconSymbol>[0]["name"],
    onPress: () => unknown,
    selected: boolean,
    title = key,
  ) => (
    <TouchableOpacity
      key={key}
      style={styles.controlBtn}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled: !controlsReady,
        selected,
        ...(key === "Keypad" ? { expanded: showKeypad } : {}),
      }}
      disabled={!controlsReady}
      onPress={onPress}
    >
      <View
        style={[
          styles.controlCircle,
          {
            backgroundColor: selected ? colors.primary : colors.surface,
            opacity: controlsReady ? 1 : 0.45,
          },
        ]}
      >
        <IconSymbol
          name={icon}
          size={26}
          color={selected ? "#fff" : colors.foreground}
        />
      </View>
      <Text style={[styles.controlLabel, { color: colors.muted }]}>
        {title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Minimize call and open Recents"
        accessibilityHint="Your call will continue. Tap the call banner to return."
        style={styles.minimizeButton}
        onPress={() => router.replace("/(tabs)/recents")}
      >
        <Text style={[styles.minimizeLabel, { color: colors.primary }]}>
          ‹ Recents
        </Text>
        {!callMissing && (
          <Text style={[styles.minimizeHint, { color: colors.muted }]}>
            Call continues
          </Text>
        )}
      </TouchableOpacity>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Caller Info */}
        <View style={styles.callerSection}>
          <CallPersonAvatar
            number={call?.remoteNumber ?? number ?? ""}
            name={identity.title}
            size={88}
            deviceContacts={contacts.people}
          />
          <Text
            accessibilityRole="header"
            accessibilityLabel={`Call with ${identity.title}`}
            numberOfLines={2}
            style={[styles.callerName, { color: colors.foreground }]}
          >
            {identity.title}
          </Text>
          {identity.title !== identity.number && (
            <Text style={{ color: colors.muted, fontSize: 16 }}>
              {identity.number}
            </Text>
          )}
          <Text
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            style={[
              styles.callStatus,
              { color: held ? colors.warning : colors.success },
            ]}
          >
            {callStatusLabel()}
          </Text>
        </View>

        {call?.isVideo && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open video call"
            accessibilityHint="Opens the video controls for this call"
            onPress={() =>
              router.replace({
                pathname: "/call/video",
                params: { callId: call.id },
              })
            }
            style={styles.openVideoButton}
          >
            <Text style={[styles.openVideoLabel, { color: colors.primary }]}>
              Open video
            </Text>
          </TouchableOpacity>
        )}
        {/* Keypad overlay */}
        {showKeypad && controlsReady && (
          <View style={styles.keypadOverlay}>
            <View style={styles.keypadGrid}>
              {KEYPAD.map((k) => (
                <TouchableOpacity
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${k}`}
                  style={[
                    styles.keypadKey,
                    { backgroundColor: colors.surface },
                  ]}
                  onPress={() => handleDtmf(k)}
                >
                  <Text
                    style={[styles.keypadDigit, { color: colors.foreground }]}
                  >
                    {k}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {controlsReady && (
          <ActiveCallRecordingControls nativeHistoryId={call?.history?.id} />
        )}
      </ScrollView>

      {/* Essential media controls do not move with recording status updates. */}
      <View style={styles.controls}>
        <View style={styles.controlRow}>
          {callControl(
            "Mute",
            muted ? "Unmute microphone" : "Mute microphone",
            muted ? "mic.slash.fill" : "mic.fill",
            handleMute,
            muted,
            muted ? "Unmute" : "Mute",
          )}
          {callControl(
            "Keypad",
            "Show call keypad",
            "rectangle.grid.3x2.fill",
            () => {
              setShowKeypad(!showKeypad);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            },
            showKeypad,
          )}
          {callControl(
            "Speaker",
            speaker ? "Use earpiece" : "Use speaker",
            "speaker.wave.3.fill",
            handleSpeaker,
            speaker,
          )}
        </View>
        <View style={styles.controlRow}>
          {callControl(
            "Hold",
            held ? "Resume call" : "Hold call",
            "pause.fill",
            handleHold,
            held,
            held ? "Resume" : "Hold",
          )}
        </View>
      </View>

      {/* Essential controls stay visible while call details and recording scroll. */}
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
        <Text
          style={[
            styles.controlLabel,
            { color: colors.foreground, textAlign: "center" },
          ]}
        >
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
  minimizeButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  minimizeLabel: { fontSize: 17, fontWeight: "600" },
  minimizeHint: { fontSize: 13 },
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingTop: 24,
    paddingBottom: 20,
    gap: 24,
  },
  endFooter: { alignItems: "center", paddingTop: 12, gap: 8, flexShrink: 0 },
  callerSection: {
    alignItems: "center",
    gap: 12,
  },
  callerName: {
    fontSize: 28,
    fontWeight: "600",
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
  openVideoButton: {
    minHeight: 44,
    paddingHorizontal: 24,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  openVideoLabel: { fontSize: 17, fontWeight: "600" },
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
  },
  controls: {
    paddingHorizontal: 24,
    paddingTop: 8,
    flexShrink: 0,
    gap: 12,
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
    maxWidth: 104,
    minHeight: 94,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  controlCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  controlLabel: {
    fontSize: 13,
    textAlign: "center",
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
    shadowOpacity: 0,
    shadowRadius: 8,
    elevation: 0,
  },
});
