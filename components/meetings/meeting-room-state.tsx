import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/use-colors";
import { NativeVideoStage } from "@/components/meetings/native-video-stage";
import {
  type BrowserMeetingSession,
  type BrowserRoom,
  type BrowserSessionSnapshot,
  type MeetingParticipant,
} from "@/lib/meetings/browser-session";

export interface MeetingRoomCaption {
  id: string;
  text: string;
  participantIdentity?: string | null;
  isFinal?: boolean;
}

export interface MeetingRoomStateProps {
  /** A session created and owned by the authenticated meeting adapter. */
  session?: BrowserMeetingSession;
  /** Existing native room from NativeMeetingLifecycle; never URL/token input. */
  nativeRoom?: BrowserRoom;
  /** Server-derived receive-only membership. */
  receiveOnly?: boolean;
  /** Reads the lifecycle interruption flag after its session event re-renders this view. */
  isSipInterrupted?: () => boolean;
  /** Captions from the authenticated meeting service. No caption data is invented here. */
  captions?: readonly MeetingRoomCaption[];
  roomName?: string;
  unavailableReason?: string;
  onBack: () => void;
  /** Owns the complete leave sequence when media has extra cleanup requirements. */
  onLeave?: () => void | Promise<void>;
}

const unavailableSnapshot: BrowserSessionSnapshot = Object.freeze({
  status: "idle",
  participants: Object.freeze([]),
  error: null,
});

const subscribeToNothing = () => () => undefined;
const getUnavailableSnapshot = () => unavailableSnapshot;

function statusCopy(
  snapshot: BrowserSessionSnapshot,
  hasSession: boolean,
  unavailableReason?: string,
  sipInterrupted = false,
) {
  if (unavailableReason) return { label: "Unavailable", description: unavailableReason };
  if (!hasSession) {
    return {
      label: "Setting up meeting",
      description:
        "This room is still being configured. Media, participants, and captions will appear when a secure meeting session is available.",
    };
  }
  if (sipInterrupted) {
    return {
      label: "Meeting paused for Phone call",
      description: "Meeting microphone, camera, and audio were stopped before your Phone call. Rejoin after the call ends.",
    };
  }
  if (snapshot.status === "connecting") {
    return { label: "Connecting", description: "Connecting to your meeting. Controls will be available once connected." };
  }
  if (snapshot.status === "reconnecting") {
    return { label: "Reconnecting", description: "Reconnecting to your meeting. Media controls are paused until it reconnects." };
  }
  if (snapshot.status === "connected") {
    return { label: "Connected", description: "Meeting controls are ready." };
  }
  if (snapshot.status === "disconnected") {
    return { label: "Disconnected", description: "This meeting is no longer connected." };
  }
  if (snapshot.status === "error") {
    return { label: "Meeting unavailable", description: snapshot.error ?? "This meeting could not be connected." };
  }
  return { label: "Ready to connect", description: "A secure meeting session is required before media can start." };
}

function participantState(participant: MeetingParticipant) {
  const media = [participant.microphone ? "Mic on" : "Muted", participant.camera ? "Camera on" : "Camera off"];
  return participant.speaking ? `Speaking · ${media.join(" · ")}` : media.join(" · ");
}

/**
 * A display and control surface for a real BrowserMeetingSession.
 * It never creates a room or media stream; that remains the meeting adapter's job.
 */
export function MeetingRoomState({
  session,
  nativeRoom,
  receiveOnly = false,
  isSipInterrupted,
  captions = [],
  roomName = "Meeting room",
  unavailableReason,
  onBack,
  onLeave,
}: MeetingRoomStateProps) {
  const colors = useColors("dark");
  const snapshot = useSyncExternalStore(
    session ? session.subscribe : subscribeToNothing,
    session ? session.getSnapshot : getUnavailableSnapshot,
    getUnavailableSnapshot,
  );
  const [busyControl, setBusyControl] = useState<"microphone" | "camera" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const sipInterrupted = isSipInterrupted?.() ?? false;
  const status = statusCopy(snapshot, Boolean(session), unavailableReason, sipInterrupted);
  const localParticipant = snapshot.participants.find((participant) => participant.local);
  const mediaReady = snapshot.status === "connected" && !!session && !!localParticipant && !leaving && !receiveOnly;
  const participantsByIdentity = useMemo(
    () => new Map(snapshot.participants.map((participant) => [participant.identity, participant.name])),
    [snapshot.participants],
  );
  const visibleCaptions = captions.filter((caption) => caption.text.trim()).slice(-2);

  async function updateMedia(kind: "microphone" | "camera") {
    if (!session || !localParticipant || !mediaReady || busyControl) return;
    setBusyControl(kind);
    setFeedback(null);
    try {
      if (kind === "microphone") {
        await session.setMicrophone(!localParticipant.microphone);
        setFeedback(localParticipant.microphone ? "Microphone muted." : "Microphone unmuted.");
      } else {
        await session.setCamera(!localParticipant.camera);
        setFeedback(localParticipant.camera ? "Camera turned off." : "Camera turned on.");
      }
    } catch {
      setFeedback(`Could not update ${kind}. Check your meeting connection and try again.`);
    } finally {
      setBusyControl(null);
    }
  }

  async function leave() {
    if (!session || leaving) return;
    setLeaving(true);
    setFeedback(null);
    try {
      if (onLeave) await onLeave();
      else await session.disconnect();
    } catch {
      setFeedback("Could not leave the meeting. Please try again.");
    } finally {
      setLeaving(false);
    }
  }

  const microphoneLabel = localParticipant?.microphone ? "Mute microphone" : "Unmute microphone";
  const cameraLabel = localParticipant?.camera ? "Turn camera off" : "Turn camera on";

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { borderBottomColor: "#FFFFFF1F" }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint={session && snapshot.status === "connected" ? "Returns to the previous screen. The meeting stays connected." : undefined}
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={[styles.backText, { color: colors.primary }]}>‹ Back</Text>
        </Pressable>
        <View style={styles.roomHeading}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.roomName}>{roomName}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.status, { color: snapshot.status === "connected" ? colors.success : colors.muted }]}>
            {status.label}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {nativeRoom ? (
          <NativeVideoStage
            room={nativeRoom}
            reconnecting={snapshot.status === "reconnecting"}
            receiveOnly={receiveOnly}
          />
        ) : (
          <View style={styles.stage}>
            <Text style={styles.stageEyebrow}>Meeting</Text>
            <Text style={styles.stageTitle}>{status.label}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.stageDescription}>{status.description}</Text>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Participants</Text>
            <Text accessibilityLabel={`${snapshot.participants.length} participants`} style={styles.sectionCount}>{snapshot.participants.length}</Text>
          </View>
          {snapshot.participants.length === 0 ? (
            <Text style={styles.emptyText}>Participants will appear when the meeting service provides them.</Text>
          ) : (
            snapshot.participants.map((participant) => (
              <View key={participant.identity} style={[styles.participant, { borderColor: "#FFFFFF1F" }]}>
                <View style={[styles.avatar, { backgroundColor: colors.primary + "2E" }]}>
                  <Text style={[styles.avatarText, { color: colors.primary }]}>{participant.name.slice(0, 1).toLocaleUpperCase()}</Text>
                </View>
                <View style={styles.participantCopy}>
                  <Text numberOfLines={1} style={styles.participantName}>{participant.name}{participant.local ? " (You)" : ""}</Text>
                  <Text style={styles.participantMeta}>{participantState(participant)}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live captions</Text>
          {visibleCaptions.length === 0 ? (
            <Text style={styles.emptyText}>Captions will appear here when they are supplied by the meeting service.</Text>
          ) : (
            visibleCaptions.map((caption) => {
              const speaker = caption.participantIdentity ? participantsByIdentity.get(caption.participantIdentity) ?? caption.participantIdentity : null;
              return (
                <View key={caption.id} style={[styles.caption, { borderColor: "#FFFFFF1F" }]}>
                  {speaker && <Text style={[styles.captionSpeaker, { color: colors.primary }]}>{speaker}</Text>}
                  <Text style={styles.captionText}>{caption.text.trim()}</Text>
                </View>
              );
            })
          )}
        </View>

        {(feedback || snapshot.error) && (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.feedback, { color: colors.foreground }]}>
            {feedback ?? snapshot.error}
          </Text>
        )}
      </ScrollView>

      <View style={[styles.controls, { borderTopColor: "#FFFFFF1F" }]}>
        <Text style={styles.controlsHint}>
          {receiveOnly
            ? "Listen-only membership receives shared audio and video. Microphone and camera are unavailable."
            : sipInterrupted
              ? "Meeting media was stopped before your Phone call. Rejoin after the call ends."
              : mediaReady ? "Media controls affect only your connection." : "Media controls are unavailable until the meeting is connected."}
        </Text>
        <View style={styles.controlRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={microphoneLabel}
            accessibilityState={{ disabled: !mediaReady || busyControl !== null, selected: Boolean(localParticipant?.microphone) }}
            disabled={!mediaReady || busyControl !== null}
            onPress={() => void updateMedia("microphone")}
            style={[styles.controlButton, { borderColor: "#FFFFFF2B" }, (!mediaReady || busyControl !== null) && styles.disabledControl]}
          >
            {busyControl === "microphone" ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.controlText}>{localParticipant?.microphone ? "Mute" : "Unmute"}</Text>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cameraLabel}
            accessibilityState={{ disabled: !mediaReady || busyControl !== null, selected: Boolean(localParticipant?.camera) }}
            disabled={!mediaReady || busyControl !== null}
            onPress={() => void updateMedia("camera")}
            style={[styles.controlButton, { borderColor: "#FFFFFF2B" }, (!mediaReady || busyControl !== null) && styles.disabledControl]}
          >
            {busyControl === "camera" ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.controlText}>{localParticipant?.camera ? "Camera off" : "Camera on"}</Text>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={session ? "Leave meeting" : "Leave meeting unavailable"}
            accessibilityState={{ disabled: !session || leaving, busy: leaving }}
            disabled={!session || leaving}
            onPress={() => void leave()}
            style={[styles.leaveButton, { backgroundColor: colors.error }, (!session || leaving) && styles.disabledControl]}
          >
            {leaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.leaveText}>Leave</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0D0F14" },
  header: { minHeight: 64, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16 },
  backButton: { minHeight: 44, minWidth: 64, justifyContent: "center" },
  backText: { fontSize: 17, fontWeight: "700" },
  roomHeading: { flex: 1, alignItems: "center", gap: 2 },
  roomName: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  status: { fontSize: 13, fontWeight: "600" },
  headerSpacer: { minWidth: 64 },
  content: { padding: 20, gap: 24, paddingBottom: 28 },
  stage: { minHeight: 180, borderRadius: 24, backgroundColor: "#191D26", justifyContent: "center", alignItems: "center", padding: 28, gap: 8 },
  stageEyebrow: { color: "#B4BAC6", fontSize: 13, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  stageTitle: { color: "#FFFFFF", fontSize: 26, fontWeight: "700", textAlign: "center" },
  stageDescription: { color: "#B4BAC6", fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 360 },
  section: { gap: 12 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  sectionCount: { color: "#B4BAC6", fontSize: 15, fontWeight: "600" },
  emptyText: { color: "#B4BAC6", fontSize: 15, lineHeight: 22 },
  participant: { minHeight: 64, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, flexDirection: "row", alignItems: "center", padding: 12, gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontWeight: "800" },
  participantCopy: { flex: 1, gap: 2 },
  participantName: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  participantMeta: { color: "#B4BAC6", fontSize: 14 },
  caption: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 4 },
  captionSpeaker: { fontSize: 14, fontWeight: "700" },
  captionText: { color: "#FFFFFF", fontSize: 15, lineHeight: 22 },
  feedback: { backgroundColor: "#FFFFFF12", borderRadius: 12, padding: 14, fontSize: 15, lineHeight: 22 },
  controls: { borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: "#11141B", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20, gap: 12 },
  controlsHint: { color: "#B4BAC6", fontSize: 13, lineHeight: 18, textAlign: "center" },
  controlRow: { flexDirection: "row", gap: 10 },
  controlButton: { flex: 1, minHeight: 52, borderWidth: 1, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  controlText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  leaveButton: { flex: 1, minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  leaveText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  disabledControl: { opacity: 0.42 },
});
