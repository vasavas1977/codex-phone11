import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { NativeVideoStage } from "@/components/meetings/native-video-stage";
import {
  ProfileAvatar,
  useProfilePhotoCacheScope,
} from "@/components/profile/profile-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useDirectory, useDirectoryFocusRefresh } from "@/hooks/use-directory";
import { useWorkspaceProfile } from "@/lib/profile/use-workspace-profile";
import {
  meetingAvatarPerson,
  meetingAvatarTenant,
} from "@/lib/meetings/participant-avatar";
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
  if (unavailableReason)
    return { label: "Unavailable", description: unavailableReason };
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
      description:
        "Meeting microphone, camera, and audio were stopped before your Phone call. Rejoin after the call ends.",
    };
  }
  if (snapshot.status === "connecting") {
    return {
      label: "Connecting",
      description:
        "Connecting to your meeting. Controls will be available once connected.",
    };
  }
  if (snapshot.status === "reconnecting") {
    return {
      label: "Reconnecting",
      description:
        "Reconnecting to your meeting. Media controls are paused until it reconnects.",
    };
  }
  if (snapshot.status === "connected") {
    return { label: "Connected", description: "Meeting controls are ready." };
  }
  if (snapshot.status === "disconnected") {
    return {
      label: "Disconnected",
      description: "This meeting is no longer connected.",
    };
  }
  if (snapshot.status === "error") {
    return {
      label: "Meeting unavailable",
      description: snapshot.error ?? "This meeting could not be connected.",
    };
  }
  return {
    label: "Ready to connect",
    description: "A secure meeting session is required before media can start.",
  };
}

function participantState(participant: MeetingParticipant) {
  const media = [
    participant.microphone ? "Mic on" : "Muted",
    participant.camera ? "Camera on" : "Camera off",
  ];
  return participant.speaking
    ? `Speaking · ${media.join(" · ")}`
    : media.join(" · ");
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
  const { user } = useAuth({ autoFetch: false });
  const snapshot = useSyncExternalStore(
    session ? session.subscribe : subscribeToNothing,
    session ? session.getSnapshot : getUnavailableSnapshot,
    getUnavailableSnapshot,
  );
  const [busyControl, setBusyControl] = useState<
    "microphone" | "camera" | null
  >(null);
  const [leaving, setLeaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [panel, setPanel] = useState<"participants" | "more" | null>(null);
  const sipInterrupted = isSipInterrupted?.() ?? false;
  const status = statusCopy(
    snapshot,
    Boolean(session),
    unavailableReason,
    sipInterrupted,
  );
  const localParticipant = snapshot.participants.find(
    (participant) => participant.local,
  );
  const meetingTenantId = meetingAvatarTenant(
    localParticipant?.identity,
    user?.id,
  );
  const directory = useDirectory(meetingTenantId, Boolean(meetingTenantId));
  const photoTenantId =
    directory.owner === user?.id && directory.workspace?.id === meetingTenantId
      ? meetingTenantId
      : undefined;
  useDirectoryFocusRefresh(
    directory.owner,
    photoTenantId,
    Boolean(photoTenantId),
    directory.reload,
  );
  useProfilePhotoCacheScope(meetingTenantId);
  const ownPhoto = useWorkspaceProfile(user, meetingTenantId).photoDescriptor;
  const photoPeople = photoTenantId ? directory.people : [];
  const mediaReady =
    snapshot.status === "connected" &&
    !!session &&
    !!localParticipant &&
    !leaving &&
    !receiveOnly;
  const participantsByIdentity = useMemo(
    () =>
      new Map(
        snapshot.participants.map((participant) => [
          participant.identity,
          participant.name,
        ]),
      ),
    [snapshot.participants],
  );
  const visibleCaptions = captions
    .filter((caption) => caption.text.trim())
    .slice(-1);

  async function updateMedia(kind: "microphone" | "camera") {
    if (!session || !localParticipant || !mediaReady || busyControl) return;
    setBusyControl(kind);
    setFeedback(null);
    try {
      if (kind === "microphone") {
        await session.setMicrophone(!localParticipant.microphone);
        setFeedback(
          localParticipant.microphone
            ? "Microphone muted."
            : "Microphone unmuted.",
        );
      } else {
        await session.setCamera(!localParticipant.camera);
        setFeedback(
          localParticipant.camera ? "Camera turned off." : "Camera turned on.",
        );
      }
    } catch {
      setFeedback(
        `Could not update ${kind}. If access was denied, enable it in iOS Settings, then check your meeting connection and retry.`,
      );
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

  const microphoneLabel = localParticipant?.microphone
    ? "Mute microphone"
    : "Unmute microphone";
  const cameraLabel = localParticipant?.camera
    ? "Turn camera off"
    : "Turn camera on";

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { borderBottomColor: "#FFFFFF1F" }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={session ? "Leave meeting" : "Back"}
          accessibilityHint={session ? "Ends this meeting on your device." : undefined}
          disabled={leaving}
          onPress={session ? () => void leave() : onBack}
          style={styles.backButton}
        >
          <Text style={[styles.backText, { color: colors.primary }]}>
            {session ? "Leave" : "‹ Back"}
          </Text>
        </Pressable>
        <View style={styles.roomHeading}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.roomName}
          >
            {roomName}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.status,
              {
                color:
                  snapshot.status === "connected"
                    ? colors.success
                    : colors.muted,
              },
            ]}
          >
            {snapshot.status === "connected" ? "●  Connected" : status.label}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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
            <Text
              accessibilityLiveRegion="polite"
              style={styles.stageDescription}
            >
              {status.description}
            </Text>
          </View>
        )}

        {visibleCaptions.map((caption) => {
          const speaker = caption.participantIdentity
            ? (participantsByIdentity.get(caption.participantIdentity) ??
              caption.participantIdentity)
            : null;
          return (
            <View key={caption.id} style={styles.captionOverlay}>
              {speaker && (
                <Text
                  style={[styles.captionSpeaker, { color: colors.primary }]}
                >
                  {speaker}
                </Text>
              )}
              <Text numberOfLines={2} style={styles.captionText}>
                {caption.text.trim()}
              </Text>
            </View>
          );
        })}

        {(feedback || snapshot.error) && (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.feedback, { color: colors.foreground }]}
          >
            {feedback ?? snapshot.error}
          </Text>
        )}
      </ScrollView>

      <View style={[styles.controls, { borderTopColor: "#FFFFFF1F" }]}>
        <View style={styles.controlRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={microphoneLabel}
            accessibilityState={{
              disabled: !mediaReady || busyControl !== null,
              selected: Boolean(localParticipant?.microphone),
            }}
            disabled={!mediaReady || busyControl !== null}
            onPress={() => void updateMedia("microphone")}
            style={[
              styles.controlButton,
              localParticipant?.microphone && styles.activeControl,
              (!mediaReady || busyControl !== null) && styles.disabledControl,
            ]}
          >
            {busyControl === "microphone" ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <IconSymbol
                  name={
                    localParticipant?.microphone ? "mic.fill" : "mic.slash.fill"
                  }
                  size={22}
                  color="#FFFFFF"
                />
                <Text style={styles.controlText}>
                  {localParticipant?.microphone ? "Mute" : "Unmute"}
                </Text>
              </>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cameraLabel}
            accessibilityState={{
              disabled: !mediaReady || busyControl !== null,
              selected: Boolean(localParticipant?.camera),
            }}
            disabled={!mediaReady || busyControl !== null}
            onPress={() => void updateMedia("camera")}
            style={[
              styles.controlButton,
              localParticipant?.camera && styles.activeControl,
              (!mediaReady || busyControl !== null) && styles.disabledControl,
            ]}
          >
            {busyControl === "camera" ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <IconSymbol
                  name={
                    localParticipant?.camera ? "video.fill" : "video.slash.fill"
                  }
                  size={22}
                  color="#FFFFFF"
                />
                <Text style={styles.controlText}>
                  {localParticipant?.camera ? "Video on" : "Video off"}
                </Text>
              </>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Participants"
            accessibilityHint="Shows everyone in this meeting and their microphone and camera states."
            accessibilityState={{ selected: panel === "participants" }}
            onPress={() =>
              setPanel(panel === "participants" ? null : "participants")
            }
            style={[
              styles.controlButton,
              panel === "participants" && styles.selectedControl,
            ]}
          >
            <IconSymbol name="person.3.fill" size={22} color="#FFFFFF" />
            <Text numberOfLines={1} style={styles.controlText}>
              Participants
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More meeting options"
            accessibilityHint="Shows the meeting name and current connection status."
            accessibilityState={{ selected: panel === "more" }}
            onPress={() => setPanel(panel === "more" ? null : "more")}
            style={[
              styles.controlButton,
              panel === "more" && styles.selectedControl,
            ]}
          >
            <IconSymbol name="ellipsis" size={22} color="#FFFFFF" />
            <Text style={styles.controlText}>More</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              session ? "Leave meeting" : "Leave meeting unavailable"
            }
            accessibilityState={{
              disabled: !session || leaving,
              busy: leaving,
            }}
            disabled={!session || leaving}
            onPress={() => void leave()}
            style={[
              styles.leaveButton,
              { backgroundColor: colors.error },
              (!session || leaving) && styles.disabledControl,
            ]}
          >
            {leaving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <IconSymbol name="phone.down.fill" size={22} color="#FFFFFF" />
                <Text style={styles.leaveText}>Leave</Text>
              </>
            )}
          </Pressable>
        </View>
        <Text style={styles.controlsHint}>
          {receiveOnly
            ? "Listen only · microphone and camera are unavailable"
            : sipInterrupted
              ? "Meeting paused for your Phone call. Rejoin after the call ends."
              : snapshot.status === "connected"
                ? `Mic ${localParticipant?.microphone ? "on" : "off"} · Video ${localParticipant?.camera ? "on" : "off"}`
                : "Controls become available when you connect."}
        </Text>
      </View>

      <Modal
        transparent
        visible={panel !== null}
        animationType="slide"
        onRequestClose={() => setPanel(null)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close meeting panel"
            onPress={() => setPanel(null)}
            style={styles.backdropDismiss}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeading}>
              <Text style={styles.sheetTitle}>
                {panel === "participants"
                  ? `Participants (${snapshot.participants.length})`
                  : "Meeting details"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close meeting panel"
                onPress={() => setPanel(null)}
                style={styles.sheetClose}
              >
                <Text style={styles.sheetCloseText}>Done</Text>
              </Pressable>
            </View>
            {panel === "participants" ? (
              <ScrollView
                style={styles.sheetRoster}
                contentContainerStyle={styles.sheetRosterContent}
                showsVerticalScrollIndicator={false}
              >
                {snapshot.participants.length === 0 ? (
                  <Text style={styles.emptyText}>
                    Participants will appear here when they join.
                  </Text>
                ) : (
                  snapshot.participants.map((participant) => (
                    <View
                      key={participant.identity}
                      style={[styles.participant, { borderColor: "#FFFFFF1F" }]}
                    >
                      <ProfileAvatar
                        name={participant.name}
                        photoUrl={
                          participant.local &&
                          ownPhoto &&
                          ownPhoto.userId === user?.id &&
                          meetingTenantId
                            ? ownPhoto.photoUrl
                            : meetingAvatarPerson(
                                participant.identity,
                                photoTenantId,
                                photoPeople,
                              )?.photoUrl
                        }
                        photoVersion={
                          participant.local &&
                          ownPhoto &&
                          ownPhoto.userId === user?.id
                            ? ownPhoto.photoVersion
                            : undefined
                        }
                        tenantId={
                          participant.local ? meetingTenantId : photoTenantId
                        }
                        userId={
                          participant.local
                            ? user?.id
                            : meetingAvatarPerson(
                                participant.identity,
                                photoTenantId,
                                photoPeople,
                              )?.id
                        }
                        size={40}
                        accessibilityLabel={`${participant.name} profile photo`}
                      />
                      <View style={styles.participantCopy}>
                        <Text numberOfLines={1} style={styles.participantName}>
                          {participant.name}
                          {participant.local ? " (You)" : ""}
                        </Text>
                        <Text style={styles.participantMeta}>
                          {participantState(participant)}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            ) : (
              <View style={styles.infoRows}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Meeting</Text>
                  <Text numberOfLines={2} style={styles.infoValue}>
                    {roomName}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Connection</Text>
                  <Text style={styles.infoValue}>{status.label}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Audio & video</Text>
                  <Text style={styles.infoValue}>
                    {receiveOnly
                      ? "Listen only"
                      : `Mic ${localParticipant?.microphone ? "on" : "off"} · Video ${localParticipant?.camera ? "on" : "off"}`}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0D0F14" },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
  },
  backButton: { minHeight: 44, minWidth: 64, justifyContent: "center" },
  backText: { fontSize: 17, fontWeight: "700" },
  roomHeading: { flex: 1, alignItems: "center", gap: 2 },
  roomName: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  status: { fontSize: 13, fontWeight: "600" },
  headerSpacer: { minWidth: 64 },
  content: { flexGrow: 1, padding: 16, gap: 14, paddingBottom: 18 },
  stage: {
    minHeight: 180,
    borderRadius: 24,
    backgroundColor: "#191D26",
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
    gap: 8,
  },
  stageEyebrow: {
    color: "#B4BAC6",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  stageTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
  },
  stageDescription: {
    color: "#B4BAC6",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 360,
  },
  emptyText: { color: "#B4BAC6", fontSize: 15, lineHeight: 22 },
  participant: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  participantCopy: { flex: 1, gap: 2 },
  participantName: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  participantMeta: { color: "#B4BAC6", fontSize: 14 },
  captionOverlay: {
    borderRadius: 14,
    backgroundColor: "#191D26",
    padding: 12,
    gap: 4,
  },
  captionSpeaker: { fontSize: 14, fontWeight: "700" },
  captionText: { color: "#FFFFFF", fontSize: 15, lineHeight: 22 },
  feedback: {
    backgroundColor: "#FFFFFF12",
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
  },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#11141B",
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 8,
  },
  controlsHint: {
    color: "#B4BAC6",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  controlRow: { flexDirection: "row", gap: 4, justifyContent: "space-between" },
  controlButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    borderWidth: 1,
    borderColor: "#FFFFFF2B",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    gap: 2,
  },
  activeControl: { backgroundColor: "#FFFFFF1A", borderColor: "#FFFFFF55" },
  selectedControl: { borderColor: "#2D8CFF", backgroundColor: "#2D8CFF20" },
  controlText: {
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
  },
  leaveButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    gap: 2,
  },
  leaveText: {
    color: "#FFFFFF",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  disabledControl: { opacity: 0.42 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#00000088",
  },
  backdropDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: "#191D26",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 14,
  },
  sheetRoster: { maxHeight: 440 },
  sheetRosterContent: { gap: 8, paddingBottom: 8 },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FFFFFF55",
  },
  sheetHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  sheetTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  sheetClose: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  sheetCloseText: { color: "#69AFFF", fontSize: 16, fontWeight: "700" },
  infoRows: { gap: 0 },
  infoRow: {
    minHeight: 54,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#FFFFFF1F",
    gap: 16,
  },
  infoLabel: { color: "#B4BAC6", fontSize: 14 },
  infoValue: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
  },
});
