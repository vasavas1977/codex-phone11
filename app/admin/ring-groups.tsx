/**
 * Ring Groups Management — Admin Portal
 * Create, edit, and manage ring groups with member assignment.
 * Phone11 Cloud PBX — Milestone 7
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView, Text, View, TouchableOpacity, StyleSheet, FlatList,
  Alert, TextInput, Modal, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { UnavailableAdminScreen } from "@/components/admin/unavailable-admin-screen";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import {
  useCreateRingGroup,
  usePbxCapabilities,
  useDeleteRingGroup,
  useExtensions,
  useRingGroup,
  useRingGroups,
  useSetRingGroupMembers,
  useTenant,
  useUpdateRingGroup,
} from "@/hooks/use-pbx-admin";
import {
  normalizeRingGroupMember,
  validateRingGroupMembers,
  type RingGroupMemberDraft,
} from "@/lib/pbx/ring-group-members";

const STRATEGIES = [
  { value: "simultaneous", label: "Ring All", desc: "Ring all members at once" },
  { value: "sequential", label: "Sequential", desc: "Ring members in order" },
] as const;

type RingStrategy = (typeof STRATEGIES)[number]["value"];
const FALLBACKS = [
  { value: "hangup", label: "End call" },
  { value: "voicemail", label: "Voicemail" },
  { value: "transfer", label: "Extension" },
  { value: "ivr", label: "IVR" },
] as const;
type FallbackAction = (typeof FALLBACKS)[number]["value"];

function isSupportedStrategy(value: string): value is RingStrategy {
  return STRATEGIES.some((strategy) => strategy.value === value);
}

function asFallbackAction(value: unknown): FallbackAction {
  return FALLBACKS.some((fallback) => fallback.value === value)
    ? (value as FallbackAction)
    : "hangup";
}

export default function AdminRingGroups() {
  const colors = useColors();
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id ?? 0;
  const capabilitiesQuery = usePbxCapabilities(tenantQuery.isSuccess);
  const ringGroupsAvailable = capabilitiesQuery.data?.ringGroups === true;
  const ringGroupsQuery = useRingGroups(tenantId, ringGroupsAvailable);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const groupDetailQuery = useRingGroup(editingGroupId ?? 0, ringGroupsAvailable);
  const [editingSettingsId, setEditingSettingsId] = useState<number | null>(null);
  const settingsQuery = useRingGroup(editingSettingsId ?? 0, ringGroupsAvailable);
  const extensionsQuery = useExtensions(
    1,
    100,
    ringGroupsAvailable && editingGroupId !== null && tenantId > 0,
  );
  const createMutation = useCreateRingGroup();
  const updateMutation = useUpdateRingGroup();
  const deleteMutation = useDeleteRingGroup();
  const membersMutation = useSetRingGroupMembers();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExt, setNewExt] = useState("");
  const [newStrategy, setNewStrategy] = useState<RingStrategy>("simultaneous");
  const [newTimeout, setNewTimeout] = useState("25");
  const [newFallbackAction, setNewFallbackAction] = useState<FallbackAction>("hangup");
  const [newFallbackTarget, setNewFallbackTarget] = useState("");
  const [draftMembers, setDraftMembers] = useState<RingGroupMemberDraft[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const initializedEditor = useRef<number | null>(null);
  const initializedSettings = useRef<number | null>(null);

  const groups = ringGroupsQuery.data || [];
  const extensionRows = (extensionsQuery.data?.data || []) as Array<{
    id?: number | string;
    extension_number?: string | null;
    display_name?: string | null;
    status?: string | null;
    deleted_at?: string | null;
  }>;
  const availableExtensions = useMemo(() => {
    const selected = new Set(draftMembers.map((member) => member.extensionId));
    return extensionRows.filter((extension) =>
      Number.isSafeInteger(Number(extension.id)) &&
      extension.extension_number &&
      extension.status === "active" &&
      !extension.deleted_at &&
      !selected.has(Number(extension.id)),
    );
  }, [draftMembers, extensionRows]);

  useEffect(() => {
    if (
      editingGroupId === null ||
      initializedEditor.current === editingGroupId ||
      Number(groupDetailQuery.data?.id) !== editingGroupId
    ) return;
    setDraftMembers((groupDetailQuery.data.members || []).map(normalizeRingGroupMember));
    initializedEditor.current = editingGroupId;
    setMembersError(null);
  }, [editingGroupId, groupDetailQuery.data]);

  useEffect(() => {
    if (
      editingSettingsId === null ||
      initializedSettings.current === editingSettingsId ||
      Number(settingsQuery.data?.id) !== editingSettingsId
    ) return;
    const group = settingsQuery.data as any;
    setNewName(group.name || "");
    setNewExt(group.extension || "");
    setNewStrategy(isSupportedStrategy(String(group.strategy)) ? group.strategy : "simultaneous");
    setNewTimeout(String(group.ring_timeout || 25));
    setNewFallbackAction(asFallbackAction(group.fallback_action));
    setNewFallbackTarget(group.fallback_target || "");
    initializedSettings.current = editingSettingsId;
  }, [editingSettingsId, settingsQuery.data]);

  const openMembers = (groupId: number) => {
    const normalizedGroupId = Number(groupId);
    if (!Number.isSafeInteger(normalizedGroupId) || normalizedGroupId < 1) {
      setMembersError("This ring group has an invalid identifier. Refresh and try again.");
      return;
    }
    setDraftMembers([]);
    setMembersError(null);
    initializedEditor.current = null;
    setEditingGroupId(normalizedGroupId);
  };

  const closeMembers = () => {
    if (membersMutation.isPending) return;
    setEditingGroupId(null);
    setDraftMembers([]);
    setMembersError(null);
    initializedEditor.current = null;
  };

  const resetSettingsForm = () => {
    setNewName("");
    setNewExt("");
    setNewStrategy("simultaneous");
    setNewTimeout("25");
    setNewFallbackAction("hangup");
    setNewFallbackTarget("");
  };

  const closeSettings = () => {
    if (createMutation.isPending || updateMutation.isPending) return;
    setShowCreate(false);
    setEditingSettingsId(null);
    initializedSettings.current = null;
    resetSettingsForm();
  };

  const openCreate = () => {
    resetSettingsForm();
    setEditingSettingsId(null);
    setShowCreate(true);
  };

  const openSettings = (groupId: number) => {
    if (!Number.isSafeInteger(groupId) || groupId < 1) return;
    resetSettingsForm();
    initializedSettings.current = null;
    setEditingSettingsId(groupId);
  };

  const saveMembers = async () => {
    if (editingGroupId === null) return;
    const validationError = validateRingGroupMembers(draftMembers);
    if (validationError) {
      setMembersError(validationError);
      return;
    }
    try {
      await membersMutation.mutateAsync({
        ring_group_id: editingGroupId,
        members: draftMembers.map((member, index) => ({
          extension_id: member.extensionId,
          priority: member.priority,
          delay_seconds: member.delaySeconds,
          is_active: member.isActive,
        })),
      });
      closeMembers();
      void Promise.all([groupDetailQuery.refetch(), ringGroupsQuery.refetch()]).catch(() => undefined);
    } catch (error: any) {
      setMembersError(error?.message || "Members could not be saved. Your changes are still here; try again.");
    }
  };

  const handleSaveSettings = async () => {
    if (!newName.trim()) {
      Alert.alert("Error", "Ring group name is required.");
      return;
    }
    try {
      const settings = {
        name: newName.trim(),
        extension: newExt.trim() || null,
        strategy: newStrategy,
        ring_timeout: parseInt(newTimeout) || 25,
        fallback_action: newFallbackAction,
        fallback_target: newFallbackAction === "hangup" ? undefined : newFallbackTarget.trim(),
      };
      if (editingSettingsId !== null) {
        await updateMutation.mutateAsync({ id: editingSettingsId, ...settings });
      } else {
        await createMutation.mutateAsync({ tenant_id: tenantId, ...settings });
      }
      closeSettings();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save ring group");
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

  const strategyLabel = (strategy: string) =>
    STRATEGIES.find((item) => item.value === strategy)?.label || `Legacy: ${strategy}`;

  const renderGroup = ({ item }: { item: any }) => {
    const supportedStrategy = isSupportedStrategy(String(item.strategy));
    return (
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
          {!supportedStrategy ? (
            <Text style={styles.legacyWarning}>
              Legacy strategy is not supported by the current call runtime.
            </Text>
          ) : null}
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
          <Text style={[styles.statValue, { color: colors.foreground }]}>{item.fallback_action || "hangup"}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Fallback</Text>
        </View>
      </View>

      <View style={[styles.cardActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.primary + "15" }]}
          onPress={() => openSettings(Number(item.id))}
          accessibilityLabel={`Edit ${item.name}`}
        >
          <IconSymbol name="pencil" size={14} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#10B98115" }]}
          onPress={() => openMembers(Number(item.id))}
          accessibilityLabel={`Edit members for ${item.name}`}
        >
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
  };

  if (capabilitiesQuery.isLoading) {
    return (
      <UnavailableAdminScreen
        checking
        title="Ring groups"
        description="Phone11 is checking whether ring-group management is available for this workspace."
      />
    );
  }

  if (!ringGroupsAvailable) {
    return (
      <UnavailableAdminScreen
        title="Ring groups"
        description="This feature is not available for your workspace yet. Phone11 will not load or change ring groups."
      />
    );
  }

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Ring Groups</Text>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={openCreate}
          disabled={!tenantId}
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
      ) : ringGroupsQuery.isError ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn’t load ring groups</Text>
          <TouchableOpacity onPress={() => ringGroupsQuery.refetch()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
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
            onPress={openCreate}
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

      <Modal
        visible={showCreate || editingSettingsId !== null}
        animationType="slide"
        transparent
        onRequestClose={closeSettings}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {editingSettingsId === null ? "New Ring Group" : "Edit Ring Group"}
              </Text>
              <TouchableOpacity onPress={closeSettings}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>

            {editingSettingsId !== null && settingsQuery.isLoading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : editingSettingsId !== null && settingsQuery.isError ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn’t load this ring group</Text>
                <TouchableOpacity onPress={() => settingsQuery.refetch()}>
                  <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              {editingSettingsId !== null && !isSupportedStrategy(String(settingsQuery.data?.strategy)) ? (
                <Text style={styles.legacyWarning}>
                  This legacy strategy is unsupported. Save Ring All or Sequential to repair it.
                </Text>
              ) : null}
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

              <Text style={[styles.fieldLabel, { color: colors.muted }]}>When no one answers</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fallbackChoices}>
                {FALLBACKS.map((fallback) => (
                  <TouchableOpacity
                    key={fallback.value}
                    style={[
                      styles.fallbackChoice,
                      { borderColor: newFallbackAction === fallback.value ? colors.primary : colors.border },
                      newFallbackAction === fallback.value && { backgroundColor: colors.primary + "10" },
                    ]}
                    onPress={() => setNewFallbackAction(fallback.value)}
                  >
                    <Text style={{ color: newFallbackAction === fallback.value ? colors.primary : colors.foreground }}>
                      {fallback.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {newFallbackAction !== "hangup" ? (
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, marginTop: 8 }]}
                  value={newFallbackTarget}
                  onChangeText={setNewFallbackTarget}
                  placeholder={newFallbackAction === "ivr" ? "IVR menu ID" : "Extension number"}
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                />
              ) : null}

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
            )}

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={closeSettings}
              >
                <Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, { backgroundColor: colors.primary }]}
                onPress={handleSaveSettings}
                disabled={
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  (editingSettingsId !== null && (settingsQuery.isLoading || settingsQuery.isError))
                }
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.createText}>
                    {editingSettingsId === null ? "Create" : "Save changes"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editingGroupId !== null} animationType="slide" transparent onRequestClose={closeMembers}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Ring group members</Text>
                <Text style={[styles.modalSubtitle, { color: colors.muted }]}>Choose active workspace extensions and set their order.</Text>
              </View>
              <TouchableOpacity onPress={closeMembers} accessibilityLabel="Close ring group members">
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>
            {groupDetailQuery.isLoading ? (
              <View style={styles.emptyState}><ActivityIndicator size="small" color={colors.primary} /><Text style={[styles.loadingText, { color: colors.muted }]}>Loading members…</Text></View>
            ) : groupDetailQuery.isError ? (
              <View style={styles.emptyState}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn’t load members</Text><TouchableOpacity onPress={() => groupDetailQuery.refetch()}><Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View>
            ) : (
              <>
                <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
                  {draftMembers.map((member, index) => {
                    const extension = extensionRows.find((row) => Number(row.id) === member.extensionId);
                    return (
                      <View key={String(member.extensionId)} style={[styles.memberCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                        <View style={styles.memberHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.memberName, { color: colors.foreground }]}>{extension?.display_name || "Extension " + String(extension?.extension_number || member.extensionId)}</Text>
                            <Text style={[styles.memberNumber, { color: colors.muted }]}>{extension?.extension_number || "ID " + String(member.extensionId)}</Text>
                          </View>
                          <TouchableOpacity disabled={membersMutation.isPending} onPress={() => setDraftMembers((current) => current.filter((_, i) => i !== index))} accessibilityLabel={"Remove ring group member " + String(index + 1)}>
                            <Text style={[styles.removeText, { color: colors.error }]}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.memberFields}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Priority</Text>
                            <TextInput
                              accessibilityLabel={"Priority for member " + String(index + 1)}
                              editable={!membersMutation.isPending}
                              keyboardType="number-pad"
                              value={String(member.priority)}
                              onChangeText={(value) => setDraftMembers((current) => current.map((item, i) => i === index ? { ...item, priority: Number(value.replace(/[^0-9]/g, "")) } : item))}
                              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {availableExtensions.length > 0 ? (
                    <>
                      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Add workspace extension</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.extensionChoices}>
                        {availableExtensions.map((extension) => (
                          <TouchableOpacity
                            key={String(extension.id)}
                            disabled={membersMutation.isPending}
                            onPress={() => setDraftMembers((current) => [...current, { extensionId: Number(extension.id), priority: current.length + 1, delaySeconds: 0, isActive: true }])}
                            style={[styles.extensionChoice, { borderColor: colors.primary, backgroundColor: colors.primary + "10" }]}
                            accessibilityLabel={"Add extension " + String(extension.extension_number)}
                          >
                            <Text style={[styles.extensionChoiceText, { color: colors.primary }]}>{String(extension.extension_number) + (extension.display_name ? " · " + extension.display_name : "")}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  ) : (
                    <Text style={[styles.note, { color: colors.muted }]}>{draftMembers.length ? "All active workspace extensions are already members." : "No active workspace extensions are available."}</Text>
                  )}
                  {membersError ? <Text accessibilityRole="alert" style={[styles.editorError, { color: colors.error }]}>{membersError}</Text> : null}
                </ScrollView>
                <View style={styles.modalFooter}>
                  <TouchableOpacity style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={closeMembers}><Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.createBtn, { backgroundColor: colors.primary, opacity: membersMutation.isPending ? 0.65 : 1 }]} onPress={saveMembers} disabled={membersMutation.isPending}><Text style={styles.createText}>{membersMutation.isPending ? "Saving…" : "Save members"}</Text></TouchableOpacity>
                </View>
              </>
            )}
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
  retryText: { fontSize: 14, fontWeight: "600", padding: 8 },
  card: { borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  cardIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardName: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  legacyWarning: { color: "#D97706", fontSize: 11, fontWeight: "600", marginTop: 5 },
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
  modalSubtitle: { fontSize: 12, marginTop: 3 },
  modalBody: { padding: 16 },
  fieldLabel: { fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  strategyGrid: { gap: 8 },
  strategyOption: { borderWidth: 1, borderRadius: 10, padding: 12 },
  strategyLabel: { fontSize: 14, fontWeight: "600" },
  strategyDesc: { fontSize: 11, marginTop: 2 },
  fallbackChoices: { gap: 8, paddingVertical: 2 },
  fallbackChoice: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  modalFooter: { flexDirection: "row", padding: 16, gap: 12 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelText: { fontSize: 15, fontWeight: "600" },
  createBtn: { flex: 2, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  createText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  memberCard: { borderWidth: 0.5, borderRadius: 12, padding: 12, marginBottom: 10, gap: 4 },
  memberHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  memberName: { fontSize: 15, fontWeight: "600" },
  memberNumber: { fontSize: 12, marginTop: 2 },
  memberFields: { flexDirection: "row", gap: 10 },
  removeText: { fontSize: 12, fontWeight: "600" },
  extensionChoices: { gap: 8, paddingVertical: 2 },
  extensionChoice: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  extensionChoiceText: { fontSize: 12, fontWeight: "600" },
  note: { fontSize: 12, lineHeight: 18 },
  editorError: { fontSize: 13, lineHeight: 19, marginTop: 4 },
});
