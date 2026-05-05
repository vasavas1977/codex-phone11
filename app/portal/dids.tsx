import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface DIDNumber {
  id: string;
  number: string;
  country: string;
  type: "local" | "tollfree" | "national";
  assignedTo: string;
  monthlyFee: string;
  status: "active" | "suspended";
  forwardTo?: string;
}

const MY_DIDS: DIDNumber[] = [
  { id: "1", number: "+1 (555) 100-1000", country: "US", type: "local", assignedTo: "Main Line", monthlyFee: "$5.00", status: "active", forwardTo: "Ext 1001" },
  { id: "2", number: "+1 (555) 100-1001", country: "US", type: "local", assignedTo: "Sales", monthlyFee: "$5.00", status: "active", forwardTo: "Ring Group: Sales" },
  { id: "3", number: "+1 (800) 555-0100", country: "US", type: "tollfree", assignedTo: "Support", monthlyFee: "$10.00", status: "active", forwardTo: "IVR: Main Menu" },
  { id: "4", number: "+44 20 7946 0958", country: "UK", type: "national", assignedTo: "London Office", monthlyFee: "$8.00", status: "active", forwardTo: "Ext 2001" },
  { id: "5", number: "+1 (555) 100-1005", country: "US", type: "local", assignedTo: "Unassigned", monthlyFee: "$5.00", status: "suspended" },
];

const AVAILABLE_DIDS = [
  { number: "+1 (555) 200-3001", country: "US", type: "local", monthlyFee: "$5.00" },
  { number: "+1 (555) 200-3002", country: "US", type: "local", monthlyFee: "$5.00" },
  { number: "+1 (800) 555-0200", country: "US", type: "tollfree", monthlyFee: "$10.00" },
  { number: "+44 20 7946 1234", country: "UK", type: "national", monthlyFee: "$8.00" },
  { number: "+49 30 1234 5678", country: "DE", type: "national", monthlyFee: "$8.00" },
  { number: "+61 2 9876 5432", country: "AU", type: "national", monthlyFee: "$8.00" },
];

export default function PortalDIDsScreen() {
  const colors = useColors();
  const [tab, setTab] = useState<"my" | "browse">("my");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const typeColors: Record<string, string> = {
    local: colors.primary,
    tollfree: colors.success,
    national: colors.warning,
  };

  const filteredDIDs = MY_DIDS.filter(d =>
    d.number.includes(search) || d.assignedTo.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Numbers</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Tab Switcher */}
      <View style={[styles.tabRow, { backgroundColor: colors.surface }]}>
        {(["my", "browse"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && { backgroundColor: colors.primary }]}
            onPress={() => { setTab(t); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <Text style={[styles.tabText, { color: tab === t ? "#fff" : colors.muted }]}>
              {t === "my" ? `My Numbers (${MY_DIDS.length})` : "Browse Available"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={[styles.searchRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder={tab === "my" ? "Search your numbers..." : "Search available numbers..."}
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {tab === "my" ? (
          <>
            {/* Monthly Cost Summary */}
            <View style={[styles.costCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View>
                <Text style={[styles.costLabel, { color: colors.muted }]}>Monthly DID Cost</Text>
                <Text style={[styles.costValue, { color: colors.foreground }]}>$33.00/mo</Text>
              </View>
              <View style={styles.costRight}>
                <Text style={[styles.costLabel, { color: colors.muted }]}>Active / Total</Text>
                <Text style={[styles.costValue, { color: colors.foreground }]}>4 / 5</Text>
              </View>
            </View>

            {/* DID List */}
            {filteredDIDs.map((did) => (
              <TouchableOpacity
                key={did.id}
                style={[styles.didCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setExpandedId(expandedId === did.id ? null : did.id);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.didMain}>
                  <View style={styles.didLeft}>
                    <Text style={[styles.didNumber, { color: colors.foreground }]}>{did.number}</Text>
                    <View style={styles.didTags}>
                      <View style={[styles.typeBadge, { backgroundColor: typeColors[did.type] + "20" }]}>
                        <Text style={[styles.typeBadgeText, { color: typeColors[did.type] }]}>
                          {did.type.charAt(0).toUpperCase() + did.type.slice(1)}
                        </Text>
                      </View>
                      <Text style={[styles.didCountry, { color: colors.muted }]}>{did.country}</Text>
                    </View>
                  </View>
                  <View style={styles.didRight}>
                    <View style={[styles.statusDot, { backgroundColor: did.status === "active" ? colors.success : colors.warning }]} />
                    <Text style={[styles.didFee, { color: colors.muted }]}>{did.monthlyFee}</Text>
                  </View>
                </View>

                <View style={[styles.didAssigned, { borderTopColor: colors.border }]}>
                  <Text style={[styles.assignedLabel, { color: colors.muted }]}>Assigned to:</Text>
                  <Text style={[styles.assignedValue, { color: colors.foreground }]}>{did.assignedTo}</Text>
                </View>

                {did.forwardTo && (
                  <View style={styles.forwardRow}>
                    <IconSymbol name="arrow.triangle.branch" size={12} color={colors.primary} />
                    <Text style={[styles.forwardText, { color: colors.primary }]}>{did.forwardTo}</Text>
                  </View>
                )}

                {expandedId === did.id && (
                  <View style={[styles.didActions, { borderTopColor: colors.border }]}>
                    <TouchableOpacity style={[styles.didActionBtn, { backgroundColor: colors.primary + "15" }]}>
                      <IconSymbol name="arrow.triangle.branch" size={14} color={colors.primary} />
                      <Text style={[styles.didActionText, { color: colors.primary }]}>Forwarding</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.didActionBtn, { backgroundColor: colors.warning + "15" }]}>
                      <IconSymbol name="pencil" size={14} color={colors.warning} />
                      <Text style={[styles.didActionText, { color: colors.warning }]}>Rename</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.didActionBtn, { backgroundColor: colors.error + "15" }]}>
                      <IconSymbol name="trash.fill" size={14} color={colors.error} />
                      <Text style={[styles.didActionText, { color: colors.error }]}>Release</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </>
        ) : (
          <>
            {/* Browse Available Numbers */}
            <Text style={[styles.browseHint, { color: colors.muted }]}>
              Select a number to add to your account. Monthly fees will be added to your next invoice.
            </Text>
            {AVAILABLE_DIDS.map((did, i) => (
              <View key={i} style={[styles.availableCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.availableInfo}>
                  <Text style={[styles.availableNumber, { color: colors.foreground }]}>{did.number}</Text>
                  <View style={styles.didTags}>
                    <View style={[styles.typeBadge, { backgroundColor: typeColors[did.type] + "20" }]}>
                      <Text style={[styles.typeBadgeText, { color: typeColors[did.type] }]}>
                        {did.type.charAt(0).toUpperCase() + did.type.slice(1)}
                      </Text>
                    </View>
                    <Text style={[styles.didCountry, { color: colors.muted }]}>{did.country}</Text>
                    <Text style={[styles.didFee, { color: colors.muted }]}>{did.monthlyFee}/mo</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.purchaseBtn, { backgroundColor: colors.primary }]}
                  onPress={() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}
                >
                  <Text style={styles.purchaseBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  tabRow: { flexDirection: "row", margin: 16, borderRadius: 10, padding: 3, gap: 3 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tabText: { fontSize: 13, fontWeight: "600" },
  searchRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  content: { paddingBottom: 20 },
  costCard: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: 16, marginBottom: 16, padding: 16, borderRadius: 12, borderWidth: 1 },
  costLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
  costValue: { fontSize: 20, fontWeight: "800", marginTop: 4 },
  costRight: { alignItems: "flex-end" },
  didCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, overflow: "hidden", padding: 14 },
  didMain: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  didLeft: { flex: 1 },
  didNumber: { fontSize: 15, fontWeight: "700" },
  didTags: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText: { fontSize: 10, fontWeight: "700" },
  didCountry: { fontSize: 12 },
  didRight: { alignItems: "flex-end", gap: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  didFee: { fontSize: 12 },
  didAssigned: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 0.5 },
  assignedLabel: { fontSize: 12 },
  assignedValue: { fontSize: 12, fontWeight: "600" },
  forwardRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  forwardText: { fontSize: 12, fontWeight: "600" },
  didActions: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 0.5 },
  didActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  didActionText: { fontSize: 12, fontWeight: "600" },
  browseHint: { fontSize: 13, paddingHorizontal: 16, marginBottom: 12 },
  availableCard: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 12, borderWidth: 1 },
  availableInfo: { flex: 1 },
  availableNumber: { fontSize: 15, fontWeight: "700" },
  purchaseBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  purchaseBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});
