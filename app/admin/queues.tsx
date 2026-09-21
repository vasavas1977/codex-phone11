/**
 * Call Queue Management — Admin Portal
 * Create, edit, and manage call queues with agent login/logout.
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
  useCallQueue,
  useCallQueues,
  useCreateCallQueue,
  useDeleteCallQueue,
  useExtensions,
  useIvrMenus,
  usePbxCapabilities,
  useSetQueueAgents,
  useTenant,
  useUpdateCallQueue,
} from "@/hooks/use-pbx-admin";
import { normalizeQueueAgent, validateQueueAgents, type QueueAgentDraft } from "@/lib/pbx/queue-agents";

export default function AdminQueues() {
  const colors = useColors();
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id ?? 0;
  const capabilitiesQuery = usePbxCapabilities(tenantQuery.isSuccess);
  const queuesAvailable = capabilitiesQuery.data?.queues === true;
  const queuesQuery = useCallQueues(tenantId, queuesAvailable);
  const createMutation = useCreateCallQueue();
  const deleteMutation = useDeleteCallQueue();
  const updateMutation = useUpdateCallQueue();
  const [editingQueueId, setEditingQueueId] = useState<number | null>(null);
  const [editingSettingsId, setEditingSettingsId] = useState<number | null>(null);
  const queueDetailQuery = useCallQueue(
    editingQueueId ?? editingSettingsId ?? 0,
    queuesAvailable,
  );
  const extensionsQuery = useExtensions(
    1,
    100,
    queuesAvailable &&
      (editingQueueId !== null || editingSettingsId !== null) &&
      tenantId > 0,
  );
  const ivrMenusQuery = useIvrMenus(
    tenantId,
    queuesAvailable && capabilitiesQuery.data?.ivr === true,
  );
  const agentsMutation = useSetQueueAgents();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExt, setNewExt] = useState("");
  const [newMaxWait, setNewMaxWait] = useState("300");
  const [draftAgents, setDraftAgents] = useState<QueueAgentDraft[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const initializedEditor = useRef<number | null>(null);
  const [settingsName, setSettingsName] = useState("");
  const [settingsExtension, setSettingsExtension] = useState("");
  const [settingsMaxWait, setSettingsMaxWait] = useState("300");
  const [settingsAnnouncePosition, setSettingsAnnouncePosition] = useState(true);
  const [settingsOverflowAction, setSettingsOverflowAction] = useState<"voicemail" | "transfer" | "ivr" | "hangup">("hangup");
  const [settingsOverflowTarget, setSettingsOverflowTarget] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null);
  const initializedSettings = useRef<number | null>(null);

  const queues = queuesQuery.data || [];
  const extensionRows = (extensionsQuery.data?.data || []) as Array<{
    id?: number | string;
    extension_number?: string | null;
    display_name?: string | null;
    status?: string | null;
    deleted_at?: string | null;
    type?: string | null;
    user_id?: number | string | null;
    voicemail_enabled?: boolean;
    sip_status?: string | null;
    sip_username?: string | null;
    sip_domain?: string | null;
  }>;
  const availableExtensions = useMemo(() => {
    const selected = new Set(draftAgents.map((agent) => agent.extensionId));
    return extensionRows.filter((extension) =>
      Number.isSafeInteger(Number(extension.id)) &&
      extension.extension_number &&
      extension.status === "active" &&
      !extension.deleted_at &&
      extension.type === "user" && extension.user_id && extension.sip_status === "active" && extension.sip_username && extension.sip_domain &&
      !selected.has(Number(extension.id)),
    );
  }, [draftAgents, extensionRows]);
  const activeExtensions = useMemo(() => extensionRows.filter((extension) =>
    Number.isSafeInteger(Number(extension.id)) && extension.extension_number && extension.status === "active" && !extension.deleted_at,
  ), [extensionRows]);
  const callableExtensions = useMemo(() => activeExtensions.filter((extension) => extension.type === "user" && extension.user_id && extension.sip_status === "active" && extension.sip_username && extension.sip_domain), [activeExtensions]);
  const voicemailExtensions = useMemo(() => callableExtensions.filter((extension) => extension.voicemail_enabled), [callableExtensions]);

  useEffect(() => {
    if (
      editingQueueId === null ||
      initializedEditor.current === editingQueueId ||
      Number(queueDetailQuery.data?.id) !== editingQueueId
    ) return;
    setDraftAgents((queueDetailQuery.data.agents || []).map(normalizeQueueAgent));
    initializedEditor.current = editingQueueId;
    setAgentsError(null);
  }, [editingQueueId, queueDetailQuery.data]);

  useEffect(() => {
    if (
      editingSettingsId === null ||
      initializedSettings.current === editingSettingsId ||
      Number(queueDetailQuery.data?.id) !== editingSettingsId
    ) return;
    const queue = queueDetailQuery.data;
    setSettingsName(String(queue.name || ""));
    setSettingsExtension(String(queue.extension || ""));
    setSettingsMaxWait(String(queue.max_wait_time ?? 300));
    setSettingsAnnouncePosition(Boolean(queue.announce_position));
    setSettingsOverflowAction(queue.overflow_action === "transfer" || queue.overflow_action === "ivr" || queue.overflow_action === "voicemail" ? queue.overflow_action : "hangup");
    setSettingsOverflowTarget(String(queue.overflow_target || ""));
    initializedSettings.current = editingSettingsId;
    setSettingsError(null);
    setSettingsWarning(null);
    setSettingsWarning(queue.strategy !== "ring_all" || queue.overflow_action === "callback" ? "This queue has legacy settings unsupported by the current FIFO runtime. Saving will normalize them to Ring All and a supported overflow route." : null);
  }, [editingSettingsId, queueDetailQuery.data]);

  const openAgents = (queueId: number) => {
    const normalizedQueueId = Number(queueId);
    if (!Number.isSafeInteger(normalizedQueueId) || normalizedQueueId < 1) {
      setAgentsError("This queue has an invalid identifier. Refresh and try again.");
      return;
    }
    setDraftAgents([]);
    setAgentsError(null);
    initializedEditor.current = null;
    setEditingSettingsId(null);
    setEditingQueueId(normalizedQueueId);
  };

  const closeAgents = (force = false) => {
    if (agentsMutation.isPending && !force) return;
    setEditingQueueId(null);
    setDraftAgents([]);
    setAgentsError(null);
    initializedEditor.current = null;
  };

  const openSettings = (queueId: number) => {
    const normalizedQueueId = Number(queueId);
    if (!Number.isSafeInteger(normalizedQueueId) || normalizedQueueId < 1) {
      setSettingsError("This queue has an invalid identifier. Refresh and try again.");
      return;
    }
    setSettingsError(null);
    setSettingsWarning(null);
    initializedSettings.current = null;
    setEditingQueueId(null);
    setEditingSettingsId(normalizedQueueId);
  };

  const closeSettings = (force = false) => {
    if (updateMutation.isPending && !force) return;
    setEditingSettingsId(null);
    setSettingsError(null);
    setSettingsWarning(null);
    initializedSettings.current = null;
  };

  const saveSettings = async () => {
    if (editingSettingsId === null) return;
    const maxWait = Number(settingsMaxWait);
    const extension = settingsExtension.trim();
    if (!settingsName.trim()) {
      setSettingsError("Queue name is required.");
      return;
    }
    if (extension && !/^\d{2,10}$/.test(extension)) {
      setSettingsError("Queue extension must be 2 to 10 digits.");
      return;
    }
    if (!Number.isSafeInteger(maxWait) || maxWait < 10 || maxWait > 3600) {
      setSettingsError("Max wait must be a whole number from 10 to 3,600 seconds.");
      return;
    }
    if (settingsOverflowAction !== "hangup" && !settingsOverflowTarget) {
      setSettingsError("Choose an overflow destination.");
      return;
    }
    if (settingsOverflowAction === "transfer" && !callableExtensions.some((row) => String(row.extension_number) === settingsOverflowTarget)) {
      setSettingsError("Choose an active callable workspace extension as the overflow destination.");
      return;
    }
    if (settingsOverflowAction === "voicemail" && !voicemailExtensions.some((row) => String(row.extension_number) === settingsOverflowTarget)) {
      setSettingsError("Choose an active voicemail-enabled extension as the overflow destination.");
      return;
    }
    if (settingsOverflowAction === "ivr" && !(ivrMenusQuery.data || []).some((menu: any) => String(menu.id) === settingsOverflowTarget)) {
      setSettingsError("Choose an active workspace IVR menu as the overflow destination.");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editingSettingsId,
        name: settingsName.trim(),
        extension: extension || null,
        strategy: "ring_all",
        max_wait_time: maxWait,
        announce_position: settingsAnnouncePosition,
        overflow_action: settingsOverflowAction,
        overflow_target: settingsOverflowAction === "hangup" ? undefined : settingsOverflowTarget,
      });
      closeSettings(true);
      void Promise.all([queueDetailQuery.refetch(), queuesQuery.refetch()]).catch(() => undefined);
    } catch (error: any) {
      setSettingsError(error?.message || "Queue settings could not be saved. Your changes are still here; try again.");
    }
  };

  const saveAgents = async () => {
    if (editingQueueId === null) return;
    const validationError = validateQueueAgents(draftAgents);
    if (validationError) {
      setAgentsError(validationError);
      return;
    }
    try {
      await agentsMutation.mutateAsync({
        queue_id: editingQueueId,
        agents: draftAgents.map((agent) => ({
          extension_id: agent.extensionId,
          priority: agent.priority,
          skills: agent.skills,
          max_no_answer: agent.maxNoAnswer,
          is_logged_in: agent.isLoggedIn,
        })),
      });
      closeAgents(true);
      void Promise.all([queueDetailQuery.refetch(), queuesQuery.refetch()]).catch(() => undefined);
    } catch (error: any) {
      setAgentsError(error?.message || "Agents could not be saved. Your changes are still here; try again.");
    }
  };

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
        strategy: "ring_all",
        overflow_action: "hangup",
        max_wait_time: parseInt(newMaxWait) || 300,
      });
      setShowCreate(false);
      setNewName("");
      setNewExt("");
      setNewMaxWait("300");
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

  const strategyLabel = (_s: string) => "Ring All";

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
            <Text style={[styles.statLabel, { color: colors.muted }]}>Enabled</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{item.total_agents || 0}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Total Agents</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{formatWait(item.max_wait_time)}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Max Wait</Text>
        </View>
      </View>

      <View style={[styles.cardActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.primary + "15" }]}
          onPress={() => openSettings(Number(item.id))}
          accessibilityLabel={`Edit queue settings for ${item.name}`}
        >
          <IconSymbol name="pencil" size={14} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#10B98115" }]}
          onPress={() => openAgents(Number(item.id))}
          accessibilityLabel={`Edit agents for ${item.name}`}
        >
          <IconSymbol name="person.badge.plus" size={14} color="#10B981" />
          <Text style={[styles.actionText, { color: "#10B981" }]}>Agents</Text>
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

  if (capabilitiesQuery.isLoading) {
    return (
      <UnavailableAdminScreen
        checking
        title="Call queues"
        description="Phone11 is checking whether call-queue management is available for this workspace."
      />
    );
  }

  if (!queuesAvailable) {
    return (
      <UnavailableAdminScreen
        title="Call queues"
        description="This feature is not available for your workspace yet. Phone11 will not load or change queues."
      />
    );
  }

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
          disabled={!tenantId}
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
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Agents Enabled</Text>
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
      ) : queuesQuery.isError ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn’t load call queues</Text>
          <TouchableOpacity onPress={() => queuesQuery.refetch()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
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

              <View>
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

      <Modal visible={editingSettingsId !== null} animationType="slide" transparent onRequestClose={() => closeSettings()}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Queue settings</Text>
                <Text style={[styles.modalSubtitle, { color: colors.muted }]}>Settings applied by the current FIFO runtime.</Text>
              </View>
              <TouchableOpacity onPress={() => closeSettings()} accessibilityLabel="Close queue settings"><IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} /></TouchableOpacity>
            </View>
            {queueDetailQuery.isLoading ? (
              <View style={styles.emptyState}><ActivityIndicator size="small" color={colors.primary} /><Text style={[styles.loadingText, { color: colors.muted }]}>Loading queue settings…</Text></View>
            ) : queueDetailQuery.isError ? (
              <View style={styles.emptyState}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn’t load settings</Text><TouchableOpacity onPress={() => queueDetailQuery.refetch()}><Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View>
            ) : (
              <>
                <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>Queue name</Text>
                  <TextInput accessibilityLabel="Queue name" editable={!updateMutation.isPending} value={settingsName} onChangeText={setSettingsName} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>Extension (2–10 digits)</Text>
                  <TextInput accessibilityLabel="Queue extension" editable={!updateMutation.isPending} keyboardType="number-pad" value={settingsExtension} onChangeText={(value) => setSettingsExtension(value.replace(/[^0-9]/g, ""))} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>Max wait (seconds)</Text>
                  <TextInput accessibilityLabel="Maximum queue wait" editable={!updateMutation.isPending} keyboardType="number-pad" value={settingsMaxWait} onChangeText={(value) => setSettingsMaxWait(value.replace(/[^0-9]/g, ""))} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
                  <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: settingsAnnouncePosition, disabled: updateMutation.isPending }} disabled={updateMutation.isPending} onPress={() => setSettingsAnnouncePosition((value) => !value)} style={styles.toggleRow}>
                    <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Announce queue position</Text>
                    <Text style={[styles.toggleValue, { color: settingsAnnouncePosition ? "#10B981" : colors.muted }]}>{settingsAnnouncePosition ? "On" : "Off"}</Text>
                  </TouchableOpacity>
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>Overflow route</Text>
                  <View style={styles.routeChoices}>
                    {(["hangup", "voicemail", "transfer", "ivr"] as const).map((action) => (
                      <TouchableOpacity key={action} disabled={updateMutation.isPending} onPress={() => { setSettingsOverflowAction(action); setSettingsOverflowTarget(""); }} style={[styles.routeChoice, { borderColor: settingsOverflowAction === action ? "#F59E0B" : colors.border, backgroundColor: settingsOverflowAction === action ? "#F59E0B10" : colors.background }]} accessibilityRole="radio" accessibilityState={{ selected: settingsOverflowAction === action }}>
                        <Text style={[styles.routeChoiceText, { color: settingsOverflowAction === action ? "#F59E0B" : colors.foreground }]}>{action === "hangup" ? "Hang up" : action === "ivr" ? "IVR menu" : action[0].toUpperCase() + action.slice(1)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {settingsOverflowAction !== "hangup" ? (
                    <>
                      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Choose overflow destination</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.extensionChoices}>
                        {settingsOverflowAction === "ivr" ? (ivrMenusQuery.data || []).filter((menu: any) => menu.is_active === true).map((menu: any) => (
                          <TouchableOpacity key={String(menu.id)} disabled={updateMutation.isPending} onPress={() => setSettingsOverflowTarget(String(menu.id))} style={[styles.extensionChoice, { borderColor: settingsOverflowTarget === String(menu.id) ? "#F59E0B" : colors.border, backgroundColor: settingsOverflowTarget === String(menu.id) ? "#F59E0B10" : colors.background }]} accessibilityLabel={"Use IVR menu " + String(menu.name)}><Text style={[styles.extensionChoiceText, { color: settingsOverflowTarget === String(menu.id) ? "#F59E0B" : colors.foreground }]}>{String(menu.name || "IVR menu")}</Text></TouchableOpacity>
                        )) : (settingsOverflowAction === "voicemail" ? voicemailExtensions : callableExtensions).map((extension) => (
                          <TouchableOpacity key={String(extension.id)} disabled={updateMutation.isPending} onPress={() => setSettingsOverflowTarget(String(extension.extension_number))} style={[styles.extensionChoice, { borderColor: settingsOverflowTarget === String(extension.extension_number) ? "#F59E0B" : colors.border, backgroundColor: settingsOverflowTarget === String(extension.extension_number) ? "#F59E0B10" : colors.background }]} accessibilityLabel={"Use extension " + String(extension.extension_number)}><Text style={[styles.extensionChoiceText, { color: settingsOverflowTarget === String(extension.extension_number) ? "#F59E0B" : colors.foreground }]}>{String(extension.extension_number) + (extension.display_name ? " · " + extension.display_name : "")}</Text></TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  ) : null}
                  {settingsWarning ? <Text accessibilityRole="alert" style={[styles.editorWarning, { color: "#F59E0B" }]}>{settingsWarning}</Text> : null}
                  {settingsError ? <Text accessibilityRole="alert" style={[styles.editorError, { color: colors.error }]}>{settingsError}</Text> : null}
                </ScrollView>
                <View style={styles.modalFooter}><TouchableOpacity style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={() => closeSettings()}><Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text></TouchableOpacity><TouchableOpacity style={[styles.createBtn, { backgroundColor: "#F59E0B", opacity: updateMutation.isPending ? 0.65 : 1 }]} onPress={saveSettings} disabled={updateMutation.isPending}><Text style={styles.createText}>{updateMutation.isPending ? "Saving…" : "Save settings"}</Text></TouchableOpacity></View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={editingQueueId !== null} animationType="slide" transparent onRequestClose={() => closeAgents()}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Queue agents</Text>
                <Text style={[styles.modalSubtitle, { color: colors.muted }]}>Assigned extensions are enabled immediately for calls.</Text>
              </View>
              <TouchableOpacity onPress={() => closeAgents()} accessibilityLabel="Close queue agents">
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>
            {queueDetailQuery.isLoading ? (
              <View style={styles.emptyState}><ActivityIndicator size="small" color={colors.primary} /><Text style={[styles.loadingText, { color: colors.muted }]}>Loading agents…</Text></View>
            ) : queueDetailQuery.isError ? (
              <View style={styles.emptyState}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn’t load agents</Text><TouchableOpacity onPress={() => queueDetailQuery.refetch()}><Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View>
            ) : (
              <>
                <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
                  {draftAgents.map((agent, index) => {
                    const extension = extensionRows.find((row) => Number(row.id) === agent.extensionId);
                    return (
                      <View key={String(agent.extensionId)} style={[styles.agentCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                        <View style={styles.agentHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.agentName, { color: colors.foreground }]}>{extension?.display_name || "Extension " + String(extension?.extension_number || agent.extensionId)}</Text>
                            <Text style={[styles.agentNumber, { color: colors.muted }]}>{extension?.extension_number || "ID " + String(agent.extensionId)}</Text>
                          </View>
                          <TouchableOpacity disabled={agentsMutation.isPending} onPress={() => setDraftAgents((current) => current.filter((_, i) => i !== index))} accessibilityLabel={"Remove queue agent " + String(index + 1)}>
                            <Text style={[styles.removeText, { color: colors.error }]}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          accessibilityRole="switch"
                          accessibilityState={{ checked: agent.isLoggedIn, disabled: agentsMutation.isPending }}
                          disabled={agentsMutation.isPending}
                          onPress={() => setDraftAgents((current) => current.map((item, i) => i === index ? { ...item, isLoggedIn: !item.isLoggedIn } : item))}
                          style={styles.toggleRow}
                        >
                          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Enabled for calls</Text>
                          <Text style={[styles.toggleValue, { color: agent.isLoggedIn ? "#10B981" : colors.muted }]}>{agent.isLoggedIn ? "On" : "Off"}</Text>
                        </TouchableOpacity>
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
                            disabled={agentsMutation.isPending}
                            onPress={() => setDraftAgents((current) => [...current, { extensionId: Number(extension.id), priority: current.length + 1, skills: [], maxNoAnswer: 3, isLoggedIn: true }])}
                            style={[styles.extensionChoice, { borderColor: "#F59E0B", backgroundColor: "#F59E0B10" }]}
                            accessibilityLabel={"Add extension " + String(extension.extension_number)}
                          >
                            <Text style={[styles.extensionChoiceText, { color: "#F59E0B" }]}>{String(extension.extension_number) + (extension.display_name ? " · " + extension.display_name : "")}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  ) : (
                    <Text style={[styles.note, { color: colors.muted }]}>{draftAgents.length ? "All active workspace extensions are already agents." : "No active workspace extensions are available."}</Text>
                  )}
                  {agentsError ? <Text accessibilityRole="alert" style={[styles.editorError, { color: colors.error }]}>{agentsError}</Text> : null}
                </ScrollView>
                <View style={styles.modalFooter}>
                  <TouchableOpacity style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={() => closeAgents()}><Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.createBtn, { backgroundColor: "#F59E0B", opacity: agentsMutation.isPending ? 0.65 : 1 }]} onPress={saveAgents} disabled={agentsMutation.isPending}><Text style={styles.createText}>{agentsMutation.isPending ? "Saving…" : "Save agents"}</Text></TouchableOpacity>
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
  modalSubtitle: { fontSize: 12, marginTop: 3 },
  modalBody: { padding: 16 },
  fieldLabel: { fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  row: { flexDirection: "row", gap: 12 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  toggleLabel: { fontSize: 14, fontWeight: "600" },
  toggleValue: { fontSize: 13, fontWeight: "700" },
  routeChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  routeChoice: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  routeChoiceText: { fontSize: 12, fontWeight: "600" },
  modalFooter: { flexDirection: "row", padding: 16, gap: 12 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelText: { fontSize: 15, fontWeight: "600" },
  createBtn: { flex: 2, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  createText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  agentCard: { borderWidth: 0.5, borderRadius: 12, padding: 12, marginBottom: 10, gap: 4 },
  agentHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  agentName: { fontSize: 15, fontWeight: "600" },
  agentNumber: { fontSize: 12, marginTop: 2 },
  removeText: { fontSize: 12, fontWeight: "600" },
  extensionChoices: { gap: 8, paddingVertical: 2 },
  extensionChoice: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  extensionChoiceText: { fontSize: 12, fontWeight: "600" },
  note: { fontSize: 12, lineHeight: 18 },
  editorWarning: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  editorError: { fontSize: 13, lineHeight: 19, marginTop: 4 },
});
