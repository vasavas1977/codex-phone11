import { useState, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Alert, View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useRecordingStore } from "@/lib/recording/store";
import { useAuth } from "@/hooks/use-auth";
import { useCallHistoryStore, historyDuration, isMissedCall } from "@/lib/sip/call-history";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipAccountStore } from "@/lib/sip/account-store";

type CallType = "incoming" | "outgoing" | "missed";

interface CallRecord {
  id: string;
  name: string;
  number: string;
  type: CallType;
  duration: string;
  time: string;
  group: string;
  presence?: "online" | "busy" | "away" | "offline";
  hasRecording?: boolean;
  recordingId?: string;
}

const PRESENCE_COLORS: Record<string, string> = {
  online: "#00C896",
  busy: "#FF3B30",
  away: "#FF9500",
  offline: "#6B7280",
};

function dateGroup(timestamp: number): string {
  const date = new Date(timestamp);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === new Date().toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const CALL_ICONS: Record<CallType, "phone.arrow.down.left" | "phone.arrow.up.right" | "phone.fill.arrow.down.left"> = {
  incoming: "phone.arrow.down.left",
  outgoing: "phone.arrow.up.right",
  missed: "phone.fill.arrow.down.left",
};

function formatPlaybackTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function RecentsScreen() {
  const colors = useColors();
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const { user } = useAuth({ autoFetch: false });
  const history = useCallHistoryStore();
  const { makeCall } = useSip();
  const registration = useSipAccountStore(state => state.registrationState);
  const dial = async (number: string) => {
    if (registration !== "registered") {
      Alert.alert("Phone is not registered", "Register your phone before calling.");
      return;
    }
    try {
      const callId = await makeCall(number, false);
      if (!callId) throw new Error("Call did not start");
      router.push({ pathname: "/call/active", params: { callId, number, type: "voice" } });
    } catch { Alert.alert("Call could not start", "Check SIP registration and try again."); }
  };
  useFocusEffect(useCallback(() => { void history.reload(); }, [history.reload, user?.id]));
  const { recordings, playback, startPlayback, stopPlayback, togglePlayPause } = useRecordingStore();

  const filtered: CallRecord[] = (history.ownerUserId === user?.id ? history.entries : [])
    .filter(call => call.ownerUserId === user?.id && (filter === "all" || isMissedCall(call)))
    .map(call => ({
      id: call.id, name: call.name || call.number, number: call.number,
      type: isMissedCall(call) ? "missed" : call.direction === "inbound" ? "incoming" : "outgoing",
      duration: call.endedAt === undefined ? "Incomplete" : call.answeredAt !== undefined
        ? formatPlaybackTime(historyDuration(call)) : isMissedCall(call) ? "Missed" : "Not answered",
      time: new Date(call.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      group: dateGroup(call.startedAt),
    }));

  const isPlaying = playback.isPlaying && playback.recordingId !== null;
  const currentRecording = recordings.find((r) => r.id === playback.recordingId);

  const handleRecordingTap = (recordingId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/recording/[id]", params: { id: recordingId } });
  };

  const renderItem = ({ item }: { item: CallRecord }) => {
    const isMissed = item.type === "missed";
    const nameColor = isMissed ? colors.error : colors.foreground;

    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: colors.border }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          void dial(item.number);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.avatarContainer}>
          <View style={[styles.avatar, { backgroundColor: isMissed ? colors.error + "20" : colors.primary + "15" }]}>
            <Text style={[styles.avatarText, { color: isMissed ? colors.error : colors.primary }]}>
              {item.name.charAt(0)}
            </Text>
          </View>
          {item.presence && (
            <View style={[styles.presenceDot, { backgroundColor: PRESENCE_COLORS[item.presence], borderColor: colors.background }]} />
          )}
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text numberOfLines={1} style={[styles.name, { color: nameColor, flexShrink: 1 }]}>{item.name}</Text>
            {item.hasRecording && (
              <View style={[styles.recBadge, { backgroundColor: colors.error + "15" }]}>
                <View style={[styles.recDot, { backgroundColor: colors.error }]} />
                <Text style={[styles.recBadgeText, { color: colors.error }]}>REC</Text>
              </View>
            )}
          </View>
          <View style={styles.subRow}>
            <IconSymbol
              name={CALL_ICONS[item.type]}
              size={13}
              color={isMissed ? colors.error : item.type === "outgoing" ? colors.primary : colors.success}
            />
            <Text style={[styles.number, { color: colors.muted }]}> {item.number}</Text>
          </View>
        </View>
        <View style={styles.meta}>
          <Text style={[styles.time, { color: colors.muted }]}>{item.time}</Text>
          {item.duration ? (
            <Text style={[styles.duration, { color: colors.muted }]}>{item.duration}</Text>
          ) : (
            <Text style={[styles.duration, { color: colors.error }]}>Missed</Text>
          )}
        </View>
        <View style={styles.actionIcons}>
          {item.hasRecording && item.recordingId && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => handleRecordingTap(item.recordingId!)}
            >
              <IconSymbol name="play.fill" size={16} color={colors.primary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void dial(item.number);
            }}
          >
            <IconSymbol name="phone.fill" size={16} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Recents</Text>
        <View style={styles.filterRow}>
          {(["all", "missed"] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filter === f && { backgroundColor: colors.primary }]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, { color: filter === f ? "#fff" : colors.muted }]}>
                {f === "all" ? "All" : "Missed"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={filtered}
        renderItem={({ item, index }) => <View>
          {(index === 0 || filtered[index - 1].group !== item.group) &&
            <Text style={[styles.groupHeader, { color: colors.muted }]}>{item.group}</Text>}
          {renderItem({ item })}
        </View>}
        refreshing={history.loading}
        onRefresh={() => void history.reload()}
        ListHeaderComponent={history.error ? <Text style={{ padding: 20, color: colors.error }}>{history.error}</Text> : null}
        ListEmptyComponent={<Text style={{ padding: 24, textAlign: "center", color: colors.muted }}>
          {!user ? "Sign in to see your calls" : history.loading ? "Loading calls..." : filter === "missed" ? "No missed calls" : "No saved calls"}
        </Text>}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={isPlaying ? { paddingBottom: 80 } : undefined}
      />

      {/* Mini Player — shows when a recording is playing */}
      {isPlaying && currentRecording && (
        <View style={[styles.miniPlayer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={styles.miniPlayerContent}
            onPress={() => router.push({ pathname: "/recording/[id]", params: { id: currentRecording.id } })}
            activeOpacity={0.8}
          >
            <View style={[styles.miniRecIcon, { backgroundColor: colors.error + "15" }]}>
              <View style={[styles.miniRecDot, { backgroundColor: colors.error }]} />
            </View>
            <View style={styles.miniPlayerInfo}>
              <Text style={[styles.miniPlayerName, { color: colors.foreground }]} numberOfLines={1}>
                {currentRecording.callerName} → {currentRecording.calleeName}
              </Text>
              <View style={styles.miniProgressContainer}>
                <View style={[styles.miniProgressBg, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.miniProgressFill,
                      {
                        backgroundColor: colors.primary,
                        width: `${(playback.currentPosition / playback.duration) * 100}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.miniTimeText, { color: colors.muted }]}>
                  {formatPlaybackTime(playback.currentPosition)} / {formatPlaybackTime(playback.duration)}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={togglePlayPause} style={styles.miniPlayBtn}>
              <IconSymbol
                name={playback.isPlaying ? "pause.fill" : "play.fill"}
                size={20}
                color={colors.primary}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={stopPlayback} style={styles.miniPlayBtn}>
              <IconSymbol name="xmark.circle.fill" size={20} color={colors.muted} />
            </TouchableOpacity>
          </TouchableOpacity>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  filterRow: {
    flexDirection: "row",
    gap: 6,
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "transparent",
  },
  filterText: {
    fontSize: 12,
    fontWeight: "600",
  },
  groupHeader: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  presenceDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "700",
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
  },
  recBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  recDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  recBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  number: {
    fontSize: 13,
  },
  meta: {
    alignItems: "flex-end",
  },
  time: {
    fontSize: 12,
  },
  duration: {
    fontSize: 11,
    marginTop: 2,
  },
  actionIcons: {
    flexDirection: "row",
    gap: 4,
  },
  iconBtn: {
    padding: 8,
  },

  // Mini Player
  miniPlayer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  miniPlayerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  miniRecIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  miniRecDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  miniPlayerInfo: {
    flex: 1,
    gap: 4,
  },
  miniPlayerName: {
    fontSize: 13,
    fontWeight: "600",
  },
  miniProgressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  miniProgressBg: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    overflow: "hidden",
  },
  miniProgressFill: {
    height: 3,
    borderRadius: 1.5,
  },
  miniTimeText: {
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  miniPlayBtn: {
    padding: 6,
  },
});
