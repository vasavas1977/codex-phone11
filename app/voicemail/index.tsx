import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { Playback } from "@/components/cloud-recordings/cloud-playback";
import { useAuth } from "@/hooks/use-auth";
import { usePhoneCall } from "@/hooks/use-phone-call";
import { useColors } from "@/hooks/use-colors";
import { voicemailPlaybackURL } from "@/lib/cloud-recordings/presentation";
import { normalizeDialInput } from "@/lib/sip/dial-input";
import { trpc } from "@/lib/trpc";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useSipAccountStore } from "@/lib/sip/account-store";

type Voicemail = {
  id: number;
  tenant_id?: number;
  extension_number: string;
  caller_number: string;
  caller_name: string | null;
  duration_seconds: number;
  status: "new" | "read";
  created_at: string | number | Date;
};

const formatDuration = (seconds: number) => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

const voicemailTitle = (message: Voicemail) =>
  message.caller_name?.trim() || message.caller_number || "Unknown caller";

const voicemailMutationInput = (message: Voicemail) => ({
  id: message.id,
  ...(Number.isSafeInteger(message.tenant_id) && message.tenant_id! > 0
    ? { tenantId: message.tenant_id }
    : {}),
});

// Read-state reconciliation may replace a row object without replacing its message.
const messageIdentity = (message: Voicemail) => JSON.stringify([
  message.id, message.tenant_id ?? null, message.extension_number,
  message.caller_number, new Date(message.created_at).getTime(),
]);

export function voicemailCallbackTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const number = normalizeDialInput(value);
  return number && /^\+?\d{2,20}$/.test(number) ? number : null;
}

export function voicemailInboxErrorMessage(error: unknown): string {
  let code: unknown;
  if (error !== null && typeof error === "object") {
    const data = (error as { data?: unknown }).data;
    if (data !== null && typeof data === "object")
      code = (data as { code?: unknown }).code;
  }
  if (code === "SERVICE_UNAVAILABLE")
    return "Voicemail storage is not configured. Ask an administrator to finish setup.";
  if (code === "UNAUTHORIZED") return "Sign in again to view voicemail.";
  if (code === "FORBIDDEN") return "You do not have access to this voicemail inbox.";
  return "Could not load voicemail. Check your connection and try again.";
}

export function VoicemailCallbackAction({
  callerNumber,
  callerName,
  authorize,
}: {
  callerNumber: string;
  callerName: string;
  authorize?: () => boolean;
}) {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const account = useSipAccountStore((state) => state.account);
  const { placeCall, calling } = usePhoneCall();
  const target = voicemailCallbackTarget(callerNumber);
  if (!target) return null;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Call back ${callerName}`}
      disabled={calling}
      onPress={() => {
        const auth = getAuthSnapshot();
        if (!calling && user && auth.user === user && !auth.loading &&
          useSipAccountStore.getState().account === account && authorize?.() !== false)
          void Promise.resolve(placeCall(target)).catch(() => {});
      }}
      style={styles.callback}
    >
      <Text style={{ color: colors.primary }}>{calling ? "Calling…" : "Call back"}</Text>
    </TouchableOpacity>
  );
}

const voicemailSourceURL = (base: string, path: string) => {
  const id = /^\/api\/recordings\/voicemail\/([1-9][0-9]*)$/.exec(path)?.[1];
  return id ? voicemailPlaybackURL(base, Number(id), path) : null;
};

export default function VoicemailScreen() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const account = useSipAccountStore((state) => state.account);
  const tenantId = account?.ownerUserId === user?.id && Number.isSafeInteger(account?.tenantId) && account!.tenantId! > 0
    ? account!.tenantId : undefined;
  const utils = trpc.useUtils();
  const inbox = trpc.pbx.voicemail.list.useQuery(tenantId ? { tenantId } : undefined, {
    enabled: Boolean(user),
    retry: false,
  });
  const markRead = trpc.pbx.voicemail.markRead.useMutation();
  const remove = trpc.pbx.voicemail.delete.useMutation();
  const available = !inbox.error && !inbox.isLoading && !getAuthSnapshot().loading;
  const scope = useRef<{ owner: NonNullable<typeof user>; account: typeof account; available: boolean } | null>(null);
  if (!user) scope.current = null;
  else if (scope.current?.owner !== user || scope.current.account !== account || scope.current.available !== available)
    scope.current = { owner: user, account, available };
  const action = scope.current;
  const currentInbox = useRef(inbox);
  currentInbox.current = inbox;
  // A confirmed server deletion stays retired across phone-workspace changes.
  const sameOwner = (left: typeof action, right: typeof action) => left?.owner === right?.owner;
  const retired = useRef<{ scope: typeof action; keys: Set<string> }>({ scope: action, keys: new Set() });
  if (!sameOwner(retired.current.scope, action)) retired.current = { scope: action, keys: new Set() };
  const [retiredMessages, setRetiredMessages] = useState<{ scope: typeof action; keys: string[] }>({ scope: action, keys: [] });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  type ActionState = { scope: NonNullable<typeof action>; id: number; key: string; pending: boolean; failed: boolean };
  const operations = useRef<{ scope: typeof action; read: Map<string, ActionState>; delete: Map<string, ActionState> }>({
    scope: action, read: new Map(), delete: new Map(),
  });
  if (operations.current.scope !== action) operations.current = { scope: action, read: new Map(), delete: new Map() };
  const [feedback, setFeedback] = useState<{ read: ActionState | null; delete: ActionState | null }>({ read: null, delete: null });
  const [openId, setOpenId] = useState<{ scope: NonNullable<typeof action>; id: number; key: string }>();
  const selection = useRef(openId);
  selection.current = openId;
  const isCurrentReader = useCallback((captured: typeof action) => {
    const auth = getAuthSnapshot();
    return mounted.current && !!captured && scope.current === captured && auth.user === captured.owner && !auth.loading &&
      useSipAccountStore.getState().account === captured.account;
  }, []);
  const isCurrent = useCallback((captured: typeof action) => !!captured?.available && isCurrentReader(captured), [isCurrentReader]);
  const isCurrentMessage = useCallback((captured: typeof action, message: Voicemail) =>
    isCurrent(captured) && !currentInbox.current.error && !currentInbox.current.isLoading &&
    !retired.current.keys.has(messageIdentity(message)) &&
    (!tenantId || !message.tenant_id || message.tenant_id === tenantId) &&
    (currentInbox.current.data as Voicemail[] | undefined)?.some((row) => messageIdentity(row) === messageIdentity(message)) === true,
  [isCurrent, tenantId]);
  const mutateMessage = async (kind: "read" | "delete", message: Voicemail, captured: typeof action) => {
    if (!captured || !isCurrentMessage(captured, message)) return;
    const key = messageIdentity(message);
    const previous = operations.current[kind].get(key);
    if (previous?.scope === captured && previous.key === key && previous.pending) return;
    const operation: ActionState = { scope: captured, id: message.id, key, pending: true, failed: false };
    operations.current[kind].set(key, operation);
    setFeedback((current) => ({ ...current, [kind]: operation }));
    const settle = (failed: boolean) => {
      if (!isCurrentMessage(captured, message)) {
        if (operations.current.scope === captured && operations.current[kind].get(key) === operation) {
          operations.current[kind].delete(key);
          if (isCurrentReader(captured))
            setFeedback((current) => ({ ...current, [kind]: current[kind] === operation ? null : current[kind] }));
        }
        return;
      }
      if (!failed) {
        if (kind === "delete") {
          retired.current.keys.add(key);
          setRetiredMessages({ scope: captured, keys: [...retired.current.keys] });
          if (selection.current?.scope === captured && selection.current.key === key) {
            selection.current = undefined;
            setOpenId(undefined);
          }
        }
        // A retired owner's completion must not refresh the replacement inbox.
        void Promise.resolve(utils.pbx.voicemail.list.invalidate()).catch(() => {});
      }
      if (operations.current[kind].get(key) !== operation) return;
      const result = { ...operation, pending: false, failed };
      operations.current[kind].delete(key);
      setFeedback((current) => ({ ...current, [kind]: current[kind] === operation ? result : current[kind] }));
    };
    try {
      const result = await (kind === "read" ? markRead : remove).mutateAsync(voicemailMutationInput(message));
      settle(result.success !== true);
    } catch { settle(true); }
  };
  const messages = !action?.available ? [] : ((inbox.data ?? []) as Voicemail[]).filter((message) =>
    (!tenantId || !message.tenant_id || message.tenant_id === tenantId) &&
    (!sameOwner(retiredMessages.scope, action) || !retiredMessages.keys.includes(messageIdentity(message))));
  if (openId && (openId.scope !== action || !messages.some((message) =>
    messageIdentity(message) === openId.key && isCurrentMessage(action, message)))) {
    // Retire the selection itself, so a removed row cannot later reopen by reappearing.
    selection.current = undefined;
    setOpenId(undefined);
  }
  const unread = messages.filter((message) => message.status === "new").length;
  const openMessage = (message: Voicemail) => {
    if (!action || !isCurrentMessage(action, message)) return;
    const key = messageIdentity(message);
    const next = selection.current?.scope === action && selection.current.key === key ? undefined : { scope: action, id: message.id, key };
    selection.current = next;
    setOpenId(next);
    if (message.status === "new") void mutateMessage("read", message, action);
  };
  const confirmDelete = (message: Voicemail) => {
    if (!isCurrentMessage(action, message)) return;
    const selected = selection.current;
    Alert.alert("Delete voicemail?", "This removes it from your inbox.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          if (selected && selection.current === selected && selected.key === messageIdentity(message))
            void mutateMessage("delete", message, action);
        },
      },
    ]);
  };
  const unavailable = !user
    ? "Sign in to view voicemail."
    : inbox.error
      ? voicemailInboxErrorMessage(inbox.error)
      : undefined;
  const selectedSourceURL = useMemo(() => (base: string, path: string) => {
    const selected = openId;
    const message = (currentInbox.current.data as Voicemail[] | undefined)?.find((row) => messageIdentity(row) === selected?.key);
    return selected && selection.current === selected && selected.scope === action && path === `/api/recordings/voicemail/${selected.id}` && message && isCurrentMessage(action, message)
      ? voicemailSourceURL(base, path) : null;
  }, [action, isCurrentMessage, openId]);
  const deleteFailed = feedback.delete?.scope === action && feedback.delete.failed &&
    messages.some((message) => messageIdentity(message) === feedback.delete?.key);
  const markReadFailed = feedback.read?.scope === action && feedback.read.failed &&
    messages.some((message) => messageIdentity(message) === feedback.read?.key && message.status === "new");

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.back}
            onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/recents")}
          >
            <Text style={[styles.backText, { color: colors.primary }]}>‹ Back</Text>
          </TouchableOpacity>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Voicemail</Text>
          <Text style={[styles.count, { color: colors.muted }]}>{unread ? `${unread} new` : ""}</Text>
        </View>

        {!unavailable && (deleteFailed || markReadFailed) && (
          <Text accessibilityRole="alert" style={[styles.message, { color: colors.error }]}>
            {deleteFailed
              ? "Could not delete voicemail. Try again."
              : "Could not mark voicemail as read. Open it again to retry."}
          </Text>
        )}

        {inbox.isLoading ? (
          <Text style={[styles.message, { color: colors.muted }]}>Loading voicemail…</Text>
        ) : unavailable ? (
          <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.message, { color: colors.muted }]}>{unavailable}</Text>
            {user && (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh voicemail" disabled={inbox.isFetching}
                onPress={() => { if (isCurrentReader(action)) void Promise.resolve(inbox.refetch()).catch(() => {}); }} style={styles.refresh}>
                <Text style={{ color: colors.primary }}>{inbox.isFetching ? "Refreshing…" : "Refresh"}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : messages.length === 0 ? (
          <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No voicemail</Text>
            <Text style={[styles.message, { color: colors.muted }]}>New messages will appear here.</Text>
          </View>
        ) : messages.map((message) => {
          const open = openId?.scope === action && openId?.key === messageIdentity(message);
          const pending = operations.current.delete.get(messageIdentity(message));
          const deletePending = pending?.scope === action && pending.pending;
          const path = `/api/recordings/voicemail/${message.id}`;
          return (
            <View key={message.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Voicemail from ${voicemailTitle(message)}`}
                accessibilityState={{ expanded: open }}
                onPress={() => openMessage(message)}
                style={styles.row}
              >
                <View style={[styles.avatar, { backgroundColor: message.status === "new" ? colors.primary : colors.border }]}>
                  <Text style={styles.avatarText}>{voicemailTitle(message).slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.details}>
                  <Text numberOfLines={1} style={[styles.name, { color: colors.foreground, fontWeight: message.status === "new" ? "700" : "600" }]}>{voicemailTitle(message)}</Text>
                  <Text numberOfLines={1} style={[styles.number, { color: colors.muted }]}>{message.caller_number || "Caller ID unavailable"}</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>{new Date(message.created_at).toLocaleString()} · {formatDuration(message.duration_seconds)}</Text>
                </View>
                {message.status === "new" && <View accessibilityLabel="New voicemail" style={[styles.unread, { backgroundColor: colors.primary }]} />}
              </TouchableOpacity>
              {open && (
                <View style={[styles.expanded, { borderTopColor: colors.border }]}>
                  <Text style={[styles.mailbox, { color: colors.muted }]}>Mailbox {message.extension_number}</Text>
                  <Playback
                    key={`voicemail:${message.id}`}
                    callUuid={`voicemail-${message.id}`}
                    path={path}
                    sourceURL={selectedSourceURL}
                    allowShare={false}
                  />
                  <VoicemailCallbackAction
                    callerNumber={message.caller_number}
                    callerName={voicemailTitle(message)}
                    authorize={() => selection.current?.scope === action && selection.current.key === messageIdentity(message) && isCurrentMessage(action, message)}
                  />
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Delete voicemail from ${voicemailTitle(message)}`}
                    disabled={deletePending}
                    onPress={() => confirmDelete(message)}
                    style={styles.delete}
                  >
                    <Text style={{ color: colors.error }}>{deletePending ? "Deleting…" : "Delete voicemail"}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", minHeight: 52, marginBottom: 8 },
  back: { minHeight: 44, justifyContent: "center", paddingRight: 12 },
  backText: { fontSize: 16, fontWeight: "600" },
  title: { flex: 1, fontSize: 28, fontWeight: "700" },
  count: { fontSize: 13, fontWeight: "600" },
  empty: { borderWidth: 1, borderRadius: 14, padding: 20, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  message: { fontSize: 14, lineHeight: 21 },
  refresh: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  row: { minHeight: 84, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  details: { flex: 1, gap: 3 },
  name: { fontSize: 16 },
  number: { fontSize: 13 },
  meta: { fontSize: 12 },
  unread: { width: 9, height: 9, borderRadius: 5 },
  expanded: { borderTopWidth: 1, padding: 14, gap: 10 },
  mailbox: { fontSize: 12, fontWeight: "600" },
  callback: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 8 },
  delete: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
