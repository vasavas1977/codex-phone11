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
import { useDirectory, useDirectoryFocusRefresh, openDirectConversation } from "@/hooks/use-directory";
import { usePhoneCall } from "@/hooks/use-phone-call";
import {
  canCallDirectoryContact,
  positiveRouteId,
} from "@/lib/phone/directory";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { PresenceIndicator } from "@/components/chat/presence-indicator";
import { usePresencePolling } from "@/lib/chat/presence-store";
import { useAuth } from "@/hooks/use-auth";
import { ProfileAvatar, useProfilePhotoCacheScope } from "@/components/profile/profile-avatar";
import { useWorkspaceProfile } from "@/lib/profile/use-workspace-profile";
import type { DirectoryContact } from "@/lib/phone/directory";

export function ContactAvatar({ person, ownPhoto, ownerId, tenantId, size, interactive }: {
  person: DirectoryContact;
  ownPhoto: { userId: number; photoUrl: string | null; photoVersion: string | null } | null;
  ownerId: number | undefined;
  tenantId: number | undefined;
  size: number;
  interactive?: boolean;
}) {
  const currentPhoto = person.id === ownerId && ownPhoto?.userId === ownerId ? ownPhoto : null;
  return <ProfileAvatar
    name={person.name}
    photoUrl={currentPhoto ? currentPhoto.photoUrl : person.photoUrl}
    photoVersion={currentPhoto ? currentPhoto.photoVersion : undefined}
    tenantId={tenantId}
    userId={person.id}
    size={size}
    interactive={interactive}
    accessibilityLabel={`${person.name} profile photo`}
  />;
}

export function ContactDetails({
  id: contactId,
  tenantId: workspaceId,
  embedded = false,
  directorySnapshot,
  actionsEnabled = true,
  onBeforeAction,
}: {
  id?: string;
  tenantId?: string;
  embedded?: boolean;
  actionsEnabled?: boolean;
  onBeforeAction?: () => void;
  directorySnapshot?: Pick<ReturnType<typeof useDirectory>, "owner" | "workspace" | "people" | "loading" | "error" | "reload">;
}) {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const id = positiveRouteId(contactId);
  const tenantId = positiveRouteId(workspaceId);
  const localDirectory = useDirectory(tenantId, !directorySnapshot && !!id && !!tenantId);
  const directory = directorySnapshot && directorySnapshot.owner === user?.id &&
    directorySnapshot.workspace?.id === tenantId
    ? directorySnapshot : localDirectory;
  const activeTenant = user?.id === directory.owner ? directory.workspace?.id : undefined;
  useDirectoryFocusRefresh(directory.owner, activeTenant, !directorySnapshot, directory.reload);
  const ownPhotoDescriptor = useWorkspaceProfile(user, activeTenant).photoDescriptor;
  const ownPhoto = ownPhotoDescriptor?.userId === user?.id ? ownPhotoDescriptor : null;
  useProfilePhotoCacheScope(activeTenant);
  const person =
    id && tenantId && activeTenant === tenantId && directory.owner === user?.id
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
  const [busy, setBusy] = useState<"call" | "message" | null>(null);
  const act = async (kind: "call" | "message") => {
    if (!person || !tenantId || !actionsEnabled || pending.current || getAuthSnapshot().user?.id !== directory.owner) return;
    pending.current = true;
    setBusy(kind);
    const owner = getAuthSnapshot().user?.id;
    try {
      if (kind === "call") {
        if (
          !canCallDirectoryContact(
            person,
            tenantId,
            useSipAccountStore.getState().account,
            owner,
          )
        ) {
          Alert.alert(
            "Phone account needed",
            "Connect your phone account for this workspace to call this extension.",
          );
          return;
        }
        onBeforeAction?.();
        await placeCall(person.extension!);
      } else {
        const channelId = await openDirectConversation(tenantId, person.id);
        if (getAuthSnapshot().user?.id === owner) {
          onBeforeAction?.();
          router.push({
            pathname: "/chat/[id]",
            params: { id: channelId, tenantId },
          });
        }
      }
    } catch {
      Alert.alert(
        kind === "call"
          ? "Call could not start"
          : "Conversation could not open",
        kind === "call"
          ? "Check that your phone is connected, then try again."
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
            <ContactAvatar person={person} ownPhoto={ownPhoto} ownerId={user?.id} tenantId={activeTenant} size={88} interactive={false} />
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
          {actionsEnabled && <View style={styles.actions}>
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
          </View>}
          {actionsEnabled && person.extension && !canCall && (
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
