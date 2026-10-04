import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AudioTrack, VideoTrack } from "livekit-client";

import type { BrowserRoom } from "@/lib/meetings/browser-session";
import { meetingParticipantDisplayName } from "@/lib/meetings/participant-display-name";
import { meetingVideoPublications, type MeetingVideoPublication } from "@/lib/meetings/video-publications";

type Publication = { track?: AudioTrack | VideoTrack; audioTrack?: AudioTrack; videoTrack?: VideoTrack };
type MediaParticipant = {
  identity: string;
  name?: string;
  audioTrackPublications?: ReadonlyMap<string, Publication>;
  videoTrackPublications?: ReadonlyMap<string, MeetingVideoPublication<VideoTrack>>;
};

function audioTracks(participant: MediaParticipant): AudioTrack[] {
  return Array.from(participant.audioTrackPublications?.values() ?? [], publication =>
    (publication.audioTrack ?? publication.track) as AudioTrack | undefined,
  ).filter((track): track is AudioTrack => Boolean(track));
}

function WebVideo({ track, local, screenShare }: { track: VideoTrack; local: boolean; screenShare: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted={local} style={{ ...styles.video, objectFit: screenShare ? "contain" : "cover" }} />;
}

function WebAudio({ track }: { track: AudioTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

/** Renders only tracks from the authenticated, already connected web Room. */
export function NativeVideoStage({
  room,
  reconnecting,
  receiveOnly,
}: {
  room?: BrowserRoom;
  reconnecting: boolean;
  receiveOnly: boolean;
}) {
  const mediaRoom = room as (BrowserRoom & {
    localParticipant: MediaParticipant;
    remoteParticipants: ReadonlyMap<string, MediaParticipant>;
    readonly canPlaybackAudio: boolean;
    startAudio(): Promise<void>;
  }) | undefined;
  const [audioBlocked, setAudioBlocked] = useState(false);
  useEffect(() => {
    if (!mediaRoom) return;
    const refresh = () => setAudioBlocked(mediaRoom.canPlaybackAudio === false);
    refresh();
    mediaRoom.on("audioPlaybackChanged", refresh);
    return () => { mediaRoom.off("audioPlaybackChanged", refresh); };
  }, [mediaRoom]);
  const localVideos = meetingVideoPublications(mediaRoom?.localParticipant.videoTrackPublications);
  const remotes: MediaParticipant[] = mediaRoom ? Array.from(mediaRoom.remoteParticipants.values()) : [];
  const remoteVideos = remotes.flatMap((participant, index) =>
    meetingVideoPublications(participant.videoTrackPublications).map(video => ({
          ...video,
          key: `${participant.identity}:${video.key}`,
          label: meetingParticipantDisplayName(
            participant.name,
            participant.identity,
            `Participant ${index + 1}`,
          ),
        })),
  );
  const remoteAudio = remotes.flatMap(participant => audioTracks(participant).map((track, index) => ({
    key: `${participant.identity}:${index}`, track,
  })));

  return (
    <View style={styles.stage} testID="web-video-stage">
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
          {remoteVideos.map(video => (
            <View key={video.key} style={[styles.tile, video.screenShare && styles.screenTile]} testID={video.screenShare ? "shared-screen" : "remote-video"}>
              <WebVideo track={video.track} local={false} screenShare={video.screenShare} />
              <Text style={styles.name}>{video.screenShare ? `${video.label} is sharing` : video.label}</Text>
            </View>
          ))}
          {localVideos.map(video => <View key={`local:${video.key}`} style={[styles.tile, video.screenShare && styles.screenTile]} testID={video.screenShare ? "shared-screen" : "local-camera-preview"}>
            <WebVideo track={video.track} local screenShare={video.screenShare} />
            <Text style={styles.name}>{video.screenShare ? "You are sharing" : "You"}</Text>
          </View>)}
        </View>
      )}
      {remoteAudio.map(({ key, track }) => <WebAudio key={key} track={track} />)}
      {remoteAudio.length > 0 && <Text style={styles.audioState}>Receiving audio from {remoteAudio.length} participant{remoteAudio.length === 1 ? "" : "s"}</Text>}
      {audioBlocked && <Pressable
        accessibilityRole="button"
        accessibilityLabel="Enable meeting audio"
        onPress={() => void mediaRoom?.startAudio().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true))}
        style={styles.audioPrompt}
      ><Text style={styles.audioPromptText}>Tap to enable meeting audio</Text></Pressable>}
      {reconnecting && <View style={styles.reconnecting}><Text style={styles.reconnectingText}>Reconnecting…</Text></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { minHeight: 250, borderRadius: 24, overflow: "hidden", backgroundColor: "#191D26" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, minHeight: 250 },
  tile: { minHeight: 180, flexBasis: "49%", flexGrow: 1, backgroundColor: "#0B0D12", overflow: "hidden" },
  screenTile: { minHeight: 250, flexBasis: "100%" },
  video: { width: "100%", height: "100%", objectFit: "cover" as const },
  name: { position: "absolute", left: 10, bottom: 10, color: "#FFFFFF", backgroundColor: "#00000099", paddingHorizontal: 8, paddingVertical: 5 },
  empty: { minHeight: 250, alignItems: "center", justifyContent: "center", padding: 28, gap: 8 },
  emptyTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "700", textAlign: "center" },
  emptyCopy: { color: "#B4BAC6", fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 360 },
  audioState: { position: "absolute", left: 12, bottom: 12, color: "#FFFFFF", backgroundColor: "#00000099", paddingHorizontal: 8, paddingVertical: 5, fontSize: 13 },
  audioPrompt: { minHeight: 48, alignSelf: "center", justifyContent: "center", borderRadius: 10, margin: 12, paddingHorizontal: 16, backgroundColor: "#3277EE" },
  audioPromptText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  reconnecting: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#00000066" },
  reconnectingText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
});
