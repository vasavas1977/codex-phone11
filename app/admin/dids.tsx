/**
 * DID Inventory Management — Admin Portal
 * Manage number pool, assign DIDs to extensions, track usage and billing.
 */

import { useState } from "react";
import {
  Text, View, TouchableOpacity, TextInput, StyleSheet, FlatList,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface DIDNumber {
  id: string;
  number: string;
  country: string;
  type: "local" | "tollfree" | "national" | "mobile";
  assignedTo: string | null;
  extension: string | null;
  monthlyFee: string;
  status: "active" | "available" | "reserved" | "porting";
  provider: string;
}

const MOCK_DIDS: DIDNumber[] = [
  { id: "1", number: "+1 (415) 555-0101", country: "US", type: "local", assignedTo: "John Smith", extension: "1001", monthlyFee: "$2.50", status: "active", provider: "DIDww" },
  { id: "2", number: "+1 (415) 555-0102", country: "US", type: "local", assignedTo: "Sarah Johnson", extension: "1002", monthlyFee: "$2.50", status: "active", provider: "DIDww" },
  { id: "3", number: "+1 (415) 555-0103", country: "US", type: "local", assignedTo: "Mike Chen", extension: "1003", monthlyFee: "$2.50", status: "active", provider: "DIDww" },
  { id: "4", number: "+44 20 7946 0104", country: "UK", type: "local", assignedTo: "Emily Davis", extension: "1004", monthlyFee: "$3.00", status: "active", provider: "DIDww" },
  { id: "5", number: "+1 (800) 555-0200", country: "US", type: "tollfree", assignedTo: "Sales Team", extension: "2001", monthlyFee: "$5.00", status: "active", provider: "DIDx" },
  { id: "6", number: "+1 (415) 555-0300", country: "US", type: "local", assignedTo: null, extension: null, monthlyFee: "$2.50", status: "available", provider: "DIDww" },
  { id: "7", number: "+1 (212) 555-0400", country: "US", type: "local", assignedTo: null, extension: null, monthlyFee: "$2.50", status: "available", provider: "DIDww" },
  { id: "8", number: "+65 6100 0500", country: "SG", type: "local", assignedTo: null, extension: null, monthlyFee: "$4.00", status: "reserved", provider: "DIDww" },
  { id: "9", number: "+1 (415) 555-0600", country: "US", type: "local", assignedTo: null, extension: null, monthlyFee: "$2.50", status: "porting", provider: "Porting" },
  { id: "10", number: "+82 2 1234 0700", country: "KR", type: "local", assignedTo: "Rachel Kim", extension: "1008", monthlyFee: "$3.50", status: "active", provider: "DIDx" },
];

export default function AdminDIDs() {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "available" | "reserved" | "porting">("all");

  const filtered = MOCK_DIDS.filter((d) => {
    const matchSearch = d.number.includes(search) || (d.assignedTo ?? "").toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || d.status === filter;
    return matchSearch && matchFilter;
  });

  const statusColor = (s: string) => {
    switch (s) {
      case "active": return "#00C896";
      case "available": return "#0057FF";
      case "reserved": return "#FF9500";
      case "porting": return "#8B5CF6";
      default: return "#9BA1A6";
    }
  };

  const typeLabel = (t: string) => {
    switch (t) {
      case "local": return "Local";
      case "tollfree": return "Toll-Free";
      case "national": return "National";
      case "mobile": return "Mobile";
      default: return t;
    }
  };

  const totalMonthly = MOCK_DIDS.filter((d) => d.status === "active" || d.status === "reserved")
    .reduce((sum, d) => sum + parseFloat(d.monthlyFee.replace("$", "")), 0);

  const renderDID = ({ item }: { item: DIDNumber }) => (
    <TouchableOpacity
      style={[styles.didCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      activeOpacity={0.7}
    >
      <View style={styles.didTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.didNumber, { color: colors.foreground }]}>{item.number}</Text>
          <View style={styles.didMeta}>
            <Text style={[styles.didCountry, { color: colors.muted }]}>{item.country}</Text>
            <View style={[styles.typeBadge, { backgroundColor: colors.primary + "15" }]}>
              <Text style={[styles.typeText, { color: colors.primary }]}>{typeLabel(item.type)}</Text>
            </View>
            <Text style={[styles.didProvider, { color: colors.muted }]}>{item.provider}</Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + "20" }]}>
            <Text style={[styles.statusText, { color: statusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
          </View>
          <Text style={[styles.didFee, { color: colors.muted }]}>{item.monthlyFee}/mo</Text>
        </View>
      </View>
      {item.assignedTo && (
        <View style={[styles.didAssignment, { borderTopColor: colors.border }]}>
          <IconSymbol name="person.fill" size={12} color={colors.muted} />
          <Text style={[styles.assignedText, { color: colors.muted }]}>
            {item.assignedTo} · Ext. {item.extension}
          </Text>
        </View>
      )}
      {!item.assignedTo && item.status === "available" && (
        <View style={[styles.didAssignment, { borderTopColor: colors.border }]}>
          <TouchableOpacity style={[styles.assignBtn, { backgroundColor: colors.primary + "15" }]}>
            <Text style={[styles.assignBtnText, { color: colors.primary }]}>Assign to Extension</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>DID Inventory</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]}>
          <IconSymbol name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Summary Stats */}
      <View style={[styles.statsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{MOCK_DIDS.length}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Total</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: "#00C896" }]}>{MOCK_DIDS.filter((d) => d.status === "active").length}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Active</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: "#0057FF" }]}>{MOCK_DIDS.filter((d) => d.status === "available").length}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Available</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: "#FF9500" }]}>${totalMonthly.toFixed(2)}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Monthly</Text>
        </View>
      </View>

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search by number or assigned user..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filters */}
      <View style={styles.filters}>
        {(["all", "active", "available", "reserved", "porting"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && { backgroundColor: colors.primary }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, { color: filter === f ? "#fff" : colors.muted }]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderDID}
        contentContainerStyle={{ padding: 16, gap: 10 }}
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
  statsRow: { flexDirection: "row", marginHorizontal: 16, marginTop: 12, borderRadius: 14, borderWidth: 0.5, padding: 14 },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "700" },
  statLabel: { fontSize: 11, marginTop: 2 },
  statDivider: { width: 0.5, marginVertical: 4 },
  searchBar: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 0.5, gap: 8 },
  searchInput: { flex: 1, fontSize: 15 },
  filters: { flexDirection: "row", paddingHorizontal: 16, marginTop: 12, gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(128,128,128,0.1)" },
  filterText: { fontSize: 12, fontWeight: "600" },
  didCard: { borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  didTop: { flexDirection: "row", justifyContent: "space-between", padding: 14 },
  didNumber: { fontSize: 16, fontWeight: "700" },
  didMeta: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 6 },
  didCountry: { fontSize: 12 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeText: { fontSize: 10, fontWeight: "600" },
  didProvider: { fontSize: 11 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: "700" },
  didFee: { fontSize: 12, marginTop: 4 },
  didAssignment: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5, gap: 6 },
  assignedText: { fontSize: 12 },
  assignBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  assignBtnText: { fontSize: 12, fontWeight: "600" },
});
