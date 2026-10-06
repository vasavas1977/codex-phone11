import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
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
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";

type HostScope = {
  owner: ReturnType<typeof getAuthSnapshot>["user"];
  tenantId: number | null;
  active: boolean;
};

// Keep an already-dispatched write owned across workspace remounts. A new
// screen must wait for its settlement, rather than send an opposing write.
const hostChangeListeners = new Set<() => void>();
let pendingHostChange: object | null = null;
function subscribeHostChange(listener: () => void) {
  hostChangeListeners.add(listener);
  return () => hostChangeListeners.delete(listener);
}
const getPendingHostChange = () => pendingHostChange;
function setPendingHostChange(value: object | null) {
  pendingHostChange = value;
  hostChangeListeners.forEach((listener) => listener());
}

function conversationTitle(conversation: {
  kind: string;
  name: string;
  members: readonly { name: string }[];
}) {
  return conversation.kind === "direct"
    ? conversation.members.map((member) => member.name).join(" · ")
    : conversation.name;
}

export default function AdminMeetingsScreen() {
  return (
    <AdminWorkspaceBoundary>
      <AdminMeetingsContent />
    </AdminWorkspaceBoundary>
  );
}

function AdminMeetingsContent() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const desktopWeb = Platform.OS === "web" && width >= 1000;
  const { user } = useAuth({ autoFetch: false });
  const workspace = usePbxAdminWorkspace();
  const tenantId = workspace.selectedTenantId;
  const [feedback, setFeedback] = useState<{
    scope: HostScope;
    message: string;
  } | null>(null);
  const pending = useSyncExternalStore(
    subscribeHostChange,
    getPendingHostChange,
    getPendingHostChange,
  );
  const mounted = useRef(false);
  const scope = useRef<HostScope>({ owner: user, tenantId, active: true });
  if (scope.current.owner !== user || scope.current.tenantId !== tenantId) {
    scope.current.active = false;
    scope.current = { owner: user, tenantId, active: true };
  }
  const renderedScope = scope.current;
  useEffect(() => {
    mounted.current = true;
    if (!scope.current.active)
      scope.current = { ...scope.current, active: true };
    const unsubscribe = addAuthChangeListener(() => {
      const auth = getAuthSnapshot();
      if (auth.loading || auth.user !== scope.current.owner)
        scope.current.active = false;
    });
    return () => {
      mounted.current = false;
      scope.current.active = false;
      unsubscribe();
    };
  }, []);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [directCursors, setDirectCursors] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const directPage = directCursors.length - 1;
  const [channelCursors, setChannelCursors] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const channelPage = channelCursors.length - 1;
  useEffect(() => {
    setDirectCursors([undefined]);
    setChannelCursors([undefined]);
    setSelectedConversationId(null);
  }, [tenantId]);
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
    {
      tenantId: tenantId ?? 0,
      directCursor: directCursors[directPage],
      channelCursor: channelCursors[channelPage],
    },
    {
      enabled: Boolean(user) && tenantId !== null && canManage,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const setHostPermission = trpc.meetings.adminSetHostPermission.useMutation();
  const setDirectHostPermission =
    trpc.meetings.adminSetDirectHostPermission.useMutation();
  const conversations = overview.data?.available
    ? [...overview.data.channels, ...overview.data.directConversations]
    : [];
  const latest = useRef({ conversations, canManage, ready: false });
  latest.current = {
    conversations,
    canManage,
    ready:
      !tenant.isLoading &&
      !tenant.isFetching &&
      !tenant.isError &&
      !overview.isLoading &&
      !overview.isFetching &&
      !overview.isError &&
      overview.data?.available === true,
  };
  const ownsScope = (captured: HostScope) => {
    const auth = getAuthSnapshot();
    return (
      mounted.current &&
      captured === scope.current &&
      captured.active &&
      captured.owner !== null &&
      auth.user === captured.owner &&
      !auth.loading &&
      captured.tenantId !== null
    );
  };
  const currentScope = (captured: HostScope) =>
    ownsScope(captured) && latest.current.canManage && latest.current.ready;
  const saveError =
    feedback && currentScope(feedback.scope) ? feedback.message : null;
  const selectedConversation = overview.data?.available
    ? conversations.find(
        (conversation) => conversation.id === selectedConversationId,
      )
    : undefined;
  const matchingMembers = selectedConversation
    ? selectedConversation.members.filter((member) =>
        member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()),
      )
    : [];

  const updateHostPermission = async (
    captured: HostScope,
    conversation: (typeof conversations)[number],
    member: (typeof conversations)[number]["members"][number],
    canStartMeeting: boolean,
  ) => {
    if (
      pendingHostChange ||
      !currentScope(captured) ||
      !latest.current.conversations.includes(conversation) ||
      !conversation.members.includes(member)
    )
      return;
    const action = { captured, conversation, member };
    const currentAction = () =>
      currentScope(captured) &&
      latest.current.conversations.includes(conversation) &&
      conversation.members.includes(member);
    setPendingHostChange(action);
    try {
      if (!currentAction()) return;
      setFeedback(null);
      if (conversation.kind === "direct")
        await setDirectHostPermission.mutateAsync({
          tenantId: captured.tenantId!,
          conversationId: conversation.id,
          userId: member.userId,
          canStartMeeting,
        });
      else
        await setHostPermission.mutateAsync({
          tenantId: captured.tenantId!,
          channelId: conversation.id,
          userId: member.userId,
          canStartMeeting,
        });
      // The server request cannot be cancelled here. Only its original screen
      // may consume its result or refetch; replacements discard late results.
      if (currentAction()) await overview.refetch();
    } catch (error) {
      if (currentAction())
        setFeedback({
          scope: captured,
          message:
            error instanceof Error
              ? error.message
              : "The hosting change could not be confirmed. Refresh before trying again.",
        });
    } finally {
      if (pendingHostChange === action) setPendingHostChange(null);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/admin");
  };

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          desktopWeb && styles.contentDesktop,
        ]}
      >
        <View style={styles.header}>
          {!desktopWeb ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to workspace administration"
              onPress={goBack}
              style={styles.back}
            >
              <IconSymbol
                name="chevron.left"
                size={22}
                color={colors.primary}
              />
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.foreground }]}
            >
              Meeting hosting
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {tenant.data?.name || "Workspace administration"}
            </Text>
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {selectedConversation
              ? conversationTitle(selectedConversation)
              : "Who can start a meeting"}
          </Text>
          <Text style={[styles.description, { color: colors.muted }]}>
            Choose hosts for direct chats, groups, and channels. Group and
            channel members join only when the host selects them.
          </Text>
        </View>
        {overview.data?.available && overview.data.directConversationsReason ? (
          <Text
            accessibilityRole="alert"
            style={[styles.description, { color: colors.muted }]}
          >
            {overview.data.directConversationsReason}
          </Text>
        ) : null}

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
              Meeting management could not be loaded. Refresh before changing
              hosting rights.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (ownsScope(renderedScope) && latest.current.canManage)
                  void overview.refetch();
              }}
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
        ) : conversations.length === 0 &&
          directPage === 0 &&
          channelPage === 0 &&
          !overview.data.directNextCursor &&
          !overview.data.channelNextCursor ? (
          <Text style={[styles.stateText, { color: colors.muted }]}>
            No conversations are available for meeting hosting.
          </Text>
        ) : selectedConversation ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSelectedConversationId(null);
                setMemberSearch("");
                setFeedback(null);
              }}
              style={styles.allChannels}
            >
              <Text style={{ color: colors.primary }}>‹ All conversations</Text>
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
              <Text
                style={[
                  styles.listHeading,
                  { color: colors.muted, borderBottomColor: colors.border },
                ]}
              >
                {matchingMembers.length} of{" "}
                {selectedConversation.members.length} eligible members
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
                    accessibilityLabel={`${member.name} can start meetings in ${conversationTitle(selectedConversation)}`}
                    accessibilityRole="switch"
                    value={member.canStartMeeting}
                    disabled={pending !== null || !currentScope(renderedScope)}
                    onValueChange={(value) =>
                      void updateHostPermission(
                        renderedScope,
                        selectedConversation,
                        member,
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
          <>
            <Text style={[styles.listHeading, { color: colors.muted }]}>
              CONVERSATIONS
            </Text>
            <View
              style={[
                styles.conversationList,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              {conversations.map((conversation) => (
                <Pressable
                  key={conversation.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Manage meeting hosts in ${conversationTitle(conversation)}`}
                  onPress={() => setSelectedConversationId(conversation.id)}
                  style={[
                    styles.channelChoice,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <View style={styles.memberText}>
                    <Text
                      style={[styles.channelName, { color: colors.foreground }]}
                    >
                      {conversationTitle(conversation)}
                    </Text>
                    <Text style={[styles.channelMeta, { color: colors.muted }]}>
                      {conversation.kind === "direct"
                        ? "Direct chat"
                        : conversation.kind === "channel"
                          ? "Channel"
                          : "Group chat"}{" "}
                      · {conversation.members.length} eligible members ·{" "}
                      {
                        conversation.members.filter(
                          (member) => member.canStartMeeting,
                        ).length
                      }{" "}
                      hosts
                    </Text>
                  </View>
                  <IconSymbol
                    name="chevron.right"
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              ))}
            </View>
            {channelPage > 0 || overview.data.channelNextCursor ? (
              <View style={styles.pageControls}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous channels"
                  disabled={channelPage === 0}
                  onPress={() =>
                    setChannelCursors((cursors) => cursors.slice(0, -1))
                  }
                >
                  <Text
                    style={{
                      color: channelPage === 0 ? colors.muted : colors.primary,
                    }}
                  >
                    Previous
                  </Text>
                </Pressable>
                <Text style={{ color: colors.muted }}>
                  Channels · page {channelPage + 1}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next channels"
                  disabled={!overview.data.channelNextCursor}
                  onPress={() => {
                    if (overview.data.channelNextCursor)
                      setChannelCursors((cursors) => [
                        ...cursors,
                        overview.data!.channelNextCursor,
                      ]);
                  }}
                >
                  <Text
                    style={{
                      color: overview.data.channelNextCursor
                        ? colors.primary
                        : colors.muted,
                    }}
                  >
                    Next
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {directPage > 0 || overview.data.directNextCursor ? (
              <View style={styles.pageControls}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous direct chats"
                  disabled={directPage === 0}
                  onPress={() =>
                    setDirectCursors((cursors) => cursors.slice(0, -1))
                  }
                >
                  <Text
                    style={{
                      color: directPage === 0 ? colors.muted : colors.primary,
                    }}
                  >
                    Previous
                  </Text>
                </Pressable>
                <Text style={{ color: colors.muted }}>
                  Direct chats · page {directPage + 1}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next direct chats"
                  disabled={!overview.data.directNextCursor}
                  onPress={() => {
                    if (overview.data.directNextCursor)
                      setDirectCursors((cursors) => [
                        ...cursors,
                        overview.data!.directNextCursor,
                      ]);
                  }}
                >
                  <Text
                    style={{
                      color: overview.data.directNextCursor
                        ? colors.primary
                        : colors.muted,
                    }}
                  >
                    Next
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        )}
        {saveError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {saveError}
          </Text>
        ) : null}
        {pending ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.description, { color: colors.muted }]}
          >
            Waiting for the current hosting change to finish before another
            change.
          </Text>
        ) : null}
        <Text style={[styles.footer, { color: colors.muted }]}>
          This page controls hosting rights only. Meeting entry, audio, video,
          and participant admission are controlled by the meeting service.
        </Text>
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
    paddingBottom: 56,
  },
  contentDesktop: { maxWidth: 1080, paddingHorizontal: 32, paddingTop: 30 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 20,
  },
  back: {
    padding: 8,
    marginLeft: -8,
    marginRight: 8,
    minHeight: 44,
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 14, marginTop: 3 },
  sectionTitle: { fontSize: 18, fontWeight: "700" },
  intro: { paddingVertical: 12, marginBottom: 12 },
  description: { fontSize: 14, lineHeight: 21, marginTop: 7 },
  state: { alignItems: "center", paddingVertical: 25, gap: 12 },
  stateText: { fontSize: 14, lineHeight: 21, paddingVertical: 10 },
  channel: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 18,
    marginBottom: 14,
  },
  conversationList: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  channelChoice: {
    borderTopWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  channelName: { fontSize: 15, fontWeight: "600" },
  channelMeta: { fontSize: 12, marginTop: 4 },
  listHeading: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
    paddingVertical: 12,
    borderBottomWidth: 0,
  },
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
  pageControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    gap: 10,
  },
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
