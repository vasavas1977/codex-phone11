import { useEffect, useRef, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import { VideoView, useVideoPlayer } from "expo-video";
import { getChatMediaSource } from "@/lib/chat/media-client";
import { phone11MediaOwnership } from "@/lib/meetings/native-session";
import { useColors } from "@/hooks/use-colors";
import type { ChatAttachment } from "@/lib/chat/types";

export function ReceivedMedia({ attachment }: { attachment: ChatAttachment }) {
  const colors = useColors(),
    audio = useAudioPlayer(null, { keepAudioSessionActive: false }),
    audioStatus = useAudioPlayerStatus(audio),
    video = useVideoPlayer(null);
  const lease = useRef<
      ReturnType<typeof phone11MediaOwnership.requestVoiceNote>["lease"] | null
    >(null),
    source = useRef<Awaited<ReturnType<typeof getChatMediaSource>> | null>(
      null,
    ),
    generation = useRef(0),
    mounted = useRef(true),
    pending = useRef(false),
    finished = useRef(false),
    configuring = useRef<Promise<void> | null>(null),
    stopping = useRef<Promise<void> | null>(null),
    pendingLoad = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null),
    [playing, setPlaying] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const isVideo = attachment.mimeType.startsWith("video/");
  const elapsed = Number.isFinite(audioStatus.currentTime) ? audioStatus.currentTime : 0;
  const duration = Number.isFinite(audioStatus.duration) ? audioStatus.duration : 0;
  const audioDuration = useRef(duration);
  audioDuration.current = duration;
  const progress = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0;
  const clock = (seconds: number) => {
    const safe = Math.max(0, Math.round(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  };
  const stop = (): Promise<void> => {
    generation.current++;
    if (mounted.current) setPlaying(false);
    if (stopping.current) return stopping.current;
    const ownedLease = lease.current;
    const configuration = configuring.current;
    const task = (async () => {
      try {
        audio.pause();
        video.pause();
      } catch {
        // Retry after a pending native mode change settles.
      }
      await configuration?.catch(() => undefined);
      audio.pause();
      video.pause();
      if (ownedLease && lease.current === ownedLease) {
        phone11MediaOwnership.release(ownedLease);
        lease.current = null;
      }
    })();
    stopping.current = task;
    void task.then(
      () => {
        if (stopping.current === task) stopping.current = null;
      },
      () => {
        if (stopping.current === task) stopping.current = null;
      },
    );
    return task;
  };
  const pause = () => {
    void stop().catch(() => {
      if (mounted.current)
        setError("Media is unavailable, your account changed, or a call is active.");
    });
  };
  const releaseSource = () => {
    source.current?.release();
    source.current = null;
  };
  const markFinished = (unplayable = false) => {
    finished.current = true;
    if (unplayable && mounted.current)
      setError("This voice message could not be played. Tap to retry.");
    void latest.current().catch(() => {
      // Preserve the lease if a native player rejects its final pause.
    });
  };
  const latest = useRef(stop);
  latest.current = stop;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingLoad.current?.abort();
      pendingLoad.current = null;
      void latest.current().catch(() => {
        // A native player that rejects a synchronous pause must not make
        // component cleanup throw. The ownership lease remains fail-closed.
      });
      releaseSource();
      finished.current = false;
    };
  }, [attachment.id]);
  useEffect(() => {
    const a = audio.addListener?.("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        markFinished(audioDuration.current <= 0);
      }
    });
    const v = video.addListener?.("playToEnd", () => {
      markFinished();
    });
    return () => {
      a?.remove();
      v?.remove();
    };
  }, [audio, video]);
  useEffect(() => {
    if (
      !isVideo &&
      audioStatus.playbackState === "failed" &&
      (playing || lease.current)
    ) {
      void latest.current().catch(() => {
        // Keep ownership fail-closed if native pause itself fails.
      });
      setError("This voice message could not be played. Tap to retry.");
    }
  }, [audioStatus.playbackState, isVideo, playing]);
  const play = async () => {
    if (pending.current || !mounted.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let fetched: Awaited<ReturnType<typeof getChatMediaSource>> | null = null;
    let version = generation.current;
    try {
      await stop();
      version = generation.current;
      // Playback remains stopped until this user tap has verified any failed
      // predecessor recorder shutdown. It is a no-op in the normal path.
      await phone11MediaOwnership.retryVoiceStop();
      if (!mounted.current || version !== generation.current) return;
      if (source.current) {
        source.current.assertOwner();
      } else {
        const controller = new AbortController();
        pendingLoad.current = controller;
        try {
          fetched = await getChatMediaSource(
            attachment.id,
            attachment,
            controller.signal,
          );
        } finally {
          if (pendingLoad.current === controller) pendingLoad.current = null;
        }
        fetched.assertOwner();
      }
      if (!mounted.current || version !== generation.current) return;
      const request = phone11MediaOwnership.requestVoiceNote(
        `chat-playback:${attachment.id}`,
        {
          stopForSip: async () => {
            // A mode change already handed to iOS cannot be cancelled. The
            // stop promise keeps this lease until the mode settles and both
            // players acknowledge pause, before the coordinator grants SIP.
            await latest.current();
          },
        },
      );
      lease.current = request.lease;
      await request.ready;
      const protectedSource = source.current ?? fetched;
      if (!protectedSource) throw new Error("Attachment is unavailable.");
      protectedSource.assertOwner();
      if (
        !mounted.current ||
        version !== generation.current ||
        !phone11MediaOwnership.isCurrent(request.lease)
      )
        return;
      if (finished.current) {
        if (isVideo) video.currentTime = 0;
        else await audio.seekTo(0);
        finished.current = false;
      }
      // expo-audio defaults iOS playback to the silent-switch-respecting
      // ambient category. Configure playback only after this clip owns media,
      // so the chat player cannot take the session from an active SIP call.
      const configuration = setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      configuring.current = configuration;
      try {
        await configuration;
      } finally {
        if (configuring.current === configuration) configuring.current = null;
      }
      if (
        !mounted.current ||
        version !== generation.current ||
        !phone11MediaOwnership.isCurrent(request.lease)
      )
        return;
      if (isVideo) {
        if (!source.current) video.replace(protectedSource.source);
        setLoaded(true);
        video.play();
      } else {
        if (!source.current) audio.replace(protectedSource.source);
        audio.play();
      }
      source.current = protectedSource;
      fetched = null;
      setPlaying(true);
    } catch {
      if (mounted.current && version === generation.current) {
        await stop().catch(() => {
          // Keep the playback lease fail-closed if the native player rejects
          // a synchronous pause while recovering from an error.
        });
        setError(
          "Media is unavailable, your account changed, or a call is active.",
        );
      }
      if (source.current) {
        try {
          source.current.assertOwner();
        } catch {
          releaseSource();
        }
      }
    } finally {
      fetched?.release();
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (!isVideo) return (
    <View style={[styles.voiceBubble, { backgroundColor: `${colors.primary}12` }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause media" : `Play ${attachment.filename}`}
        disabled={busy}
        onPress={() => (playing ? pause() : void play())}
        style={[styles.playButton, { backgroundColor: colors.primary }]}
      >
        <MaterialIcons
          name={busy ? "hourglass-top" : playing ? "pause" : "play-arrow"}
          size={30}
          color="#fff"
        />
      </Pressable>
      <View style={styles.voiceTrackGroup}>
        <View style={[styles.voiceTrack, { backgroundColor: `${colors.muted}55` }]}>
          <View style={[styles.voiceProgress, { backgroundColor: colors.primary, width: `${progress * 100}%` }]} />
        </View>
        <Text style={[styles.voiceStatus, { color: error ? colors.error : colors.muted }]}>
          {busy
            ? "Loading…"
            : error
              ? "Tap to retry"
              : playing && !audioStatus.isLoaded
                ? "Loading audio…"
              : duration > 0
                ? `${clock(elapsed)} / ${clock(duration)}`
                : "Voice message"}
        </Text>
      </View>
    </View>
  );
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

const styles = StyleSheet.create({
  voiceBubble: {
    minWidth: 230,
    maxWidth: 560,
    minHeight: 72,
    borderRadius: 18,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  playButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
  },
  voiceTrackGroup: { flex: 1, gap: 7 },
  voiceTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  voiceProgress: { height: 4, borderRadius: 2 },
  voiceStatus: { alignSelf: "flex-end", fontSize: 13, fontVariant: ["tabular-nums"] },
});
