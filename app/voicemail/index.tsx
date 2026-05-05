import { useState } from "react";
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Voicemail {
  id: string;
  from: string;
  number: string;
  duration: string;
  time: string;
  read: boolean;
  transcription: string;
}

const VOICEMAILS: Voicemail[] = [
  {
    id: "1",
    from: "John Smith",
    number: "+1 (555) 234-5678",
    duration: "0:42",
    time: "Today, 2:15 PM",
    read: false,
    transcription: "Hey, it's John. Just calling to confirm our meeting tomorrow at 3pm. Please call me back if that doesn't work. Thanks!",
  },
  {
    id: "2",
    from: "Acme Corp",
    number: "+1 (555) 987-6543",
    duration: "1:15",
    time: "Today, 10:30 AM",
    read: false,
    transcription: "This is a message from Acme Corp regarding your account. Please call us back at your earliest convenience to discuss the renewal options.",
  },
  {
    id: "3",
    from: "Unknown",
    number: "+1 (555) 111-0000",
    duration: "0:18",
    time: "Yesterday, 4:50 PM",
    read: true,
    transcription: "Hi, I'm calling about the job posting. Please call me back when you get a chance.",
  },
  {
    id: "4",
    from: "Sarah Lee",
    number: "Ext. 2001",
    duration: "2:03",
    time: "Mar 22, 9:05 AM",
    read: true,
    transcription: "Sarah here from the support team. We've resolved the ticket you submitted. Everything should be working now. Let me know if you need anything else.",
  },
];

export default function VoicemailScreen() {
  const colors = useColors();
  const [playing, setPlaying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const togglePlay = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPlaying(playing === id ? null : id);
  };

  const renderItem = ({ item }: { item: Voicemail }) => {
    const isPlaying = playing === item.id;
    const isExpanded = expanded === item.id;

    return (
      <TouchableOpacity
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setExpanded(isExpanded ? null : item.id);
        }}
        activeOpacity={0.8}
      >
        {/* Unread indicator */}
        {!item.read && (
          <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
        )}

        <View style={styles.rowContent}>
          <View style={styles.topSection}>
            <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>{item.from.charAt(0)}</Text>
            </View>
            <View style={styles.info}>
              <Text style={[styles.fromName, { color: colors.foreground }, !item.read && styles.bold]}>
                {item.from}
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>{item.time} · {item.duration}</Text>
            </View>
            <TouchableOpacity
              style={[styles.playBtn, { backgroundColor: isPlaying ? colors.primary : colors.primary + "20" }]}
              onPress={() => togglePlay(item.id)}
            >
              <IconSymbol
                name={isPlaying ? "pause.fill" : "phone.fill"}
                size={16}
                color={isPlaying ? "#fff" : colors.primary}
              />
            </TouchableOpacity>
          </View>

          {/* Playback bar */}
          {isPlaying && (
            <View style={styles.playbackBar}>
              <View style={[styles.playbackTrack, { backgroundColor: colors.border }]}>
                <View style={[styles.playbackProgress, { backgroundColor: colors.primary, width: "35%" }]} />
              </View>
              <Text style={[styles.playbackTime, { color: colors.muted }]}>0:15 / {item.duration}</Text>
            </View>
          )}

          {/* Transcription */}
          {isExpanded && (
            <View style={[styles.transcription, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.transcriptionHeader}>
                <IconSymbol name="waveform" size={14} color={colors.primary} />
                <Text style={[styles.transcriptionLabel, { color: colors.primary }]}>AI Transcription</Text>
              </View>
              <Text style={[styles.transcriptionText, { color: colors.foreground }]}>
                {item.transcription}
              </Text>
            </View>
          )}

          {/* Actions */}
          {isExpanded && (
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: "/call/active", params: { number: item.number, type: "voice" } });
                }}
              >
                <IconSymbol name="phone.fill" size={16} color={colors.success} />
                <Text style={[styles.actionText, { color: colors.success }]}>Call Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
                <IconSymbol name="message.fill" size={16} color={colors.primary} />
                <Text style={[styles.actionText, { color: colors.primary }]}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
                <IconSymbol name="trash.fill" size={16} color={colors.error} />
                <Text style={[styles.actionText, { color: colors.error }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>Settings</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Voicemail</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Unread count */}
      <View style={[styles.summaryBar, { backgroundColor: colors.primary + "10", borderBottomColor: colors.border }]}>
        <IconSymbol name="waveform" size={16} color={colors.primary} />
        <Text style={[styles.summaryText, { color: colors.primary }]}>
          {VOICEMAILS.filter((v) => !v.read).length} new voicemails
        </Text>
      </View>

      <FlatList
        data={VOICEMAILS}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
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
    borderBottomWidth: 0.5,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, width: 80 },
  backText: { fontSize: 16, fontWeight: "500" },
  title: { fontSize: 17, fontWeight: "700" },
  summaryBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  summaryText: { fontSize: 13, fontWeight: "600" },
  list: { padding: 12, gap: 10 },
  row: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  unreadDot: {
    position: "absolute",
    top: 16,
    left: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 1,
  },
  rowContent: { padding: 14, paddingLeft: 22, gap: 10 },
  topSection: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "700" },
  info: { flex: 1 },
  fromName: { fontSize: 15, fontWeight: "500" },
  bold: { fontWeight: "700" },
  meta: { fontSize: 12, marginTop: 2 },
  playBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  playbackBar: { gap: 4 },
  playbackTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  playbackProgress: { height: "100%", borderRadius: 2 },
  playbackTime: { fontSize: 11, textAlign: "right" },
  transcription: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 6 },
  transcriptionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  transcriptionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  transcriptionText: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 },
  actionText: { fontSize: 13, fontWeight: "600" },
});
