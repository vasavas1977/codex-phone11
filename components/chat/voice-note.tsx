import { useEffect, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { phone11MediaOwnership } from "@/lib/meetings/native-session";
import type { ChatUpload } from "@/lib/chat/media-client";
import { useColors } from "@/hooks/use-colors";

const MAX_SECONDS = 60;
const CANCEL_DISTANCE = 72;
function formatDuration(milliseconds: number) {
  const seconds = Math.min(MAX_SECONDS, Math.max(0, Math.ceil(milliseconds / 1000)));
  return `0:${String(seconds).padStart(2, "0")}`;
}

export function VoiceNote({
  onReady,
  onClose,
}: {
  onReady: (upload: ChatUpload) => void | Promise<void>;
  onClose?: () => void;
}) {
  const colors = useColors();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const lease = useRef<
    ReturnType<typeof phone11MediaOwnership.requestVoiceNote>["lease"] | null
  >(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const working = useRef(false);
  const prepared = useRef(false);
  const recordingStarted = useRef(false);
  const releaseRequested = useRef(false);
  const cancelRequested = useRef(false);
  const gestureActiveRef = useRef(false);
  const startX = useRef(0);
  const mode = useRef(false);
  const preparing = useRef<Promise<void> | null>(null);
  const stopping = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gestureActive, setGestureActive] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const busyRef = useRef(false);
  const retryUpload = useRef<ChatUpload | null>(null);

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
      let stopError: unknown;
      await preparing.current?.catch(() => {});
      if (prepared.current) {
        try {
          await recorder.stop();
          prepared.current = false;
        } catch (cause) {
          stopError = cause;
        }
      }
      recordingStarted.current = false;
      if (mode.current) {
        try {
          await setAudioModeAsync({ allowsRecording: false });
        } catch (cause) {
          stopError ||= cause;
        }
        mode.current = false;
      }
      if (stopError) throw stopError;
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
      void latest.current.stop().then(latest.current.release, () => {});
    };
  }, []);

  const failure = (cause: unknown) => {
    if (alive.current)
      setError(cause instanceof Error ? cause.message : "Voice note is unavailable.");
  };
  const resetGesture = () => {
    gestureActiveRef.current = false;
    releaseRequested.current = false;
    cancelRequested.current = false;
    if (alive.current) {
      setGestureActive(false);
      setCancelArmed(false);
    }
  };
  const cancel = async () => {
    cancelRequested.current = true;
    try {
      await stop();
      release();
    } catch (cause) {
      failure(cause);
    } finally {
      resetGesture();
    }
  };
  const finishAndSend = async () => {
    if (working.current || sending || cancelRequested.current) return;
    working.current = true;
    if (alive.current) setSending(true);
    try {
      await stop();
      if (cancelRequested.current) return;
      release();
      if (!recorder.uri) throw new Error("No voice recording was created.");
      const web = recorder.uri.startsWith("blob:");
      const upload = {
        uri: recorder.uri,
        filename: web ? "voice-note.webm" : "voice-note.m4a",
        mimeType: web ? "audio/webm" : "audio/mp4",
      } satisfies ChatUpload;
      retryUpload.current = upload;
      if (alive.current) setRetryAvailable(true);
      await onReady(upload);
      retryUpload.current = null;
      if (alive.current) setRetryAvailable(false);
      if (alive.current) onClose?.();
    } catch (cause) {
      failure(cause);
    } finally {
      working.current = false;
      if (alive.current) setSending(false);
      resetGesture();
    }
  };
  const retry = async () => {
    const upload = retryUpload.current;
    if (!upload || working.current || sending || !alive.current) return;
    working.current = true;
    setSending(true);
    setError(null);
    try {
      await onReady(upload);
      retryUpload.current = null;
      if (alive.current) setRetryAvailable(false);
      if (alive.current) onClose?.();
    } catch (cause) {
      failure(cause);
    } finally {
      working.current = false;
      if (alive.current) setSending(false);
    }
  };
  const start = async (event: GestureResponderEvent) => {
    if (working.current || sending || busyRef.current || !alive.current) return;
    startX.current = event.nativeEvent.pageX;
    gestureActiveRef.current = true;
    releaseRequested.current = false;
    cancelRequested.current = false;
    setGestureActive(true);
    setCancelArmed(false);
    setError(null);
    retryUpload.current = null;
    setRetryAvailable(false);
    setBusy(true);
    busyRef.current = true;
    const version = ++generation.current;
    try {
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
      ) return;
      preparing.current = (async () => {
        mode.current = true;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        prepared.current = true;
      })();
      await preparing.current;
      preparing.current = null;
      if (
        !alive.current ||
        version !== generation.current ||
        !phone11MediaOwnership.isCurrent(request.lease)
      ) return;
      if (cancelRequested.current || releaseRequested.current) {
        await cancel();
        return;
      }
      recorder.record();
      recordingStarted.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      timer.current = setTimeout(() => {
        releaseRequested.current = true;
        void finishAndSend();
      }, MAX_SECONDS * 1000);
      if (cancelRequested.current || releaseRequested.current) await cancel();
    } catch (cause) {
      failure(cause);
      await stop().then(release, () => {});
      resetGesture();
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const move = (event: GestureResponderEvent) => {
    if (!gestureActiveRef.current) return;
    const armed = event.nativeEvent.pageX - startX.current <= -CANCEL_DISTANCE;
    cancelRequested.current = armed;
    setCancelArmed(armed);
  };
  const end = () => {
    if (!gestureActiveRef.current) return;
    if (cancelRequested.current) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      void cancel();
      return;
    }
    releaseRequested.current = true;
    if (recordingStarted.current) void finishAndSend();
  };

  const recording = gestureActive || state.isRecording;
  return (
    <View accessibilityLiveRegion="polite" style={styles.root}>
      {recording && (
        <View style={styles.statusRow}>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.timer, { color: cancelArmed ? colors.error : colors.muted }]}
          >
            {busy && !state.isRecording ? "Preparing…" : formatDuration(state.durationMillis)}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.cancelFeedback, { color: colors.error }]}
          >
            {cancelArmed ? "Release to cancel" : "Slide left to cancel"}
          </Text>
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {error}
        </Text>
      )}
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hold to record voice note"
          accessibilityHint="Keep holding to record. Slide left to cancel. Release to send."
          disabled={sending || retryAvailable}
          onPressIn={(event) => void start(event)}
          onTouchMove={move}
          onPressOut={end}
          accessibilityActions={
            recording ? [{ name: "activate", label: "Cancel voice note" }] : undefined
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "activate" && recording) void cancel();
          }}
          style={({ pressed }) => [
            styles.holdButton,
            {
              backgroundColor: cancelArmed
                ? `${colors.error}22`
                : pressed || recording
                  ? `${colors.primary}22`
                  : colors.surface,
              borderColor: cancelArmed ? colors.error : colors.border,
            },
          ]}
        >
          <MaterialIcons
            name={cancelArmed ? "delete-outline" : "mic-none"}
            size={22}
            color={cancelArmed ? colors.error : colors.primary}
          />
          <Text style={[styles.holdLabel, { color: cancelArmed ? colors.error : colors.primary }]}>
            {sending ? "Sending…" : cancelArmed ? "Release to cancel" : recording ? "Release to send" : "Hold to Record"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to message keyboard"
          accessibilityHint={recording ? "Cancel the recording and return to typing." : undefined}
          onPress={() => {
            void cancel();
            onClose?.();
          }}
          style={[styles.keyboardReturn, { borderColor: colors.border }]}
        >
          <MaterialIcons name="keyboard" size={20} color={colors.foreground} />
        </Pressable>
      </View>
      {retryAvailable && !recording && !sending && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry voice note"
          onPress={() => void retry()}
          style={styles.retryButton}
        >
          <Text style={[styles.retryLabel, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", alignItems: "center", gap: 14, paddingTop: 4 },
  statusRow: {
    minHeight: 30,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  cancelFeedback: {
    fontSize: 13,
  },
  timer: {
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  error: { width: "100%", textAlign: "center", fontSize: 13, lineHeight: 18 },
  actionRow: { width: "100%", flexDirection: "row", alignItems: "center", gap: 10 },
  keyboardReturn: {
    width: 44,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  keyboardLabel: { fontSize: 14 },
  retryButton: { minHeight: 32, paddingHorizontal: 8, justifyContent: "center" },
  retryLabel: { fontSize: 14, fontWeight: "600" },
  holdButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  holdLabel: { fontSize: 17, fontWeight: "700" },
});
