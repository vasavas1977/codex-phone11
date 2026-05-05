/**
 * Ring Groups Management — Admin Portal
 * Create, edit, and manage ring groups with member assignment.
 * Phone11 Cloud PBX — Milestone 7
 */

import { useState, useCallback } from "react";
import {
  ScrollView, Text, View, TouchableOpacity, StyleSheet, FlatList,
  Alert, TextInput, Modal, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useRingGroups, useCreateRingGroup, useDeleteRingGroup, useTenant } from "@/hooks/use-pbx-admin";

const STRATEGIES = [
  { value: "simultaneous", label: "Ring All", desc: "Ring all members at once" },
  { value: "sequential", label: "Sequential", desc: "Ring members in order" },
  { value: "round_robin", label: "Round Robin", desc: "Rotate through members" },
  { value: "longest_idle", label: "Longest Idle", desc: "Ring least-recently-used" },
  { value: "random", label: "Random", desc: "Random member selection" },
];

export default function AdminRingGroups() {
  const colors = useColors();
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id || 1;
  const ringGroupsQuery = useRingGroups(tenantId);
  const createMutation = useCreateRingGroup();
  const deleteMutation = useDeleteRingGroup();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExt, setNewExt] = useState("");
  const [newStrategy, setNewStrategy] = useState("simultaneous");
  const [newTimeout, setNewTimeout] = useState("25");

  const groups = ringGroupsQuery.data || [];

  const handleCreate = async () => {
    if (!newName.trim()) {
      Alert.alert("Error", "Ring group name is required.");
      return;
    }
    try {
      await createMutation.mutateAsync({
        tenant_id: tenantId,
        name: newName.trim(),
        extension: newExt.trim() || undefined,
        strategy: newStrategy as any,
        ring_timeout: parseInt(newTimeout) || 25,
      });
      setShowCreate(false);
      setNewName("");
      setNewExt("");
      setNewStrategy("simultaneous");
      setNewTimeout("25");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to create ring group");
    }
  };

  const handleDelete = (id: number, name: string) => {
    Alert.alert(
      "Delete Ring Group",
      `Are you sure you want to delete "${name}"? This cannot be undone.`,
      [
        { text: "Cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteMutation.mutateAsync({ id });
          } catch (e: any) {
            Alert.alert("Error", e.message);
          }
        }},
      ]
    );
  };

  const strategyLabel = (s: string) => STRATEGIES.find(x => x.value === s)?.label || s;

  const renderGroup = ({ item }: { item: any }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: "#10B98115" }]}>
          <IconSymbol name="person.3.fill" size={20} color="#10B981" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardName, { color: colors.foreground }]}>{item.name}</Text>
          <Text style={[styles.cardSub, { color: colors.muted }]}>
            Ext: {item.extension || "—"} · {strategyLabel(item.strategy)}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: item.is_active ? "#10B98120" : "#6B728020" }]}>
          <Text style={[styles.badgeText, { color: item.is_active ? "#10B981" : "#6B7280" }]}>
            {item.is_active ? "ACTIVE" : "INACTIVE"}
          </Text>
        </View>
      </View>

      <View style={[styles.cardStats, { borderTopColor: colors.border }]}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{item.member_count || 0}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Members</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{item.ring_timeout}s</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Timeout</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{item.fallback_action || "voicemail"}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Fallback</Text>
        </View>
      </View>

      <View style={[styles.cardActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name="pencil" size={14} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#10B98115" }]}>
          <IconSymbol name="person.badge.plus" size={14} color="#10B981" />
          <Text style={[styles.actionText, { color: "#10B981" }]}>Members</Text>
        </TouchableOpacity>
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
        <Text style={[styles.title, { color: colors.foreground }]}>Ring Groups</Text>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setShowCreate(true)}
        >
          <IconSymbol name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <View style={[styles.summaryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>{groups.length}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Total Groups</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: "#10B981" }]}>
            {groups.filter((g: any) => g.is_active).length}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Active</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.primary }]}>
            {groups.reduce((s: number, g: any) => s + (parseInt(g.member_count) || 0), 0)}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Total Members</Text>
        </View>
      </View>

      {ringGroupsQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading ring groups...</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.emptyState}>
          <IconSymbol name="person.3.fill" size={48} color={colors.muted} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Ring Groups</Text>
          <Text style={[styles.emptyDesc, { color: colors.muted }]}>
            Create a ring group to route calls to multiple extensions simultaneously or sequentially.
          </Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
            onPress={() => setShowCreate(true)}
          >
            <Text style={styles.emptyBtnText}>Create Ring Group</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={renderGroup}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Ring Group</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Name *</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Sales Team"
                placeholderTextColor={colors.muted}
              />

              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Extension (dial code)</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={newExt}
                onChangeText={setNewExt}
                placeholder="e.g. 600"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
              />

              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Ring Strategy</Text>
              <View style={styles.strategyGrid}>
                {STRATEGIES.map(s => (
                  <TouchableOpacity
                    key={s.value}
                    style={[
                      styles.strategyOption,
                      { borderColor: newStrategy === s.value ? colors.primary : colors.border },
                      newStrategy === s.value && { backgroundColor: colors.primary + "10" },
                    ]}
                    onPress={() => setNewStrategy(s.value)}
                  >
                    <Text style={[styles.strategyLabel, { color: newStrategy === s.value ? colors.primary : colors.foreground }]}>
                      {s.label}
                    </Text>
                    <Text style={[styles.strategyDesc, { color: colors.muted }]}>{s.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Ring Timeout (seconds)</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={newTimeout}
                onChangeText={setNewTimeout}
                placeholder="25"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => setShowCreate(false)}
              >
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
                  <Text style={styles.createText}>Create</Text>
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
  loadingContainer: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 40, gap: 8 },
  loadingText: { fontSize: 13 },
  emptyState: { alignItems: "center", padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 8 },
  emptyDesc: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  emptyBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 8 },
  emptyBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  card: { borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  cardIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardName: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  cardStats: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5 },
  stat: { flex: 1 },
  statValue: { fontSize: 14, fontWeight: "600" },
  statLabel: { fontSize: 10, marginTop: 1 },
  cardActions: { flexDirection: "row", padding: 10, gap: 8, borderTopWidth: 0.5 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 8, gap: 4 },
  actionText: { fontSize: 12, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#333" },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  modalBody: { padding: 16 },
  fieldLabel: { fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  strategyGrid: { gap: 8 },
  strategyOption: { borderWidth: 1, borderRadius: 10, padding: 12 },
  strategyLabel: { fontSize: 14, fontWeight: "600" },
  strategyDesc: { fontSize: 11, marginTop: 2 },
  modalFooter: { flexDirection: "row", padding: 16, gap: 12 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelText: { fontSize: 15, fontWeight: "600" },
  createBtn: { flex: 2, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  createText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
