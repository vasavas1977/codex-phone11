import { useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
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
  const { width } = useWindowDimensions();
  const desktopWeb = Platform.OS === "web" && width >= 1000;
  const workspace = usePbxAdminWorkspace();
  const tenantId = workspace.selectedTenantId ?? 0;
  const [page, setPage] = useState(1);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const status = trpc.pbx.voicemail.storageStatus.useQuery(
    { tenantId },
    {
      enabled: tenantId > 0,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
    },
  );
  const extensions = trpc.pbx.extensions.list.useQuery(
    {
      tenantId,
      page,
      pageSize: 50,
      sortBy: "extension_number",
      sortOrder: "asc",
    },
    { enabled: tenantId > 0, staleTime: 0 },
  );
  const update = trpc.pbx.extensions.update.useMutation();
  const rows = (extensions.data?.data ?? []) as ExtensionRow[];
  const personalRows = rows.filter((item) => item.type === "user");

  const save = async (item: ExtensionRow, enabled: boolean) => {
    if (!tenantId || pendingId !== null) return;
    setPendingId(item.id);
    setSaveError(null);
    try {
      await update.mutateAsync({
        id: item.id,
        tenantId,
        voicemailEnabled: enabled,
      });
      await utils.pbx.extensions.list.invalidate();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Mailbox setting could not be saved.",
      );
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
      <ScrollView
        contentContainerStyle={[
          styles.content,
          desktopWeb && styles.contentDesktop,
        ]}
      >
        {!desktopWeb ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to workspace administration"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/admin")
            }
            style={styles.backButton}
          >
            <Text style={[styles.back, { color: colors.primary }]}>
              ‹ Admin portal
            </Text>
          </Pressable>
        ) : null}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground }]}
        >
          Voicemail administration
        </Text>
        <Text style={[styles.intro, { color: colors.muted }]}>
          Manage mailbox access for assigned extensions. Messages stay with
          their original owner if an extension is reassigned.
        </Text>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Storage checks
          </Text>
          {status.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : status.isError ? (
            <Text accessibilityRole="alert" style={{ color: colors.muted }}>
              Could not check voicemail storage. Try again before relying on the
              inbox.
            </Text>
          ) : (
            <>
              <Text style={{ color: colors.foreground }}>
                Inbox storage:{" "}
                {status.data?.schemaReady ? "Detected" : "Not configured"}
              </Text>
              <Text style={{ color: colors.foreground }}>
                Audio storage:{" "}
                {status.data?.mediaDirectoryWritable
                  ? "Writable at check time"
                  : "Not writable"}
              </Text>
              <Text style={[styles.note, { color: colors.muted }]}>
                These checks do not confirm message delivery or long-term storage.
                Leave a test voicemail and play it back to check the full flow.
              </Text>
            </>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => void status.refetch()}
          >
            <Text style={[styles.action, { color: colors.primary }]}>
              Refresh checks
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Personal mailboxes
        </Text>
        {saveError ? (
          <Text accessibilityRole="alert" style={{ color: "#B42318" }}>
            {saveError}
          </Text>
        ) : null}
        {extensions.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : extensions.isError ? (
          <Text accessibilityRole="alert" style={{ color: colors.muted }}>
            Could not load extensions.
          </Text>
        ) : personalRows.length === 0 ? (
          <Text style={{ color: colors.muted }}>
            No personal extensions on this page.
          </Text>
        ) : (
          <View
            style={[
              styles.mailboxList,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {desktopWeb ? (
              <View
                style={[
                  styles.tableHeader,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.numberColumn,
                    styles.tableLabel,
                    { color: colors.muted },
                  ]}
                >
                  EXTENSION
                </Text>
                <Text
                  style={[
                    styles.memberColumn,
                    styles.tableLabel,
                    { color: colors.muted },
                  ]}
                >
                  MEMBER
                </Text>
                <Text
                  style={[
                    styles.statusColumn,
                    styles.tableLabel,
                    { color: colors.muted },
                  ]}
                >
                  MAILBOX
                </Text>
                <Text
                  style={[
                    styles.actionColumn,
                    styles.tableLabel,
                    { color: colors.muted },
                  ]}
                >
                  ACTION
                </Text>
              </View>
            ) : null}
            {personalRows.map((item, index) => {
              const eligible =
                item.status === "active" && Boolean(item.user_id);
              const busy = pendingId !== null;
              return (
                <View
                  key={item.id}
                  style={[
                    styles.row,
                    index > 0 && {
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  {desktopWeb ? (
                    <>
                      <Text
                        style={[
                          styles.numberColumn,
                          styles.number,
                          { color: colors.foreground },
                        ]}
                      >
                        {item.extension_number || item.id}
                      </Text>
                      <Text
                        style={[
                          styles.memberColumn,
                          { color: colors.foreground },
                        ]}
                      >
                        {item.user_name || item.display_name || "Unassigned"}
                      </Text>
                      <View style={styles.statusColumn}>
                        <Text style={{ color: colors.foreground }}>
                          {item.voicemail_enabled ? "Enabled" : "Disabled"}
                        </Text>
                        {!eligible ? (
                          <Text style={[styles.note, { color: colors.muted }]}>
                            Assign an active member to enable
                          </Text>
                        ) : null}
                      </View>
                    </>
                  ) : (
                    <View style={styles.rowText}>
                      <Text
                        style={[styles.number, { color: colors.foreground }]}
                      >
                        {item.extension_number || item.id}
                      </Text>
                      <Text style={{ color: colors.muted }}>
                        {item.user_name || item.display_name || "Unassigned"}
                      </Text>
                      <Text style={[styles.note, { color: colors.muted }]}>
                        {item.voicemail_enabled
                          ? "Mailbox enabled"
                          : "Mailbox disabled"}
                        {!eligible
                          ? " · Assign an active member to enable"
                          : ""}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${item.voicemail_enabled ? "Disable" : "Enable"} voicemail for extension ${item.extension_number || item.id}`}
                    accessibilityState={{
                      disabled: busy || (!eligible && !item.voicemail_enabled),
                    }}
                    disabled={busy || (!eligible && !item.voicemail_enabled)}
                    onPress={() => change(item)}
                    style={[
                      styles.button,
                      desktopWeb && styles.actionColumn,
                      {
                        borderColor: colors.primary,
                        opacity:
                          busy || (!eligible && !item.voicemail_enabled)
                            ? 0.5
                            : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: colors.primary, fontWeight: "600" }}>
                      {pendingId === item.id
                        ? "Saving…"
                        : item.voicemail_enabled
                          ? "Disable"
                          : "Enable"}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
        {extensions.data?.pagination &&
        extensions.data.pagination.totalPages > 1 ? (
          <View style={styles.pages}>
            <Pressable
              accessibilityRole="button"
              disabled={!extensions.data.pagination.hasPrev}
              onPress={() => setPage((value) => value - 1)}
            >
              <Text style={{ color: colors.primary }}>Previous</Text>
            </Pressable>
            <Text style={{ color: colors.muted }}>
              Page {page} of {extensions.data.pagination.totalPages}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={!extensions.data.pagination.hasNext}
              onPress={() => setPage((value) => value + 1)}
            >
              <Text style={{ color: colors.primary }}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: 920,
    alignSelf: "center",
    padding: 16,
    gap: 16,
    paddingBottom: 48,
  },
  contentDesktop: { maxWidth: 1080, paddingHorizontal: 32, paddingTop: 30 },
  backButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
  },
  back: { fontSize: 14, fontWeight: "600" },
  title: { fontSize: 28, fontWeight: "700" },
  intro: { fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 10, padding: 18, gap: 10 },
  sectionTitle: { fontSize: 18, fontWeight: "700" },
  note: { fontSize: 12, lineHeight: 18 },
  action: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  mailboxList: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 12,
  },
  tableLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  numberColumn: { flex: 1, minWidth: 0 },
  memberColumn: { flex: 2, minWidth: 0 },
  statusColumn: { flex: 2, minWidth: 0 },
  actionColumn: { flex: 1, minWidth: 0 },
  row: {
    minHeight: 68,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: { flex: 1, gap: 3 },
  number: { fontSize: 17, fontWeight: "700" },
  button: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  pages: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
});
