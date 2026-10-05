import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";

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
  const auth = useSyncExternalStore(
    addAuthChangeListener,
    getAuthSnapshot,
    getAuthSnapshot,
  );
  const mounted = useRef(false);
  const scope = useRef({ owner: auth.user, tenantId, page, active: true });
  type Action = {
    scope: typeof scope.current;
    row: ExtensionRow;
    enabled: boolean;
    phase: "confirming" | "saving" | "finished";
    active: boolean;
  };
  const pending = useRef<Action | null>(null);
  const [feedback, setFeedback] = useState<{
    action: Action;
    error: string | null;
  } | null>(null);
  if (
    !scope.current.active ||
    scope.current.owner !== auth.user ||
    scope.current.tenantId !== tenantId ||
    scope.current.page !== page
  ) {
    scope.current.active = false;
    if (pending.current) pending.current.active = false;
    pending.current = null;
    scope.current = { owner: auth.user, tenantId, page, active: true };
  }
  useLayoutEffect(() => {
    mounted.current = true;
    if (!scope.current.active)
      scope.current = { ...scope.current, active: true };
    const unsubscribe = addAuthChangeListener(() => {
      const latest = getAuthSnapshot();
      if (latest.user !== scope.current.owner || latest.loading) {
        scope.current.active = false;
        if (pending.current) pending.current.active = false;
        pending.current = null;
      }
    });
    return () => {
      mounted.current = false;
      scope.current.active = false;
      if (pending.current) pending.current.active = false;
      pending.current = null;
      unsubscribe();
    };
  }, []);
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

  const queryInput = {
    tenantId,
    page,
    pageSize: 50,
    sortBy: "extension_number" as const,
    sortOrder: "asc" as const,
  };
  const sameRow = (a: ExtensionRow, b: ExtensionRow) =>
    a.id === b.id &&
    a.extension_number === b.extension_number &&
    a.user_id === b.user_id &&
    a.status === b.status &&
    a.type === b.type &&
    a.voicemail_enabled === b.voicemail_enabled &&
    a.user_name === b.user_name &&
    a.display_name === b.display_name;
  const latestQuery = useRef({ failed: false });
  latestQuery.current.failed = extensions.isError;
  const current = (action: Action) => {
    const latest = getAuthSnapshot();
    if (
      !mounted.current ||
      !action.active ||
      !action.scope.active ||
      scope.current !== action.scope ||
      latest.loading ||
      !latest.user ||
      latest.user !== action.scope.owner ||
      !action.scope.tenantId ||
      latestQuery.current.failed
    )
      return false;
    const cached = utils.pbx.extensions.list.getData({
      ...queryInput,
      tenantId: action.scope.tenantId,
      page: action.scope.page,
    });
    const row = (cached?.data as ExtensionRow[] | undefined)?.find(
      (item) => item.id === action.row.id,
    );
    return Boolean(
      row &&
      sameRow(row, action.row) &&
      row.type === "user" &&
      (!action.enabled || (row.status === "active" && Boolean(row.user_id))),
    );
  };
  // Retire observed replacement rows permanently, even if the old values later return.
  if (pending.current && !current(pending.current)) {
    pending.current.active = false;
    pending.current = null;
  }
  if (feedback?.action.active && !current(feedback.action))
    feedback.action.active = false;
  const pendingId = pending.current?.row.id ?? null;
  const saveError =
    feedback && current(feedback.action) ? feedback.error : null;
  const cancel = (action: Action) => {
    if (pending.current !== action || action.phase !== "confirming") return;
    const wasCurrent = current(action);
    action.active = false;
    pending.current = null;
    if (wasCurrent) setFeedback(null);
  };
  const save = async (action: Action) => {
    if (
      pending.current !== action ||
      action.phase !== "confirming" ||
      !current(action)
    )
      return;
    action.phase = "saving";
    setFeedback({ action, error: null });
    try {
      await update.mutateAsync({
        id: action.row.id,
        tenantId: action.scope.tenantId,
        voicemailEnabled: action.enabled,
      });
      if (!current(action)) return;
      await utils.pbx.extensions.list.invalidate({
        ...queryInput,
        tenantId: action.scope.tenantId,
        page: action.scope.page,
      });
    } catch (error) {
      if (current(action))
        setFeedback({
          action,
          error:
            error instanceof Error
              ? error.message
              : "Mailbox setting could not be saved.",
        });
    } finally {
      action.phase = "finished";
      if (pending.current === action) {
        pending.current = null;
        if (current(action))
          setFeedback((value) =>
            value?.action === action ? { ...value } : value,
          );
      }
    }
  };
  const change = (item: ExtensionRow) => {
    if (pending.current) return;
    const action: Action = {
      scope: scope.current,
      row: { ...item },
      enabled: item.voicemail_enabled !== true,
      phase: "confirming",
      active: true,
    };
    if (!current(action)) return;
    pending.current = action; // Reserve before Alert or mutation, independently of React state.
    setFeedback({ action, error: null });
    if (!action.enabled) {
      void save(action);
      return;
    }
    Alert.alert(
      "Enable voicemail mailbox?",
      "This enables the PBX mailbox. Inbox delivery still needs a completed-message relay and a real voicemail test.",
      [
        { text: "Cancel", style: "cancel", onPress: () => cancel(action) },
        { text: "Enable", onPress: () => void save(action) },
      ],
      { cancelable: true, onDismiss: () => cancel(action) },
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
                These checks do not confirm message delivery or long-term
                storage. Leave a test voicemail and play it back to check the
                full flow.
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
