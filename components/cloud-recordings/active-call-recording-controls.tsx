import { useEffect, useRef } from "react";
import { AppState, Text, TouchableOpacity, View } from "react-native";
import { useCloudRecordings } from "@/hooks/use-cloud-recordings";
import { useColors } from "@/hooks/use-colors";
import type { CloudRecording } from "@/shared/cloud-recordings";
import { CaptureControls } from "./capture-controls";

/** The server supplies this ID only after exact SIP correlation. Never infer it
 * from a phone number, time, or the SDK's local call identifier. */
export function exactActiveRecording(
  items: CloudRecording[],
  nativeHistoryId?: string,
) {
  if (!nativeHistoryId) return undefined;
  const matches = items.filter(
    (item) => item.nativeHistoryId === nativeHistoryId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function useActiveRefresh(cloud: ReturnType<typeof useCloudRecordings>) {
  const latest = useRef(cloud);
  latest.current = cloud;
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && !latest.current.loading)
        void latest.current.reload();
    }, 5000);
    return () => clearInterval(timer);
  }, []);
}

function RecordingStatus({
  message,
  refresh,
}: {
  message: string;
  refresh(): Promise<void>;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>
        {message}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => void refresh()}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primary }}>Refresh recording status</Text>
      </TouchableOpacity>
    </View>
  );
}

function MatchedRecording({
  callUuid,
  nativeHistoryId,
}: {
  callUuid: string;
  nativeHistoryId: string;
}) {
  const colors = useColors();
  const cloud = useCloudRecordings(callUuid);
  useActiveRefresh(cloud);
  const detail = cloud.detail;
  if (
    !detail ||
    detail.nativeHistoryId !== nativeHistoryId ||
    detail.callUuid !== callUuid
  )
    return (
      <RecordingStatus
        refresh={cloud.reload}
        message={
          cloud.error
            ? "Could not check recording status."
            : cloud.loading
              ? "Checking recording status…"
              : "Recording controls unavailable."
        }
      />
    );
  const status = detail.recordingFinalizing
    ? "Saving recording…"
    : {
        off: "Not recording",
        pending: "Preparing recording…",
        recording: "Recording in progress",
        ready: "Recording saved. Available in Recents after the call.",
        failed: detail.manualControls?.canStart
          ? "Not recording"
          : "Recording unavailable",
      }[detail.recordingStatus];
  const controls = detail.manualControls;
  const explainUnavailable =
    !detail.recordingFinalizing &&
    !controls?.canStart &&
    !controls?.canStop &&
    (detail.recordingStatus === "off" || detail.recordingStatus === "failed");
  return (
    <View style={{ gap: 4 }}>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>
        {status}
      </Text>
      {controls &&
      !detail.recordingFinalizing &&
      (controls.canStart || controls.canStop) ? (
        <CaptureControls
          key={callUuid}
          callUuid={callUuid}
          controls={controls}
          refresh={cloud.reload}
        />
      ) : explainUnavailable ? (
        <Text style={{ color: colors.muted }}>
          Recording controls are unavailable for this call.
        </Text>
      ) : null}
    </View>
  );
}

/** Mount only for the connected call; unmount when the call ends. */
export function ActiveCallRecordingControls({
  nativeHistoryId,
}: {
  nativeHistoryId?: string;
}) {
  const cloud = useCloudRecordings();
  useActiveRefresh(cloud);
  const match = exactActiveRecording(cloud.items, nativeHistoryId);
  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 8 }}>
      {match && nativeHistoryId ? (
        <MatchedRecording
          key={`${nativeHistoryId}:${match.callUuid}`}
          callUuid={match.callUuid}
          nativeHistoryId={nativeHistoryId}
        />
      ) : (
        <RecordingStatus
          refresh={cloud.reload}
          message={
            cloud.error
              ? "Could not check recording availability."
              : cloud.unavailable || !nativeHistoryId
                ? "Recording controls unavailable for this call."
                : "Waiting for recording controls…"
          }
        />
      )}
    </View>
  );
}
