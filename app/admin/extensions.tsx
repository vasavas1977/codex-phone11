/**
 * Extensions Management - Admin Portal
 * Admin-controlled phone provisioning for Phone11 mobile clients.
 */

import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

type ExtensionRow = {
  id: number;
  extension_number?: string;
  sip_username?: string;
  sip_domain?: string;
  display_name?: string;
  status?: string;
  assigned_user_id?: number | null;
  user_id?: number | null;
};

function extensionNumber(row: ExtensionRow) {
  return row.extension_number || row.sip_username || String(row.id);
}

export default function AdminExtensions() {
  const colors = useColors();
  const utils = trpc.useUtils();
  const extensionsQuery = trpc.phone.listExtensions.useQuery({ orgId: 1 });
  const createExtension = trpc.phone.createExtension.useMutation({
    onSuccess: () => {
      utils.phone.listExtensions.invalidate();
    },
  });
  const assignExtension = trpc.phone.assignExtension.useMutation({
    onSuccess: () => {
      utils.phone.listExtensions.invalidate();
    },
  });

  const [search, setSearch] = useState("");
  const [extension, setExtension] = useState("1020");
  const [displayName, setDisplayName] = useState("Phone11 Test User");
  const [userId, setUserId] = useState("");

  const rows = (extensionsQuery.data || []) as ExtensionRow[];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const number = extensionNumber(row).toLowerCase();
      const name = (row.display_name || "").toLowerCase();
      const user = String(row.assigned_user_id || row.user_id || "");
      return number.includes(needle) || name.includes(needle) || user.includes(needle);
    });
  }, [rows, search]);

  const busy = createExtension.isPending || assignExtension.isPending;

  const handleCreate = async () => {
    const extensionNumberValue = extension.trim();
    const parsedUserId = userId.trim() ? Number.parseInt(userId.trim(), 10) : undefined;

    if (!extensionNumberValue) {
      Alert.alert("Extension required", "Enter an extension number before creating it.");
      return;
    }

    if (userId.trim() && (!Number.isFinite(parsedUserId) || !parsedUserId || parsedUserId <= 0)) {
      Alert.alert("Invalid user ID", "Enter the numeric Phone11 user ID from the admin user record.");
      return;
    }

    try {
      const created = await createExtension.mutateAsync({
        orgId: 1,
        extensionNumber: extensionNumberValue,
        displayName: displayName.trim() || `Extension ${extensionNumberValue}`,
      });

      if (parsedUserId && created.id) {
        await assignExtension.mutateAsync({
          userId: parsedUserId,
          extensionId: created.id,
          isPrimary: true,
        });
      }

      Alert.alert(
        "Extension provisioned",
        parsedUserId
          ? `Extension ${extensionNumber(created)} was created and assigned to user ${parsedUserId}. The mobile app can now sync from admin.`
          : `Extension ${extensionNumber(created)} was created. Assign it to a user before testing on iPhone.`,
      );
    } catch (error) {
      Alert.alert("Provisioning failed", error instanceof Error ? error.message : "Could not create the extension.");
    }
  };

  const handleAssign = async (row: ExtensionRow) => {
    const parsedUserId = userId.trim() ? Number.parseInt(userId.trim(), 10) : undefined;

    if (!parsedUserId || parsedUserId <= 0) {
      Alert.alert("User ID required", "Enter the numeric Phone11 user ID, then assign the extension.");
      return;
    }

    try {
      await assignExtension.mutateAsync({
        userId: parsedUserId,
        extensionId: row.id,
        isPrimary: true,
      });
      Alert.alert("Extension assigned", `Extension ${extensionNumber(row)} is now assigned to user ${parsedUserId}.`);
    } catch (error) {
      Alert.alert("Assignment failed", error instanceof Error ? error.message : "Could not assign the extension.");
    }
  };

  const renderExtension = ({ item }: { item: ExtensionRow }) => {
    const assignedUser = item.assigned_user_id || item.user_id || null;
    const status = item.status || "active";

    return (
      <View style={[styles.extCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.extLeft}>
          <View style={[styles.extIcon, { backgroundColor: colors.primary + "15" }]}>
            <IconSymbol name="phone.fill" size={18} color={colors.primary} />
          </View>
          <View style={styles.extText}>
            <Text style={[styles.extNumber, { color: colors.primary }]}>{extensionNumber(item)}</Text>
            <Text style={[styles.extName, { color: colors.foreground }]}>
              {item.display_name || "Unnamed extension"}
            </Text>
            <Text style={[styles.extMeta, { color: colors.muted }]}>
              {item.sip_domain || "sip.phone11.ai"} - {assignedUser ? `User ${assignedUser}` : "Unassigned"}
            </Text>
          </View>
        </View>
        <View style={styles.extRight}>
          <View style={[styles.statusBadge, { backgroundColor: assignedUser ? "#00C89620" : "#FF950020" }]}>
            <Text style={[styles.statusText, { color: assignedUser ? "#00A876" : "#D97706" }]}>
              {assignedUser ? "ASSIGNED" : "OPEN"}
            </Text>
          </View>
          <Text style={[styles.extMeta, { color: colors.muted }]}>{status}</Text>
          {!assignedUser && (
            <TouchableOpacity
              style={[styles.assignBtn, { borderColor: colors.primary + "60" }]}
              onPress={() => handleAssign(item)}
              disabled={busy}
            >
              <Text style={[styles.assignText, { color: colors.primary }]}>Assign</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Phone Provisioning</Text>
        <TouchableOpacity onPress={() => extensionsQuery.refetch()} style={styles.refreshBtn}>
          {extensionsQuery.isFetching ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <IconSymbol name="arrow.clockwise" size={18} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderExtension}
        ListHeaderComponent={
          <View>
            <View style={[styles.provisionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Create test extension</Text>
              <Text style={[styles.cardSub, { color: colors.muted }]}> 
                The iPhone app will receive SIP server, username, password, TLS, SRTP, and STUN from admin provisioning.
              </Text>

              <View style={styles.inputRow}>
                <View style={styles.inputCol}>
                  <Text style={[styles.inputLabel, { color: colors.muted }]}>Extension</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={extension}
                    onChangeText={setExtension}
                    keyboardType="number-pad"
                    placeholder="1020"
                    placeholderTextColor={colors.muted}
                  />
                </View>
                <View style={styles.inputCol}>
                  <Text style={[styles.inputLabel, { color: colors.muted }]}>User ID</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={userId}
                    onChangeText={setUserId}
                    keyboardType="number-pad"
                    placeholder="Phone11 user ID"
                    placeholderTextColor={colors.muted}
                  />
                </View>
              </View>

              <Text style={[styles.inputLabel, { color: colors.muted }]}>Display name</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Phone11 Test User"
                placeholderTextColor={colors.muted}
              />

              <TouchableOpacity
                style={[styles.createBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
                onPress={handleCreate}
                disabled={busy}
              >
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <IconSymbol name="plus" size={18} color="#fff" />}
                <Text style={styles.createText}>Create and provision</Text>
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summary} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {[
                { label: "Total", count: rows.length, color: colors.primary },
                { label: "Assigned", count: rows.filter((row) => row.assigned_user_id || row.user_id).length, color: "#00C896" },
                { label: "Open", count: rows.filter((row) => !row.assigned_user_id && !row.user_id).length, color: "#FF9500" },
              ].map((item) => (
                <View key={item.label} style={[styles.summaryChip, { borderColor: item.color + "40" }]}>
                  <View style={[styles.summaryDot, { backgroundColor: item.color }]} />
                  <Text style={[styles.summaryText, { color: colors.foreground }]}>{item.count} {item.label}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
              <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
              <TextInput
                style={[styles.searchInput, { color: colors.foreground }]}
                placeholder="Search extension, name, or user ID"
                placeholderTextColor={colors.muted}
                value={search}
                onChangeText={setSearch}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {extensionsQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.emptyText, { color: colors.muted }]}>No extensions found.</Text>
            )}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "700", flex: 1 },
  refreshBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  provisionCard: { margin: 16, padding: 16, borderRadius: 14, borderWidth: 1, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardSub: { fontSize: 12, lineHeight: 18 },
  inputRow: { flexDirection: "row", gap: 10 },
  inputCol: { flex: 1, gap: 6 },
  inputLabel: { fontSize: 12, fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: 4 },
  createText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  summary: { maxHeight: 40 },
  summaryChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, gap: 6 },
  summaryDot: { width: 6, height: 6, borderRadius: 3 },
  summaryText: { fontSize: 12, fontWeight: "600" },
  searchBar: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 12, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 0.5, gap: 8 },
  searchInput: { flex: 1, fontSize: 15 },
  extCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 16, marginTop: 8, padding: 14, borderRadius: 14, borderWidth: 0.5, gap: 12 },
  extLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 12 },
  extIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  extText: { flex: 1, gap: 2 },
  extNumber: { fontSize: 16, fontWeight: "800" },
  extName: { fontSize: 14, fontWeight: "600" },
  extMeta: { fontSize: 11 },
  extRight: { alignItems: "flex-end", gap: 6 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: "800" },
  assignBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  assignText: { fontSize: 12, fontWeight: "700" },
  emptyState: { padding: 28, alignItems: "center" },
  emptyText: { fontSize: 14 },
});