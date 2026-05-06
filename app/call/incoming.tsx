import { useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Vibration } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";

export default function IncomingCallScreen() {
  const colors = useColors();
  const { number, name, callId } = useLocalSearchParams<{ number?: string; name?: string; callId?: string }>();
  const { answerCall, hangupCall } = useSip();
  const incomingCall = useSipCallStore((state) =>
    callId && state.incomingCall?.id === callId ? state.incomingCall : state.incomingCall
  );
  const callerNumber = incomingCall?.remoteNumber ?? number ?? "SIP Call";
  const callerName = incomingCall?.remoteName ?? name ?? callerNumber;

  useEffect(() => {
    // Simulate ringtone vibration pattern
    const pattern = [0, 500, 300, 500];
    Vibration.vibrate(pattern, true);
    return () => Vibration.cancel();
  }, []);

  const handleAccept = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Vibration.cancel();
    if (callId) {
      await answerCall(callId);
    }
    const params: Record<string, string> = { number: callerNumber, type: "voice" };
    if (callId) params.callId = callId;
    router.replace({ pathname: "/call/active", params });
  };

  const handleDecline = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Vibration.cancel();
    if (callId) {
      await hangupCall(callId);
    }
    router.back();
  };

  return (
    <View style={styles.container}>
      {/* Background gradient effect */}
      <View style={[styles.bgTop, { backgroundColor: "#0D1F3C" }]} />
      <View style={[styles.bgBottom, { backgroundColor: "#0D0F14" }]} />

      {/* Caller Info */}
      <View style={styles.callerSection}>
        <Text style={styles.incomingLabel}>Incoming Call</Text>
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
            style={[styles.actionBtn, { backgroundColor: colors.error }]}
            onPress={handleDecline}
            activeOpacity={0.8}
          >
            <IconSymbol name="phone.down.fill" size={30} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Decline</Text>
        </View>

        {/* Accept */}
        <View style={styles.actionItem}>
          <TouchableOpacity
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
