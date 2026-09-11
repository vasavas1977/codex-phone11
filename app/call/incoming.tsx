import { useEffect, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { resolveCurrentCall } from "@/lib/sip/current-call";

export default function IncomingCallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const owner = getAuthSnapshot().user;
  const {
    number,
    name,
    callId: requestedCallId,
  } = useLocalSearchParams<{
    number?: string;
    name?: string;
    callId?: string;
  }>();
  const { answerCall, hangupCall } = useSip();
  const incomingCall = useSipCallStore((state) =>
    resolveCurrentCall(state, requestedCallId),
  );
  const callId = incomingCall?.id;
  type Action = {
    kind: "answer" | "decline";
    callId: string;
    failed?: boolean;
  };
  const pending = useRef<Action | null>(null);
  const [operation, setOperation] = useState<Action["kind"] | null>(null);
  const ringing = incomingCall?.status === "incoming";
  const currentOwnedCall = () =>
    owner && getAuthSnapshot().user === owner && callId
      ? resolveCurrentCall(useSipCallStore.getState(), callId)
      : null;
  const stillRinging = () => currentOwnedCall()?.status === "incoming";

  useEffect(() => {
    pending.current = null;
    setOperation(null);
    return () => {
      pending.current = null;
    };
  }, [owner, callId, incomingCall?.status]);
  const callerNumber = incomingCall?.remoteNumber ?? number ?? "SIP Call";
  const callerName = incomingCall?.remoteName ?? name ?? callerNumber;

  useEffect(() => {
    if (incomingCall?.status !== "incoming") return;
    const pattern = [0, 500, 300, 500];
    Vibration.vibrate(pattern, true);
    return () => Vibration.cancel();
  }, [owner, callId, incomingCall?.status]);

  useEffect(() => {
    if (
      callId &&
      (incomingCall?.status === "active" || incomingCall?.status === "held")
    ) {
      router.replace({
        pathname: "/call/active",
        params: { callId, number: callerNumber, type: "voice" },
      });
    }
  }, [callId, incomingCall?.status, callerNumber]);

  const handleAccept = async () => {
    if (!callId || pending.current || !stillRinging()) return;
    const action: Action = { kind: "answer", callId };
    pending.current = action;
    setOperation("answer");
    Vibration.cancel();
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
    try {
      await answerCall(callId);
      // Command acceptance is not a connected call. Wait for the native state
      // effect to leave Incoming; repeated taps must not re-answer the SDK call.
    } catch {
      action.failed = true;
      if (pending.current !== action) return;
      pending.current = null;
      setOperation(null);
      if (stillRinging())
        Alert.alert(
          "Could not answer call",
          "Tap Answer to retry while the caller is still ringing.",
        );
    }
  };

  const handleDecline = async () => {
    if (pending.current?.kind === "decline") return;
    if (!callId) {
      router.canGoBack() ? router.back() : router.replace("/(tabs)");
      return;
    }
    if (!currentOwnedCall()) return;
    const answerBeforeDecline =
      pending.current?.kind === "answer" ? pending.current : null;
    let declineFailed = false;
    const action: Action = { kind: "decline", callId };
    pending.current = action;
    setOperation("decline");
    Vibration.cancel();
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});
    try {
      await hangupCall(callId);
    } catch {
      declineFailed = true;
      if (pending.current === action && currentOwnedCall())
        Alert.alert("Could not end call", "Please try ending the call again.");
    } finally {
      if (pending.current === action) {
        const restoreAnswer =
          declineFailed &&
          answerBeforeDecline &&
          !answerBeforeDecline.failed &&
          stillRinging();
        pending.current = restoreAnswer ? answerBeforeDecline : null;
        setOperation(restoreAnswer ? "answer" : null);
      }
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      {/* Background gradient effect */}
      <View style={[styles.bgTop, { backgroundColor: "#0D1F3C" }]} />
      <View style={[styles.bgBottom, { backgroundColor: "#0D0F14" }]} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Caller Info */}
        <View style={styles.callerSection}>
          <Text style={styles.incomingLabel}>
            {ringing
              ? "Incoming Call"
              : incomingCall
                ? "Connecting call"
                : "Call ended"}
          </Text>
          <View
            style={[styles.avatar, { backgroundColor: colors.primary + "30" }]}
          >
            <Text style={styles.avatarText}>
              {callerName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.callerName}>{callerName}</Text>
          <Text style={[styles.callerNumber, { color: "#ffffff80" }]}>
            {callerNumber}
          </Text>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.footer}>
        <View style={styles.actions}>
          {/* Decline */}
          <View style={styles.actionItem}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                ringing
                  ? "Decline call"
                  : incomingCall
                    ? "End call"
                    : "Close ended call"
              }
              disabled={operation === "decline"}
              style={[styles.actionBtn, { backgroundColor: colors.error }]}
              onPress={handleDecline}
              activeOpacity={0.8}
            >
              <IconSymbol name="phone.down.fill" size={30} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>
              {operation === "decline"
                ? "Ending…"
                : ringing
                  ? "Decline"
                  : incomingCall
                    ? "End call"
                    : "Close"}
            </Text>
          </View>

          {/* Accept */}
          <View style={styles.actionItem}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Answer call"
              accessibilityState={{
                disabled: operation !== null || !ringing,
                busy: operation === "answer",
              }}
              disabled={operation !== null || !ringing}
              style={[styles.actionBtn, { backgroundColor: colors.success }]}
              onPress={handleAccept}
              activeOpacity={0.8}
            >
              <IconSymbol name="phone.fill" size={30} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>
              {operation === "answer" ? "Answering…" : "Answer"}
            </Text>
          </View>
        </View>

        {ringing && (
          <Text style={[styles.hint, { color: "#ffffff80" }]}>
            {operation === "answer"
              ? "Connecting your call. You can still decline."
              : "Tap Answer or Decline"}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0F14",
  },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 24 },
  footer: { paddingTop: 16, gap: 20 },
  bgTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "50%",
    opacity: 0.6,
  },
  bgBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "50%",
  },
  callerSection: {
    alignItems: "center",
    gap: 12,
  },
  incomingLabel: {
    fontSize: 14,
    color: "#ffffff60",
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  avatarText: {
    fontSize: 48,
    fontWeight: "700",
    color: "#fff",
  },
  callerName: {
    fontSize: 30,
    fontWeight: "700",
    color: "#fff",
    marginTop: 8,
  },
  callerNumber: {
    fontSize: 16,
    fontWeight: "400",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    paddingHorizontal: 24,
  },
  actionItem: {
    flex: 1,
    alignItems: "center",
    gap: 12,
  },
  actionBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  actionLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  hint: {
    textAlign: "center",
    fontSize: 13,
  },
});
