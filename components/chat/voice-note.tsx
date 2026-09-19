import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { phone11MediaOwnership } from "@/lib/meetings/native-session";
import type { ChatUpload } from "@/lib/chat/media-client";
import { useColors } from "@/hooks/use-colors";

export function VoiceNote({
  onReady,
}: {
  onReady: (upload: ChatUpload) => void;
}) {
  const colors = useColors(),
    recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY),
    state = useAudioRecorderState(recorder),
    player = useAudioPlayer(null, { keepAudioSessionActive: false });
  const lease = useRef<
      ReturnType<typeof phone11MediaOwnership.requestVoiceNote>["lease"] | null
    >(null),
    alive = useRef(true),
    generation = useRef(0),
    working = useRef(false),
    prepared = useRef(false),
    mode = useRef(false),
    preparing = useRef<Promise<void> | null>(null),
    stopping = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uri, setUri] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false);
  const release = () => {
    if (lease.current) phone11MediaOwnership.release(lease.current);
    lease.current = null;
  };
  const stop = (): Promise<void> => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (stopping.current) return stopping.current;
    const task = (async () => {
      await preparing.current?.catch(() => {});
      if (prepared.current) {
        await recorder.stop();
        prepared.current = false;
      }
      player.pause();
      if (mode.current) {
        await setAudioModeAsync({ allowsRecording: false });
        mode.current = false;
      }
      if (alive.current) setPlaying(false);
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
  const latest = useRef({ stop, release });
  latest.current = { stop, release };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void latest.current.stop().then(
        () => latest.current.release(),
        () => {},
      );
    };
  }, []);
  useEffect(() => {
    const listener = player.addListener?.("playbackStatusUpdate", (status) => {
      if (status.didJustFinish)
        void latest.current.stop().then(
          () => latest.current.release(),
          () => {},
        );
    });
    return () => listener?.remove();
  }, [player]);
  const failure = (cause: unknown) => {
    if (alive.current)
      setError(
        cause instanceof Error ? cause.message : "Voice note is unavailable.",
      );
  };
  const finish = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await stop();
      release();
      if (alive.current) {
        if (!recorder.uri) throw new Error("No voice recording was created.");
        setUri(recorder.uri);
      }
    } catch (cause) {
      failure(cause);
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const start = async () => {
    if (working.current || !alive.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setUri(null);
    const version = ++generation.current;
    try {
      // This tap is an explicit recovery action. It only retries a previously
      // failed recorder shutdown; it never starts playback/recording itself.
      await phone11MediaOwnership.retryVoiceStop();
      if (!alive.current || version !== generation.current) return;
      const request = phone11MediaOwnership.requestVoiceNote(
        `voice-note:${Date.now()}`,
        { stopForSip: () => latest.current.stop() },
      );
      lease.current = request.lease;
      await request.ready;
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted)
        throw new Error("Allow microphone access to record a voice note.");
      if (
        !alive.current ||
        version !== generation.current ||
        !phone11MediaOwnership.isCurrent(request.lease)
      )
        return;
      preparing.current = (async () => {
        mode.current = true;
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        await recorder.prepareToRecordAsync();
        prepared.current = true;
      })();
      await preparing.current;
      preparing.current = null;
      if (
        !alive.current ||
        version !== generation.current ||
        !phone11MediaOwnership.isCurrent(request.lease)
      )
        return;
      recorder.record();
      timer.current = setTimeout(() => void finish(), 60_000);
    } catch (cause) {
      failure(cause);
      await stop().then(release, () => {});
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const cancel = async () => {
    try {
      await stop();
      release();
      if (alive.current) setUri(null);
    } catch (cause) {
      failure(cause);
    }
  };
  const preview = async () => {
    if (!uri || working.current) return;
    if (playing) {
      await stop().then(release, failure);
      return;
    }
    working.current = true;
    setError(null);
    const version = ++generation.current;
    try {
      await phone11MediaOwnership.retryVoiceStop();
      if (!alive.current || version !== generation.current) return;
      const request = phone11MediaOwnership.requestVoiceNote(
        `voice-preview:${Date.now()}`,
        { stopForSip: () => latest.current.stop() },
      );
      lease.current = request.lease;
      await request.ready;
      if (
        !alive.current ||
        version !== generation.current ||
        !phone11MediaOwnership.isCurrent(request.lease)
      )
        return;
      player.replace(uri);
      player.play();
      setPlaying(true);
    } catch (cause) {
      failure(cause);
      await stop().then(release, () => {});
    } finally {
      working.current = false;
    }
  };
  const add = async () => {
    if (!uri || working.current) return;
    working.current = true;
    try {
      await stop();
      release();
      const web = uri.startsWith("blob:");
      if (alive.current)
        onReady({
          uri,
          filename: web ? "voice-note.webm" : "voice-note.m4a",
          mimeType: web ? "audio/webm" : "audio/mp4",
        });
    } catch (cause) {
      failure(cause);
    } finally {
      working.current = false;
    }
  };
  const button = (label: string, action: () => void | Promise<void>) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={() => void action()}
      style={{
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 10,
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.primary }}>{label}</Text>
    </Pressable>
  );
  return (
    <View accessibilityLiveRegion="polite">
      {error && <Text style={{ color: colors.error }}>{error}</Text>}
      <Text style={{ color: colors.muted }}>
        {state.isRecording
          ? `Recording ${Math.min(60, Math.ceil(state.durationMillis / 1000))}s`
          : uri
            ? "Voice note ready"
            : busy
              ? "Preparing…"
              : ""}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {state.isRecording ? (
          <>
            {button("Stop", finish)}
            {button("Cancel", cancel)}
          </>
        ) : uri ? (
          <>
            {button(playing ? "Pause" : "Play", preview)}
            {button("Cancel", cancel)}
            {button("Add to message", add)}
          </>
        ) : (
          button("Record voice", start)
        )}
      </View>
    </View>
  );
}
