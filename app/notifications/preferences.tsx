/**
 * Notification Preferences Screen
 *
 * Allows users to configure push notification settings:
 * master toggle, per-category toggles, sound, vibration, quiet hours.
 */

import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, ScrollView, Switch, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNotificationStore } from "@/lib/notifications/store";
import type { NotificationPreferences } from "@/lib/notifications/types";

interface ToggleRowProps {
  icon: string;
  iconColor: string;
  label: string;
  sublabel?: string;
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

function ToggleRow({ icon, iconColor, label, sublabel, value, onToggle, disabled }: ToggleRowProps) {
  const colors = useColors();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }, disabled && { opacity: 0.5 }]}>
      <View style={[styles.rowIcon, { backgroundColor: iconColor + "15" }]}>
        <IconSymbol name={icon as any} size={18} color={iconColor} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        {sublabel && <Text style={[styles.rowSublabel, { color: colors.muted }]}>{sublabel}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={() => {
          if (!disabled) {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onToggle();
          }
        }}
        trackColor={{ true: colors.primary, false: colors.border }}
        disabled={disabled}
      />
    </View>
  );
}

export default function NotificationPreferencesScreen() {
  const router = useRouter();
  const colors = useColors();
  const { preferences, updatePreferences, initialize } = useNotificationStore();

  useEffect(() => {
    initialize();
  }, []);

  const toggle = (key: keyof NotificationPreferences) => {
    const current = preferences[key];
    if (typeof current === "boolean") {
      updatePreferences({ [key]: !current });
    }
  };

  const masterEnabled = preferences.enabled;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          <Text style={[styles.headerBtnText, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notification Settings</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Master Toggle */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>GENERAL</Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ToggleRow
            icon="bell.fill"
            iconColor="#0057FF"
            label="Push Notifications"
            sublabel="Enable all push notifications"
            value={preferences.enabled}
            onToggle={() => toggle("enabled")}
          />
        </View>

        {/* Category Toggles */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>NOTIFICATION TYPES</Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ToggleRow
            icon="phone.fill.arrow.down.left"
            iconColor="#FF3B30"
            label="Missed Calls"
            sublabel="Alert when you miss an incoming call"
            value={preferences.missedCalls}
            onToggle={() => toggle("missedCalls")}
            disabled={!masterEnabled}
          />
          <ToggleRow
            icon="voicemail"
            iconColor="#8B5CF6"
            label="Voicemail"
            sublabel="Alert when a new voicemail is received"
            value={preferences.voicemail}
            onToggle={() => toggle("voicemail")}
            disabled={!masterEnabled}
          />
          <ToggleRow
            icon="record.circle.fill"
            iconColor="#FF9500"
            label="Recording Ready"
            sublabel="Alert when a call recording is processed"
            value={preferences.recordingReady}
            onToggle={() => toggle("recordingReady")}
            disabled={!masterEnabled}
          />
          <ToggleRow
            icon="antenna.radiowaves.left.and.right"
            iconColor="#06B6D4"
            label="SIP Registration"
            sublabel="Alert on SIP registration changes"
            value={preferences.sipRegistration}
            onToggle={() => toggle("sipRegistration")}
            disabled={!masterEnabled}
          />
          <ToggleRow
            icon="info.circle"
            iconColor="#6B7280"
            label="System Alerts"
            sublabel="App updates and system messages"
            value={preferences.systemAlerts}
            onToggle={() => toggle("systemAlerts")}
            disabled={!masterEnabled}
          />
        </View>

        {/* Sound & Vibration */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>SOUND & VIBRATION</Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ToggleRow
            icon="speaker.wave.3.fill"
            iconColor="#0057FF"
            label="Sound"
            sublabel="Play notification sounds"
            value={preferences.soundEnabled}
            onToggle={() => toggle("soundEnabled")}
            disabled={!masterEnabled}
          />
          <ToggleRow
            icon="waveform"
            iconColor="#8B5CF6"
            label="Vibration"
            sublabel="Vibrate on notifications"
            value={preferences.vibrationEnabled}
            onToggle={() => toggle("vibrationEnabled")}
            disabled={!masterEnabled}
          />
        </View>

        {/* Quiet Hours */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>QUIET HOURS</Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ToggleRow
            icon="moon.fill"
            iconColor="#FF9500"
            label="Quiet Hours"
            sublabel={
              preferences.quietHoursEnabled
                ? `${preferences.quietHoursStart} – ${preferences.quietHoursEnd}`
                : "Mute notifications during set hours"
            }
            value={preferences.quietHoursEnabled}
            onToggle={() => toggle("quietHoursEnabled")}
            disabled={!masterEnabled}
          />
        </View>

        {/* Flexisip Info */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>PUSH GATEWAY</Text>
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={[styles.rowIcon, { backgroundColor: "#06B6D4" + "15" }]}>
              <IconSymbol name="server.rack" size={18} color="#06B6D4" />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Flexisip Push Gateway</Text>
              <Text style={[styles.rowSublabel, { color: colors.muted }]}>
                Handles FCM (Android) and APNs (iOS) delivery via SIP REGISTER contact parameters
              </Text>
            </View>
          </View>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={[styles.rowIcon, { backgroundColor: "#00C896" + "15" }]}>
              <IconSymbol name="checkmark.circle.fill" size={18} color="#00C896" />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Token Status</Text>
              <Text style={[styles.rowSublabel, { color: colors.muted }]}>
                {Platform.OS === "ios" ? "APNs" : Platform.OS === "android" ? "FCM" : "Web Push"} token registered
              </Text>
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
    minWidth: 70,
  },
  headerBtnText: { fontSize: 16 },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  section: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "500" },
  rowSublabel: { fontSize: 12, marginTop: 1, lineHeight: 17 },
});
