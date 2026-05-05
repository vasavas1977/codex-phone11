/**
 * IVR Flow Management — Admin Portal
 * View, create, and manage IVR dial plans deployed on FreeSWITCH.
 */

import { useState } from "react";
import {
  ScrollView, Text, View, TouchableOpacity, StyleSheet, FlatList, Alert,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface IVRFlow {
  id: string;
  name: string;
  description: string;
  did: string;
  nodes: number;
  status: "active" | "draft" | "disabled";
  lastModified: string;
  callsToday: number;
}

const MOCK_FLOWS: IVRFlow[] = [
  { id: "1", name: "Main Auto-Attendant", description: "Primary greeting → Sales / Support / Billing menu", did: "+1 (415) 555-0000", nodes: 8, status: "active", lastModified: "2 hours ago", callsToday: 142 },
  { id: "2", name: "After Hours", description: "Voicemail greeting → Leave message → Email notification", did: "+1 (415) 555-0000", nodes: 4, status: "active", lastModified: "3 days ago", callsToday: 23 },
  { id: "3", name: "Sales Queue", description: "Hold music → Agent ring group → Overflow to voicemail", did: "+1 (800) 555-0200", nodes: 6, status: "active", lastModified: "1 day ago", callsToday: 67 },
  { id: "4", name: "Support Triage", description: "Language select → Department → Priority routing", did: "+1 (415) 555-2002", nodes: 12, status: "active", lastModified: "5 hours ago", callsToday: 89 },
  { id: "5", name: "Holiday Greeting", description: "Holiday message → Emergency option → Voicemail", did: "", nodes: 3, status: "draft", lastModified: "2 weeks ago", callsToday: 0 },
  { id: "6", name: "VIP Routing", description: "Caller ID lookup → Direct to account manager", did: "", nodes: 5, status: "disabled", lastModified: "1 month ago", callsToday: 0 },
];

export default function AdminIVR() {
  const colors = useColors();

  const statusColor = (s: string) =>
    s === "active" ? "#00C896" : s === "draft" ? "#FF9500" : "#9BA1A6";

  const handleDeploy = (flow: IVRFlow) => {
    Alert.alert(
      "Deploy IVR Flow",
      `Deploy "${flow.name}" to FreeSWITCH? This will update the live dial plan.`,
      [
        { text: "Cancel" },
        { text: "Deploy", style: "default", onPress: () => Alert.alert("Deployed", "IVR flow deployed to FreeSWITCH successfully.") },
      ]
    );
  };

  const renderFlow = ({ item }: { item: IVRFlow }) => (
    <TouchableOpacity
      style={[styles.flowCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      activeOpacity={0.7}
      onPress={() => router.push("/settings/ivr" as any)}
    >
      <View style={styles.flowHeader}>
        <View style={[styles.flowIcon, { backgroundColor: "#8B5CF615" }]}>
          <IconSymbol name="rectangle.grid.3x2.fill" size={20} color="#8B5CF6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.flowName, { color: colors.foreground }]}>{item.name}</Text>
          <Text style={[styles.flowDesc, { color: colors.muted }]}>{item.description}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + "20" }]}>
          <Text style={[styles.statusText, { color: statusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={[styles.flowStats, { borderTopColor: colors.border }]}>
        <View style={styles.flowStat}>
          <Text style={[styles.flowStatValue, { color: colors.foreground }]}>{item.nodes}</Text>
          <Text style={[styles.flowStatLabel, { color: colors.muted }]}>Nodes</Text>
        </View>
        <View style={styles.flowStat}>
          <Text style={[styles.flowStatValue, { color: colors.foreground }]}>{item.callsToday}</Text>
          <Text style={[styles.flowStatLabel, { color: colors.muted }]}>Calls Today</Text>
        </View>
        <View style={styles.flowStat}>
          <Text style={[styles.flowStatValue, { color: colors.foreground }]}>{item.did || "—"}</Text>
          <Text style={[styles.flowStatLabel, { color: colors.muted }]}>DID</Text>
        </View>
      </View>

      <View style={[styles.flowActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.primary + "15" }]}
          onPress={() => router.push("/settings/ivr" as any)}
        >
          <IconSymbol name="pencil" size={14} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#00C89615" }]}
          onPress={() => handleDeploy(item)}
        >
          <IconSymbol name="paperplane.fill" size={14} color="#00C896" />
          <Text style={[styles.actionText, { color: "#00C896" }]}>Deploy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#8B5CF615" }]}>
          <IconSymbol name="doc.on.doc.fill" size={14} color="#8B5CF6" />
          <Text style={[styles.actionText, { color: "#8B5CF6" }]}>Clone</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.flowModified, { color: colors.muted }]}>Modified {item.lastModified}</Text>
    </TouchableOpacity>
  );

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>IVR Flows</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]}>
          <IconSymbol name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <View style={[styles.summaryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>{MOCK_FLOWS.length}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Total Flows</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: "#00C896" }]}>{MOCK_FLOWS.filter((f) => f.status === "active").length}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Active</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.primary }]}>{MOCK_FLOWS.reduce((s, f) => s + f.callsToday, 0)}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Calls Today</Text>
        </View>
      </View>

      <FlatList
        data={MOCK_FLOWS}
        keyExtractor={(item) => item.id}
        renderItem={renderFlow}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "700", flex: 1 },
  addBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  summaryRow: { flexDirection: "row", marginHorizontal: 16, marginTop: 12, borderRadius: 14, borderWidth: 0.5, padding: 14 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryValue: { fontSize: 20, fontWeight: "700" },
  summaryLabel: { fontSize: 11, marginTop: 2 },
  summaryDivider: { width: 0.5, marginVertical: 4 },
  flowCard: { borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  flowHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  flowIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  flowName: { fontSize: 15, fontWeight: "700" },
  flowDesc: { fontSize: 12, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: "700" },
  flowStats: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5 },
  flowStat: { flex: 1 },
  flowStatValue: { fontSize: 14, fontWeight: "600" },
  flowStatLabel: { fontSize: 10, marginTop: 1 },
  flowActions: { flexDirection: "row", padding: 10, gap: 8, borderTopWidth: 0.5 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 8, gap: 4 },
  actionText: { fontSize: 12, fontWeight: "600" },
  flowModified: { fontSize: 10, paddingHorizontal: 14, paddingBottom: 10 },
});
