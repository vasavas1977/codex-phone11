import { useEffect, useState } from "react";
import { Alert, View, Text, TouchableOpacity, StyleSheet, Vibration } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";

export default function IncomingCallScreen() {
  const colors = useColors();
  const { number, name, callId: requestedCallId } = useLocalSearchParams<{ number?: string; name?: string; callId?: string }>();
  const { answerCall, hangupCall } = useSip();
  const incomingCall = useSipCallStore(state => resolveCurrentCall(state, requestedCallId));
  const callId = incomingCall?.id;
  const [busy, setBusy] = useState(false);
  const callerNumber = incomingCall?.remoteNumber ?? number ?? "SIP Call";
  const callerName = incomingCall?.remoteName ?? name ?? callerNumber;

  useEffect(() => {
    if (incomingCall?.status !== "incoming") return;
    const pattern = [0, 500, 300, 500];
    Vibration.vibrate(pattern, true);
    return () => Vibration.cancel();
  }, [callId, incomingCall?.status]);

  useEffect(() => {
    if (callId && (incomingCall?.status === "active" || incomingCall?.status === "held")) {
      router.replace({ pathname: "/call/active", params: { callId, number: callerNumber, type: "voice" } });
    }
  }, [callId, incomingCall?.status, callerNumber]);

  const handleAccept = async () => {
    if (!callId || busy) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Vibration.cancel();
    setBusy(true);
    try { await answerCall(callId); }
    catch { Alert.alert("Could not answer call", "Please try again while the caller is still ringing."); }
    finally { setBusy(false); }
  };

  const handleDecline = async () => {
    if (busy) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Vibration.cancel();
    if (!callId) { router.back(); return; }
    setBusy(true);
    try { await hangupCall(callId); }
    catch { Alert.alert("Could not end call", "Please try Decline again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.container}>
      {/* Background gradient effect */}
      <View style={[styles.bgTop, { backgroundColor: "#0D1F3C" }]} />
      <View style={[styles.bgBottom, { backgroundColor: "#0D0F14" }]} />

      {/* Caller Info */}
      <View style={styles.callerSection}>
        <Text style={styles.incomingLabel}>{incomingCall ? "Incoming Call" : "Call ended"}</Text>
        <View style={[styles.avatar, { backgroundColor: colors.primary + "30" }]}> 
          <Text style={styles.avatarText}>{callerName.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={[styles.callerNumber, { color: "#ffffff80" }]}>{callerNumber}</Text>
        <View style={[styles.sipBadge, { backgroundColor: colors.primary + "30", borderColor: colors.primary + "60" }]}> 
          <IconSymbol name="antenna.radiowaves.left.and.right" size={12} color={colors.primary} />
          <Text style={[styles.sipBadgeText, { color: colors.primary }]}>SIP / VoIP</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        {/* Decline */}
        <View style={styles.actionItem}>
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel={incomingCall ? "Decline call" : "Close ended call"} disabled={busy}
            style={[styles.actionBtn, { backgroundColor: colors.error }]}
            onPress={handleDecline}
            activeOpacity={0.8}
          >
            <IconSymbol name="phone.down.fill" size={30} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>{incomingCall ? "Decline" : "Close"}</Text>
        </View>

        {/* Accept */}
        <View style={styles.actionItem}>
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Answer call" disabled={busy || !incomingCall}
            style={[styles.actionBtn, { backgroundColor: colors.success }]}
            onPress={handleAccept}
            activeOpacity={0.8}
          >
            <IconSymbol name="phone.fill" size={30} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Accept</Text>
        </View>
      </View>

      {/* Swipe hint */}
      <Text style={[styles.hint, { color: "#ffffff40" }]}>Slide to answer or decline</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0F14",
    justifyContent: "space-between",
    paddingTop: 80,
    paddingBottom: 60,
  },
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
  sipBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  sipBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 80,
    paddingHorizontal: 40,
  },
  actionItem: {
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
