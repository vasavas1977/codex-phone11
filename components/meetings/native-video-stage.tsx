import { VideoView } from "@livekit/react-native";
import type { VideoTrack } from "livekit-client";
import { StyleSheet, Text, View } from "react-native";

import type { BrowserRoom } from "@/lib/meetings/browser-session";
import { meetingParticipantDisplayName } from "@/lib/meetings/participant-display-name";
import { meetingVideoPublications, type MeetingVideoPublication } from "@/lib/meetings/video-publications";

type Publication = {
  videoTrack?: VideoTrack;
  audioTrack?: unknown;
  track?: VideoTrack;
};
type NativeParticipant = {
  identity: string;
  name?: string;
  videoTrackPublications?: ReadonlyMap<string, MeetingVideoPublication<VideoTrack>>;
  audioTrackPublications?: ReadonlyMap<string, Publication>;
};
type NativeRoom = BrowserRoom & {
  localParticipant: NativeParticipant;
  remoteParticipants: ReadonlyMap<string, NativeParticipant>;
};

function subscribedAudioCount(participant: NativeParticipant): number {
  let count = 0;
  for (const publication of participant.audioTrackPublications?.values() ?? []) {
    if (publication.audioTrack ?? publication.track) count += 1;
  }
  return count;
}

function VideoTile({
  track,
  label,
  local = false,
  screenShare = false,
}: {
  track: VideoTrack;
  label: string;
  local?: boolean;
  screenShare?: boolean;
}) {
  // The lifecycle creates this existing, server-authorized LiveKit Room.
  // VideoView renders only its actual media track; it accepts no URL or token.
  return (
    <View style={[styles.tile, screenShare && styles.screenTile]} testID={screenShare ? "shared-screen" : local ? "local-camera-preview" : "remote-video"}>
      <VideoView
        videoTrack={track}
        style={styles.video}
        objectFit={screenShare ? "contain" : "cover"}
        mirror={local && !screenShare}
        zOrder={local ? 1 : 0}
      />
      <View style={styles.nameBadge} pointerEvents="none">
        <Text numberOfLines={1} style={styles.name}>{label}</Text>
      </View>
    </View>
  );
}

export function NativeVideoStage({
  room,
  reconnecting,
  receiveOnly,
}: {
  room?: BrowserRoom;
  reconnecting: boolean;
  receiveOnly: boolean;
}) {
  const nativeRoom = room as NativeRoom | undefined;
  const localVideos = meetingVideoPublications(nativeRoom?.localParticipant.videoTrackPublications);
  const remoteParticipants: NativeParticipant[] = nativeRoom
    ? Array.from(nativeRoom.remoteParticipants.values())
    : [];
  const remoteVideos = remoteParticipants.flatMap((participant, index) =>
    meetingVideoPublications(participant.videoTrackPublications).map(video => ({
      ...video,
      key: `${participant.identity}:${video.key}`,
      label: meetingParticipantDisplayName(participant.name, participant.identity, `Participant ${index + 1}`),
    })),
  );
  const remoteAudio = remoteParticipants.reduce(
    (count, participant) => count + subscribedAudioCount(participant),
    0,
  );

  return (
    <View style={styles.stage} testID="native-video-stage">
      {remoteVideos.length === 0 && localVideos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{reconnecting ? "Reconnecting video…" : "Waiting for video"}</Text>
          <Text style={styles.emptyCopy}>
            {receiveOnly
              ? "This is a listen-only membership. Shared audio and video appear when other participants publish them."
              : "Your camera preview and participant video appear when available."}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {remoteVideos.map((video) => (
            <VideoTile key={video.key} track={video.track} label={video.screenShare ? `${video.label} is sharing` : video.label} screenShare={video.screenShare} />
          ))}
          {localVideos.map(video => <VideoTile key={`local:${video.key}`} track={video.track} label={video.screenShare ? "You are sharing" : "You"} local screenShare={video.screenShare} />)}
        </View>
      )}
      {remoteAudio > 0 && (
        <Text style={styles.audioState} accessibilityLiveRegion="polite">
          Receiving audio from {remoteAudio} participant{remoteAudio === 1 ? "" : "s"}
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
  stage: { minHeight: 250, borderRadius: 24, overflow: "hidden", backgroundColor: "#191D26" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, minHeight: 250 },
  tile: { minHeight: 180, flexBasis: "49%", flexGrow: 1, backgroundColor: "#0B0D12", overflow: "hidden" },
  screenTile: { minHeight: 250, flexBasis: "100%" },
  video: { flex: 1, width: "100%" },
  nameBadge: { position: "absolute", left: 10, right: 10, bottom: 10, borderRadius: 8, backgroundColor: "#00000099", paddingHorizontal: 8, paddingVertical: 5 },
  name: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  empty: { minHeight: 250, alignItems: "center", justifyContent: "center", padding: 28, gap: 8 },
  emptyTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "700", textAlign: "center" },
  emptyCopy: { color: "#B4BAC6", fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 360 },
  audioState: { position: "absolute", left: 12, bottom: 12, color: "#FFFFFF", backgroundColor: "#00000099", borderRadius: 8, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, fontSize: 13, fontWeight: "600" },
  reconnecting: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#00000066" },
  reconnectingText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
});
