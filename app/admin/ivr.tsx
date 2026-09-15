/**
 * IVR Flow Management — Admin Portal
 * View, create, and manage IVR dial plans deployed on FreeSWITCH.
 */

import { useState } from "react";
import {
  ScrollView, Text, View, TouchableOpacity, StyleSheet, FlatList, Alert,
  TextInput, Modal, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useCreateIvrMenu, useDeleteIvrMenu, useIvrMenus, useTenant } from "@/hooks/use-pbx-admin";

const EXIT_ACTIONS = [
  { value: "voicemail", label: "Voicemail" },
  { value: "transfer", label: "Transfer" },
  { value: "hangup", label: "End call" },
] as const;

export default function AdminIVR() {
  const colors = useColors();
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id ?? 0;
  const menusQuery = useIvrMenus(tenantId);
  const createMutation = useCreateIvrMenu();
  const deleteMutation = useDeleteIvrMenu();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("");
  const [exitAction, setExitAction] = useState<(typeof EXIT_ACTIONS)[number]["value"]>("voicemail");
  const [exitTarget, setExitTarget] = useState("");
  const menus = menusQuery.data || [];

  const handleDelete = (id: number, menuName: string) => {
    Alert.alert(
      "Delete IVR Menu",
      `Calls assigned to "${menuName}" may stop routing.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteMutation.mutateAsync({ id });
          } catch (e: any) {
            Alert.alert("IVR not deleted", e.message || "Please try again.");
          }
        }},
      ]
    );
  };

  const handleCreate = async () => {
    if (!tenantId || !name.trim() || !greeting.trim()) {
      Alert.alert("Missing details", "Enter a menu name and greeting.");
      return;
    }
    if (exitAction !== "hangup" && !exitTarget.trim()) {
      Alert.alert("Missing destination", "Enter the extension or voicemail destination.");
      return;
    }
    try {
      await createMutation.mutateAsync({
        tenant_id: tenantId,
        name: name.trim(),
        greeting_tts: greeting.trim(),
        exit_action: exitAction,
        exit_target: exitAction === "hangup" ? undefined : exitTarget.trim(),
        is_active: true,
      });
      setShowCreate(false);
      setName("");
      setGreeting("");
      setExitAction("voicemail");
      setExitTarget("");
    } catch (e: any) {
      Alert.alert("IVR not created", e.message || "Please try again.");
    }
  };

  const renderFlow = ({ item }: { item: any }) => (
    <View
      style={[styles.flowCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.flowHeader}>
        <View style={[styles.flowIcon, { backgroundColor: "#8B5CF615" }]}>
          <IconSymbol name="rectangle.grid.3x2.fill" size={20} color="#8B5CF6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.flowName, { color: colors.foreground }]}>{item.name}</Text>
          <Text style={[styles.flowDesc, { color: colors.muted }]} numberOfLines={2}>
            {item.greeting_tts || item.description || "Audio greeting configured"}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: item.is_active ? "#00C89620" : "#9BA1A620" }]}>
          <Text style={[styles.statusText, { color: item.is_active ? "#00C896" : "#9BA1A6" }]}>
            {item.is_active ? "ACTIVE" : "INACTIVE"}
          </Text>
        </View>
      </View>

      <View style={[styles.flowStats, { borderTopColor: colors.border }]}>
        <View style={styles.flowStat}>
          <Text style={[styles.flowStatValue, { color: colors.foreground }]}>{Number(item.action_count) || 0}</Text>
          <Text style={[styles.flowStatLabel, { color: colors.muted }]}>Key Options</Text>
        </View>
        <View style={styles.flowStat}>
          <Text style={[styles.flowStatValue, { color: colors.foreground }]}>{Math.round((item.timeout_ms || 5000) / 1000)}s</Text>
          <Text style={[styles.flowStatLabel, { color: colors.muted }]}>Input Timeout</Text>
        </View>
        <View style={styles.flowStat}>
          <Text style={[styles.flowStatValue, { color: colors.foreground }]}>{item.exit_action || "hangup"}</Text>
          <Text style={[styles.flowStatLabel, { color: colors.muted }]}>No Response</Text>
        </View>
      </View>

      <View style={[styles.flowActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#EF444415" }]}
          onPress={() => handleDelete(item.id, item.name)}
        >
          <IconSymbol name="trash.fill" size={14} color="#EF4444" />
          <Text style={[styles.actionText, { color: "#EF4444" }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>IVR Menus</Text>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setShowCreate(true)}
          disabled={!tenantId}
        >
          <IconSymbol name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <View style={[styles.summaryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>{menus.length}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Total Menus</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: "#00C896" }]}>{menus.filter((menu: any) => menu.is_active).length}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Active</Text>
        </View>
      </View>

      {tenantQuery.isLoading || menusQuery.isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.muted }]}>Loading IVR menus...</Text>
        </View>
      ) : tenantQuery.isError || menusQuery.isError ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn’t load IVR menus</Text>
          <TouchableOpacity onPress={() => menusQuery.refetch()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : menus.length === 0 ? (
        <View style={styles.emptyState}>
          <IconSymbol name="rectangle.grid.3x2.fill" size={48} color={colors.muted} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No IVR Menus</Text>
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            Create a greeting and choose where calls go when nobody presses a key.
          </Text>
        </View>
      ) : (
        <FlatList
          data={menus}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={renderFlow}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          showsVerticalScrollIndicator={false}
          refreshing={menusQuery.isRefetching}
          onRefresh={menusQuery.refetch}
        />
      )}

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>New IVR Menu</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Name *</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={name}
                onChangeText={setName}
                placeholder="Main menu"
                placeholderTextColor={colors.muted}
              />
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Greeting *</Text>
              <TextInput
                style={[styles.input, styles.greetingInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={greeting}
                onChangeText={setGreeting}
                placeholder="Welcome. Press 1 for sales..."
                placeholderTextColor={colors.muted}
                multiline
              />
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>If there is no response</Text>
              <View style={styles.exitActions}>
                {EXIT_ACTIONS.map((action) => (
                  <TouchableOpacity
                    key={action.value}
                    style={[
                      styles.exitAction,
                      { borderColor: exitAction === action.value ? colors.primary : colors.border },
                      exitAction === action.value && { backgroundColor: colors.primary + "10" },
                    ]}
                    onPress={() => setExitAction(action.value)}
                  >
                    <Text style={[styles.exitActionText, { color: exitAction === action.value ? colors.primary : colors.foreground }]}>
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {exitAction !== "hangup" && (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>Destination *</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={exitTarget}
                    onChangeText={setExitTarget}
                    placeholder="Extension or voicemail number"
                    placeholderTextColor={colors.muted}
                    keyboardType="phone-pad"
                  />
                </>
              )}
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={() => setShowCreate(false)}>
                <Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, { backgroundColor: colors.primary }]}
                onPress={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.createText}>Create Menu</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  emptyState: { alignItems: "center", padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 8 },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  retryText: { fontSize: 14, fontWeight: "600", padding: 8 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#333" },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  modalBody: { padding: 16 },
  fieldLabel: { fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  greetingInput: { minHeight: 84, textAlignVertical: "top" },
  exitActions: { flexDirection: "row", gap: 8 },
  exitAction: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  exitActionText: { fontSize: 12, fontWeight: "600" },
  modalFooter: { flexDirection: "row", padding: 16, gap: 12 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelText: { fontSize: 15, fontWeight: "600" },
  createBtn: { flex: 2, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  createText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
