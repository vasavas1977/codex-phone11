/**
 * User / Subscriber Management — Admin Portal
 * CRUD operations for subscribers with BillRun integration.
 */

import { useState } from "react";
import {
  ScrollView, Text, View, TouchableOpacity, TextInput, StyleSheet, FlatList, Alert,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Subscriber {
  id: string;
  name: string;
  email: string;
  extension: string;
  did: string;
  plan: string;
  status: "active" | "suspended" | "trial";
  balance: string;
  registeredAt: string;
}

const MOCK_USERS: Subscriber[] = [
  { id: "1", name: "John Smith", email: "john@acme.com", extension: "1001", did: "+1 (415) 555-0101", plan: "Business Pro", status: "active", balance: "$142.50", registeredAt: "2025-08-15" },
  { id: "2", name: "Sarah Johnson", email: "sarah@techcorp.io", extension: "1002", did: "+1 (415) 555-0102", plan: "Business Pro", status: "active", balance: "$89.20", registeredAt: "2025-09-22" },
  { id: "3", name: "Mike Chen", email: "mike@startup.co", extension: "1003", did: "+1 (415) 555-0103", plan: "Starter", status: "trial", balance: "$0.00", registeredAt: "2026-04-01" },
  { id: "4", name: "Emily Davis", email: "emily@corp.net", extension: "1004", did: "+44 20 7946 0104", plan: "Enterprise", status: "active", balance: "$567.80", registeredAt: "2025-06-10" },
  { id: "5", name: "Alex Wilson", email: "alex@biz.com", extension: "1005", did: "+1 (212) 555-0105", plan: "Business Pro", status: "suspended", balance: "-$24.00", registeredAt: "2025-11-03" },
  { id: "6", name: "Lisa Park", email: "lisa@media.co", extension: "1006", did: "+65 6100 0106", plan: "Starter", status: "active", balance: "$31.40", registeredAt: "2026-01-18" },
  { id: "7", name: "David Brown", email: "david@finance.com", extension: "1007", did: "+1 (312) 555-0107", plan: "Enterprise", status: "active", balance: "$1,240.00", registeredAt: "2025-03-20" },
  { id: "8", name: "Rachel Kim", email: "rachel@design.io", extension: "1008", did: "+82 2 1234 0108", plan: "Starter", status: "active", balance: "$15.60", registeredAt: "2026-03-05" },
];

export default function AdminUsers() {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "suspended" | "trial">("all");

  const filtered = MOCK_USERS.filter((u) => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.extension.includes(search);
    const matchFilter = filter === "all" || u.status === filter;
    return matchSearch && matchFilter;
  });

  const statusColor = (s: string) =>
    s === "active" ? "#00C896" : s === "trial" ? "#FF9500" : "#FF3B30";

  const handleAction = (user: Subscriber, action: string) => {
    Alert.alert(
      `${action} User`,
      `Are you sure you want to ${action.toLowerCase()} ${user.name}?`,
      [{ text: "Cancel" }, { text: action, style: action === "Suspend" ? "destructive" : "default" }]
    );
  };

  const renderUser = ({ item }: { item: Subscriber }) => (
    <View style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.userHeader}>
        <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>
            {item.name.split(" ").map((n) => n[0]).join("")}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.userName, { color: colors.foreground }]}>{item.name}</Text>
          <Text style={[styles.userEmail, { color: colors.muted }]}>{item.email}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + "20" }]}>
          <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={[styles.userDetails, { borderTopColor: colors.border }]}>
        <View style={styles.detailCol}>
          <Text style={[styles.detailLabel, { color: colors.muted }]}>Extension</Text>
          <Text style={[styles.detailValue, { color: colors.foreground }]}>{item.extension}</Text>
        </View>
        <View style={styles.detailCol}>
          <Text style={[styles.detailLabel, { color: colors.muted }]}>DID</Text>
          <Text style={[styles.detailValue, { color: colors.foreground }]}>{item.did}</Text>
        </View>
        <View style={styles.detailCol}>
          <Text style={[styles.detailLabel, { color: colors.muted }]}>Balance</Text>
          <Text style={[styles.detailValue, { color: parseFloat(item.balance.replace(/[^0-9.-]/g, "")) < 0 ? "#FF3B30" : colors.foreground }]}>
            {item.balance}
          </Text>
        </View>
      </View>

      <View style={[styles.userActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary + "15" }]} onPress={() => handleAction(item, "Edit")}>
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#FF950015" }]} onPress={() => handleAction(item, "Reset Password")}>
          <Text style={[styles.actionBtnText, { color: "#FF9500" }]}>Reset PW</Text>
        </TouchableOpacity>
        {item.status === "active" ? (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#FF3B3015" }]} onPress={() => handleAction(item, "Suspend")}>
            <Text style={[styles.actionBtnText, { color: "#FF3B30" }]}>Suspend</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#00C89615" }]} onPress={() => handleAction(item, "Activate")}>
            <Text style={[styles.actionBtnText, { color: "#00C896" }]}>Activate</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Users & Subscribers</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]}>
          <IconSymbol name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search by name, email, or extension..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {(["all", "active", "suspended", "trial"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && { backgroundColor: colors.primary }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, { color: filter === f ? "#fff" : colors.muted }]}>
              {f === "all" ? `All (${MOCK_USERS.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${MOCK_USERS.filter((u) => u.status === f).length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* User List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
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
  searchBar: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 0.5, gap: 8 },
  searchInput: { flex: 1, fontSize: 15 },
  filters: { marginTop: 12, maxHeight: 40 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(128,128,128,0.1)" },
  filterText: { fontSize: 13, fontWeight: "600" },
  userCard: { borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  userHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontWeight: "700" },
  userName: { fontSize: 15, fontWeight: "600" },
  userEmail: { fontSize: 12, marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: "700" },
  userDetails: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5 },
  detailCol: { flex: 1 },
  detailLabel: { fontSize: 10, marginBottom: 2 },
  detailValue: { fontSize: 13, fontWeight: "600" },
  userActions: { flexDirection: "row", padding: 10, gap: 8, borderTopWidth: 0.5 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  actionBtnText: { fontSize: 12, fontWeight: "600" },
});
