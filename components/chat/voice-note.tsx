import { useEffect, useRef, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
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
const MIN_DURATION_MS = 600;
const CANCEL_DISTANCE = 72;
function formatDuration(milliseconds: number) {
  const seconds = Math.min(MAX_SECONDS, Math.max(0, Math.ceil(milliseconds / 1000)));
  return `0:${String(seconds).padStart(2, "0")}`;
}
function cancelledError() {
  const error = new Error("Voice note cancelled.");
  error.name = "AbortError";
  return error;
}
function isCancelled(cause: unknown) {
  return cause instanceof Error && cause.name === "AbortError";
}

export function VoiceNote({
  onReady,
  onClose,
}: {
  onReady: (
    upload: ChatUpload,
    delivery?: { signal: AbortSignal; commit: () => boolean },
  ) => void | Promise<void>;
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
  const recordingStartedAt = useRef<number | null>(null);
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
  const [committed, setCommitted] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const busyRef = useRef(false);
  const retryUpload = useRef<ChatUpload | null>(null);
  const deliveryAbort = useRef<AbortController | null>(null);
  const deliveryCommitted = useRef(false);
  const deliveryGeneration = useRef(0);

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
      recordingStartedAt.current = null;
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
  const abortPendingDelivery = () => {
    if (deliveryCommitted.current) return;
    deliveryGeneration.current++;
    deliveryAbort.current?.abort();
  };
  const latest = useRef({ stop, release, abortPendingDelivery });
  latest.current = { stop, release, abortPendingDelivery };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      latest.current.abortPendingDelivery();
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
    if (deliveryCommitted.current) return false;
    abortPendingDelivery();
    cancelRequested.current = true;
    try {
      await stop();
      release();
      retryUpload.current = null;
      if (alive.current) setRetryAvailable(false);
      return true;
    } catch (cause) {
      failure(cause);
      return false;
    } finally {
      resetGesture();
    }
  };
  const validatedUpload = async (uri: string): Promise<ChatUpload> => {
    const web = uri.startsWith("blob:");
    if (web) {
      const file = await (await fetch(uri)).blob();
      if (file.size <= 0) throw new Error("The voice recording was empty. Please try again.");
      return {
        uri,
        filename: "voice-note.webm",
        mimeType: "audio/webm",
        sizeBytes: file.size,
        file,
      };
    }
    if (Platform.OS !== "web") {
      const files = await import("expo-file-system/legacy");
      const info = await files.getInfoAsync(uri);
      if (!info.exists || info.isDirectory || info.size <= 0)
        throw new Error("The voice recording was empty. Please try again.");
      return {
        uri,
        filename: "voice-note.m4a",
        mimeType: "audio/mp4",
        sizeBytes: info.size,
      };
    }
    throw new Error("The voice recording was unavailable. Please try again.");
  };
  const deliver = async (upload: ChatUpload, version: number) => {
    if (version !== deliveryGeneration.current) throw cancelledError();
    const controller = new AbortController();
    deliveryAbort.current = controller;
    deliveryCommitted.current = false;
    await onReady(upload, {
      signal: controller.signal,
      commit: () => {
        if (
          version !== deliveryGeneration.current ||
          controller.signal.aborted ||
          cancelRequested.current
        )
          return false;
        deliveryCommitted.current = true;
        if (alive.current) setCommitted(true);
        return true;
      },
    });
    if (version !== deliveryGeneration.current || controller.signal.aborted)
      throw cancelledError();
  };
  const finishAndSend = async () => {
    if (working.current || sending || cancelRequested.current) return;
    working.current = true;
    if (alive.current) setSending(true);
    const deliveryVersion = ++deliveryGeneration.current;
    const wallDuration = recordingStartedAt.current
      ? Date.now() - recordingStartedAt.current
      : 0;
    const recorderDuration = Number.isFinite(recorder.currentTime)
      ? recorder.currentTime * 1_000
      : 0;
    const duration = Math.max(wallDuration, recorderDuration);
    try {
      await stop();
      if (cancelRequested.current) return;
      release();
      if (duration < MIN_DURATION_MS)
        throw new Error("Hold a little longer to record a voice note.");
      if (!recorder.uri) throw new Error("No voice recording was created.");
      const upload = await validatedUpload(recorder.uri);
      if (deliveryVersion !== deliveryGeneration.current) throw cancelledError();
      retryUpload.current = upload;
      if (alive.current) setRetryAvailable(true);
      await deliver(upload, deliveryVersion);
      retryUpload.current = null;
      if (alive.current) setRetryAvailable(false);
      if (alive.current) onClose?.();
    } catch (cause) {
      if (!isCancelled(cause)) failure(cause);
    } finally {
      deliveryAbort.current = null;
      deliveryCommitted.current = false;
      if (alive.current) setCommitted(false);
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
    const deliveryVersion = ++deliveryGeneration.current;
    try {
      await deliver(upload, deliveryVersion);
      retryUpload.current = null;
      if (alive.current) setRetryAvailable(false);
      if (alive.current) onClose?.();
    } catch (cause) {
      if (!isCancelled(cause)) failure(cause);
    } finally {
      deliveryAbort.current = null;
      deliveryCommitted.current = false;
      if (alive.current) setCommitted(false);
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
      recordingStartedAt.current = Date.now();
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
  const close = async () => {
    if (deliveryCommitted.current) {
      onClose?.();
      return;
    }
    await cancel();
    if (alive.current) onClose?.();
  };

  const recording = gestureActive || state.isRecording;
  return (
    <View accessibilityLiveRegion="polite" style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.foreground }]}>Voice note</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={committed ? "Close voice note" : "Cancel voice note"}
          accessibilityHint={
            committed
              ? "Return to the conversation while the message finishes sending."
              : "Discard this voice note and return to the conversation."
          }
          onPress={() => {
            void close();
          }}
          style={styles.closeButton}
        >
          <MaterialIcons name="close" size={22} color={colors.foreground} />
          <Text style={[styles.closeLabel, { color: colors.foreground }]}>
            {committed ? "Close" : "Cancel"}
          </Text>
        </Pressable>
      </View>
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
            {sending
              ? deliveryCommitted.current
                ? "Sending…"
                : "Uploading…"
              : cancelArmed
                ? "Release to cancel"
                : recording
                  ? "Release to send"
                  : "Hold to Record"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to message keyboard"
          accessibilityHint={recording ? "Cancel the recording and return to typing." : undefined}
          onPress={() => {
            void close();
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
  headerRow: {
    width: "100%",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 17, fontWeight: "700" },
  closeButton: {
    minHeight: 44,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  closeLabel: { fontSize: 15, fontWeight: "600" },
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
