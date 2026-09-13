import { useEffect, useRef, useState } from "react";
import { AppState, Text, TouchableOpacity, View } from "react-native";
import { createTRPCClient } from "@/lib/trpc";
import * as Auth from "@/lib/_core/auth";
import { useColors } from "@/hooks/use-colors";
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
  const [message, setMessage] = useState("");
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    setBusy(false);
    setMessage("");
    const unsubscribe = Auth.addAuthChangeListener(() => {
      generation.current++;
      inFlight.current = false;
      setBusy(false);
      setMessage("");
    });
    return () => {
      generation.current++;
      unsubscribe();
    };
  }, [callUuid]);
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
      const api = createTRPCClient().cloudRecordings;
      const accepted =
        action === "start"
          ? (await api.startCapture.mutate({ callUuid })).started
          : (await api.stopCapture.mutate({ callUuid })).stopped;
      if (!current()) return;
      setMessage(
        accepted
          ? action === "start"
            ? "Recording requested. Refreshing status…"
            : "Recording stop requested. Refreshing status…"
          : "Recording could not be changed. Please refresh and try again.",
      );
      await refresh();
    } catch {
      if (current())
        setMessage(
          "Recording could not be changed. Please refresh and try again.",
        );
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
      {controls.canStop && (
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
