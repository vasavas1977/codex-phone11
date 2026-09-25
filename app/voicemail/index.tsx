import { useMemo, useState } from "react";
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

type Voicemail = {
  id: number;
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
}: {
  callerNumber: string;
  callerName: string;
}) {
  const colors = useColors();
  const { placeCall, calling } = usePhoneCall();
  const target = voicemailCallbackTarget(callerNumber);
  if (!target) return null;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Call back ${callerName}`}
      disabled={calling}
      onPress={() => {
        if (!calling) void placeCall(target);
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
  const utils = trpc.useUtils();
  const inbox = trpc.pbx.voicemail.list.useQuery(undefined, {
    enabled: Boolean(user),
    retry: false,
  });
  const markRead = trpc.pbx.voicemail.markRead.useMutation({
    onSuccess: () => void utils.pbx.voicemail.list.invalidate(),
  });
  const remove = trpc.pbx.voicemail.delete.useMutation({
    onSuccess: () => void utils.pbx.voicemail.list.invalidate(),
  });
  const [openId, setOpenId] = useState<number>();
  const messages = (inbox.data ?? []) as Voicemail[];
  const unread = useMemo(
    () => messages.filter((message) => message.status === "new").length,
    [messages],
  );
  const openMessage = (message: Voicemail) => {
    setOpenId((current) => (current === message.id ? undefined : message.id));
    if (message.status === "new" && !markRead.isPending)
      void markRead.mutateAsync({ id: message.id }).catch(() => {});
  };
  const confirmDelete = (message: Voicemail) => {
    Alert.alert("Delete voicemail?", "This removes it from your inbox.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setOpenId(undefined);
          void remove.mutateAsync({ id: message.id }).catch(() => {});
        },
      },
    ]);
  };
  const unavailable = !user
    ? "Sign in to view voicemail."
    : inbox.error
      ? voicemailInboxErrorMessage(inbox.error)
      : undefined;

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

        {inbox.isLoading ? (
          <Text style={[styles.message, { color: colors.muted }]}>Loading voicemail…</Text>
        ) : unavailable ? (
          <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.message, { color: colors.muted }]}>{unavailable}</Text>
            {user && (
              <TouchableOpacity accessibilityRole="button" disabled={inbox.isFetching} onPress={() => void inbox.refetch()} style={styles.refresh}>
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
          const open = openId === message.id;
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
                    sourceURL={voicemailSourceURL}
                    allowShare={false}
                  />
                  <VoicemailCallbackAction
                    callerNumber={message.caller_number}
                    callerName={voicemailTitle(message)}
                  />
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Delete voicemail from ${voicemailTitle(message)}`}
                    disabled={remove.isPending}
                    onPress={() => confirmDelete(message)}
                    style={styles.delete}
                  >
                    <Text style={{ color: colors.error }}>{remove.isPending ? "Deleting…" : "Delete voicemail"}</Text>
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
