import { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNotificationStore } from "@/lib/notifications/store";

const DIAL_KEYS = [
  { digit: "1", sub: "" },
  { digit: "2", sub: "ABC" },
  { digit: "3", sub: "DEF" },
  { digit: "4", sub: "GHI" },
  { digit: "5", sub: "JKL" },
  { digit: "6", sub: "MNO" },
  { digit: "7", sub: "PQRS" },
  { digit: "8", sub: "TUV" },
  { digit: "9", sub: "WXYZ" },
  { digit: "*", sub: "" },
  { digit: "0", sub: "+" },
  { digit: "#", sub: "" },
];

const RECENT_NUMBERS = [
  { number: "+1 (555) 234-5678", name: "John Smith" },
  { number: "+1 (555) 987-6543", name: "Acme Corp" },
  { number: "1001", name: "Ext. 1001" },
];

export default function DialpadScreen() {
  const colors = useColors();
  const [input, setInput] = useState("");
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const handleKey = useCallback((digit: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput((prev) => prev + digit);
  }, []);

  const handleBackspace = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput((prev) => prev.slice(0, -1));
  }, []);

  const handleCall = useCallback((number?: string) => {
    const target = number || input;
    if (!target) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: "/call/active", params: { number: target, type: "voice" } });
  }, [input]);

  const handleVideoCall = useCallback(() => {
    if (!input) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: "/call/video", params: { number: input, type: "video" } });
  }, [input]);

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>CloudPhone11</Text>
            <View style={styles.sipStatus}>
              <View style={[styles.sipDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.sipText, { color: colors.muted }]}>SIP Registered</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/notifications" as any)}
            style={styles.bellBtn}
          >
            <IconSymbol name="bell.fill" size={22} color={colors.foreground} />
            {unreadCount > 0 && (
              <View style={[styles.bellBadge, { backgroundColor: colors.error }]}>
                <Text style={styles.bellBadgeText}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Number Input */}
        <View style={styles.inputRow}>
          <Text
            style={[styles.numberInput, { color: colors.foreground }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {input || " "}
          </Text>
          {input.length > 0 && (
            <TouchableOpacity onPress={handleBackspace} style={styles.backspaceBtn}>
              <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Dial Pad */}
        <View style={styles.dialpad}>
          {DIAL_KEYS.map(({ digit, sub }) => (
            <TouchableOpacity
              key={digit}
              style={[styles.dialKey, { backgroundColor: colors.surface }]}
              onPress={() => handleKey(digit)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dialDigit, { color: colors.foreground }]}>{digit}</Text>
              {sub ? <Text style={[styles.dialSub, { color: colors.muted }]}>{sub}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>

        {/* Call Buttons */}
        <View style={styles.callRow}>
          <TouchableOpacity
            style={[styles.videoBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary }]}
            onPress={handleVideoCall}
            activeOpacity={0.8}
          >
            <IconSymbol name="video.fill" size={22} color={colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.callBtn, { backgroundColor: colors.success }]}
            onPress={() => handleCall()}
            activeOpacity={0.8}
          >
            <IconSymbol name="phone.fill" size={28} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.meetNowBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/conference" as any);
            }}
            activeOpacity={0.8}
          >
            <IconSymbol name="person.3.fill" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Meet Now Banner */}
        <TouchableOpacity
          style={[styles.meetNowBanner, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/conference" as any);
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.meetNowIconBg, { backgroundColor: colors.primary + "20" }]}>
            <IconSymbol name="video.fill" size={18} color={colors.primary} />
          </View>
          <View style={styles.meetNowInfo}>
            <Text style={[styles.meetNowTitle, { color: colors.foreground }]}>Conference Bridge</Text>
            <Text style={[styles.meetNowSub, { color: colors.muted }]}>Meet Now • Up to 50 participants</Text>
          </View>
          <IconSymbol name="chevron.right" size={16} color={colors.muted} />
        </TouchableOpacity>

        {/* Recent Quick Dial */}
        <View style={[styles.recentSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.recentTitle, { color: colors.muted }]}>RECENT</Text>
          {RECENT_NUMBERS.map((item) => (
            <TouchableOpacity
              key={item.number}
              style={styles.recentRow}
              onPress={() => handleCall(item.number)}
              activeOpacity={0.7}
            >
              <View style={[styles.recentAvatar, { backgroundColor: colors.primary + "20" }]}>
                <Text style={[styles.recentAvatarText, { color: colors.primary }]}>
                  {item.name.charAt(0)}
                </Text>
              </View>
              <View style={styles.recentInfo}>
                <Text style={[styles.recentName, { color: colors.foreground }]}>{item.name}</Text>
                <Text style={[styles.recentNumber, { color: colors.muted }]}>{item.number}</Text>
              </View>
              <IconSymbol name="phone.fill" size={18} color={colors.success} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  bellBtn: {
    position: "relative",
    padding: 4,
  },
  bellBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  bellBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  sipStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sipText: {
    fontSize: 12,
    fontWeight: "500",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 20,
    minHeight: 72,
  },
  numberInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: "300",
    textAlign: "center",
    letterSpacing: 2,
  },
  backspaceBtn: {
    padding: 8,
  },
  dialpad: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 24,
    gap: 12,
    justifyContent: "center",
  },
  dialKey: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  dialDigit: {
    fontSize: 28,
    fontWeight: "300",
  },
  dialSub: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.5,
    marginTop: -2,
  },
  callRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    paddingVertical: 24,
  },
  callBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00C896",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  videoBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  recentSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 0.5,
  },
  recentTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 8,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  recentAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  recentAvatarText: {
    fontSize: 16,
    fontWeight: "700",
  },
  recentInfo: {
    flex: 1,
  },
  recentName: {
    fontSize: 15,
    fontWeight: "600",
  },
  recentNumber: {
    fontSize: 13,
    marginTop: 1,
  },
  meetNowBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  meetNowBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 12,
    marginBottom: 8,
  },
  meetNowIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  meetNowInfo: {
    flex: 1,
  },
  meetNowTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  meetNowSub: {
    fontSize: 12,
    marginTop: 1,
  },
});
