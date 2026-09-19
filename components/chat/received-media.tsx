import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAudioPlayer } from "expo-audio";
import { VideoView, useVideoPlayer } from "expo-video";
import { getChatMediaSource } from "@/lib/chat/media-client";
import { phone11MediaOwnership } from "@/lib/meetings/native-session";
import { useColors } from "@/hooks/use-colors";
import type { ChatAttachment } from "@/lib/chat/types";

export function ReceivedMedia({ attachment }: { attachment: ChatAttachment }) {
  const colors = useColors(),
    audio = useAudioPlayer(null, { keepAudioSessionActive: false }),
    video = useVideoPlayer(null);
  const lease = useRef<
      ReturnType<typeof phone11MediaOwnership.requestVoiceNote>["lease"] | null
    >(null),
    source = useRef<Awaited<ReturnType<typeof getChatMediaSource>> | null>(
      null,
    ),
    generation = useRef(0),
    mounted = useRef(true),
    pending = useRef(false);
  const [error, setError] = useState<string | null>(null),
    [playing, setPlaying] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const isVideo = attachment.mimeType.startsWith("video/");
  const stop = () => {
    generation.current++;
    audio.pause();
    video.pause();
    if (mounted.current) setPlaying(false);
    if (lease.current) phone11MediaOwnership.release(lease.current);
    lease.current = null;
  };
  const latest = useRef(stop);
  latest.current = stop;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latest.current();
      source.current?.release();
      source.current = null;
    };
  }, [attachment.id]);
  useEffect(() => {
    const a = audio.addListener?.("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) latest.current();
    });
    const v = video.addListener?.("playToEnd", () => latest.current());
    return () => {
      a?.remove();
      v?.remove();
    };
  }, [audio, video]);
  const play = async () => {
    if (pending.current || !mounted.current) return;
    stop();
    const version = generation.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    let fetched: Awaited<ReturnType<typeof getChatMediaSource>> | null = null;
    try {
      // Playback remains stopped until this user tap has verified any failed
      // predecessor recorder shutdown. It is a no-op in the normal path.
      await phone11MediaOwnership.retryVoiceStop();
      if (!mounted.current || version !== generation.current) return;
      source.current?.release();
      source.current = null;
      fetched = await getChatMediaSource(attachment.id);
      fetched.assertOwner();
      if (!mounted.current || version !== generation.current) return;
      const request = phone11MediaOwnership.requestVoiceNote(
        `chat-playback:${attachment.id}`,
        {
          stopForSip: async () => {
            latest.current();
          },
        },
      );
      lease.current = request.lease;
      await request.ready;
      fetched.assertOwner();
      if (
        !mounted.current ||
        version !== generation.current ||
        !phone11MediaOwnership.isCurrent(request.lease)
      )
        return;
      if (isVideo) {
        video.replace(fetched.source);
        setLoaded(true);
        video.play();
      } else {
        audio.replace(fetched.source);
        audio.play();
      }
      source.current = fetched;
      fetched = null;
      setPlaying(true);
    } catch {
      if (mounted.current && version === generation.current) {
        stop();
        setError(
          "Media is unavailable, your account changed, or a call is active.",
        );
      }
    } finally {
      fetched?.release();
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <View
      style={{
        minWidth: 200,
        maxWidth: 560,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        padding: 12,
      }}
    >
      <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
        {attachment.filename}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          playing ? "Pause media" : `Play ${attachment.filename}`
        }
        disabled={busy}
        onPress={() => (playing ? stop() : void play())}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primary }}>
          {busy
            ? "Loading…"
            : error
              ? "Retry media"
              : playing
                ? "Pause"
                : "Play"}
        </Text>
      </Pressable>
      {isVideo && loaded && (
        <VideoView
          player={video}
          nativeControls={false}
          style={{ width: "100%", height: 220 }}
        />
      )}
      {error && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
    </View>
  );
}
