import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useDirectory, openDirectConversation } from "@/hooks/use-directory";
import { usePhoneCall } from "@/hooks/use-phone-call";
import {
  canCallDirectoryContact,
  positiveRouteId,
} from "@/lib/phone/directory";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { PresenceIndicator } from "@/components/chat/presence-indicator";
import { usePresencePolling } from "@/lib/chat/presence-store";

export function ContactDetails({
  id: contactId,
  tenantId: workspaceId,
  embedded = false,
}: {
  id?: string;
  tenantId?: string;
  embedded?: boolean;
}) {
  const colors = useColors();
  const id = positiveRouteId(contactId);
  const tenantId = positiveRouteId(workspaceId);
  const directory = useDirectory(tenantId);
  const person =
    id && tenantId
      ? directory.people.find((item) => item.id === id)
      : undefined;
  usePresencePolling(tenantId, id ? [id] : [], Boolean(person));
  const account = useSipAccountStore((state) => state.account);
  const canCall =
    person &&
    canCallDirectoryContact(
      person,
      tenantId,
      account,
      directory.owner ?? undefined,
    );
  const { placeCall } = usePhoneCall();
  const pending = useRef(false);
  const meetingAttempt = useRef<{ key: string; requestId: string } | null>(null);
  const [busy, setBusy] = useState<"call" | "message" | "meet" | null>(null);
  const act = async (kind: "call" | "message" | "meet") => {
    if (!person || !tenantId || pending.current || directory.workspace?.id !== tenantId ||
      getAuthSnapshot().user?.id !== directory.owner) return;
    pending.current = true;
    setBusy(kind);
    const owner = getAuthSnapshot().user;
    try {
      if (kind === "call") {
        if (
          !canCallDirectoryContact(
            person,
            tenantId,
            useSipAccountStore.getState().account,
            owner?.id,
          )
        ) {
          Alert.alert(
            "Phone account needed",
            "Connect your phone account for this workspace to call this extension.",
          );
          return;
        }
        await placeCall(person.extension!);
      } else if (kind === "message") {
        const channelId = await openDirectConversation(tenantId, person.id);
        if (getAuthSnapshot().user === owner)
          router.push({
            pathname: "/chat/[id]",
            params: { id: channelId, tenantId },
          });
      } else {
        const conversationId = await openDirectConversation(tenantId, person.id);
        if (getAuthSnapshot().user !== owner) return;
        const { createChatTransport } = await import("@/lib/chat/transport");
        const meetings = createChatTransport();
        const capability = await meetings.directMeetingCapabilities(tenantId, conversationId);
        if (getAuthSnapshot().user !== owner) return;
        if (!capability.available || !capability.canStart) {
          Alert.alert("Meeting unavailable", "Meeting hosting is not enabled for this contact in this workspace.");
          return;
        }
        const key = `${owner!.id}:${tenantId}:${conversationId}`;
        const attempt = meetingAttempt.current?.key === key ? meetingAttempt.current : {
          key,
          requestId: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
            const random = Math.floor(Math.random() * 16);
            return (character === "x" ? random : (random & 3) | 8).toString(16);
          }),
        };
        meetingAttempt.current = attempt;
        const result = await meetings.startDirectMeeting(tenantId, conversationId, attempt.requestId);
        if (getAuthSnapshot().user !== owner) return;
        meetingAttempt.current = null;
        router.push({ pathname: "/conference", params: {
          meetingId: result.meetingId,
          tenantId: String(tenantId),
          source: "direct",
        } });
      }
    } catch {
      if (getAuthSnapshot().user !== owner) return;
      Alert.alert(
        kind === "call"
          ? "Call could not start"
          : kind === "meet" ? "Meeting could not start" : "Conversation could not open",
        kind === "call"
          ? "Check that your phone is connected, then try again."
          : kind === "meet"
            ? "Check your connection and try again. The same meeting request will be recovered safely."
            : "Check your connection and try again.",
      );
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {!embedded && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to contacts"
          onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/contacts")}
          style={styles.back}
        >
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 17 }}>Contacts</Text>
        </Pressable>
      )}
      {directory.loading ? (
        <ActivityIndicator
          style={{ marginTop: 50 }}
          color={colors.primary}
          accessibilityLabel="Loading contact"
        />
      ) : !person ? (
        <View style={styles.empty}>
          <Text
            accessibilityRole="header"
            style={[styles.emptyTitle, { color: colors.foreground }]}
          >
            {directory.error ? "Contact unavailable" : "Contact not found"}
          </Text>
          <Text style={[styles.description, { color: colors.muted }]}>
            {directory.error ||
              "This contact is no longer available in your workspace."}
          </Text>
          {directory.error && (
            <Pressable
              accessibilityRole="button"
              style={[styles.action, { backgroundColor: colors.primary }]}
              onPress={() => void directory.reload()}
            >
              <Text style={styles.actionText}>Try again</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <>
          <View style={styles.profile}>
            <View
              style={[
                styles.avatar,
                { backgroundColor: colors.primary + "20" },
              ]}
            >
              <Text style={[styles.initial, { color: colors.primary }]}>
                {Array.from(person.name)[0]}
              </Text>
            </View>
            <Text
              accessibilityRole="header"
              style={[styles.name, { color: colors.foreground }]}
            >
              {person.name}
            </Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              {directory.workspace?.name}
            </Text>
            <PresenceIndicator tenantId={tenantId} userId={id} />
            <Text style={[styles.extension, { color: colors.muted }]}>
              {person.extension
                ? `Ext. ${person.extension}`
                : "No phone extension assigned"}
            </Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Meet with ${person.name}`}
              accessibilityHint="Check meeting access, then invite this contact to a video meeting."
              accessibilityState={{ disabled: busy !== null, busy: busy === "meet" }}
              disabled={busy !== null}
              onPress={() => void act("meet")}
              style={[styles.action, { backgroundColor: colors.surface, opacity: busy ? 0.6 : 1 }]}
            >
              <IconSymbol name="video.fill" size={22} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>
                {busy === "meet" ? "Starting…" : "Meet"}
              </Text>
            </Pressable>
            {canCall && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${person.name}`}
                accessibilityState={{
                  disabled: busy !== null,
                  busy: busy === "call",
                }}
                disabled={busy !== null}
                onPress={() => void act("call")}
                style={[
                  styles.action,
                  {
                    backgroundColor: colors.primary,
                    opacity: busy ? 0.6 : 1,
                  },
                ]}
              >
                <IconSymbol name="phone.fill" size={22} color="white" />
                <Text style={styles.actionText}>
                  {busy === "call" ? "Calling…" : "Call"}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Message ${person.name}`}
              accessibilityState={{
                disabled: busy !== null,
                busy: busy === "message",
              }}
              disabled={busy !== null}
              onPress={() => void act("message")}
              style={[
                styles.action,
                { backgroundColor: colors.surface, opacity: busy ? 0.6 : 1 },
              ]}
            >
              <IconSymbol
                name="message.fill"
                size={22}
                color={colors.primary}
              />
              <Text style={[styles.actionText, { color: colors.primary }]}>
                {busy === "message" ? "Opening…" : "Message"}
              </Text>
            </Pressable>
          </View>
          {person.extension && !canCall && (
            <Text
              style={[styles.description, { color: colors.muted, padding: 24 }]}
            >
              Connect your phone account for this workspace to call this
              extension.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  back: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
  },
  profile: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 14,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontSize: 40, fontWeight: "600" },
  name: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  extension: { fontSize: 15 },
  description: { fontSize: 16, lineHeight: 24, textAlign: "center" },
  actions: {
    paddingHorizontal: 24,
    gap: 12,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  action: {
    minHeight: 54,
    padding: 16,
    borderRadius: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { color: "white", fontSize: 17, fontWeight: "600" },
  empty: { padding: 28, gap: 18, alignItems: "center" },
  emptyTitle: { fontSize: 22, fontWeight: "600" },
});
