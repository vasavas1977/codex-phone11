import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { usePbxAdminWorkspace } from "@/hooks/use-pbx-admin";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";

type Resource = { id: number | string; name: string };
type List = "ivr" | "timeConditions" | "ringGroups" | "queues";
type Options = {
  list: List;
  tenantId: number;
  available: boolean;
  requiresImplicitTenant?: boolean;
  queryReady: boolean;
  mutationPending: boolean;
  title: string;
  consequence: (name: string) => string;
  mutate: (id: number, tenantId: number) => Promise<unknown>;
};

/** One synchronous reservation shared by native Alert and the visible web dialog. */
export function useAdminDeleteConfirmation(options: Options) {
  const colors = useColors();
  const auth = useSyncExternalStore(
    addAuthChangeListener,
    getAuthSnapshot,
    getAuthSnapshot,
  );
  const workspace = usePbxAdminWorkspace();
  const utils = trpc.useUtils();
  const role = workspace.manageableMemberships.find(
    (row) => row.tenantId === options.tenantId,
  )?.role;
  const live = useRef({ options, workspace, utils });
  live.current = { options, workspace, utils };
  const mounted = useRef(false);
  const scope = useRef({
    owner: auth.user,
    tenantId: options.tenantId,
    role,
    active: true,
  });
  type Action = {
    scope: typeof scope.current;
    row: Resource;
    fingerprint: string;
    phase: "confirming" | "saving" | "finished";
    active: boolean;
  };
  const pending = useRef<Action | null>(null);
  const [feedback, setFeedback] = useState<{
    action: Action;
    error: string | null;
  } | null>(null);
  const retire = () => {
    scope.current.active = false;
    if (pending.current) pending.current.active = false;
    pending.current = null;
  };
  if (
    scope.current.owner !== auth.user ||
    scope.current.tenantId !== options.tenantId ||
    scope.current.role !== role ||
    !scope.current.active
  ) {
    retire();
    scope.current = {
      owner: auth.user,
      tenantId: options.tenantId,
      role,
      active: true,
    };
  }
  useLayoutEffect(() => {
    mounted.current = true;
    // React's development effect replay retires the first lifetime. Start a
    // fresh scope without reviving any action captured by that lifetime.
    if (!scope.current.active)
      scope.current = { ...scope.current, active: true };
    const unsubscribe = addAuthChangeListener(() => {
      const latest = getAuthSnapshot();
      if (latest.loading || latest.user !== scope.current.owner) retire();
    });
    return () => {
      mounted.current = false;
      retire();
      unsubscribe();
    };
  }, []);
  const scopeCurrent = (action: Action) => {
    const latest = getAuthSnapshot();
    const view = live.current;
    const memberships = view.utils.pbx.tenant.memberships.getData();
    const member = memberships?.find(
      (row) =>
        row.userId === latest.user?.id &&
        row.tenantId === action.scope.tenantId,
    );
    return (
      mounted.current &&
      action.active &&
      action.scope.active &&
      scope.current === action.scope &&
      !latest.loading &&
      latest.user !== null &&
      latest.user === action.scope.owner &&
      view.options.available &&
      action.scope.tenantId > 0 &&
      view.options.tenantId === action.scope.tenantId &&
      view.workspace.selectedTenantId === action.scope.tenantId &&
      view.workspace.membershipsQuery.isSuccess &&
      !view.workspace.membershipsQuery.isError &&
      (!view.options.requiresImplicitTenant ||
        (view.workspace.canUseImplicitTenant &&
          memberships?.filter((row) => row.userId === latest.user?.id)
            .length === 1)) &&
      (member?.role === "owner" || member?.role === "admin") &&
      member.role === action.scope.role
    );
  };
  const readRow = (id: number | string) =>
    live.current.utils.ivr[live.current.options.list].list
      .getData({ tenant_id: scope.current.tenantId })
      ?.find((row) => Number(row.id) === Number(id));
  const rowCurrent = (action: Action) => {
    const row = readRow(action.row.id);
    return (
      scopeCurrent(action) &&
      live.current.options.queryReady &&
      row !== undefined &&
      JSON.stringify(row) === action.fingerprint
    );
  };
  if (
    pending.current &&
    !(pending.current.phase === "saving"
      ? scopeCurrent(pending.current)
      : rowCurrent(pending.current))
  ) {
    pending.current.active = false;
    pending.current = null;
  }
  if (
    feedback?.action.active &&
    !(feedback.action.phase === "saving"
      ? scopeCurrent(feedback.action)
      : rowCurrent(feedback.action))
  ) {
    feedback.action.active = false;
  }
  const cancel = (action: Action) => {
    if (pending.current !== action || action.phase !== "confirming") return;
    action.active = false;
    pending.current = null;
    if (mounted.current) setFeedback(null);
  };
  const confirm = async (action: Action) => {
    if (pending.current !== action || action.phase !== "confirming") return;
    if (!rowCurrent(action)) {
      action.active = false;
      pending.current = null;
      if (mounted.current) setFeedback(null);
      return;
    }
    action.phase = "saving"; // Reserve before awaiting or relying on a mutation rerender.
    setFeedback({ action, error: null });
    try {
      await live.current.options.mutate(
        Number(action.row.id),
        action.scope.tenantId,
      );
      if (scopeCurrent(action)) setFeedback(null);
    } catch (error) {
      if (scopeCurrent(action))
        setFeedback({
          action,
          error:
            error instanceof Error
              ? error.message
              : "Deletion failed. Please try again.",
        });
    } finally {
      action.phase = "finished";
      if (pending.current === action) {
        pending.current = null;
        if (scopeCurrent(action))
          setFeedback((value) =>
            value?.action === action ? { ...value } : value,
          );
      }
    }
  };
  const request = (row: Resource) => {
    if (
      pending.current ||
      live.current.options.mutationPending ||
      !Number.isSafeInteger(Number(row.id)) ||
      Number(row.id) < 1
    )
      return;
    const action: Action = {
      scope: scope.current,
      row: { id: row.id, name: row.name },
      fingerprint: JSON.stringify(row),
      phase: "confirming",
      active: true,
    };
    if (!rowCurrent(action)) return;
    pending.current = action;
    setFeedback({ action, error: null });
    if (Platform.OS === "web") return;
    Alert.alert(
      options.title,
      options.consequence(row.name),
      [
        { text: "Cancel", style: "cancel", onPress: () => cancel(action) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void confirm(action),
        },
      ],
      { cancelable: true, onDismiss: () => cancel(action) },
    );
  };
  const action = feedback?.action;
  const visible =
    action &&
    scopeCurrent(action) &&
    (action.phase === "saving" || rowCurrent(action));
  const dialog = Platform.OS === "web" && visible && pending.current === action;
  const saving = action?.phase === "saving";
  const ui = (
    <>
      {dialog ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => cancel(action)}
          onDismiss={() => cancel(action)}
        >
          <View style={styles.backdrop}>
            <View
              accessibilityViewIsModal
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: colors.foreground }]}
              >
                {options.title}
              </Text>
              <Text style={{ color: colors.foreground }}>
                {action.row.name}
              </Text>
              <Text style={{ color: colors.muted }}>
                {options.consequence(action.row.name)}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel deletion"
                  disabled={saving}
                  onPress={() => cancel(action)}
                  style={styles.button}
                >
                  <Text style={{ color: colors.foreground }}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm delete ${action.row.name}`}
                  disabled={saving}
                  onPress={() => void confirm(action)}
                  style={styles.button}
                >
                  <Text style={{ color: colors.error }}>
                    {saving ? "Deleting…" : "Delete"}
                  </Text>
                </Pressable>
              </View>
              {saving ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
          </View>
        </Modal>
      ) : null}
      {visible && saving ? (
        <Text accessibilityRole="alert" style={{ color: colors.muted }}>
          Deleting {action.row.name}…
        </Text>
      ) : null}
      {visible && feedback?.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {feedback.error}
        </Text>
      ) : null}
    </>
  );
  return {
    request,
    busy:
      pending.current !== null ||
      options.mutationPending ||
      !options.queryReady ||
      !options.available,
    ui,
  };
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    gap: 16,
  },
  title: { fontSize: 20, fontWeight: "700" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 16 },
  button: { padding: 12 },
});
