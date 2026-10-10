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
  safeMeetingTitle,
  type AdmittedMeeting,
} from "@/lib/meetings/admitted-selection";
import { MeetingJoinFailure, meetingJoinFailureReference } from "@/lib/meetings/join-failure";

/** Fixed copy from typed milestones only; never inspect a raw error or cause. */
function joinFailureMessage(error: unknown): string {
  if (error instanceof MeetingJoinFailure) {
    if (error.stage === "audio_start" && error.reason === "phone_call_active")
      return "Finish your Phone call before joining this meeting, then try again.";
    switch (error.stage) {
      case "admission":
        if (error.reason === "unavailable")
          return "This meeting is currently unavailable. Try again later or contact your administrator.";
        break;
      case "signal_connect":
        return "Could not join. Check your connection and try again.";
      case "native_setup":
      case "bindings":
      case "audio_start":
      case "room_cleanup":
      case "room_create":
      case "event_bind":
        return "Could not prepare this meeting on your device. Try again.";
    }
  }
  return "Could not join this meeting. Try again.";
}

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
  /** Opens existing named invitations; never selects an opaque room for the user. */
  onOpenInvitations?: () => void;
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
  onOpenInvitations,
  checkingAvailability = false,
  joinLabel = "Join meeting",
  onBack,
}: MeetingPrejoinProps) {
  const colors = useColors();
  const selection = initialMeetingSelection(
    admittedMeetings,
    initialMeetingCode,
  );
  const deepLinkedMeeting = initialMeetingCode
    ? admittedMeetings?.find(
        meeting => meeting.meetingId === initialMeetingCode,
      )
    : undefined;
  const [meetingCode, setMeetingCode] = useState(selection.meetingCode);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failureReference, setFailureReference] = useState<string | null>(null);
  const joinInFlight = useRef(false);
  const needsNamedInvitation = !deepLinkedMeeting && (admittedMeetings?.length ?? 0) > 1 &&
    admittedMeetings!.some(meeting => !safeMeetingTitle(meeting.title));
  const unavailable =
    unavailableReason ||
    (needsNamedInvitation
      ? "Open a meeting invitation in Team Chat to join the right conversation."
      : null) ||
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
      setError(joinFailureMessage(cause));
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
              {needsNamedInvitation ? "Choose your meeting in Team Chat" : "Meetings aren’t available"}
            </Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              {unavailable}
            </Text>
            {needsNamedInvitation && onOpenInvitations && <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Team Chat invitations"
              onPress={onOpenInvitations}
              style={[styles.retry, { borderColor: colors.primary }]}
            >
              <Text style={[styles.retryText, { color: colors.primary }]}>Open Team Chat</Text>
            </Pressable>}
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
              <View
                accessible
                accessibilityLabel={`Signed in as ${authenticatedDisplayName.trim() || "Phone11 account"}`}
                style={styles.identity}
              >
                <Text style={[styles.label, { color: colors.foreground }]}>
                  Signed in as
                </Text>
                <Text style={[styles.identityName, { color: colors.foreground }]}>
                  {authenticatedDisplayName.trim() || "Phone11 account"}
                </Text>
              </View>
              <View
                style={[
                  styles.joinState,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <Text
                  style={[styles.joinStateTitle, { color: colors.foreground }]}
                >
                  Before you join
                </Text>
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.joinStateText, { color: colors.muted }]}
                >
                  {microphoneEnabled
                    ? "Join with microphone on"
                    : "Join muted"}
                  {"  ·  "}
                  {cameraEnabled ? "Join with video on" : "Join with video off"}
                </Text>
              </View>
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
                  {deepLinkedMeeting &&
                  meetingCode === deepLinkedMeeting.meetingId ? (
                    <Text style={{ color: colors.muted }}>
                      {safeMeetingTitle(deepLinkedMeeting.title) ?? "Your meeting is ready"}
                    </Text>
                  ) : admittedMeetings?.length === 1 &&
                  meetingCode === admittedMeetings[0].meetingId &&
                  (!initialMeetingCode || initialMeetingCode === meetingCode) ? (
                    <Text style={{ color: colors.muted }}>
                      {safeMeetingTitle(admittedMeetings[0].title) ?? "Your admitted meeting is ready."}
                    </Text>
                  ) : (
                    <>
                      <Text style={{ color: colors.muted }}>
                        {initialMeetingCode && !meetingCode
                          ? "That meeting is no longer available. Select an admitted meeting."
                          : meetingCode
                            ? "Admitted meeting selected."
                            : "Select an admitted meeting."}
                      </Text>
                      {admittedMeetings?.map((meeting, index) => {
                        const selected = meetingCode === meeting.meetingId;
                        const title = safeMeetingTitle(meeting.title);
                        return (
                          <Pressable
                            key={meeting.meetingId}
                            accessibilityRole="button"
                            accessibilityLabel={title
                              ? `Select admitted meeting ${index + 1}, ${title}`
                              : `Select admitted meeting ${index + 1}`}
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
                              {title ?? "Your meeting"}{selected ? " · Selected" : ""}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </>
                  )}
                </View>
              )}
              <View style={styles.mediaRow}>
                <View style={styles.mediaText}>
                  <Text style={[styles.label, { color: colors.foreground }]}>
                    Microphone
                  </Text>
                  <Text style={{ color: colors.muted }}>
                    {microphoneEnabled ? "Request access when joining" : "Join muted"}
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
                    {cameraEnabled ? "Request access when joining" : "Join with video off"}
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
                Your camera and microphone stay off until you join.
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
  joinState: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  joinStateTitle: { fontSize: 15, fontWeight: "700" },
  joinStateText: { fontSize: 14, lineHeight: 20 },
  unavailableCard: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 16 },
  failure: { gap: 4 },
  stageReference: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 16, fontWeight: "600" },
  identity: { gap: 4 },
  identityName: { fontSize: 19, fontWeight: "700" },
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
