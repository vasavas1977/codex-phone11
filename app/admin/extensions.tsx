/**
 * Extensions Management — Admin Portal
 * Manage PBX extensions, assign DIDs, configure voicemail and call forwarding.
 */

import { useState } from "react";
import {
  ScrollView, Text, View, TouchableOpacity, TextInput, StyleSheet, FlatList,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Extension {
  id: string;
  number: string;
  name: string;
  type: "user" | "ring_group" | "conference" | "ivr" | "parking";
  did: string;
  status: "online" | "busy" | "offline" | "dnd";
  voicemail: boolean;
  forwarding: string | null;
}

const MOCK_EXTENSIONS: Extension[] = [
  { id: "1", number: "1001", name: "John Smith", type: "user", did: "+1 (415) 555-0101", status: "online", voicemail: true, forwarding: null },
  { id: "2", number: "1002", name: "Sarah Johnson", type: "user", did: "+1 (415) 555-0102", status: "busy", voicemail: true, forwarding: null },
  { id: "3", number: "1003", name: "Mike Chen", type: "user", did: "+1 (415) 555-0103", status: "offline", voicemail: true, forwarding: "+1 (555) 999-0000" },
  { id: "4", number: "1004", name: "Emily Davis", type: "user", did: "+44 20 7946 0104", status: "online", voicemail: true, forwarding: null },
  { id: "5", number: "2001", name: "Sales Team", type: "ring_group", did: "+1 (415) 555-2001", status: "online", voicemail: false, forwarding: null },
  { id: "6", number: "2002", name: "Support Team", type: "ring_group", did: "+1 (415) 555-2002", status: "online", voicemail: true, forwarding: null },
  { id: "7", number: "3001", name: "Main Conference", type: "conference", did: "", status: "online", voicemail: false, forwarding: null },
  { id: "8", number: "0", name: "Main Auto-Attendant", type: "ivr", did: "+1 (415) 555-0000", status: "online", voicemail: false, forwarding: null },
  { id: "9", number: "7001", name: "Call Parking Lot", type: "parking", did: "", status: "online", voicemail: false, forwarding: null },
  { id: "10", number: "1005", name: "Alex Wilson", type: "user", did: "+1 (212) 555-0105", status: "dnd", voicemail: true, forwarding: null },
];

export default function AdminExtensions() {
  const colors = useColors();
  const [search, setSearch] = useState("");

  const filtered = MOCK_EXTENSIONS.filter(
    (e) => e.name.toLowerCase().includes(search.toLowerCase()) || e.number.includes(search)
  );

  const statusColor = (s: string) =>
    s === "online" ? "#00C896" : s === "busy" ? "#FF9500" : s === "dnd" ? "#FF3B30" : "#9BA1A6";

  const typeIcon = (t: string) => {
    switch (t) {
      case "user": return "person.fill";
      case "ring_group": return "person.2.fill";
      case "conference": return "phone.fill";
      case "ivr": return "rectangle.grid.3x2.fill";
      case "parking": return "pause.fill";
      default: return "phone.fill";
    }
  };

  const typeLabel = (t: string) => {
    switch (t) {
      case "user": return "User";
      case "ring_group": return "Ring Group";
      case "conference": return "Conference";
      case "ivr": return "IVR";
      case "parking": return "Parking";
      default: return t;
    }
  };

  const renderExtension = ({ item }: { item: Extension }) => (
    <TouchableOpacity
      style={[styles.extCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      activeOpacity={0.7}
    >
      <View style={styles.extLeft}>
        <View style={[styles.extIcon, { backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name={typeIcon(item.type) as any} size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.extNameRow}>
            <Text style={[styles.extNumber, { color: colors.primary }]}>{item.number}</Text>
            <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} />
          </View>
          <Text style={[styles.extName, { color: colors.foreground }]}>{item.name}</Text>
          <View style={styles.extTags}>
            <View style={[styles.tag, { backgroundColor: colors.primary + "15" }]}>
              <Text style={[styles.tagText, { color: colors.primary }]}>{typeLabel(item.type)}</Text>
            </View>
            {item.voicemail && (
              <View style={[styles.tag, { backgroundColor: "#8B5CF615" }]}>
                <Text style={[styles.tagText, { color: "#8B5CF6" }]}>VM</Text>
              </View>
            )}
            {item.forwarding && (
              <View style={[styles.tag, { backgroundColor: "#FF950015" }]}>
                <Text style={[styles.tagText, { color: "#FF9500" }]}>FWD</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      <View style={styles.extRight}>
        {item.did ? (
          <Text style={[styles.extDid, { color: colors.muted }]}>{item.did}</Text>
        ) : (
          <Text style={[styles.extDid, { color: colors.muted, fontStyle: "italic" }]}>No DID</Text>
        )}
        <IconSymbol name="chevron.right" size={16} color={colors.muted} />
      </View>
    </TouchableOpacity>
  );

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Extensions</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]}>
          <IconSymbol name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summary} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {[
          { label: "Total", count: MOCK_EXTENSIONS.length, color: colors.primary },
          { label: "Online", count: MOCK_EXTENSIONS.filter((e) => e.status === "online").length, color: "#00C896" },
          { label: "Busy", count: MOCK_EXTENSIONS.filter((e) => e.status === "busy").length, color: "#FF9500" },
          { label: "Offline", count: MOCK_EXTENSIONS.filter((e) => e.status === "offline").length, color: "#9BA1A6" },
          { label: "DND", count: MOCK_EXTENSIONS.filter((e) => e.status === "dnd").length, color: "#FF3B30" },
        ].map((s, i) => (
          <View key={i} style={[styles.summaryChip, { borderColor: s.color + "40" }]}>
            <View style={[styles.summaryDot, { backgroundColor: s.color }]} />
            <Text style={[styles.summaryText, { color: colors.foreground }]}>{s.count} {s.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search by name or extension number..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderExtension}
        contentContainerStyle={{ padding: 16, gap: 8 }}
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
  summary: { marginTop: 12, maxHeight: 40 },
  summaryChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, gap: 6 },
  summaryDot: { width: 6, height: 6, borderRadius: 3 },
  summaryText: { fontSize: 12, fontWeight: "600" },
  searchBar: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 0.5, gap: 8 },
  searchInput: { flex: 1, fontSize: 15 },
  extCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 14, borderWidth: 0.5 },
  extLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 12 },
  extIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  extNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  extNumber: { fontSize: 15, fontWeight: "700" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  extName: { fontSize: 13, marginTop: 1 },
  extTags: { flexDirection: "row", marginTop: 4, gap: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tagText: { fontSize: 10, fontWeight: "600" },
  extRight: { alignItems: "flex-end", gap: 4 },
  extDid: { fontSize: 11 },
});
