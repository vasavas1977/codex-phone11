import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface ServiceCard {
  id: string;
  icon: any;
  title: string;
  subtitle: string;
  route: string;
  badge?: string;
}

const ACCOUNT = {
  name: "CloudPhone11 Subscriber",
  email: "user@company.com",
  accountId: "CP11-2024-00847",
  plan: "Business Pro",
  balance: "$124.50",
  dueDate: "May 1, 2026",
  status: "Active" as const,
};

const QUICK_STATS = [
  { label: "Voice Minutes", value: "1,247", limit: "2,000", percent: 62 },
  { label: "SMS Messages", value: "342", limit: "500", percent: 68 },
  { label: "Active DIDs", value: "5", limit: "10", percent: 50 },
  { label: "Extensions", value: "12", limit: "25", percent: 48 },
];

const SERVICES: ServiceCard[] = [
  { id: "profile", icon: "person.fill", title: "My Profile", subtitle: "Edit account details & password", route: "/portal/profile" },
  { id: "billing", icon: "creditcard.fill", title: "Billing & Invoices", subtitle: "View balance, pay bills, auto-pay", route: "/portal/billing", badge: "1 Due" },
  { id: "dids", icon: "phone.badge.plus", title: "My Numbers", subtitle: "Manage DIDs & forwarding rules", route: "/portal/dids" },
  { id: "forwarding", icon: "arrow.triangle.branch", title: "Call Forwarding", subtitle: "Set forwarding rules & schedules", route: "/portal/forwarding" },
  { id: "usage", icon: "chart.bar.fill", title: "Usage & Analytics", subtitle: "Voice, SMS, data breakdown", route: "/portal/usage" },
  { id: "voicemail", icon: "recordingtape", title: "Voicemail", subtitle: "Listen, download, manage greetings", route: "/portal/voicemail-mgmt" },
  { id: "support", icon: "questionmark.circle.fill", title: "Support & Tickets", subtitle: "Submit tickets, view FAQ", route: "/portal/support" },
];

export default function PortalDashboard() {
  const colors = useColors();

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Account</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Account Card */}
        <View style={[styles.accountCard, { backgroundColor: colors.primary }]}>
          <View style={styles.accountHeader}>
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>
                {ACCOUNT.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
              </Text>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>{ACCOUNT.name}</Text>
              <Text style={styles.accountEmail}>{ACCOUNT.email}</Text>
              <View style={styles.accountBadge}>
                <View style={[styles.statusDot, { backgroundColor: "#4ADE80" }]} />
                <Text style={styles.accountPlan}>{ACCOUNT.plan} · {ACCOUNT.status}</Text>
              </View>
            </View>
          </View>
          <View style={styles.balanceRow}>
            <View>
              <Text style={styles.balanceLabel}>Current Balance</Text>
              <Text style={styles.balanceValue}>{ACCOUNT.balance}</Text>
            </View>
            <View style={styles.balanceRight}>
              <Text style={styles.balanceLabel}>Due Date</Text>
              <Text style={styles.dueDateValue}>{ACCOUNT.dueDate}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.payNowBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/portal/billing" as any);
            }}
          >
            <Text style={styles.payNowText}>Pay Now</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Stats */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Usage Overview</Text>
        <View style={styles.statsGrid}>
          {QUICK_STATS.map((stat, i) => (
            <View key={i} style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.statLabel, { color: colors.muted }]}>{stat.label}</Text>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{stat.value}</Text>
              <Text style={[styles.statLimit, { color: colors.muted }]}>of {stat.limit}</Text>
              <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
                <View style={[styles.progressFill, {
                  width: `${stat.percent}%`,
                  backgroundColor: stat.percent > 80 ? colors.warning : colors.primary,
                }]} />
              </View>
            </View>
          ))}
        </View>

        {/* Services Grid */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Manage Services</Text>
        {SERVICES.map((service) => (
          <TouchableOpacity
            key={service.id}
            style={[styles.serviceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(service.route as any);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.serviceIcon, { backgroundColor: colors.primary + "15" }]}>
              <IconSymbol name={service.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.serviceInfo}>
              <Text style={[styles.serviceTitle, { color: colors.foreground }]}>{service.title}</Text>
              <Text style={[styles.serviceSubtitle, { color: colors.muted }]}>{service.subtitle}</Text>
            </View>
            {service.badge && (
              <View style={[styles.serviceBadge, { backgroundColor: colors.error }]}>
                <Text style={styles.serviceBadgeText}>{service.badge}</Text>
              </View>
            )}
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </TouchableOpacity>
        ))}

        {/* Account ID */}
        <View style={[styles.accountIdRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.accountIdLabel, { color: colors.muted }]}>Account ID</Text>
          <Text style={[styles.accountIdValue, { color: colors.foreground }]}>{ACCOUNT.accountId}</Text>
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
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  content: { paddingBottom: 20 },
  accountCard: {
    margin: 16,
    borderRadius: 16,
    padding: 20,
  },
  accountHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  accountAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  accountAvatarText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  accountInfo: { flex: 1 },
  accountName: { fontSize: 17, fontWeight: "700", color: "#fff" },
  accountEmail: { fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  accountBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  accountPlan: { fontSize: 12, color: "rgba(255,255,255,0.9)", fontWeight: "600" },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.2)",
  },
  balanceLabel: { fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: "600", letterSpacing: 0.5 },
  balanceValue: { fontSize: 28, fontWeight: "800", color: "#fff", marginTop: 2 },
  balanceRight: { alignItems: "flex-end" },
  dueDateValue: { fontSize: 15, fontWeight: "600", color: "#fff", marginTop: 2 },
  payNowBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 16,
  },
  payNowText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    width: "48%",
    flexGrow: 1,
    flexBasis: "46%",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  statLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
  statValue: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  statLimit: { fontSize: 11, marginTop: 2 },
  progressBg: {
    height: 4,
    borderRadius: 2,
    marginTop: 8,
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  serviceIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceInfo: { flex: 1 },
  serviceTitle: { fontSize: 15, fontWeight: "600" },
  serviceSubtitle: { fontSize: 12, marginTop: 2 },
  serviceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  serviceBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  accountIdRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  accountIdLabel: { fontSize: 13 },
  accountIdValue: { fontSize: 13, fontWeight: "600" },
});
