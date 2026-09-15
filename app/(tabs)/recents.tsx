import { useState, useCallback } from "react";
import {
  FlatList,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import {
  CallHistoryRow,
  type HistoryRowCall,
} from "@/components/cloud-recordings/call-history-view";
import { LiveRecordingPanel } from "@/components/cloud-recordings/live-recording-panel";
import { useCloudRecordings } from "@/hooks/use-cloud-recordings";
import { useDeviceContacts } from "@/hooks/use-device-contacts";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { usePhoneCall } from "@/hooks/use-phone-call";
import { deviceContactName } from "@/lib/phone/device-contacts";
import {
  contactPhoneKey,
  internationalHistoryNumber,
} from "@/lib/phone/phone-number";
import {
  useCallHistoryStore,
  historyDuration,
  isMissedCall,
} from "@/lib/sip/call-history";
import type { CloudRecording } from "@/shared/cloud-recordings";
import { CallActionsSheet } from "@/components/cloud-recordings/call-actions-sheet";
import { useCallFavorites } from "@/hooks/use-call-favorites";
import { useCallBlocks } from "@/hooks/use-call-blocks";
import { useHiddenCalls } from "@/hooks/use-hidden-calls";
import {
  uniqueDeviceContactId,
  resolveExistingDirectChat,
} from "@/lib/phone/call-actions";
import { useChatStore } from "@/lib/chat/store";
import { getAuthSnapshot } from "@/lib/_core/auth";
type Row = HistoryRowCall & {
  startedAt: number;
  recording?: CloudRecording;
};
type RecentsFilter = "all" | "missed" | "recorded" | "hidden";
const filters: readonly {
  value: Exclude<RecentsFilter, "hidden">;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "missed", label: "Missed" },
  { value: "recorded", label: "Recorded" },
];
function matchesSearch(row: Row, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  if (`${row.name} ${row.number}`.toLocaleLowerCase().includes(normalized))
    return true;
  const digits = normalized.replace(/\D/g, "");
  if (
    digits.length > 0 &&
    `${row.name} ${row.number}`.replace(/\D/g, "").includes(digits)
  )
    return true;
  const queryPhone = contactPhoneKey(normalized);
  const rowPhone = contactPhoneKey(row.number);
  return Boolean(queryPhone && rowPhone && queryPhone === rowPhone);
}
export function filterRecentsRows(
  rows: Row[],
  filter: RecentsFilter,
  query: string,
  hidden: (row: Row) => boolean,
) {
  return rows
    .filter((row) => (filter === "hidden" ? hidden(row) : !hidden(row)))
    .filter((row) =>
      filter === "missed"
        ? row.direction === "missed"
        : filter === "recorded"
          ? row.recordingReady
          : true,
    )
    .filter((row) => matchesSearch(row, query))
    .sort((a, b) => b.startedAt - a.startedAt);
}
const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
function group(ms: number) {
  const date = new Date(ms),
    yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === new Date().toDateString()
    ? "Today"
    : date.toDateString() === yesterday.toDateString()
      ? "Yesterday"
      : date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
}
export default function RecentsScreen() {
  const colors = useColors(),
    cloud = useCloudRecordings(),
    router = useRouter();
  const { user } = useAuth({ autoFetch: false });
  const history = useCallHistoryStore();
  const contacts = useDeviceContacts();
  const favorites = useCallFavorites(user?.id);
  const blocks = useCallBlocks(user?.id);
  const hidden = useHiddenCalls(user?.id);
  const chat = useChatStore();
  const { placeCall, calling } = usePhoneCall();
  const [filter, setFilter] = useState<RecentsFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const reloadHistory = history.reload;
  const reloadCloud = cloud.reload;
  useFocusEffect(
    useCallback(() => {
      void reloadHistory();
      void reloadCloud();
      return () => {
        setExpanded(null);
        setActionId(null);
      };
    }, [reloadHistory, reloadCloud]),
  );
  const local =
    history.ownerUserId === user?.id
      ? history.entries.filter((call) => call.ownerUserId === user?.id)
      : [];
  const ids = new Set(local.map((call) => call.id));
  const rows: Row[] = local.map((call) => {
    const recording = cloud.items.find(
      (item) => item.nativeHistoryId === call.id,
    );
    const contactName = deviceContactName(contacts.people, call.number);
    const remoteName = contactName || call.name;
    return {
      id: call.id,
      name: remoteName || call.number,
      number: call.number,
      direction: isMissedCall(call)
        ? "missed"
        : call.direction === "inbound"
          ? "incoming"
          : "outgoing",
      startedAt: call.startedAt,
      time: time(call.startedAt),
      duration:
        call.endedAt === undefined
          ? "Incomplete"
          : call.answeredAt !== undefined
            ? duration(historyDuration(call))
            : isMissedCall(call)
              ? "Missed"
              : "Not answered",
      recording,
      recordingReady: recording?.recordingStatus === "ready",
      summaryReady: recording?.summaryStatus === "ready",
    };
  });
  if (user && filter !== "missed")
    for (const recording of cloud.items) {
      if (recording.nativeHistoryId && ids.has(recording.nativeHistoryId))
        continue;
      const number = internationalHistoryNumber(recording.number);
      const remoteName = deviceContactName(contacts.people, number);
      rows.push({
        id: `cloud:${recording.callUuid}`,
        name: remoteName || number,
        number,
        direction: recording.direction === "inbound" ? "incoming" : "outgoing",
        startedAt: recording.startedAt,
        time: time(recording.startedAt),
        duration: recording.endedAt ? "" : "In progress",
        recording,
        recordingReady: recording.recordingStatus === "ready",
        summaryReady: recording.summaryStatus === "ready",
      });
    }
  const isHidden = (row: Row) =>
    hidden.ids.includes(row.id) ||
    Boolean(
      row.recording && hidden.ids.includes(`cloud:${row.recording.callUuid}`),
    );
  const visible = filterRecentsRows(
    hidden.ready ? rows : [],
    filter,
    search,
    isHidden,
  );
  const actionCall = actionId
    ? rows.find((row) => row.id === actionId)
    : undefined;
  const chatTarget =
    actionCall && user && chat.userId === user.id && chat.workspace
      ? resolveExistingDirectChat({
          number: actionCall.number,
          ownerUserId: user.id,
          workspaceId: chat.workspace.id,
          people: chat.people,
          channels: chat.channels,
        })
      : undefined;
  const openActions = (id: string) => {
    setActionId(id);
    if (!user || getAuthSnapshot().user?.id !== user.id) return;
    chat.setUser(user.id);
    void useChatStore
      .getState()
      .loadChannels()
      .then(() => {
        if (
          getAuthSnapshot().user?.id === user.id &&
          useChatStore.getState().userId === user.id
        )
          return useChatStore.getState().loadDirectory();
      })
      .catch(() => {});
  };
  return (
    <ScreenContainer>
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 12,
          gap: 14,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            fontSize: 28,
            fontWeight: "700",
            color: colors.foreground,
          }}
        >
          Recents
        </Text>
        <TextInput
          accessibilityLabel="Search recent calls"
          value={search}
          onChangeText={setSearch}
          placeholder="Search name or number"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{
            minHeight: 44,
            borderRadius: 14,
            paddingHorizontal: 14,
            fontSize: 15,
            color: colors.foreground,
            backgroundColor: colors.surface,
          }}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {filters.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Show ${label.toLocaleLowerCase()} calls`}
              accessibilityState={{ selected: filter === value }}
              onPress={() => setFilter(value)}
              style={{
                minHeight: 44,
                paddingHorizontal: 18,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor:
                  filter === value ? colors.primary : colors.surface,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: filter === value ? "white" : colors.muted,
                }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {hidden.ids.length > 0 && (
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setFilter(filter === "hidden" ? "all" : "hidden")}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: colors.primary }}>Hidden calls</Text>
            </TouchableOpacity>
            {filter === "hidden" && (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  void hidden
                    .restoreAll()
                    .then(() => setFilter("all"))
                    .catch(() => {});
                }}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ color: colors.primary }}>Restore all</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshing={history.loading || cloud.loading}
        onRefresh={() => {
          void history.reload();
          void cloud.reload();
        }}
        ListHeaderComponent={
          history.error ||
          cloud.error ||
          hidden.error ||
          favorites.error ||
          blocks.error ? (
            <Text
              style={{
                paddingHorizontal: 20,
                paddingBottom: 12,
                color: colors.muted,
                lineHeight: 22,
              }}
            >
              {history.error ||
                cloud.error ||
                hidden.error ||
                favorites.error ||
                blocks.error}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Text
            style={{ padding: 24, color: colors.muted, textAlign: "center" }}
          >
            {!user
              ? "Sign in to see your calls"
              : history.loading || !hidden.ready
                ? "Loading calls..."
                : filter === "missed"
                  ? "No missed calls"
                  : search.trim()
                    ? "No calls match your search"
                    : filter === "recorded"
                      ? "No recorded calls"
                      : "No saved calls"}
          </Text>
        }
        renderItem={({ item, index }) => (
          <View>
            {(index === 0 ||
              group(visible[index - 1].startedAt) !==
                group(item.startedAt)) && (
              <Text
                style={{
                  paddingHorizontal: 20,
                  paddingTop: 18,
                  paddingBottom: 8,
                  fontSize: 12,
                  fontWeight: "600",
                  color: colors.muted,
                }}
              >
                {group(item.startedAt)}
              </Text>
            )}
            <CallHistoryRow
              call={item}
              starred={favorites.starred(item.number)}
              colors={colors}
              expanded={expanded === item.id}
              calling={calling}
              onToggle={() =>
                setExpanded(expanded === item.id ? null : item.id)
              }
              onCall={() => void placeCall(item.number)}
              onMore={() => openActions(item.id)}
            >
              {item.recording ? (
                <LiveRecordingPanel
                  callUuid={item.recording.callUuid}
                  contactName={item.name}
                />
              ) : (
                <Text
                  style={{
                    paddingHorizontal: 20,
                    paddingBottom: 20,
                    fontSize: 13,
                    color: colors.muted,
                  }}
                >
                  No cloud recording for this call.
                </Text>
              )}
            </CallHistoryRow>
          </View>
        )}
      />
      {actionCall && user && (
        <CallActionsSheet
          visible
          call={{
            ...actionCall,
            ownerUserId: user.id,
            occurredAtLabel: new Date(actionCall.startedAt).toLocaleString(),
            deviceContactId: uniqueDeviceContactId(
              contacts.people,
              actionCall.number,
            ),
            recordingStatus: actionCall.recording?.recordingStatus,
            summaryStatus: actionCall.recording?.summaryStatus,
          }}
          starred={favorites.starred(actionCall.number)}
          calling={calling}
          onCall={() => {
            setActionId(null);
            void placeCall(actionCall.number);
          }}
          onToggleStar={async () => {
            await favorites.toggle(actionCall.number);
          }}
          blockReason={blocks.reason(actionCall.number)}
          onSetBlock={async (reason) => {
            await blocks.set(actionCall.number, reason);
          }}
          onDeleteHistory={async () => {
            await hidden.hide(actionCall.id);
            if (actionCall.recording)
              await hidden.hide(`cloud:${actionCall.recording.callUuid}`);
            setActionId(null);
            setExpanded(null);
          }}
          onClose={() => setActionId(null)}
          onChat={
            chatTarget
              ? () => {
                  setActionId(null);
                  router.push({
                    pathname: "/chat/[id]",
                    params: {
                      id: chatTarget.conversationId,
                      tenantId: String(chatTarget.workspaceId),
                    },
                  });
                }
              : undefined
          }
          extraActions={
            actionCall.recording
              ? [
                  {
                    id: "copy-transcript",
                    label: "Copy transcript",
                    icon: "doc.on.clipboard",
                    onPress: async () => {
                      const identity = getAuthSnapshot().user;
                      if (!identity || identity.id !== user.id)
                        throw new Error("Account changed");
                      const { createTRPCClient } = await import("@/lib/trpc");
                      const Clipboard = await import("expo-clipboard");
                      const detail =
                        await createTRPCClient().cloudRecordings.detail.query({
                          callUuid: actionCall.recording!.callUuid,
                        });
                      if (getAuthSnapshot().user !== identity)
                        throw new Error("Account changed");
                      if (!detail.transcript)
                        throw new Error("Transcription is not ready yet");
                      if (!(await Clipboard.setStringAsync(detail.transcript)))
                        throw new Error("Could not copy transcript");
                    },
                  },
                  {
                    id: "summary",
                    label: "Summary and transcription",
                    icon: "doc.text.fill",
                    onPress: () => {
                      setActionId(null);
                      router.push({
                        pathname: "/call-recording/[callUuid]",
                        params: { callUuid: actionCall.recording!.callUuid },
                      });
                    },
                  },
                ]
              : undefined
          }
        />
      )}
    </ScreenContainer>
  );
}
