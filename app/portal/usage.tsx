import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

type Period = "today" | "week" | "month" | "quarter";

const USAGE_DATA: Record<Period, { voice: any; sms: any; did: any; cost: any }> = {
  today: {
    voice: { total: 47, inbound: 23, outbound: 24, avgDuration: "3:42" },
    sms: { sent: 12, received: 8 },
    did: { active: 5, inboundCalls: 23 },
    cost: { voice: "$1.88", sms: "$0.60", did: "$1.10", total: "$3.58" },
  },
  week: {
    voice: { total: 312, inbound: 156, outbound: 156, avgDuration: "4:15" },
    sms: { sent: 87, received: 64 },
    did: { active: 5, inboundCalls: 156 },
    cost: { voice: "$12.48", sms: "$4.35", did: "$7.65", total: "$24.48" },
  },
  month: {
    voice: { total: 1247, inbound: 623, outbound: 624, avgDuration: "3:58" },
    sms: { sent: 342, received: 218 },
    did: { active: 5, inboundCalls: 623 },
    cost: { voice: "$33.88", sms: "$7.10", did: "$25.00", total: "$65.98" },
  },
  quarter: {
    voice: { total: 3841, inbound: 1920, outbound: 1921, avgDuration: "4:02" },
    sms: { sent: 1024, received: 687 },
    did: { active: 5, inboundCalls: 1920 },
    cost: { voice: "$102.44", sms: "$21.30", did: "$75.00", total: "$198.74" },
  },
};

const TOP_DESTINATIONS = [
  { number: "+1 (555) 234-5678", name: "Sales Team", calls: 87, minutes: 342 },
  { number: "+1 (555) 345-6789", name: "Support Desk", calls: 64, minutes: 256 },
  { number: "+44 20 7946 0958", name: "London Office", calls: 42, minutes: 189 },
  { number: "+1 (800) 555-0100", name: "Toll-Free Line", calls: 38, minutes: 152 },
  { number: "+1 (555) 456-7890", name: "Partner Corp", calls: 31, minutes: 124 },
];

export default function UsageScreen() {
  const colors = useColors();
  const [period, setPeriod] = useState<Period>("month");
  const data = USAGE_DATA[period];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Usage & Analytics</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Period Selector */}
      <View style={[styles.periodRow, { backgroundColor: colors.surface }]}>
        {(["today", "week", "month", "quarter"] as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodTab, period === p && { backgroundColor: colors.primary }]}
            onPress={() => { setPeriod(p); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <Text style={[styles.periodText, { color: period === p ? "#fff" : colors.muted }]}>
              {p === "today" ? "Today" : p === "week" ? "Week" : p === "month" ? "Month" : "Quarter"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Total Cost Card */}
        <View style={[styles.totalCard, { backgroundColor: colors.primary }]}>
          <Text style={styles.totalLabel}>Total Cost This {period === "today" ? "Day" : period === "week" ? "Week" : period === "month" ? "Month" : "Quarter"}</Text>
          <Text style={styles.totalValue}>{data.cost.total}</Text>
          <View style={styles.totalBreakdown}>
            <View style={styles.totalItem}>
              <Text style={styles.totalItemLabel}>Voice</Text>
              <Text style={styles.totalItemValue}>{data.cost.voice}</Text>
            </View>
            <View style={[styles.totalDivider]} />
            <View style={styles.totalItem}>
              <Text style={styles.totalItemLabel}>SMS</Text>
              <Text style={styles.totalItemValue}>{data.cost.sms}</Text>
            </View>
            <View style={[styles.totalDivider]} />
            <View style={styles.totalItem}>
              <Text style={styles.totalItemLabel}>DID</Text>
              <Text style={styles.totalItemValue}>{data.cost.did}</Text>
            </View>
          </View>
        </View>

        {/* Voice Usage */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Voice Usage</Text>
        <View style={[styles.statsGrid]}>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Total Calls</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{data.voice.total.toLocaleString()}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Avg Duration</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{data.voice.avgDuration}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Inbound</Text>
            <Text style={[styles.statValue, { color: colors.success }]}>{data.voice.inbound.toLocaleString()}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Outbound</Text>
            <Text style={[styles.statValue, { color: colors.primary }]}>{data.voice.outbound.toLocaleString()}</Text>
          </View>
        </View>

        {/* Visual Bar Chart */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.chartTitle, { color: colors.foreground }]}>Inbound vs Outbound</Text>
          <View style={styles.barRow}>
            <Text style={[styles.barLabel, { color: colors.muted }]}>Inbound</Text>
            <View style={[styles.barBg, { backgroundColor: colors.border }]}>
              <View style={[styles.barFill, { width: `${(data.voice.inbound / data.voice.total) * 100}%`, backgroundColor: colors.success }]} />
            </View>
            <Text style={[styles.barValue, { color: colors.foreground }]}>{Math.round((data.voice.inbound / data.voice.total) * 100)}%</Text>
          </View>
          <View style={styles.barRow}>
            <Text style={[styles.barLabel, { color: colors.muted }]}>Outbound</Text>
            <View style={[styles.barBg, { backgroundColor: colors.border }]}>
              <View style={[styles.barFill, { width: `${(data.voice.outbound / data.voice.total) * 100}%`, backgroundColor: colors.primary }]} />
            </View>
            <Text style={[styles.barValue, { color: colors.foreground }]}>{Math.round((data.voice.outbound / data.voice.total) * 100)}%</Text>
          </View>
        </View>

        {/* SMS Usage */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>SMS Usage</Text>
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Sent</Text>
            <Text style={[styles.statValue, { color: colors.primary }]}>{data.sms.sent.toLocaleString()}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Received</Text>
            <Text style={[styles.statValue, { color: colors.success }]}>{data.sms.received.toLocaleString()}</Text>
          </View>
        </View>

        {/* Top Destinations */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Top Destinations</Text>
        <View style={[styles.destCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {TOP_DESTINATIONS.map((dest, i) => (
            <View key={i} style={[styles.destRow, i < TOP_DESTINATIONS.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
              <View style={[styles.destRank, { backgroundColor: i < 3 ? colors.primary + "15" : colors.border + "40" }]}>
                <Text style={[styles.destRankText, { color: i < 3 ? colors.primary : colors.muted }]}>{i + 1}</Text>
              </View>
              <View style={styles.destInfo}>
                <Text style={[styles.destName, { color: colors.foreground }]}>{dest.name}</Text>
                <Text style={[styles.destNumber, { color: colors.muted }]}>{dest.number}</Text>
              </View>
              <View style={styles.destStats}>
                <Text style={[styles.destCalls, { color: colors.foreground }]}>{dest.calls} calls</Text>
                <Text style={[styles.destMinutes, { color: colors.muted }]}>{dest.minutes} min</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  periodRow: { flexDirection: "row", margin: 16, borderRadius: 10, padding: 3, gap: 3 },
  periodTab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  periodText: { fontSize: 12, fontWeight: "600" },
  content: { paddingBottom: 20 },
  totalCard: { marginHorizontal: 16, borderRadius: 16, padding: 24, alignItems: "center" },
  totalLabel: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: "600" },
  totalValue: { fontSize: 36, fontWeight: "800", color: "#fff", marginTop: 4 },
  totalBreakdown: { flexDirection: "row", marginTop: 16, gap: 0 },
  totalItem: { flex: 1, alignItems: "center" },
  totalItemLabel: { fontSize: 11, color: "rgba(255,255,255,0.7)" },
  totalItemValue: { fontSize: 16, fontWeight: "700", color: "#fff", marginTop: 2 },
  totalDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.2)", marginVertical: 2 },
  sectionTitle: { fontSize: 16, fontWeight: "700", paddingHorizontal: 16, marginTop: 20, marginBottom: 12 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8 },
  statCard: { flexGrow: 1, flexBasis: "46%", borderRadius: 12, padding: 14, borderWidth: 1 },
  statLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
  statValue: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  chartCard: { marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 12, borderWidth: 1 },
  chartTitle: { fontSize: 14, fontWeight: "600", marginBottom: 12 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  barLabel: { fontSize: 11, width: 60 },
  barBg: { flex: 1, height: 20, borderRadius: 10, overflow: "hidden" },
  barFill: { height: 20, borderRadius: 10 },
  barValue: { fontSize: 12, fontWeight: "700", width: 36, textAlign: "right" },
  destCard: { marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  destRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 12 },
  destRank: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  destRankText: { fontSize: 12, fontWeight: "800" },
  destInfo: { flex: 1 },
  destName: { fontSize: 14, fontWeight: "600" },
  destNumber: { fontSize: 11, marginTop: 1 },
  destStats: { alignItems: "flex-end" },
  destCalls: { fontSize: 13, fontWeight: "600" },
  destMinutes: { fontSize: 11, marginTop: 1 },
});
