import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Platform,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useConferenceStore } from "@/lib/conference/store";
import type { Participant, ConferenceAction } from "@/lib/conference/types";
import * as Haptics from "expo-haptics";

export default function ConferenceRoomScreen() {
  const router = useRouter();
  const colors = useColors();
  const {
    activeConference,
    leaveConference,
    executeAction,
    toggleRecording,
    addParticipant,
  } = useConferenceStore();

  const [elapsed, setElapsed] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeConference?.startedAt) {
        setElapsed(Math.floor((Date.now() - activeConference.startedAt) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeConference?.startedAt]);

  // Recording pulse animation
  useEffect(() => {
    if (activeConference?.isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [activeConference?.isRecording]);

  if (!activeConference) {
    return (
      <View style={[styles.container, { backgroundColor: "#1C1C1E" }]}>
        <Text style={styles.noConference}>No active conference</Text>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.primary }]}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const handleAction = async (action: ConferenceAction) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await executeAction(action);
  };

  const handleEndConference = () => {
    Alert.alert(
      "End Conference",
      `End "${activeConference.name}" for all ${activeConference.participants.length} participants?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End for All",
          style: "destructive",
          onPress: async () => {
            await leaveConference();
            router.back();
          },
        },
      ]
    );
  };

  const handleKickParticipant = (participant: Participant) => {
    Alert.alert(
      "Remove Participant",
      `Remove ${participant.name} from the conference?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => handleAction({ type: "kick_participant", participantId: participant.id }),
        },
      ]
    );
  };

  const handleAddDemoParticipants = async () => {
    const demoUsers = [
      { ext: "1002", name: "Sarah Chen" },
      { ext: "1003", name: "Mike Johnson" },
      { ext: "1004", name: "Emily Davis" },
      { ext: "1005", name: "David Kim" },
      { ext: "1006", name: "Lisa Wang" },
    ];
    for (const user of demoUsers) {
      await addParticipant(user.ext, user.name);
    }
    setShowAddParticipant(false);
  };

  const renderParticipant = ({ item }: { item: Participant }) => {
    const isSelf = item.id === "p_self";
    const isModerator = item.role === "moderator";

    return (
      <View style={[styles.participantCard, { backgroundColor: "#2C2C2E" }]}>
        {/* Avatar with speaking indicator */}
        <View style={styles.avatarContainer}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: isModerator ? "#FFD60A" : colors.primary,
                borderColor: item.isSpeaking ? "#34C759" : "transparent",
                borderWidth: item.isSpeaking ? 3 : 0,
              },
            ]}
          >
            <Text style={styles.avatarText}>
              {item.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </Text>
          </View>
          {/* Mute indicator */}
          {item.isMuted && (
            <View style={styles.muteIndicator}>
              <IconSymbol name="mic.slash.fill" size={12} color="#FF3B30" />
            </View>
          )}
          {/* Moderator badge */}
          {isModerator && (
            <View style={styles.modBadge}>
              <IconSymbol name="crown.fill" size={10} color="#FFD60A" />
            </View>
          )}
        </View>

        {/* Name and status */}
        <Text style={styles.participantName} numberOfLines={1}>
          {item.name}{isSelf ? " (You)" : ""}
        </Text>
        <Text style={[styles.participantRole, { color: isModerator ? "#FFD60A" : "#8E8E93" }]}>
          {item.role.charAt(0).toUpperCase() + item.role.slice(1)}
        </Text>

        {/* Audio level bar */}
        <View style={styles.audioBar}>
          <View
            style={[
              styles.audioLevel,
              {
                width: `${Math.min(item.audioLevel, 100)}%`,
                backgroundColor: item.isSpeaking ? "#34C759" : "#48484A",
              },
            ]}
          />
        </View>

        {/* Moderator actions on participants */}
        {!isSelf && (
          <View style={styles.participantActions}>
            <TouchableOpacity
              style={styles.pAction}
              onPress={() =>
                handleAction({
                  type: item.isMuted ? "unmute_participant" : "mute_participant",
                  participantId: item.id,
                })
              }
            >
              <IconSymbol
                name={item.isMuted ? "mic.slash.fill" : "mic.fill"}
                size={16}
                color={item.isMuted ? "#FF3B30" : "#FFFFFF"}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pAction}
              onPress={() => handleKickParticipant(item)}
            >
              <IconSymbol name="xmark" size={16} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: "#1C1C1E" }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <IconSymbol name="chevron.left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.conferenceName}>{activeConference.name}</Text>
            <View style={styles.headerMeta}>
              {activeConference.isRecording && (
                <Animated.View style={[styles.recordDot, { opacity: pulseAnim }]} />
              )}
              <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
              <Text style={styles.separatorDot}>•</Text>
              <IconSymbol name="person.3.fill" size={14} color="#8E8E93" />
              <Text style={styles.participantCount}>
                {activeConference.participants.length}/{activeConference.config.maxParticipants}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => setShowAddParticipant(true)}
            style={styles.headerBtn}
          >
            <IconSymbol name="plus" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Conference info bar */}
        <View style={[styles.infoBar, { backgroundColor: "#2C2C2E" }]}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Bridge</Text>
            <Text style={styles.infoValue}>{activeConference.bridgeNumber}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>PIN</Text>
            <Text style={styles.infoValue}>{activeConference.config.pin}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Mod PIN</Text>
            <Text style={styles.infoValue}>{activeConference.config.moderatorPin}</Text>
          </View>
        </View>
      </View>

      {/* Participant Grid */}
      <FlatList
        data={activeConference.participants}
        renderItem={renderParticipant}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.gridRow}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <IconSymbol name="person.3.fill" size={48} color="#48484A" />
            <Text style={styles.emptyText}>No participants yet</Text>
            <Text style={styles.emptySubtext}>Tap + to invite participants</Text>
          </View>
        }
      />

      {/* Moderator Controls */}
      <View style={[styles.controls, { backgroundColor: "#2C2C2E" }]}>
        {/* Top row — main controls */}
        <View style={styles.controlRow}>
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => handleAction({ type: "mute_all" })}
          >
            <View style={[styles.controlIcon, { backgroundColor: "#48484A" }]}>
              <IconSymbol name="mic.slash.fill" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.controlLabel}>Mute All</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => handleAction({ type: "unmute_all" })}
          >
            <View style={[styles.controlIcon, { backgroundColor: "#48484A" }]}>
              <IconSymbol name="mic.fill" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.controlLabel}>Unmute All</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={toggleRecording}
          >
            <View
              style={[
                styles.controlIcon,
                {
                  backgroundColor: activeConference.isRecording ? "#FF3B30" : "#48484A",
                },
              ]}
            >
              <IconSymbol
                name={activeConference.isRecording ? "stop.fill" : "record.circle.fill"}
                size={22}
                color="#FFFFFF"
              />
            </View>
            <Text
              style={[
                styles.controlLabel,
                activeConference.isRecording && { color: "#FF3B30" },
              ]}
            >
              {activeConference.isRecording ? "Stop Rec" : "Record"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => handleAction({ type: "lock_conference" })}
          >
            <View style={[styles.controlIcon, { backgroundColor: "#48484A" }]}>
              <IconSymbol name="lock.fill" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.controlLabel}>Lock</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom row — end conference */}
        <TouchableOpacity
          style={styles.endButton}
          onPress={handleEndConference}
        >
          <IconSymbol name="phone.down.fill" size={22} color="#FFFFFF" />
          <Text style={styles.endButtonText}>End Conference</Text>
        </TouchableOpacity>
      </View>

      {/* Add Participant Modal */}
      {showAddParticipant && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: "#2C2C2E" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Participants</Text>
              <TouchableOpacity onPress={() => setShowAddParticipant(false)}>
                <IconSymbol name="xmark" size={22} color="#8E8E93" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtext}>
              Invite team members to join the conference
            </Text>

            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              onPress={handleAddDemoParticipants}
            >
              <IconSymbol name="person.3.fill" size={18} color="#FFFFFF" />
              <Text style={styles.modalBtnText}>Add Demo Participants (5)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: "#48484A" }]}
              onPress={() => {
                // In production: open contacts picker
                setShowAddParticipant(false);
              }}
            >
              <IconSymbol name="person.fill.badge.plus" size={18} color="#FFFFFF" />
              <Text style={styles.modalBtnText}>Choose from Contacts</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: "#48484A" }]}
              onPress={() => setShowAddParticipant(false)}
            >
              <IconSymbol name="rectangle.grid.3x2.fill" size={18} color="#FFFFFF" />
              <Text style={styles.modalBtnText}>Dial Extension Manually</Text>
            </TouchableOpacity>

            {/* Share conference info */}
            <View style={[styles.shareBox, { backgroundColor: "#1C1C1E" }]}>
              <Text style={styles.shareTitle}>Share Conference Info</Text>
              <Text style={styles.shareText}>
                Bridge: {activeConference.bridgeNumber}{"\n"}
                PIN: {activeConference.config.pin}{"\n"}
                Moderator PIN: {activeConference.config.moderatorPin}
              </Text>
              <TouchableOpacity style={[styles.copyBtn, { backgroundColor: colors.primary }]}>
                <IconSymbol name="doc.on.clipboard" size={14} color="#FFFFFF" />
                <Text style={styles.copyBtnText}>Copy to Clipboard</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === "ios" ? 60 : 40 },
  noConference: { color: "#8E8E93", fontSize: 16, textAlign: "center", marginTop: 100 },
  backButton: { alignSelf: "center", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  backButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },

  // Header
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  conferenceName: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  recordDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FF3B30" },
  timerText: { color: "#8E8E93", fontSize: 14, fontVariant: ["tabular-nums"] },
  separatorDot: { color: "#48484A", fontSize: 14 },
  participantCount: { color: "#8E8E93", fontSize: 14, marginLeft: 2 },

  // Info bar
  infoBar: { flexDirection: "row", borderRadius: 12, padding: 12, marginTop: 12 },
  infoItem: { flex: 1, alignItems: "center" },
  infoLabel: { color: "#8E8E93", fontSize: 11, marginBottom: 2 },
  infoValue: { color: "#FFFFFF", fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  infoDivider: { width: 1, backgroundColor: "#48484A", marginVertical: 2 },

  // Participant grid
  grid: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 20 },
  gridRow: { gap: 8, marginBottom: 8 },
  participantCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
    minHeight: 140,
  },
  avatarContainer: { position: "relative", marginBottom: 8 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#1C1C1E", fontSize: 18, fontWeight: "700" },
  muteIndicator: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  modBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  participantName: { color: "#FFFFFF", fontSize: 13, fontWeight: "600", textAlign: "center" },
  participantRole: { fontSize: 11, marginTop: 2 },
  audioBar: {
    width: "80%",
    height: 3,
    backgroundColor: "#48484A",
    borderRadius: 2,
    marginTop: 6,
    overflow: "hidden",
  },
  audioLevel: { height: "100%", borderRadius: 2 },
  participantActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  pAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#48484A",
    alignItems: "center",
    justifyContent: "center",
  },

  // Controls
  controls: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  controlRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 16 },
  controlBtn: { alignItems: "center", gap: 6 },
  controlIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  controlLabel: { color: "#FFFFFF", fontSize: 11, fontWeight: "500" },
  endButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF3B30",
    borderRadius: 16,
    paddingVertical: 14,
  },
  endButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },

  // Empty state
  emptyState: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyText: { color: "#8E8E93", fontSize: 16, fontWeight: "600" },
  emptySubtext: { color: "#48484A", fontSize: 14 },

  // Modal
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  modalSubtext: { color: "#8E8E93", fontSize: 14, marginBottom: 16 },
  modalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  modalBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  shareBox: { borderRadius: 12, padding: 14, marginTop: 8 },
  shareTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 6 },
  shareText: { color: "#8E8E93", fontSize: 13, lineHeight: 20, fontVariant: ["tabular-nums"] },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  copyBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
});
