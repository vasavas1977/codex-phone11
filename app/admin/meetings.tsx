import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";

import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { useDirectory } from "@/hooks/use-directory";
import { usePbxAdminWorkspace } from "@/hooks/use-pbx-admin";
import { trpc } from "@/lib/trpc";

export default function AdminMeetingsScreen() {
  return (
    <AdminWorkspaceBoundary>
      <AdminMeetingsContent />
    </AdminWorkspaceBoundary>
  );
}

function AdminMeetingsContent() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const workspace = usePbxAdminWorkspace();
  const tenantId = workspace.selectedTenantId;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );
  const [memberSearch, setMemberSearch] = useState("");
  const tenant = trpc.pbx.tenant.get.useQuery(
    { tenantId: tenantId ?? 0 },
    { enabled: Boolean(user) && tenantId !== null, staleTime: 0 },
  );
  const canManage =
    tenant.data?.id === tenantId &&
    ["owner", "admin"].includes(String(tenant.data?.userRole ?? ""));
  const directory = useDirectory(
    tenantId ?? undefined,
    Boolean(user) && canManage,
  );
  const memberPhotos = useMemo(() => {
    if (
      !user?.id ||
      !tenantId ||
      directory.owner !== user.id ||
      directory.requestedTenant !== tenantId ||
      directory.workspace?.id !== tenantId
    )
      return new Map<number, string>();
    return new Map(
      directory.people
        .filter((person) => Boolean(person.photoUrl))
        .map((person) => [person.id, person.photoUrl!] as const),
    );
  }, [
    directory.owner,
    directory.people,
    directory.requestedTenant,
    directory.workspace?.id,
    tenantId,
    user?.id,
  ]);
  const overview = trpc.meetings.adminOverview.useQuery(
    { tenantId: tenantId ?? 0 },
    {
      enabled: Boolean(user) && tenantId !== null && canManage,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const setHostPermission = trpc.meetings.adminSetHostPermission.useMutation();
  const selectedChannel = overview.data?.available
    ? overview.data.channels.find((channel) => channel.id === selectedChannelId)
    : undefined;
  const matchingMembers = selectedChannel
    ? selectedChannel.members.filter((member) =>
        member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()),
      )
    : [];

  const updateHostPermission = async (
    channelId: string,
    userId: number,
    canStartMeeting: boolean,
  ) => {
    if (!tenantId || changing || !overview.data?.available) return;
    setSaveError(null);
    setChanging(`${channelId}:${userId}`);
    try {
      await setHostPermission.mutateAsync({
        tenantId,
        channelId,
        userId,
        canStartMeeting,
      });
      await overview.refetch();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "The meeting permission was not changed. Try again.",
      );
    } finally {
      setChanging(null);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/admin");
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to workspace administration"
            onPress={goBack}
            style={styles.back}
          >
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.foreground }]}
            >
              Meetings
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {tenant.data?.name || "Workspace administration"}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {selectedChannel ? selectedChannel.name : "Channel hosting"}
        </Text>
        <Text style={[styles.description, { color: colors.muted }]}>
          Choose who can start a meeting from each group chat or channel.
          Members can only join when selected by the host.
        </Text>

        {tenant.isLoading || overview.isLoading ? (
          <View style={styles.state}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.muted }]}>
              Checking meeting access…
            </Text>
          </View>
        ) : tenant.isError || !canManage ? (
          <Text
            accessibilityRole="alert"
            style={[styles.stateText, { color: colors.muted }]}
          >
            Phone11 could not confirm your administrator access to this
            workspace.
          </Text>
        ) : overview.isError ? (
          <View style={styles.state}>
            <Text
              accessibilityRole="alert"
              style={[styles.stateText, { color: colors.muted }]}
            >
              Meeting management is unavailable. No settings were changed.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void overview.refetch()}
            >
              <Text style={{ color: colors.primary }}>Try again</Text>
            </Pressable>
          </View>
        ) : !overview.data?.available ? (
          <Text
            accessibilityRole="alert"
            style={[styles.stateText, { color: colors.muted }]}
          >
            {overview.data?.reason ||
              "Meeting management is not enabled for this workspace."}
          </Text>
        ) : overview.data.channels.length === 0 ? (
          <Text style={[styles.stateText, { color: colors.muted }]}>
            No group chats or channels are available for meeting hosting.
          </Text>
        ) : selectedChannel ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSelectedChannelId(null);
                setMemberSearch("");
                setSaveError(null);
              }}
              style={styles.allChannels}
            >
              <Text style={{ color: colors.primary }}>‹ All channels</Text>
            </Pressable>
            <TextInput
              accessibilityLabel="Search meeting members"
              placeholder="Search members"
              placeholderTextColor={colors.muted}
              value={memberSearch}
              onChangeText={setMemberSearch}
              style={[
                styles.search,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            />
            <View
              style={[
                styles.channel,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <Text style={[styles.channelMeta, { color: colors.muted }]}>
                {matchingMembers.length} of {selectedChannel.members.length}{" "}
                eligible members
              </Text>
              {matchingMembers.slice(0, 100).map((member) => (
                <View
                  key={member.userId}
                  style={[styles.member, { borderTopColor: colors.border }]}
                >
                  <ProfileAvatar
                    name={member.name}
                    photoUrl={memberPhotos.get(member.userId)}
                    tenantId={tenantId}
                    userId={member.userId}
                    size={38}
                  />
                  <View style={styles.memberText}>
                    <Text
                      style={[styles.memberName, { color: colors.foreground }]}
                    >
                      {member.name}
                    </Text>
                    <Text
                      style={[styles.memberCaption, { color: colors.muted }]}
                    >
                      {member.canStartMeeting
                        ? "Can start meetings"
                        : "Can join when invited"}
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel={`${member.name} can start meetings in ${selectedChannel.name}`}
                    accessibilityRole="switch"
                    value={member.canStartMeeting}
                    disabled={changing !== null}
                    onValueChange={(value) =>
                      void updateHostPermission(
                        selectedChannel.id,
                        member.userId,
                        value,
                      )
                    }
                    trackColor={{ true: colors.primary }}
                  />
                </View>
              ))}
              {matchingMembers.length > 100 ? (
                <Text style={[styles.moreMembers, { color: colors.muted }]}>
                  Showing 100 members. Search by name to find another person.
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          overview.data.channels.map((channel) => (
            <Pressable
              key={channel.id}
              accessibilityRole="button"
              accessibilityLabel={`Manage meeting hosts in ${channel.name}`}
              onPress={() => setSelectedChannelId(channel.id)}
              style={[
                styles.channelChoice,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <View style={styles.memberText}>
                <Text
                  style={[styles.channelName, { color: colors.foreground }]}
                >
                  {channel.name}
                </Text>
                <Text style={[styles.channelMeta, { color: colors.muted }]}>
                  {channel.kind === "channel" ? "Channel" : "Group chat"} ·{" "}
                  {channel.members.length} eligible members ·{" "}
                  {
                    channel.members.filter((member) => member.canStartMeeting)
                      .length
                  }{" "}
                  hosts
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
          ))
        )}
        {saveError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {saveError}
          </Text>
        ) : null}
        <Text style={[styles.footer, { color: colors.muted }]}>
          Meeting entry, audio, video, and participant admission are controlled
          by the active meeting service. Additional security controls will
          appear here only when the service can enforce them.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    padding: 20,
    paddingBottom: 56,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingBottom: 20,
    marginBottom: 24,
  },
  back: { padding: 8, marginLeft: -8, marginRight: 8 },
  headerText: { flex: 1 },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 14, marginTop: 3 },
  sectionTitle: { fontSize: 19, fontWeight: "600" },
  description: { fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 20 },
  state: { alignItems: "center", paddingVertical: 25, gap: 12 },
  stateText: { fontSize: 14, lineHeight: 21, paddingVertical: 10 },
  channel: { borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 14 },
  channelChoice: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  channelName: { fontSize: 17, fontWeight: "600" },
  channelMeta: { fontSize: 13, marginTop: 3, marginBottom: 12 },
  allChannels: {
    alignSelf: "flex-start",
    paddingVertical: 7,
    marginBottom: 10,
  },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  moreMembers: { fontSize: 13, lineHeight: 20, marginTop: 12 },
  member: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    paddingVertical: 10,
    gap: 11,
  },
  memberText: { flex: 1, paddingRight: 16 },
  memberName: { fontSize: 15, fontWeight: "600" },
  memberCaption: { fontSize: 12, marginTop: 3 },
  error: { color: "#C62828", fontSize: 14, marginTop: 12 },
  footer: { fontSize: 12, lineHeight: 19, marginTop: 20 },
});
