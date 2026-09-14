import { useEffect, useRef, useState } from "react";
import { AppState, Text, TouchableOpacity, View } from "react-native";
import { createTRPCClient } from "@/lib/trpc";
import * as Auth from "@/lib/_core/auth";
import { useColors } from "@/hooks/use-colors";
export function recordingChangeMessage(
  action: "start" | "stop",
  accepted: boolean,
  statusRefreshFailed = false,
) {
  if (statusRefreshFailed && accepted)
    return "Recording change accepted. Status is still updating; please refresh again.";
  if (!accepted) return "Recording could not be changed. Please refresh and try again.";
  return action === "start"
    ? "Recording requested. Refreshing status…"
    : "Recording stop requested. Refreshing status…";
}
export function CaptureControls({
  callUuid,
  controls,
  refresh,
}: {
  callUuid: string;
  controls: { canStart: boolean; canStop: boolean };
  refresh(): Promise<void>;
}) {
  const colors = useColors();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    setBusy(false);
    setStopping(false);
    setMessage("");
    const unsubscribe = Auth.addAuthChangeListener(() => {
      generation.current++;
      inFlight.current = false;
      setBusy(false);
      setStopping(false);
      setMessage("");
    });
    return () => {
      generation.current++;
      unsubscribe();
    };
  }, [callUuid]);
  useEffect(() => {
    if (stopping && !controls.canStop) {
      setStopping(false);
      setMessage("");
    }
  }, [controls.canStop, stopping]);
  useEffect(() => {
    if (!stopping || !controls.canStop || AppState.currentState !== "active")
      return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 2 * 60_000;
    const poll = async () => {
      if (disposed) return;
      try {
        await refresh();
      } catch {
        // The accepted stop remains authoritative; the next poll or manual
        // refresh can observe the finalized server state.
      }
      if (
        !disposed &&
        Date.now() < deadline &&
        AppState.currentState === "active"
      )
        timer = setTimeout(poll, 2_000);
    };
    timer = setTimeout(poll, 2_000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [controls.canStop, refresh, stopping]);
  const change = async (action: "start" | "stop") => {
    const identity = Auth.getAuthSnapshot().user;
    if (
      !identity ||
      inFlight.current ||
      busy ||
      AppState.currentState !== "active" ||
      (action === "start" ? !controls.canStart : !controls.canStop)
    )
      return;
    const revision = ++generation.current;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    const current = () =>
      generation.current === revision &&
      Auth.getAuthSnapshot().user === identity;
    try {
      let accepted = false;
      try {
        const api = createTRPCClient().cloudRecordings;
        accepted =
          action === "start"
            ? (await api.startCapture.mutate({ callUuid })).started
            : (await api.stopCapture.mutate({ callUuid })).stopped;
        if (!current()) return;
        if (action === "stop" && accepted) {
          setStopping(true);
          setMessage("Recording stop accepted. Finalizing…");
        } else setMessage(recordingChangeMessage(action, accepted));
      } catch {
        if (current())
          setMessage(
            "Recording could not be changed. Please refresh and try again.",
          );
        return;
      }
      if (!current()) return;
      try {
        await refresh();
      } catch {
        if (current() && accepted)
          setMessage(
            action === "stop"
              ? "Recording stop accepted. Finalizing… Please refresh again."
              : recordingChangeMessage(action, true, true),
          );
      }
    } finally {
      if (current()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <View style={{ gap: 8 }}>
      {controls.canStart && (
        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          style={{ minHeight: 48, justifyContent: "center" }}
          onPress={() => void change("start")}
        >
          <Text style={{ color: colors.primary }}>Start recording</Text>
        </TouchableOpacity>
      )}
      {controls.canStop && stopping && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.muted }}>
            {message || "Recording stop accepted. Finalizing…"}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => void refresh()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: colors.primary }}>Refresh recording status</Text>
          </TouchableOpacity>
        </View>
      )}
      {controls.canStop && !stopping && (
        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          style={{ minHeight: 48, justifyContent: "center" }}
          onPress={() => void change("stop")}
        >
          <Text style={{ color: colors.primary }}>Stop recording</Text>
        </TouchableOpacity>
      )}
      {!!message && <Text style={{ color: colors.muted }}>{message}</Text>}
    </View>
  );
}
