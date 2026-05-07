import { View, Text, TouchableOpacity, ScrollView, Switch, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useSipAccountStore } from "@/lib/sip/account-store";

interface SettingRow {
  icon: string;
  iconColor: string;
  label: string;
  sublabel?: string;
  value?: string;
  toggle?: boolean;
  onPress?: () => void;
}

export default function SettingsScreen() {
  const colors = useColors();
  const account = useSipAccountStore((s) => s.account);
  const registrationState = useSipAccountStore((s) => s.registrationState);
  const registrationColor =
    registrationState === "registered"
      ? "#00E5A8"
      : registrationState === "registering"
      ? "#FFB340"
      : registrationState === "failed" || registrationState === "network_error"
      ? "#FF453A"
      : "#ffffff90";
  const registrationText =
    registrationState === "registered"
      ? "Registered"
      : registrationState === "registering"
      ? "Registering"
      : registrationState === "failed"
      ? "Failed"
      : registrationState === "network_error"
      ? "Network Error"
      : "Not Registered";

  const SettingItem = ({ icon, iconColor, label, sublabel, value, toggle, onPress }: SettingRow) => (
    <TouchableOpacity
      style={[styles.settingRow, { borderBottomColor: colors.border }]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      activeOpacity={0.7}
    >
      <View style={[styles.settingIcon, { backgroundColor: iconColor + "20" }]}> 
        <IconSymbol name={icon as any} size={18} color={iconColor} />
      </View>
      <View style={styles.settingText}>
        <Text style={[styles.settingLabel, { color: colors.foreground }]}>{label}</Text>
        {sublabel && <Text style={[styles.settingSubLabel, { color: colors.muted }]}>{sublabel}</Text>}
      </View>
      {toggle ? (
        <Switch
          value={true}
          onValueChange={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
          trackColor={{ true: colors.primary }}
        />
      ) : (
        <View style={styles.settingRight}>
          {value && <Text style={[styles.settingValue, { color: colors.muted }]}>{value}</Text>}
          <IconSymbol name="chevron.right" size={16} color={colors.muted} />
        </View>
      )}
    </TouchableOpacity>
  );

  const SectionHeader = ({ title }: { title: string }) => (
    <Text style={[styles.sectionHeader, { color: colors.muted }]}>{title}</Text>
  );

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}> 
          <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
        </View>

        {/* SIP Account Status */}
        <View style={[styles.accountCard, { backgroundColor: colors.primary, marginHorizontal: 16, marginTop: 16, borderRadius: 16 }]}> 
          <View style={styles.accountInfo}>
            <View style={[styles.accountAvatar, { backgroundColor: "#ffffff30" }]}> 
              <IconSymbol name="phone.fill" size={22} color="#fff" />
            </View>
            <View>
              <Text style={styles.accountName}>Phone11 Account</Text>
              <Text style={styles.accountDetail}>
                {account ? `sip:${account.username}@${account.domain}` : "Sync from admin"}
              </Text>
            </View>
          </View>
          <View style={styles.accountStatus}>
            <View style={[styles.statusDot, { backgroundColor: registrationColor }]} />
            <Text style={[styles.statusText, { color: registrationColor }]}>{registrationText}</Text>
          </View>
        </View>

        {/* SIP Configuration */}
        <SectionHeader title="SIP CONFIGURATION" />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <SettingItem
            icon="server.rack"
            iconColor="#0057FF"
            label="Phone Provisioning"
            sublabel="Sign in, sync extension, register SIP"
            onPress={() => router.push("/settings/sip")}
          />
          <SettingItem
            icon="checklist"
            iconColor="#00C896"
            label="SIP Diagnostics"
            sublabel="Registration, call id, and media events"
            onPress={() => router.push("/settings/sip-diagnostics" as any)}
          />
          <SettingItem
            icon="waveform"
            iconColor="#8B5CF6"
            label="Audio Settings"
            sublabel="Codecs, echo cancel, noise suppress"
            onPress={() => router.push("/settings/audio")}
          />
          <SettingItem
            icon="rectangle.grid.3x2.fill"
            iconColor="#FF9500"
            label="IVR Builder"
            sublabel="Auto-attendant & call routing"
            onPress={() => router.push("/settings/ivr")}
          />
          <SettingItem
            icon="waveform"
            iconColor="#00C896"
            label="Voicemail"
            sublabel="2 new messages"
            onPress={() => router.push("/voicemail")}
          />
        </View>

        {/* Call Settings */}
        <SectionHeader title="CALL SETTINGS" />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <SettingItem
            icon="bell.fill"
            iconColor="#FF3B30"
            label="Ringtone"
            value="Default"
            onPress={() => {}}
          />
          <SettingItem
            icon="phone.arrow.up.right"
            iconColor="#0057FF"
            label="Call Forwarding"
            value="Off"
            onPress={() => {}}
          />
          <SettingItem
            icon="arrow.triangle.2.circlepath"
            iconColor="#00C896"
            label="Call Transfer"
            toggle
          />
          <SettingItem
            icon="lock.fill"
            iconColor="#6B7280"
            label="Do Not Disturb"
            toggle
          />
        </View>

        {/* Notifications */}
        <SectionHeader title="NOTIFICATIONS" />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <SettingItem
            icon="bell.fill"
            iconColor="#FF9500"
            label="Notification Center"
            sublabel="View missed calls, voicemail alerts"
            onPress={() => router.push("/notifications" as any)}
          />
          <SettingItem
            icon="gearshape.fill"
            iconColor="#8B5CF6"
            label="Notification Preferences"
            sublabel="Categories, sound, quiet hours"
            onPress={() => router.push("/notifications/preferences" as any)}
          />
          <SettingItem
            icon="phone.fill"
            iconColor="#0057FF"
            label="Background Calling"
            sublabel="CallKit / ConnectionService"
            toggle
          />
        </View>

        {/* Network */}
        <SectionHeader title="NETWORK" />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <SettingItem
            icon="network"
            iconColor="#06B6D4"
            label="Transport"
            value="TLS"
            onPress={() => {}}
          />
          <SettingItem
            icon="shield.fill"
            iconColor="#00C896"
            label="SRTP Encryption"
            toggle
          />
          <SettingItem
            icon="antenna.radiowaves.left.and.right"
            iconColor="#8B5CF6"
            label="STUN / ICE"
            sublabel="NAT traversal"
            value="Enabled"
            onPress={() => {}}
          />
        </View>

        {/* Billing & Numbers */}
        <SectionHeader title="BILLING & NUMBERS" />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <SettingItem
            icon="number"
            iconColor="#0057FF"
            label="Phone Numbers (DID)"
            sublabel="Manage your virtual numbers"
            onPress={() => router.push("/did")}
          />
          <SettingItem
            icon="banknote.fill"
            iconColor="#00C896"
            label="Billing & Usage"
            sublabel="Invoices, balance, plans · BillRun BSS"
            onPress={() => router.push("/billing")}
          />
          <SettingItem
            icon="sim.card.fill"
            iconColor="#8B5CF6"
            label="MVNO SIM Management"
            sublabel="SIM lifecycle & data bundles"
            onPress={() => {}}
          />
          <SettingItem
            icon="chart.bar.fill"
            iconColor="#FF9500"
            label="Usage Analytics"
            sublabel="AI insights, sentiment trends & call volume"
            onPress={() => router.push("/admin/analytics" as any)}
          />
        </View>

        {/* Self-Service Portal */}
        <SectionHeader title="MY ACCOUNT" />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <SettingItem
            icon="person.crop.circle.fill"
            iconColor="#0057FF"
            label="Account Dashboard"
            sublabel="Balance, usage, quick actions"
            onPress={() => router.push("/portal" as any)}
          />
          <SettingItem
            icon="person.fill"
            iconColor="#8B5CF6"
            label="My Profile"
            sublabel="Name, email, security settings"
            onPress={() => router.push("/portal/profile" as any)}
          />
          <SettingItem
            icon="banknote.fill"
            iconColor="#00C896"
            label="Billing & Invoices"
            sublabel="Payment methods, invoices, auto-pay"
            onPress={() => router.push("/portal/billing" as any)}
          />
          <SettingItem
            icon="number"
            iconColor="#FF9500"
            label="My Numbers"
            sublabel="Manage DID numbers & routing"
            onPress={() => router.push("/portal/dids" as any)}
          />
          <SettingItem
            icon="phone.arrow.up.right"
            iconColor="#06B6D4"
            label="Call Forwarding Rules"
            sublabel="Busy, no-answer, time-based"
            onPress={() => router.push("/portal/forwarding" as any)}
          />
          <SettingItem
            icon="chart.bar.fill"
            iconColor="#FF3B30"
            label="Usage & Analytics"
            sublabel="Voice, SMS, DID usage breakdown"
            onPress={() => router.push("/portal/usage" as any)}
          />
          <SettingItem
            icon="waveform"
            iconColor="#00C896"
            label="Voicemail Management"
            sublabel="Inbox, greetings, transcription"
            onPress={() => router.push("/portal/voicemail-mgmt" as any)}
          />
          <SettingItem
            icon="questionmark.circle.fill"
            iconColor="#6B7280"
            label="Support & Tickets"
            sublabel="Submit tickets, FAQ, contact us"
            onPress={() => router.push("/portal/support" as any)}
          />
        </View>

        {/* Admin Portal */}
        <SectionHeader title="ADMIN PORTAL" />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <SettingItem
            icon="rectangle.grid.3x2.fill"
            iconColor="#FF3B30"
            label="Operator Dashboard"
            sublabel="Users, extensions, analytics, system"
            onPress={() => router.push("/admin" as any)}
          />
          <SettingItem
            icon="chart.bar.fill"
            iconColor="#0057FF"
            label="Call Analytics"
            sublabel="AI insights, sentiment trends & call volume"
            onPress={() => router.push("/admin/analytics" as any)}
          />
          <SettingItem
            icon="server.rack"
            iconColor="#00C896"
            label="System Health"
            sublabel="Server nodes, SIP trunks, codecs"
            onPress={() => router.push("/admin/system" as any)}
          />
        </View>

        {/* About */}
        <SectionHeader title="ABOUT" />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <SettingItem
            icon="server.rack"
            iconColor="#06B6D4"
            label="Server Configuration"
            sublabel="Kamailio, BillRun, FreeSWITCH, DID"
            onPress={() => router.push("/settings/servers")}
          />
          <SettingItem
            icon="doc.text.fill"
            iconColor="#6B7280"
            label="Architecture & Docs"
            sublabel="PJSIP, Kamailio, FreeSWITCH, LiveKit"
            onPress={() => router.push("/settings/about")}
          />
          <SettingItem
            icon="info.circle"
            iconColor="#0057FF"
            label="Version"
            value="1.0.0"
            onPress={() => {}}
          />
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  title: { fontSize: 22, fontWeight: "700" },
  accountCard: {
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  accountInfo: { flexDirection: "row", alignItems: "center", gap: 12 },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  accountName: { color: "#fff", fontSize: 15, fontWeight: "700" },
  accountDetail: { color: "#ffffff90", fontSize: 12, marginTop: 2 },
  accountStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#00E5A8" },
  statusText: { color: "#00E5A8", fontSize: 12, fontWeight: "600" },
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
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  settingText: { flex: 1 },
  settingLabel: { fontSize: 15, fontWeight: "500" },
  settingSubLabel: { fontSize: 12, marginTop: 1 },
  settingRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  settingValue: { fontSize: 14 },
});
