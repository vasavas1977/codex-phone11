import { useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { usePbxAdminWorkspace } from "@/hooks/use-pbx-admin";
import { trpc } from "@/lib/trpc";

type ExtensionRow = {
  id: number;
  extension_number?: string | null;
  display_name?: string | null;
  user_name?: string | null;
  user_id?: number | null;
  status?: string | null;
  type?: string | null;
  voicemail_enabled?: boolean;
};

export default function AdminVoicemail() {
  return (
    <AdminWorkspaceBoundary>
      <AdminVoicemailContent />
    </AdminWorkspaceBoundary>
  );
}

function AdminVoicemailContent() {
  const colors = useColors();
  const workspace = usePbxAdminWorkspace();
  const tenantId = workspace.selectedTenantId ?? 0;
  const [page, setPage] = useState(1);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const status = trpc.pbx.voicemail.storageStatus.useQuery(
    { tenantId },
    { enabled: tenantId > 0, staleTime: 0, gcTime: 0, refetchOnMount: "always" },
  );
  const extensions = trpc.pbx.extensions.list.useQuery(
    { tenantId, page, pageSize: 50, sortBy: "extension_number", sortOrder: "asc" },
    { enabled: tenantId > 0, staleTime: 0 },
  );
  const update = trpc.pbx.extensions.update.useMutation();
  const rows = (extensions.data?.data ?? []) as ExtensionRow[];

  const save = async (item: ExtensionRow, enabled: boolean) => {
    if (!tenantId || pendingId !== null) return;
    setPendingId(item.id);
    setSaveError(null);
    try {
      await update.mutateAsync({ id: item.id, tenantId, voicemailEnabled: enabled });
      await utils.pbx.extensions.list.invalidate();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Mailbox setting could not be saved.");
    } finally {
      setPendingId(null);
    }
  };

  const change = (item: ExtensionRow) => {
    const enable = item.voicemail_enabled !== true;
    if (!enable) {
      void save(item, false);
      return;
    }
    Alert.alert(
      "Enable voicemail mailbox?",
      "This enables the PBX mailbox. Inbox delivery still needs a completed-message relay and a real voicemail test.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Enable", onPress: () => void save(item, true) },
      ],
    );
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text style={[styles.back, { color: colors.primary }]}>‹ Admin portal</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Voicemail</Text>
        <Text style={[styles.intro, { color: colors.muted }]}>
          Manage personal mailboxes for this workspace. A message stays with its original owner when an extension is reassigned.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Storage checks</Text>
          {status.isLoading ? <ActivityIndicator color={colors.primary} /> : status.isError ? (
            <Text accessibilityRole="alert" style={{ color: colors.muted }}>
              Could not check voicemail storage. Try again before relying on the inbox.
            </Text>
          ) : (
            <>
              <Text style={{ color: colors.foreground }}>
                Inbox database: {status.data?.schemaReady ? "Available" : "Not configured"}
              </Text>
              <Text style={{ color: colors.foreground }}>
                Private audio directory: {status.data?.mediaDirectoryWritable ? "Writable" : "Not writable"}
              </Text>
              <Text style={[styles.note, { color: colors.muted }]}>
                These checks do not verify durable mounting or delivery from FreeSWITCH. A real voicemail deposit and playback test is still required.
              </Text>
            </>
          )}
          <Pressable accessibilityRole="button" onPress={() => void status.refetch()}>
            <Text style={[styles.action, { color: colors.primary }]}>Refresh checks</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Personal mailboxes</Text>
        {saveError ? <Text accessibilityRole="alert" style={{ color: "#B42318" }}>{saveError}</Text> : null}
        {extensions.isLoading ? <ActivityIndicator color={colors.primary} /> : extensions.isError ? (
          <Text accessibilityRole="alert" style={{ color: colors.muted }}>Could not load extensions.</Text>
        ) : rows.filter(item => item.type === "user").length === 0 ? (
          <Text style={{ color: colors.muted }}>No personal extensions on this page.</Text>
        ) : rows.filter(item => item.type === "user").map(item => {
          const eligible = item.status === "active" && Boolean(item.user_id);
          const busy = pendingId !== null;
          return (
            <View key={item.id} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={styles.rowText}>
                <Text style={[styles.number, { color: colors.foreground }]}>{item.extension_number || item.id}</Text>
                <Text style={{ color: colors.muted }}>{item.user_name || item.display_name || "Unassigned"}</Text>
                <Text style={[styles.note, { color: colors.muted }]}>
                  {item.voicemail_enabled ? "Mailbox enabled" : "Mailbox disabled"}
                  {!eligible ? " · Assign an active member to enable" : ""}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.voicemail_enabled ? "Disable" : "Enable"} voicemail for extension ${item.extension_number || item.id}`}
                accessibilityState={{ disabled: busy || (!eligible && !item.voicemail_enabled) }}
                disabled={busy || (!eligible && !item.voicemail_enabled)}
                onPress={() => change(item)}
                style={[styles.button, { borderColor: colors.primary, opacity: busy || (!eligible && !item.voicemail_enabled) ? 0.5 : 1 }]}
              >
                <Text style={{ color: colors.primary, fontWeight: "600" }}>
                  {pendingId === item.id ? "Saving…" : item.voicemail_enabled ? "Disable" : "Enable"}
                </Text>
              </Pressable>
            </View>
          );
        })}
        {extensions.data?.pagination && extensions.data.pagination.totalPages > 1 ? (
          <View style={styles.pages}>
            <Pressable accessibilityRole="button" disabled={!extensions.data.pagination.hasPrev} onPress={() => setPage(value => value - 1)}>
              <Text style={{ color: colors.primary }}>Previous</Text>
            </Pressable>
            <Text style={{ color: colors.muted }}>Page {page} of {extensions.data.pagination.totalPages}</Text>
            <Pressable accessibilityRole="button" disabled={!extensions.data.pagination.hasNext} onPress={() => setPage(value => value + 1)}>
              <Text style={{ color: colors.primary }}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  back: { fontSize: 14, fontWeight: "600" },
  title: { fontSize: 28, fontWeight: "700" },
  intro: { fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 9 },
  sectionTitle: { fontSize: 18, fontWeight: "700" },
  note: { fontSize: 12, lineHeight: 18 },
  action: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  row: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, gap: 3 },
  number: { fontSize: 17, fontWeight: "700" },
  button: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 9 },
  pages: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
});
