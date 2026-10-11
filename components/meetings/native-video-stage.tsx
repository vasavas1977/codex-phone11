import { VideoView } from "@livekit/react-native";
import type { VideoTrack } from "livekit-client";
import { useEffect, useRef, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { BrowserRoom } from "@/lib/meetings/browser-session";
import { meetingParticipantDisplayName } from "@/lib/meetings/participant-display-name";
import {
  meetingVideoPublications,
  type MeetingVideoPublication,
} from "@/lib/meetings/video-publications";
import {
  meetingSpeakerIdentity,
  orderMeetingVideoTiles,
  type MeetingVideoLayout,
} from "@/lib/meetings/video-layout";

type Publication = {
  videoTrack?: VideoTrack;
  audioTrack?: unknown;
  track?: VideoTrack;
};
type NativeParticipant = {
  identity: string;
  name?: string;
  isSpeaking?: boolean;
  videoTrackPublications?: ReadonlyMap<
    string,
    MeetingVideoPublication<VideoTrack>
  >;
  audioTrackPublications?: ReadonlyMap<string, Publication>;
};
type NativeRoom = BrowserRoom & {
  localParticipant: NativeParticipant;
  remoteParticipants: ReadonlyMap<string, NativeParticipant>;
};

function subscribedAudioCount(participant: NativeParticipant): number {
  let count = 0;
  for (const publication of participant.audioTrackPublications?.values() ??
    []) {
    if (publication.audioTrack ?? publication.track) count += 1;
  }
  return count;
}

function VideoTile({
  track,
  label,
  local = false,
  screenShare = false,
  prominent = false,
  thumbnail = false,
}: {
  track: VideoTrack;
  label: string;
  local?: boolean;
  screenShare?: boolean;
  prominent?: boolean;
  thumbnail?: boolean;
}) {
  // The lifecycle creates this existing, server-authorized LiveKit Room.
  // VideoView renders only its actual media track; it accepts no URL or token.
  return (
    <View
      style={[
        styles.tile,
        prominent && styles.speakerTile,
        thumbnail && styles.thumbnailTile,
        screenShare && styles.screenTile,
      ]}
      testID={
        screenShare
          ? "shared-screen"
          : local
            ? "local-camera-preview"
            : "remote-video"
      }
    >
      <VideoView
        videoTrack={track}
        style={styles.video}
        objectFit={screenShare ? "contain" : "cover"}
        mirror={local && !screenShare}
        zOrder={local ? 1 : 0}
      />
      <View style={styles.nameBadge} pointerEvents="none">
        <Text numberOfLines={1} style={styles.name}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export function NativeVideoStage({
  room,
  reconnecting,
  receiveOnly,
  layout = "speaker",
  renderAvatar,
}: {
  room?: BrowserRoom;
  reconnecting: boolean;
  receiveOnly: boolean;
  layout?: MeetingVideoLayout;
  /** Profile media comes only from the owning authenticated workspace surface. */
  renderAvatar?: (target: {
    identity: string;
    local: boolean;
    name: string;
    size: number;
  }) => ReactNode;
}) {
  const nativeRoom = room as NativeRoom | undefined;
  const localVideos = meetingVideoPublications(
    nativeRoom?.localParticipant.videoTrackPublications,
  );
  const remoteParticipants: NativeParticipant[] = nativeRoom
    ? Array.from(nativeRoom.remoteParticipants.values())
    : [];
  const previousSpeaker = useRef<{ room?: BrowserRoom; identity?: string }>({});
  const speaker = meetingSpeakerIdentity(
    [
      ...remoteParticipants.map((participant) => ({
        identity: participant.identity,
        local: false,
        speaking: participant.isSpeaking,
      })),
      ...(nativeRoom
        ? [
            {
              identity: nativeRoom.localParticipant.identity,
              local: true,
              speaking: nativeRoom.localParticipant.isSpeaking,
            },
          ]
        : []),
    ],
    previousSpeaker.current.room === room
      ? previousSpeaker.current.identity
      : undefined,
  );
  useEffect(() => {
    previousSpeaker.current = { room, identity: speaker };
  }, [room, speaker]);
  const remoteVideos = remoteParticipants.flatMap((participant, index) =>
    meetingVideoPublications(participant.videoTrackPublications).map(
      (video) => ({
        ...video,
        key: `${participant.identity}:${video.key}`,
        identity: participant.identity,
        label: meetingParticipantDisplayName(
          participant.name,
          participant.identity,
          `Participant ${index + 1}`,
        ),
      }),
    ),
  );
  const remoteAudio = remoteParticipants.filter(
    (participant) => subscribedAudioCount(participant) > 0,
  ).length;
  const hasSharedScreen = [...remoteVideos, ...localVideos].some(
    (video) => video.screenShare,
  );
  const placeholderParticipants = nativeRoom
    ? [
        ...remoteParticipants.map((participant, index) => ({
          identity: participant.identity,
          label: meetingParticipantDisplayName(
            participant.name,
            participant.identity,
            `Participant ${index + 1}`,
          ),
          videos: meetingVideoPublications(participant.videoTrackPublications),
        })),
        {
          identity: nativeRoom.localParticipant.identity,
          label: "You",
          videos: localVideos,
        },
      ].filter(
        (participant) =>
          !participant.videos.some((video) => !video.screenShare),
      )
    : [];
  const isProminent = (identity: string) =>
    layout === "speaker" && !hasSharedScreen && identity === speaker;
  const tiles = orderMeetingVideoTiles(
    [
      ...remoteVideos.map((video) => ({ ...video, local: false })),
      ...localVideos.map((video) => ({
        ...video,
        key: `local:${video.key}`,
        identity: nativeRoom!.localParticipant.identity,
        label: "You",
        local: true,
      })),
      ...placeholderParticipants.map((participant) => ({
        key: `camera-off:${participant.identity}`,
        identity: participant.identity,
        label: participant.label,
        track: undefined,
        screenShare: false,
        local: participant.identity === nativeRoom?.localParticipant.identity,
      })),
    ],
    layout,
    speaker,
  );

  return (
    <View style={styles.stage} testID="native-video-stage">
      {tiles.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            {reconnecting ? "Reconnecting video…" : "Waiting for video"}
          </Text>
          <Text style={styles.emptyCopy}>
            {receiveOnly
              ? "This is a listen-only membership. Shared audio and video appear when other participants publish them."
              : "Your camera preview and participant video appear when available."}
          </Text>
        </View>
      ) : null}
      <View style={styles.grid}>
        {tiles.map((video) =>
          video.track ? (
            <VideoTile
              key={video.key}
              track={video.track}
              label={
                video.screenShare
                  ? `${video.label} ${video.local ? "are" : "is"} sharing`
                  : video.label
              }
              local={video.local}
              screenShare={video.screenShare}
              prominent={isProminent(video.identity)}
              thumbnail={
                layout === "speaker" &&
                !isProminent(video.identity) &&
                !video.screenShare
              }
            />
          ) : (
            <View
              key={video.key}
              style={[
                styles.tile,
                styles.cameraOff,
                isProminent(video.identity) && styles.speakerTile,
                layout === "speaker" &&
                  !isProminent(video.identity) &&
                  styles.thumbnailTile,
              ]}
              testID="camera-off-participant"
            >
              {renderAvatar?.({
                identity: video.identity,
                local: video.local,
                name: video.label,
                size:
                  layout === "speaker" && !isProminent(video.identity)
                    ? 40
                    : 72,
              })}
              <Text style={styles.placeholderName}>{video.label}</Text>
              <Text style={styles.cameraOffText}>Camera off</Text>
            </View>
          ),
        )}
      </View>
      {receiveOnly && tiles.length > 0 && (
        <Text style={styles.membershipState}>Listen-only membership</Text>
      )}
      {remoteAudio > 0 && (
        <Text style={styles.audioState} accessibilityLiveRegion="polite">
          Receiving audio from {remoteAudio} participant
          {remoteAudio === 1 ? "" : "s"}
        </Text>
      )}
      {reconnecting && (
        <View style={styles.reconnecting} pointerEvents="none">
          <Text style={styles.reconnectingText}>Reconnecting…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    minHeight: 250,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#191D26",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, minHeight: 250 },
  tile: {
    minHeight: 180,
    flexBasis: "49%",
    flexGrow: 1,
    backgroundColor: "#0B0D12",
    overflow: "hidden",
  },
  screenTile: { minHeight: 250, flexBasis: "100%" },
  speakerTile: { minHeight: 300, flexBasis: "100%" },
  thumbnailTile: { minHeight: 110, flexBasis: "31%" },
  cameraOff: {
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 6,
  },
  placeholderName: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  cameraOffText: { color: "#B4BAC6", fontSize: 13 },
  membershipState: { color: "#B4BAC6", fontSize: 13, padding: 12 },
  video: { flex: 1, width: "100%" },
  nameBadge: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 8,
    backgroundColor: "#00000099",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  name: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  empty: {
    minHeight: 250,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 8,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyCopy: {
    color: "#B4BAC6",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 360,
  },
  audioState: {
    position: "absolute",
    left: 12,
    bottom: 12,
    color: "#FFFFFF",
    backgroundColor: "#00000099",
    borderRadius: 8,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: "600",
  },
  reconnecting: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000066",
  },
  reconnectingText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
});
