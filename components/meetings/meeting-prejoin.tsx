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
import {
  initialMeetingSelection,
  type AdmittedMeeting,
} from "@/lib/meetings/admitted-selection";
import { meetingJoinFailureReference } from "@/lib/meetings/join-failure";

export interface MeetingJoinPreferences {
  meetingCode: string;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
}

export interface MeetingPrejoinProps {
  initialMeetingCode?: string;
  /** Server-filtered opaque IDs; their presence disables manual UUID entry. */
  admittedMeetings?: readonly AdmittedMeeting[];
  /** Authenticated Phone11 profile name, shown read-only because admission owns provider identity. */
  authenticatedDisplayName?: string;
  /** Omit until an authenticated meeting admission and media path are available. */
  onJoin?: (preferences: MeetingJoinPreferences) => Promise<void>;
  unavailableReason?: string;
  onRetryAvailability?: () => void;
  checkingAvailability?: boolean;
  joinLabel?: string;
  onBack: () => void;
}

/** Collects preferences only. The join adapter owns permissions, admission and media. */
export function MeetingPrejoin({
  initialMeetingCode = "",
  admittedMeetings,
  authenticatedDisplayName = "",
  onJoin,
  unavailableReason,
  onRetryAvailability,
  checkingAvailability = false,
  joinLabel = "Join meeting",
  onBack,
}: MeetingPrejoinProps) {
  const colors = useColors();
  const selection = initialMeetingSelection(
    admittedMeetings,
    initialMeetingCode,
  );
  const [meetingCode, setMeetingCode] = useState(selection.meetingCode);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failureReference, setFailureReference] = useState<string | null>(null);
  const joinInFlight = useRef(false);
  const unavailable =
    unavailableReason ||
    (!onJoin
      ? "Video meetings are not connected for this account yet. Ask your administrator to enable meetings."
      : null);
  const disabled = !!unavailable || joining || !meetingCode.trim();
  async function join() {
    if (disabled || !onJoin || joinInFlight.current) return;
    joinInFlight.current = true;
    setJoining(true);
    setError(null);
    setFailureReference(null);
    try {
      await onJoin({
        meetingCode: meetingCode.trim(),
        microphoneEnabled,
        cameraEnabled,
      });
    } catch (cause) {
      setFailureReference(meetingJoinFailureReference(cause) ?? null);
      setError(
        admittedMeetings === undefined
          ? "Could not open this meeting. Check the meeting code and your connection, then try again."
          : "Could not join. Check your connection and try again.",
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
        {unavailable ? (
          <View
            style={[
              styles.unavailableCard,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.foreground }]}
            >
              Meetings aren’t available
            </Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              {unavailable}
            </Text>
            {onRetryAvailability && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: checkingAvailability }}
                disabled={checkingAvailability}
                onPress={onRetryAvailability}
                style={[styles.retry, { borderColor: colors.primary }]}
              >
                {checkingAvailability && (
                  <ActivityIndicator color={colors.primary} />
                )}
                <Text style={[styles.retryText, { color: colors.primary }]}>
                  {checkingAvailability ? "Checking…" : "Check again"}
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
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
              {selection.manualEntry ? (
                <>
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
                </>
              ) : (
                <View style={styles.meetingPicker}>
                  <Text style={[styles.label, { color: colors.foreground }]}>
                    Meeting
                  </Text>
                  {admittedMeetings?.length === 1 ? (
                    <Text style={{ color: colors.muted }}>
                      Your admitted meeting is ready.
                    </Text>
                  ) : (
                    <>
                      <Text style={{ color: colors.muted }}>
                        Select an admitted meeting.
                      </Text>
                      {admittedMeetings?.map((meeting, index) => {
                        const selected = meetingCode === meeting.meetingId;
                        return (
                          <Pressable
                            key={meeting.meetingId}
                            accessibilityRole="button"
                            accessibilityLabel={`Select admitted meeting ${index + 1}`}
                            accessibilityState={{ selected }}
                            disabled={joining}
                            onPress={() => setMeetingCode(meeting.meetingId)}
                            style={[
                              styles.meetingChoice,
                              {
                                borderColor: selected
                                  ? colors.primary
                                  : colors.border,
                                backgroundColor: selected
                                  ? colors.background
                                  : colors.surface,
                              },
                            ]}
                          >
                            <Text style={{ color: colors.foreground }}>
                              Meeting {index + 1}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </>
                  )}
                </View>
              )}
              <View
                accessible
                accessibilityLabel={`Signed in as ${authenticatedDisplayName || "Phone11 account"}`}
              >
                <Text style={[styles.label, { color: colors.foreground }]}>
                  Signed in as
                </Text>
                <Text style={{ color: colors.muted }}>
                  {authenticatedDisplayName.trim() || "Phone11 account"}
                </Text>
              </View>
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
                Your microphone and camera are off on this screen. Permission
                may be requested when you join.
              </Text>
            </View>
            {error && (
              <View style={styles.failure}>
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[styles.description, { color: colors.error }]}
                >
                  {error}
                </Text>
                {failureReference && (
                  <Text
                    testID="meeting-join-stage"
                    accessibilityLabel={`Join stage reference: ${failureReference}`}
                    style={[styles.stageReference, { color: colors.muted }]}
                  >
                    Reference: {failureReference}
                  </Text>
                )}
              </View>
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
              Video meetings are separate from Phone calls. Finish any phone
              call before joining a meeting.
            </Text>
          </>
        )}
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
  unavailableCard: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 16 },
  failure: { gap: 4 },
  stageReference: { fontSize: 13, lineHeight: 18 },
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
  meetingPicker: { gap: 10 },
  meetingChoice: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  note: { fontSize: 14, lineHeight: 21 },
  retry: {
    minHeight: 46,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  retryText: { fontSize: 16, fontWeight: "700" },
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
