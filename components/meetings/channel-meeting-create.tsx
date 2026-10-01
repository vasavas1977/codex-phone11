import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ChannelMeetingPicker } from "@/components/chat/channel-meeting-picker";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
import { createChatTransport } from "@/lib/chat/transport";
import type { ChatChannel, ChatPerson } from "@/lib/chat/types";

const api = createChatTransport();
type Owner = NonNullable<ReturnType<typeof useAuth>["user"]>;
type Scope = { owner: Owner; tenantId: number; channel: ChatChannel };
type Selection = Scope & {
  request: Scope;
  members: ChatPerson[];
  loading: boolean;
  rosterError: string | null;
  capability: {
    available: boolean;
    canStart: boolean;
    maxSelectedMembers: number;
  } | null;
  error: string | null;
};
type Attempt = Scope & { requestId: string; selectedIds: number[] };

const sameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Uses the existing channel admission/invitation workflow, never a second calendar or room store. */
export function ChannelMeetingCreate() {
  const { user } = useAuth({ autoFetch: false });
  const colors = useColors();
  const chat = useChatStore();
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busyScope, setBusyScope] = useState<Scope | null>(null);
  const active = useRef<Scope | null>(null);
  const pending = useRef<Scope | null>(null);
  const attempts = useRef(new Map<string, Attempt>());
  const focused = useRef(false);
  const ownsWorkspace =
    !!user &&
    getAuthSnapshot().user === user &&
    chat.userId === user.id &&
    !!chat.workspace;
  const current = (scope: Scope) => {
    const auth = getAuthSnapshot();
    const state = useChatStore.getState();
    return (
      focused.current &&
      !auth.loading &&
      auth.user === scope.owner &&
      state.userId === scope.owner.id &&
      state.workspace?.id === scope.tenantId &&
      state.channels.some(
        (channel) =>
          channel.id === scope.channel.id &&
          channel.kind === scope.channel.kind &&
          (channel.kind === "channel" || channel.kind === "group"),
      )
    );
  };
  const visible =
    selection &&
    selection.request === active.current &&
    selection.owner === user &&
    ownsWorkspace &&
    selection.tenantId === chat.workspace?.id &&
    chat.channels.some(
      (channel) =>
        channel.id === selection.channel.id &&
        channel.kind === selection.channel.kind,
    )
      ? selection
      : null;
  const busy =
    !!busyScope &&
    visible?.owner === busyScope.owner &&
    visible.tenantId === busyScope.tenantId &&
    visible.channel.id === busyScope.channel.id;

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      active.current = null;
      setSelection(null);
      setQuery("");
      if (
        user &&
        getAuthSnapshot().user === user &&
        useChatStore.getState().userId === user.id
      )
        void useChatStore.getState().loadChannels(chat.workspace?.id);
      return () => {
        focused.current = false;
        active.current = null;
      };
    }, [user, chat.workspace?.id]),
  );

  const back = () => {
    if (pending.current) return;
    active.current = null;
    if (router.canGoBack()) router.back();
    else router.replace("/conference");
  };
  const close = () => {
    if (pending.current) return;
    active.current = null;
    setSelection(null);
  };
  const choose = async (channel: ChatChannel) => {
    if (!ownsWorkspace || !user || !chat.workspace || pending.current) return;
    const scope: Scope = { owner: user, tenantId: chat.workspace.id, channel };
    if (!current(scope)) return;
    active.current = scope;
    setSelection({
      ...scope,
      request: scope,
      members: [],
      loading: true,
      rosterError: null,
      capability: null,
      error: null,
    });
    // Both reads must complete before Start is enabled. A cancelled or stale
    // read cannot populate another account, workspace, or channel's picker.
    const [roster, capability] = await Promise.allSettled([
      api.details(scope.tenantId, channel.id),
      api.channelMeetingCapabilities(scope.tenantId, channel.id),
    ]);
    if (active.current !== scope || !current(scope)) return;
    setSelection({
      ...scope,
      request: scope,
      members: roster.status === "fulfilled" ? roster.value.members : [],
      loading: false,
      rosterError:
        roster.status === "rejected"
          ? "Could not load channel members. Cancel and choose this channel again to retry."
          : null,
      capability: capability.status === "fulfilled" ? capability.value : null,
      error:
        capability.status === "rejected"
          ? "Could not check meeting hosting. Cancel and choose this channel again to retry."
          : null,
    });
  };
  const start = async (memberIds: number[]) => {
    const scope = visible?.request;
    if (
      !scope ||
      active.current !== scope ||
      !visible ||
      visible.loading ||
      visible.rosterError ||
      !visible.capability?.available ||
      !visible.capability.canStart ||
      pending.current ||
      !current(scope)
    )
      return;
    const selected = [...new Set(memberIds)].sort((a, b) => a - b);
    if (
      !selected.length ||
      selected.length !== memberIds.length ||
      selected.length > visible.capability.maxSelectedMembers ||
      selected.includes(scope.owner.id) ||
      !visible.members.some((member) => member.id === scope.owner.id) ||
      !selected.every((id) =>
        visible.members.some((member) => member.id === id),
      )
    )
      return;
    const key = `${scope.owner.id}:${scope.tenantId}:${scope.channel.id}`;
    const previous = attempts.current.get(key);
    if (
      previous?.owner === scope.owner &&
      !sameIds(previous.selectedIds, selected)
    ) {
      setSelection((value) =>
        value && active.current === scope
          ? {
              ...value,
              error:
                "The previous request may already have created a meeting. Retry with the original selection, or return to Meetings to find it.",
            }
          : value,
      );
      return;
    }
    pending.current = scope;
    setBusyScope(scope);
    setSelection((value) => (value ? { ...value, error: null } : value));
    try {
      const capability = await api.channelMeetingCapabilities(
        scope.tenantId,
        scope.channel.id,
      );
      if (active.current !== scope || !current(scope)) return;
      if (
        !capability.available ||
        !capability.canStart ||
        selected.length > capability.maxSelectedMembers
      ) {
        setSelection((value) =>
          value
            ? {
                ...value,
                capability,
                error: "Meeting hosting changed. No new request was sent.",
              }
            : value,
        );
        return;
      }
      // The server supports requestId replay for exactly the same host, channel
      // and selection. Keep it after an uncertain response, including Cancel.
      const attempt =
        previous?.owner === scope.owner
          ? previous
          : {
              ...scope,
              selectedIds: selected,
              requestId: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
                /[xy]/g,
                (c) => {
                  const n = Math.floor(Math.random() * 16);
                  return (c === "x" ? n : (n & 3) | 8).toString(16);
                },
              ),
            };
      attempts.current.set(key, attempt);
      const result = await api.startChannelMeeting(
        scope.tenantId,
        scope.channel.id,
        selected,
        attempt.requestId,
      );
      if (active.current !== scope || !current(scope)) return;
      if (
        !uuid.test(result.meetingId) ||
        result.channelId !== scope.channel.id ||
        !sameIds(
          [...result.invitedMemberIds].sort((a, b) => a - b),
          selected,
        )
      )
        throw new Error("Invalid meeting acknowledgement");
      active.current = null;
      setSelection(null);
      router.replace({
        pathname: "/conference",
        params: {
          meetingId: result.meetingId,
          tenantId: String(scope.tenantId),
          source: "channel",
        },
      });
    } catch {
      if (active.current === scope && current(scope))
        setSelection((value) =>
          value
            ? {
                ...value,
                error:
                  "Could not confirm the meeting. Retry with the same selection to recover the original request safely.",
              }
            : value,
        );
    } finally {
      if (pending.current === scope) pending.current = null;
      setBusyScope((value) => (value === scope ? null : value));
    }
  };
  const channels = ownsWorkspace
    ? chat.channels.filter(
        (channel) =>
          (channel.kind === "channel" || channel.kind === "group") &&
          channel.name
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
      )
    : [];
  return (
    <>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Meetings"
          disabled={!!pending.current}
          onPress={back}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: colors.primary }}>‹ Meetings</Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 28, fontWeight: "700", color: colors.foreground }}
        >
          New meeting
        </Text>
        <Text style={{ color: colors.muted }}>
          Choose a team channel, select who to invite, then check your
          microphone and camera before joining.
        </Text>
        {!user ? (
          <Text accessibilityRole="alert" style={{ color: colors.muted }}>
            Sign in to create a workspace meeting.
          </Text>
        ) : chat.userId !== user.id || !chat.workspace ? (
          <Text style={{ color: colors.muted }}>
            Open Team Chat and select a workspace to create a meeting.
          </Text>
        ) : (
          <>
            <Text style={{ fontWeight: "600", color: colors.foreground }}>
              {ownsWorkspace ? chat.workspace.name : "Workspace unavailable"}
            </Text>
            <TextInput
              accessibilityLabel="Search meeting channels"
              placeholder="Search channels"
              value={query}
              onChangeText={setQuery}
              editable={ownsWorkspace && !chat.loading}
              style={{
                color: colors.foreground,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 12,
                borderRadius: 12,
              }}
            />
            {chat.loading ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.muted }}
              >
                Loading your channels…
              </Text>
            ) : chat.error ? (
              <>
                <Text accessibilityRole="alert" style={{ color: colors.error }}>
                  Could not refresh your channels. Try again.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry meeting channels"
                  onPress={() => {
                    if (
                      user &&
                      getAuthSnapshot().user === user &&
                      useChatStore.getState().userId === user.id
                    )
                      void useChatStore
                        .getState()
                        .loadChannels(chat.workspace?.id);
                  }}
                  style={{ minHeight: 44 }}
                >
                  <Text style={{ color: colors.primary }}>Retry</Text>
                </Pressable>
              </>
            ) : (
              channels.map((channel) => (
                <Pressable
                  key={channel.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose meeting channel ${channel.name}`}
                  disabled={!!pending.current}
                  onPress={() => void choose(channel)}
                  style={{
                    minHeight: 56,
                    justifyContent: "center",
                    padding: 12,
                    backgroundColor: colors.surface,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontSize: 17 }}>
                    {channel.name}
                  </Text>
                  <Text style={{ color: colors.muted }}>
                    {channel.kind === "group" ? "Group chat" : "Channel"}
                  </Text>
                </Pressable>
              ))
            )}
            {!chat.loading && !chat.error && !channels.length && (
              <Text style={{ color: colors.muted }}>
                No matching channels. Create or join a team channel in Team Chat
                first.
              </Text>
            )}
          </>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Team Chat"
          disabled={!!pending.current}
          onPress={() => {
            if (!pending.current) router.push("/(tabs)/teamchat");
          }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: colors.primary }}>Open Team Chat</Text>
        </Pressable>
      </ScrollView>
      {visible && (
        <ChannelMeetingPicker
          visible
          tenantId={visible.tenantId}
          channelId={visible.channel.id}
          channelName={visible.channel.name}
          hostId={visible.owner.id}
          members={visible.members}
          loading={visible.loading}
          rosterError={visible.rosterError}
          busy={busy}
          error={visible.error}
          startAvailable={
            !visible.loading &&
            !visible.rosterError &&
            visible.capability?.available === true &&
            visible.capability.canStart === true
          }
          maxSelectedMembers={visible.capability?.maxSelectedMembers}
          unavailableReason={
            visible.loading
              ? "Checking meeting hosting…"
              : "Meeting hosting is not enabled for you in this channel. No invitations have been sent."
          }
          onCancel={close}
          onStart={(ids) => void start(ids)}
        />
      )}
    </>
  );
}
