import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  Alert,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useConferenceStore } from "@/lib/conference/store";
import type { Conference, ConferenceConfig } from "@/lib/conference/types";
import * as Haptics from "expo-haptics";

export default function ConferenceListScreen() {
  const router = useRouter();
  const colors = useColors();
  const { history, activeConference, createConference, joinConference, init } =
    useConferenceStore();

  const [showCreate, setShowCreate] = useState(false);
  const [confName, setConfName] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("50");
  const [muteOnEntry, setMuteOnEntry] = useState(false);
  const [recordEnabled, setRecordEnabled] = useState(false);
  const [waitForMod, setWaitForMod] = useState(false);

  useEffect(() => {
    init();
  }, []);

  const handleCreateConference = async () => {
    if (!confName.trim()) {
      Alert.alert("Error", "Please enter a conference name");
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const config: Partial<ConferenceConfig> = {
      maxParticipants: parseInt(maxParticipants) || 50,
      muteOnEntry,
      recordEnabled,
      waitForModerator: waitForMod,
    };

    await createConference(confName.trim(), config);
    setShowCreate(false);
    setConfName("");
    router.push("/conference/room" as any);
  };

  const handleMeetNow = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await createConference(`Quick Meeting ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    router.push("/conference/room" as any);
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  const renderConference = ({ item }: { item: Conference }) => {
    const isActive = item.state === "active";

    return (
      <TouchableOpacity
        style={[styles.confCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => {
          if (isActive) {
            joinConference(item.id);
            router.push("/conference/room" as any);
          }
        }}
      >
        <View style={styles.confCardLeft}>
          <View
            style={[
              styles.confIcon,
              { backgroundColor: isActive ? "#34C75920" : `${colors.primary}15` },
            ]}
          >
            <IconSymbol
              name="person.3.fill"
              size={20}
              color={isActive ? "#34C759" : colors.primary}
            />
          </View>
        </View>

        <View style={styles.confCardCenter}>
          <View style={styles.confNameRow}>
            <Text style={[styles.confName, { color: colors.foreground }]} numberOfLines={1}>
              {item.name}
            </Text>
            {isActive && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
          <Text style={[styles.confMeta, { color: colors.muted }]}>
            {item.participants.length} participant{item.participants.length !== 1 ? "s" : ""}
            {" • "}
            {item.state === "ended"
              ? formatDuration(item.duration)
              : formatDate(item.createdAt)}
          </Text>
          {item.isRecording && (
            <View style={styles.recordBadge}>
              <View style={[styles.recordDotSmall, { backgroundColor: "#FF3B30" }]} />
              <Text style={{ color: "#FF3B30", fontSize: 11, fontWeight: "600" }}>Recorded</Text>
            </View>
          )}
        </View>

        <View style={styles.confCardRight}>
          <Text style={[styles.confTime, { color: colors.muted }]}>
            {formatDate(item.createdAt)}
          </Text>
          {isActive && (
            <TouchableOpacity
              style={[styles.joinBtn, { backgroundColor: "#34C759" }]}
              onPress={() => {
                joinConference(item.id);
                router.push("/conference/room" as any);
              }}
            >
              <Text style={styles.joinBtnText}>Join</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Conference Bridge</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)}>
          <IconSymbol name="plus" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Meet Now Hero Button */}
      <TouchableOpacity
        style={[styles.meetNowHero, { backgroundColor: colors.primary }]}
        onPress={handleMeetNow}
      >
        <View style={styles.meetNowContent}>
          <View style={styles.meetNowIcon}>
            <IconSymbol name="video.fill" size={28} color="#FFFFFF" />
          </View>
          <View style={styles.meetNowText}>
            <Text style={styles.meetNowTitle}>Meet Now</Text>
            <Text style={styles.meetNowSubtitle}>
              Start an instant conference for up to 50 participants
            </Text>
          </View>
        </View>
        <IconSymbol name="chevron.right" size={20} color="#FFFFFF80" />
      </TouchableOpacity>

      {/* Active conference banner */}
      {activeConference && (
        <TouchableOpacity
          style={[styles.activeBanner, { backgroundColor: "#34C75920", borderColor: "#34C759" }]}
          onPress={() => router.push("/conference/room" as any)}
        >
          <View style={styles.activeBannerLeft}>
            <View style={styles.activePulse} />
            <Text style={[styles.activeBannerText, { color: "#34C759" }]}>
              Active: {activeConference.name}
            </Text>
          </View>
          <Text style={[styles.activeBannerJoin, { color: "#34C759" }]}>
            Rejoin →
          </Text>
        </TouchableOpacity>
      )}

      {/* Conference History */}
      <FlatList
        data={history}
        renderItem={renderConference}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <IconSymbol name="person.3.fill" size={48} color={colors.muted} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No Conferences Yet
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.muted }]}>
              Tap "Meet Now" to start your first conference call
            </Text>
          </View>
        }
        ListHeaderComponent={
          history.length > 0 ? (
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>RECENT CONFERENCES</Text>
          ) : null
        }
      />

      {/* Create Conference Modal */}
      {showCreate && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                New Conference
              </Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <IconSymbol name="xmark" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: colors.muted }]}>Conference Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              value={confName}
              onChangeText={setConfName}
              placeholder="e.g. Sales Team Standup"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
            />

            <Text style={[styles.inputLabel, { color: colors.muted }]}>Max Participants</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              value={maxParticipants}
              onChangeText={setMaxParticipants}
              keyboardType="number-pad"
              placeholder="50"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
            />

            <View style={styles.toggleRow}>
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Mute on Entry</Text>
              <Switch value={muteOnEntry} onValueChange={setMuteOnEntry} trackColor={{ true: colors.primary }} />
            </View>

            <View style={styles.toggleRow}>
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Auto-Record</Text>
              <Switch value={recordEnabled} onValueChange={setRecordEnabled} trackColor={{ true: colors.primary }} />
            </View>

            <View style={styles.toggleRow}>
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Wait for Moderator</Text>
              <Switch value={waitForMod} onValueChange={setWaitForMod} trackColor={{ true: colors.primary }} />
            </View>

            <TouchableOpacity
              style={[styles.createBtn, { backgroundColor: colors.primary }]}
              onPress={handleCreateConference}
            >
              <IconSymbol name="video.fill" size={18} color="#FFFFFF" />
              <Text style={styles.createBtnText}>Create & Start Conference</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 20, fontWeight: "700" },

  // Meet Now Hero
  meetNowHero: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  meetNowContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 14 },
  meetNowIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  meetNowText: { flex: 1 },
  meetNowTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  meetNowSubtitle: { color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 2 },

  // Active banner
  activeBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  activeBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  activePulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#34C759" },
  activeBannerText: { fontSize: 14, fontWeight: "600" },
  activeBannerJoin: { fontSize: 14, fontWeight: "700" },

  // List
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },

  // Conference card
  confCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 8,
  },
  confCardLeft: { marginRight: 12 },
  confIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  confCardCenter: { flex: 1 },
  confNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  confName: { fontSize: 15, fontWeight: "600", flex: 1 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#34C75920",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#34C759" },
  liveText: { color: "#34C759", fontSize: 10, fontWeight: "700" },
  confMeta: { fontSize: 13, marginTop: 2 },
  recordBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  recordDotSmall: { width: 6, height: 6, borderRadius: 3 },
  confCardRight: { alignItems: "flex-end", gap: 6 },
  confTime: { fontSize: 12 },
  joinBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  joinBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },

  // Empty state
  emptyState: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptySubtext: { fontSize: 14, textAlign: "center", paddingHorizontal: 40 },

  // Modal
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  inputLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 4,
  },
  toggleLabel: { fontSize: 15 },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  createBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
