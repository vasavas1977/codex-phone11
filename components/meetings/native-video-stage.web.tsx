import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AudioTrack, VideoTrack } from "livekit-client";

import type { BrowserRoom } from "@/lib/meetings/browser-session";
import { meetingParticipantDisplayName } from "@/lib/meetings/participant-display-name";
import {
  meetingSpeakerIdentity,
  orderMeetingVideoTiles,
  type MeetingVideoLayout,
} from "@/lib/meetings/video-layout";
import {
  meetingVideoPublications,
  type MeetingVideoPublication,
} from "@/lib/meetings/video-publications";

type Publication = {
  track?: AudioTrack | VideoTrack;
  audioTrack?: AudioTrack;
  videoTrack?: VideoTrack;
};
type MediaParticipant = {
  identity: string;
  name?: string;
  isSpeaking?: boolean;
  audioTrackPublications?: ReadonlyMap<string, Publication>;
  videoTrackPublications?: ReadonlyMap<
    string,
    MeetingVideoPublication<VideoTrack>
  >;
};

function audioTracks(participant: MediaParticipant): AudioTrack[] {
  return Array.from(
    participant.audioTrackPublications?.values() ?? [],
    (publication) =>
      (publication.audioTrack ?? publication.track) as AudioTrack | undefined,
  ).filter((track): track is AudioTrack => Boolean(track));
}

function WebVideo({
  track,
  local,
  screenShare,
}: {
  track: VideoTrack;
  local: boolean;
  screenShare: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={local}
      style={{
        ...styles.video,
        objectFit: screenShare ? "contain" : "cover",
        transform: local && !screenShare ? "scaleX(-1)" : undefined,
      }}
    />
  );
}

function WebAudio({ track }: { track: AudioTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

/** Renders only tracks from the authenticated, already connected web Room. */
export function NativeVideoStage({
  room,
  reconnecting,
  receiveOnly,
  layout = "speaker",
}: {
  room?: BrowserRoom;
  reconnecting: boolean;
  receiveOnly: boolean;
  layout?: MeetingVideoLayout;
}) {
  const mediaRoom = room as
    | (BrowserRoom & {
        localParticipant: MediaParticipant;
        remoteParticipants: ReadonlyMap<string, MediaParticipant>;
        readonly canPlaybackAudio: boolean;
        startAudio(): Promise<void>;
      })
    | undefined;
  const [playback, setPlayback] = useState(() => ({
    room: mediaRoom,
    blocked: mediaRoom?.canPlaybackAudio === false,
  }));
  const playbackOwner = useRef<{
    room: typeof mediaRoom;
    enable(): Promise<void>;
  } | null>(null);
  useEffect(() => {
    let current = true;
    let pending = false;
    const refresh = () => {
      if (current)
        setPlayback({
          room: mediaRoom,
          blocked: mediaRoom?.canPlaybackAudio === false,
        });
    };
    const owner = {
      room: mediaRoom,
      async enable() {
        if (!current || pending || !mediaRoom) return;
        pending = true;
        try {
          await mediaRoom.startAudio();
        } catch {
          /* Playback state, rather than the attempt outcome, controls the prompt. */
        } finally {
          pending = false;
          refresh();
        }
      },
    };
    playbackOwner.current = owner;
    refresh();
    mediaRoom?.on("audioPlaybackChanged", refresh);
    return () => {
      current = false;
      mediaRoom?.off("audioPlaybackChanged", refresh);
      if (playbackOwner.current === owner) playbackOwner.current = null;
    };
  }, [mediaRoom]);
  // A replacement room must not inherit the previous room's state, including
  // during the render before passive-effect cleanup installs its new owner.
  const audioBlocked = Boolean(
    mediaRoom &&
    (playback.room === mediaRoom
      ? playback.blocked
      : mediaRoom.canPlaybackAudio === false),
  );
  const localVideos = meetingVideoPublications(
    mediaRoom?.localParticipant.videoTrackPublications,
  );
  const remotes: MediaParticipant[] = mediaRoom
    ? Array.from(mediaRoom.remoteParticipants.values())
    : [];
  const previousSpeaker = useRef<{ room?: BrowserRoom; identity?: string }>({});
  const speaker = meetingSpeakerIdentity(
    [
      ...remotes.map((participant) => ({
        identity: participant.identity,
        local: false,
        speaking: participant.isSpeaking,
      })),
      ...(mediaRoom
        ? [
            {
              identity: mediaRoom.localParticipant.identity,
              local: true,
              speaking: mediaRoom.localParticipant.isSpeaking,
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
  const remoteVideos = remotes.flatMap((participant, index) =>
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
  // Audio stays independent of the display layout: every existing remote audio
  // track retains its attachment and key when tiles reorder or resize.
  const remoteAudio = remotes.flatMap((participant) =>
    audioTracks(participant).map((track, index) => ({
      key: `${participant.identity}:${index}`,
      track,
    })),
  );
  const remoteAudioPeople = remotes.filter(
    (participant) => audioTracks(participant).length > 0,
  ).length;
  const hasSharedScreen = [...remoteVideos, ...localVideos].some(
    (video) => video.screenShare,
  );
  const placeholders = mediaRoom
    ? [
        ...remotes.map((participant, index) => ({
          identity: participant.identity,
          label: meetingParticipantDisplayName(
            participant.name,
            participant.identity,
            `Participant ${index + 1}`,
          ),
          videos: meetingVideoPublications(participant.videoTrackPublications),
        })),
        {
          identity: mediaRoom.localParticipant.identity,
          label: "You",
          videos: localVideos,
        },
      ].filter(
        (participant) =>
          !participant.videos.some((video) => !video.screenShare),
      )
    : [];
  const prominent = (identity: string) =>
    layout === "speaker" && !hasSharedScreen && identity === speaker;
  const tiles = orderMeetingVideoTiles(
    [
      ...remoteVideos.map((video) => ({ ...video, local: false })),
      ...localVideos.map((video) => ({
        ...video,
        key: `local:${video.key}`,
        identity: mediaRoom!.localParticipant.identity,
        label: "You",
        local: true,
      })),
      ...placeholders.map((participant) => ({
        key: `camera-off:${participant.identity}`,
        identity: participant.identity,
        label: participant.label,
        track: undefined,
        screenShare: false,
        local: participant.identity === mediaRoom?.localParticipant.identity,
      })),
    ],
    layout,
    speaker,
  );

  return (
    <View style={styles.stage} testID="web-video-stage">
      {tiles.length === 0 && (
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
      )}
      <View style={styles.grid}>
        {tiles.map((video) => (
          <View
            key={video.key}
            style={[
              styles.tile,
              prominent(video.identity) && styles.speakerTile,
              layout === "speaker" &&
                !prominent(video.identity) &&
                !video.screenShare &&
                styles.thumbnailTile,
              video.screenShare && styles.screenTile,
              !video.track && styles.cameraOff,
            ]}
            testID={
              video.screenShare
                ? "shared-screen"
                : !video.track
                  ? "camera-off-participant"
                  : video.local
                    ? "local-camera-preview"
                    : "remote-video"
            }
          >
            {video.track ? (
              <>
                <WebVideo
                  track={video.track}
                  local={video.local}
                  screenShare={video.screenShare}
                />
                <Text style={styles.name}>
                  {video.screenShare
                    ? `${video.label} ${video.local ? "are" : "is"} sharing`
                    : video.label}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.placeholderName}>{video.label}</Text>
                <Text style={styles.cameraOffText}>Camera off</Text>
              </>
            )}
          </View>
        ))}
      </View>
      {receiveOnly && tiles.length > 0 && (
        <Text style={styles.membershipState}>Listen-only membership</Text>
      )}
      {remoteAudio.map(({ key, track }) => (
        <WebAudio key={key} track={track} />
      ))}
      {remoteAudio.length > 0 && (
        <Text style={styles.audioState}>
          Receiving audio from {remoteAudioPeople} participant
          {remoteAudioPeople === 1 ? "" : "s"}
        </Text>
      )}
      {audioBlocked && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enable meeting audio"
          onPress={() => {
            const owner = playbackOwner.current;
            if (owner && owner.room === mediaRoom) void owner.enable();
          }}
          style={styles.audioPrompt}
        >
          <Text style={styles.audioPromptText}>
            Tap to enable meeting audio
          </Text>
        </Pressable>
      )}
      {reconnecting && (
        <View style={styles.reconnecting}>
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
    position: "relative",
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
  video: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
  },
  name: {
    position: "absolute",
    left: 10,
    bottom: 10,
    color: "#FFFFFF",
    backgroundColor: "#00000099",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
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
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 13,
  },
  audioPrompt: {
    minHeight: 48,
    alignSelf: "center",
    justifyContent: "center",
    borderRadius: 10,
    margin: 12,
    paddingHorizontal: 16,
    backgroundColor: "#3277EE",
  },
  audioPromptText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  reconnecting: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000066",
  },
  reconnectingText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
});
