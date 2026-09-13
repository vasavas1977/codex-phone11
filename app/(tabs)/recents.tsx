import { useState, useCallback } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";
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
import { internationalHistoryNumber } from "@/lib/phone/phone-number";
import {
  useCallHistoryStore,
  historyDuration,
  isMissedCall,
} from "@/lib/sip/call-history";
import type { CloudRecording } from "@/shared/cloud-recordings";
type Row = HistoryRowCall & { startedAt: number; recording?: CloudRecording };
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
  const { placeCall, calling } = usePhoneCall();
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      void history.reload();
      void cloud.reload();
      return () => setExpanded(null);
    }, [history.reload, cloud.reload, user?.id]),
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
    return {
      id: call.id,
      name:
        deviceContactName(contacts.people, call.number) ||
        call.name ||
        call.number,
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
  if (user && filter === "all")
    for (const recording of cloud.items) {
      if (recording.nativeHistoryId && ids.has(recording.nativeHistoryId))
        continue;
      const number = internationalHistoryNumber(recording.number);
      rows.push({
        id: `cloud:${recording.callUuid}`,
        name: deviceContactName(contacts.people, number) || number,
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
  const visible = rows
    .filter((row) => filter === "all" || row.direction === "missed")
    .sort((a, b) => b.startedAt - a.startedAt);
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
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              fontSize: 28,
              fontWeight: "700",
              color: colors.foreground,
            }}
          >
            Recents
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={{ minHeight: 48, justifyContent: "center" }}
            onPress={() => router.push("/call-recording/settings")}
          >
            <Text style={{ fontSize: 13, color: colors.primary }}>
              Recording settings
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["all", "missed"] as const).map((value) => (
            <TouchableOpacity
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === value }}
              onPress={() => setFilter(value)}
              style={{
                minHeight: 48,
                minWidth: 78,
                borderRadius: 24,
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
                {value === "all" ? "All" : "Missed"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshing={history.loading}
        onRefresh={() => {
          void history.reload();
          void cloud.reload();
        }}
        ListHeaderComponent={
          history.error || cloud.error ? (
            <Text
              style={{
                paddingHorizontal: 20,
                paddingBottom: 12,
                color: colors.muted,
                lineHeight: 22,
              }}
            >
              {history.error || cloud.error}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Text
            style={{ padding: 24, color: colors.muted, textAlign: "center" }}
          >
            {!user
              ? "Sign in to see your calls"
              : history.loading
                ? "Loading calls..."
                : filter === "missed"
                  ? "No missed calls"
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
              colors={colors}
              expanded={expanded === item.id}
              calling={calling}
              onToggle={() =>
                setExpanded(expanded === item.id ? null : item.id)
              }
              onCall={() => void placeCall(item.number)}
            >
              {item.recording ? (
                <LiveRecordingPanel callUuid={item.recording.callUuid} />
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
    </ScreenContainer>
  );
}
