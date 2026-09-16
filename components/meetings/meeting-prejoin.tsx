import { useRef, useState } from "react";
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
import { useColors } from "@/hooks/use-colors";

export interface MeetingJoinPreferences {
  meetingCode: string;
  displayName: string;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
}

export interface MeetingPrejoinProps {
  initialMeetingCode?: string;
  initialDisplayName?: string;
  /** Omit until an authenticated meeting admission and media path are available. */
  onJoin?: (preferences: MeetingJoinPreferences) => Promise<void>;
  unavailableReason?: string;
  joinLabel?: string;
  onBack: () => void;
}

/** Collects preferences only. The join adapter owns permissions, admission and media. */
export function MeetingPrejoin({
  initialMeetingCode = "",
  initialDisplayName = "",
  onJoin,
  unavailableReason,
  joinLabel = "Join meeting",
  onBack,
}: MeetingPrejoinProps) {
  const colors = useColors();
  const [meetingCode, setMeetingCode] = useState(initialMeetingCode);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const joinInFlight = useRef(false);
  const unavailable =
    unavailableReason ||
    (!onJoin
      ? "Video meetings are not connected for this account yet. Ask your administrator to enable meetings."
      : null);
  const disabled =
    !!unavailable || joining || !meetingCode.trim() || !displayName.trim();
  async function join() {
    if (disabled || !onJoin || joinInFlight.current) return;
    joinInFlight.current = true;
    setJoining(true);
    setError(null);
    try {
      await onJoin({
        meetingCode: meetingCode.trim(),
        displayName: displayName.trim(),
        microphoneEnabled,
        cameraEnabled,
      });
    } catch {
      setError(
        "Could not open this meeting. Check the meeting code and your connection, then try again.",
      );
    } finally {
      joinInFlight.current = false;
      setJoining(false);
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      <View style={styles.body}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.back}
        >
          <Text style={[styles.backText, { color: colors.primary }]}>
            ‹ Back
          </Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground }]}
        >
          Join a meeting
        </Text>
        <Text style={[styles.description, { color: colors.muted }]}>
          Meet face to face with your team.
        </Text>
        <View
          style={[
            styles.card,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <Text
            nativeID="meeting-code-label"
            style={[styles.label, { color: colors.foreground }]}
          >
            Meeting code
          </Text>
          <TextInput
            accessibilityLabel="Meeting code"
            accessibilityLabelledBy="meeting-code-label"
            value={meetingCode}
            onChangeText={setMeetingCode}
            placeholder="Enter meeting code"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={128}
            editable={!joining}
            returnKeyType="next"
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border },
            ]}
          />
          <Text
            nativeID="meeting-name-label"
            style={[styles.label, { color: colors.foreground }]}
          >
            Your name
          </Text>
          <TextInput
            accessibilityLabel="Your name"
            accessibilityLabelledBy="meeting-name-label"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Name shown in the meeting"
            placeholderTextColor={colors.muted}
            autoComplete="name"
            maxLength={80}
            editable={!joining}
            returnKeyType="done"
            onSubmitEditing={() => void join()}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border },
            ]}
          />
          <View style={styles.mediaRow}>
            <View style={styles.mediaText}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                Microphone
              </Text>
              <Text style={{ color: colors.muted }}>
                {microphoneEnabled ? "On when you join" : "Join muted"}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Microphone on when joining"
              value={microphoneEnabled}
              onValueChange={setMicrophoneEnabled}
              disabled={joining}
              trackColor={{ true: colors.primary }}
            />
          </View>
          <View style={styles.mediaRow}>
            <View style={styles.mediaText}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                Camera
              </Text>
              <Text style={{ color: colors.muted }}>
                {cameraEnabled ? "On when you join" : "Join with video off"}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Camera on when joining"
              value={cameraEnabled}
              onValueChange={setCameraEnabled}
              disabled={joining}
              trackColor={{ true: colors.primary }}
            />
          </View>
          <Text style={[styles.note, { color: colors.muted }]}>
            Your microphone and camera are off on this screen. Permission may be
            requested when you join.
          </Text>
        </View>
        {unavailable && (
          <Text
            accessibilityRole="text"
            style={[
              styles.notice,
              { color: colors.foreground, backgroundColor: colors.surface },
            ]}
          >
            {unavailable}
          </Text>
        )}
        {error && (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.description, { color: colors.error }]}
          >
            {error}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: joining }}
          disabled={disabled}
          onPress={() => void join()}
          style={[
            styles.join,
            { backgroundColor: disabled ? colors.border : colors.primary },
          ]}
        >
          {joining && <ActivityIndicator color={colors.foreground} />}
          <Text
            style={[
              styles.joinText,
              { color: disabled ? colors.muted : "#fff" },
            ]}
          >
            {joining ? "Opening meeting…" : joinLabel}
          </Text>
        </Pressable>
        <Text style={[styles.note, { color: colors.muted }]}>
          Video meetings are separate from Phone calls. Finish any phone call
          before joining a meeting.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 24, paddingBottom: 40 },
  body: { width: "100%", maxWidth: 520, alignSelf: "center", gap: 18 },
  back: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingRight: 20,
  },
  backText: { fontSize: 17, fontWeight: "600" },
  title: { fontSize: 30, fontWeight: "700" },
  description: { fontSize: 16, lineHeight: 24 },
  card: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 14 },
  label: { fontSize: 16, fontWeight: "600" },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  mediaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    minHeight: 58,
  },
  mediaText: { flex: 1, gap: 5 },
  note: { fontSize: 14, lineHeight: 21 },
  notice: { borderRadius: 12, padding: 16, fontSize: 15, lineHeight: 23 },
  join: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  joinText: { fontSize: 17, fontWeight: "700" },
});
