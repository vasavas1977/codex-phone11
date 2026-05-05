import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Voicemail {
  id: string;
  from: string;
  fromName: string;
  date: string;
  duration: string;
  transcription: string;
  isNew: boolean;
}

const VOICEMAILS: Voicemail[] = [
  { id: "1", from: "+1 (555) 234-5678", fromName: "Sarah Chen", date: "Today, 2:34 PM", duration: "0:42", transcription: "Hi, this is Sarah from the sales team. I wanted to follow up on the proposal we discussed yesterday. Please call me back when you get a chance.", isNew: true },
  { id: "2", from: "+1 (555) 345-6789", fromName: "Mike Johnson", date: "Today, 11:15 AM", duration: "1:08", transcription: "Hey, it's Mike. The client meeting has been moved to Thursday at 3 PM. Can you confirm your availability? Thanks.", isNew: true },
  { id: "3", from: "+44 20 7946 0958", fromName: "London Office", date: "Yesterday, 4:22 PM", duration: "0:35", transcription: "Good afternoon. This is the London office calling about the quarterly report. We need the updated figures by end of day Friday.", isNew: false },
  { id: "4", from: "+1 (800) 555-0100", fromName: "Support Queue", date: "Yesterday, 9:45 AM", duration: "0:58", transcription: "This is an automated message. You have 3 support tickets awaiting your review. Please log in to the admin portal to address them.", isNew: false },
  { id: "5", from: "+1 (555) 456-7890", fromName: "David Park", date: "Apr 23, 3:10 PM", duration: "0:28", transcription: "David here. Quick question about the API integration. Give me a call when you're free.", isNew: false },
];

const GREETINGS = [
  { id: "1", name: "Default Greeting", duration: "0:12", active: true },
  { id: "2", name: "Out of Office", duration: "0:18", active: false },
  { id: "3", name: "Holiday Greeting", duration: "0:15", active: false },
];

export default function VoicemailMgmtScreen() {
  const colors = useColors();
  const [tab, setTab] = useState<"inbox" | "greetings" | "settings">("inbox");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [vmSettings, setVmSettings] = useState({
    emailNotify: true,
    transcription: true,
    pinRequired: true,
    maxLength: 120,
    ringsBeforeVm: 4,
  });

  const newCount = VOICEMAILS.filter(v => v.isNew).length;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Voicemail</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Tab Switcher */}
      <View style={[styles.tabRow, { backgroundColor: colors.surface }]}>
        {(["inbox", "greetings", "settings"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && { backgroundColor: colors.primary }]}
            onPress={() => { setTab(t); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <Text style={[styles.tabText, { color: tab === t ? "#fff" : colors.muted }]}>
              {t === "inbox" ? `Inbox (${newCount})` : t === "greetings" ? "Greetings" : "Settings"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {tab === "inbox" && (
          <>
            {VOICEMAILS.map((vm) => (
              <TouchableOpacity
                key={vm.id}
                style={[styles.vmCard, { backgroundColor: colors.surface, borderColor: vm.isNew ? colors.primary + "40" : colors.border }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setExpandedId(expandedId === vm.id ? null : vm.id);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.vmMain}>
                  <View style={styles.vmLeft}>
                    {vm.isNew && <View style={[styles.newDot, { backgroundColor: colors.primary }]} />}
                    <View style={[styles.vmAvatar, { backgroundColor: vm.isNew ? colors.primary + "15" : colors.border + "40" }]}>
                      <Text style={[styles.vmAvatarText, { color: vm.isNew ? colors.primary : colors.muted }]}>
                        {vm.fromName.split(" ").map(w => w[0]).join("").slice(0, 2)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.vmInfo}>
                    <Text style={[styles.vmName, { color: colors.foreground, fontWeight: vm.isNew ? "700" : "500" }]}>{vm.fromName}</Text>
                    <Text style={[styles.vmNumber, { color: colors.muted }]}>{vm.from}</Text>
                    <Text style={[styles.vmDate, { color: colors.muted }]}>{vm.date} · {vm.duration}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.playBtn, { backgroundColor: colors.primary + "15" }]}
                    onPress={(e) => {
                      e.stopPropagation();
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setPlayingId(playingId === vm.id ? null : vm.id);
                    }}
                  >
                    <IconSymbol name={playingId === vm.id ? "pause.fill" : "play.fill"} size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                {/* Playback Bar */}
                {playingId === vm.id && (
                  <View style={[styles.playbackBar, { borderTopColor: colors.border }]}>
                    <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
                      <View style={[styles.progressFill, { width: "45%", backgroundColor: colors.primary }]} />
                    </View>
                    <View style={styles.playbackTime}>
                      <Text style={[styles.timeText, { color: colors.muted }]}>0:19</Text>
                      <Text style={[styles.timeText, { color: colors.muted }]}>{vm.duration}</Text>
                    </View>
                  </View>
                )}

                {/* Transcription */}
                {expandedId === vm.id && (
                  <View style={[styles.transcription, { borderTopColor: colors.border }]}>
                    <Text style={[styles.transcriptionLabel, { color: colors.muted }]}>Transcription</Text>
                    <Text style={[styles.transcriptionText, { color: colors.foreground }]}>{vm.transcription}</Text>
                    <View style={styles.vmActions}>
                      <TouchableOpacity style={[styles.vmActionBtn, { backgroundColor: colors.primary + "15" }]}>
                        <IconSymbol name="phone.fill" size={14} color={colors.primary} />
                        <Text style={[styles.vmActionText, { color: colors.primary }]}>Call Back</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.vmActionBtn, { backgroundColor: colors.success + "15" }]}>
                        <IconSymbol name="arrow.down.circle.fill" size={14} color={colors.success} />
                        <Text style={[styles.vmActionText, { color: colors.success }]}>Download</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.vmActionBtn, { backgroundColor: colors.error + "15" }]}>
                        <IconSymbol name="trash.fill" size={14} color={colors.error} />
                        <Text style={[styles.vmActionText, { color: colors.error }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </>
        )}

        {tab === "greetings" && (
          <>
            <Text style={[styles.greetingHint, { color: colors.muted }]}>
              Manage your voicemail greetings. The active greeting will play when callers reach your voicemail.
            </Text>
            {GREETINGS.map((g) => (
              <View key={g.id} style={[styles.greetingCard, { backgroundColor: colors.surface, borderColor: g.active ? colors.primary + "40" : colors.border }]}>
                <View style={styles.greetingMain}>
                  <TouchableOpacity style={[styles.playBtn, { backgroundColor: colors.primary + "15" }]}>
                    <IconSymbol name="play.fill" size={16} color={colors.primary} />
                  </TouchableOpacity>
                  <View style={styles.greetingInfo}>
                    <Text style={[styles.greetingName, { color: colors.foreground }]}>{g.name}</Text>
                    <Text style={[styles.greetingDuration, { color: colors.muted }]}>Duration: {g.duration}</Text>
                  </View>
                  {g.active ? (
                    <View style={[styles.activeBadge, { backgroundColor: colors.success + "20" }]}>
                      <Text style={[styles.activeBadgeText, { color: colors.success }]}>Active</Text>
                    </View>
                  ) : (
                    <TouchableOpacity style={[styles.setActiveBtn, { borderColor: colors.primary }]}>
                      <Text style={[styles.setActiveText, { color: colors.primary }]}>Set Active</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
            <TouchableOpacity style={[styles.recordBtn, { backgroundColor: colors.primary }]}>
              <IconSymbol name="mic.fill" size={18} color="#fff" />
              <Text style={styles.recordBtnText}>Record New Greeting</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.uploadBtn, { borderColor: colors.primary }]}>
              <IconSymbol name="arrow.up.circle.fill" size={18} color={colors.primary} />
              <Text style={[styles.uploadBtnText, { color: colors.primary }]}>Upload Audio File</Text>
            </TouchableOpacity>
          </>
        )}

        {tab === "settings" && (
          <>
            <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.foreground }]}>Email Notifications</Text>
                  <Text style={[styles.settingSub, { color: colors.muted }]}>Send voicemail to email as attachment</Text>
                </View>
                <Switch value={vmSettings.emailNotify} onValueChange={(v) => setVmSettings({ ...vmSettings, emailNotify: v })} trackColor={{ false: colors.border, true: colors.primary }} />
              </View>
              <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.foreground }]}>AI Transcription</Text>
                  <Text style={[styles.settingSub, { color: colors.muted }]}>Auto-transcribe voicemail messages</Text>
                </View>
                <Switch value={vmSettings.transcription} onValueChange={(v) => setVmSettings({ ...vmSettings, transcription: v })} trackColor={{ false: colors.border, true: colors.primary }} />
              </View>
              <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.foreground }]}>PIN Required</Text>
                  <Text style={[styles.settingSub, { color: colors.muted }]}>Require PIN to access voicemail by phone</Text>
                </View>
                <Switch value={vmSettings.pinRequired} onValueChange={(v) => setVmSettings({ ...vmSettings, pinRequired: v })} trackColor={{ false: colors.border, true: colors.primary }} />
              </View>
              <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.foreground }]}>Max Message Length</Text>
                  <Text style={[styles.settingSub, { color: colors.muted }]}>{vmSettings.maxLength} seconds</Text>
                </View>
                <Text style={[styles.settingValue, { color: colors.primary }]}>{vmSettings.maxLength}s</Text>
              </View>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.foreground }]}>Rings Before Voicemail</Text>
                  <Text style={[styles.settingSub, { color: colors.muted }]}>{vmSettings.ringsBeforeVm} rings (~{vmSettings.ringsBeforeVm * 5}s)</Text>
                </View>
                <Text style={[styles.settingValue, { color: colors.primary }]}>{vmSettings.ringsBeforeVm}</Text>
              </View>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  tabRow: { flexDirection: "row", margin: 16, borderRadius: 10, padding: 3, gap: 3 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tabText: { fontSize: 12, fontWeight: "600" },
  content: { paddingBottom: 20 },
  vmCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  vmMain: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  vmLeft: { position: "relative" },
  newDot: { position: "absolute", top: -2, left: -2, width: 10, height: 10, borderRadius: 5, zIndex: 1 },
  vmAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  vmAvatarText: { fontSize: 14, fontWeight: "700" },
  vmInfo: { flex: 1 },
  vmName: { fontSize: 14 },
  vmNumber: { fontSize: 11, marginTop: 1 },
  vmDate: { fontSize: 11, marginTop: 2 },
  playBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  playbackBar: { paddingHorizontal: 14, paddingBottom: 12, borderTopWidth: 0.5 },
  progressBg: { height: 4, borderRadius: 2, marginTop: 10 },
  progressFill: { height: 4, borderRadius: 2 },
  playbackTime: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  timeText: { fontSize: 10 },
  transcription: { padding: 14, borderTopWidth: 0.5 },
  transcriptionLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3, marginBottom: 6 },
  transcriptionText: { fontSize: 13, lineHeight: 20 },
  vmActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  vmActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  vmActionText: { fontSize: 12, fontWeight: "600" },
  greetingHint: { fontSize: 13, paddingHorizontal: 16, marginBottom: 12 },
  greetingCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  greetingMain: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  greetingInfo: { flex: 1 },
  greetingName: { fontSize: 14, fontWeight: "600" },
  greetingDuration: { fontSize: 12, marginTop: 2 },
  activeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  activeBadgeText: { fontSize: 11, fontWeight: "700" },
  setActiveBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  setActiveText: { fontSize: 12, fontWeight: "600" },
  recordBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginTop: 16, paddingVertical: 14, borderRadius: 12 },
  recordBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  uploadBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginTop: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderStyle: "dashed" },
  uploadBtnText: { fontSize: 15, fontWeight: "600" },
  settingsCard: { marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5 },
  settingInfo: { flex: 1 },
  settingTitle: { fontSize: 14, fontWeight: "600" },
  settingSub: { fontSize: 12, marginTop: 2 },
  settingValue: { fontSize: 15, fontWeight: "700" },
});
