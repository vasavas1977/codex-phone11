/**
 * Call Queue Management — Admin Portal
 * Create, edit, and manage call queues with agent login/logout.
 * Phone11 Cloud PBX — Milestone 7
 */

import { useState } from "react";
import {
  ScrollView, Text, View, TouchableOpacity, StyleSheet, FlatList,
  Alert, TextInput, Modal, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useCallQueues, useCreateCallQueue, useDeleteCallQueue, useTenant } from "@/hooks/use-pbx-admin";

const QUEUE_STRATEGIES = [
  { value: "longest_idle", label: "Longest Idle", desc: "Agent idle the longest" },
  { value: "round_robin", label: "Round Robin", desc: "Rotate through agents" },
  { value: "ring_all", label: "Ring All", desc: "Ring all agents at once" },
  { value: "fewest_calls", label: "Fewest Calls", desc: "Agent with fewest calls" },
  { value: "random", label: "Random", desc: "Random agent selection" },
  { value: "top_down", label: "Top Down", desc: "Priority-based order" },
];

export default function AdminQueues() {
  const colors = useColors();
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id || 1;
  const queuesQuery = useCallQueues(tenantId);
  const createMutation = useCreateCallQueue();
  const deleteMutation = useDeleteCallQueue();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExt, setNewExt] = useState("");
  const [newStrategy, setNewStrategy] = useState("longest_idle");
  const [newMaxWait, setNewMaxWait] = useState("300");
  const [newMaxCallers, setNewMaxCallers] = useState("20");

  const queues = queuesQuery.data || [];

  const handleCreate = async () => {
    if (!newName.trim()) {
      Alert.alert("Error", "Queue name is required.");
      return;
    }
    try {
      await createMutation.mutateAsync({
        tenant_id: tenantId,
        name: newName.trim(),
        extension: newExt.trim() || undefined,
        strategy: newStrategy as any,
        max_wait_time: parseInt(newMaxWait) || 300,
        max_callers: parseInt(newMaxCallers) || 20,
      });
      setShowCreate(false);
      setNewName("");
      setNewExt("");
      setNewStrategy("longest_idle");
      setNewMaxWait("300");
      setNewMaxCallers("20");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to create queue");
    }
  };

  const handleDelete = (id: number, name: string) => {
    Alert.alert(
      "Delete Queue",
      `Are you sure you want to delete "${name}"? Active callers will be disconnected.`,
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

  const strategyLabel = (s: string) => QUEUE_STRATEGIES.find(x => x.value === s)?.label || s;

  const formatWait = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m`;
  };

  const renderQueue = ({ item }: { item: any }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: "#F59E0B15" }]}>
          <IconSymbol name="person.line.dotted.person.fill" size={20} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardName, { color: colors.foreground }]}>{item.name}</Text>
          <Text style={[styles.cardSub, { color: colors.muted }]}>
            Ext: {item.extension || "—"} · {strategyLabel(item.strategy)}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: item.is_active ? "#F59E0B20" : "#6B728020" }]}>
          <Text style={[styles.badgeText, { color: item.is_active ? "#F59E0B" : "#6B7280" }]}>
            {item.is_active ? "ACTIVE" : "PAUSED"}
          </Text>
        </View>
      </View>

      <View style={[styles.cardStats, { borderTopColor: colors.border }]}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: "#10B981" }]}>{item.agents_online || 0}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Online</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{item.total_agents || 0}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Total Agents</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{formatWait(item.max_wait_time)}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Max Wait</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{item.max_callers}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Max Callers</Text>
        </View>
      </View>

      <View style={[styles.cardActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name="pencil" size={14} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#10B98115" }]}>
          <IconSymbol name="person.badge.plus" size={14} color="#10B981" />
          <Text style={[styles.actionText, { color: "#10B981" }]}>Agents</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#06B6D415" }]}>
          <IconSymbol name="chart.bar.fill" size={14} color="#06B6D4" />
          <Text style={[styles.actionText, { color: "#06B6D4" }]}>Stats</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#EF444415" }]}
          onPress={() => handleDelete(item.id, item.name)}
        >
          <IconSymbol name="trash.fill" size={14} color="#EF4444" />
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
        <Text style={[styles.title, { color: colors.foreground }]}>Call Queues</Text>
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
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>{queues.length}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Total Queues</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: "#10B981" }]}>
            {queues.reduce((s: number, q: any) => s + (parseInt(q.agents_online) || 0), 0)}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Agents Online</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: "#F59E0B" }]}>
            {queues.reduce((s: number, q: any) => s + (parseInt(q.total_agents) || 0), 0)}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Total Agents</Text>
        </View>
      </View>

      {queuesQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading queues...</Text>
        </View>
      ) : queues.length === 0 ? (
        <View style={styles.emptyState}>
          <IconSymbol name="person.line.dotted.person.fill" size={48} color={colors.muted} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Call Queues</Text>
          <Text style={[styles.emptyDesc, { color: colors.muted }]}>
            Create a call queue to distribute incoming calls among agents with hold music and position announcements.
          </Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
            onPress={() => setShowCreate(true)}
          >
            <Text style={styles.emptyBtnText}>Create Queue</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={queues}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={renderQueue}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Call Queue</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Queue Name *</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Support Queue"
                placeholderTextColor={colors.muted}
              />

              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Extension (dial code)</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={newExt}
                onChangeText={setNewExt}
                placeholder="e.g. 800"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
              />

              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Distribution Strategy</Text>
              <View style={styles.strategyGrid}>
                {QUEUE_STRATEGIES.map(s => (
                  <TouchableOpacity
                    key={s.value}
                    style={[
                      styles.strategyOption,
                      { borderColor: newStrategy === s.value ? "#F59E0B" : colors.border },
                      newStrategy === s.value && { backgroundColor: "#F59E0B10" },
                    ]}
                    onPress={() => setNewStrategy(s.value)}
                  >
                    <Text style={[styles.strategyLabel, { color: newStrategy === s.value ? "#F59E0B" : colors.foreground }]}>
                      {s.label}
                    </Text>
                    <Text style={[styles.strategyDesc, { color: colors.muted }]}>{s.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>Max Wait (sec)</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={newMaxWait}
                    onChangeText={setNewMaxWait}
                    placeholder="300"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>Max Callers</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={newMaxCallers}
                    onChangeText={setNewMaxCallers}
                    placeholder="20"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => setShowCreate(false)}
              >
                <Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, { backgroundColor: "#F59E0B" }]}
                onPress={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.createText}>Create Queue</Text>
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
  cardActions: { flexDirection: "row", padding: 10, gap: 6, borderTopWidth: 0.5 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 8, gap: 4 },
  actionText: { fontSize: 11, fontWeight: "600" },
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
  row: { flexDirection: "row", gap: 12 },
  modalFooter: { flexDirection: "row", padding: 16, gap: 12 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelText: { fontSize: 15, fontWeight: "600" },
  createBtn: { flex: 2, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  createText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
