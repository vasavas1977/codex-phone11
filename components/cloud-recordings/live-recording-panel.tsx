import { internationalHistoryNumber } from "@/lib/phone/phone-number";
import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useCloudRecordings } from "@/hooks/use-cloud-recordings";
import { useColors } from "@/hooks/use-colors";
import { useSipCallStore } from "@/lib/sip/call-store";
import { recordingLabels } from "@/lib/cloud-recordings/presentation";
import { RecordingPanel } from "./call-history-view";
import { Playback } from "./cloud-playback";
import { CaptureControls } from "./capture-controls";
import type { TranscriptSpeakerNames } from "@/lib/cloud-recordings/transcript";
export function LiveRecordingPanel({
  callUuid,
  full = false,
  initialTab = "summary",
  speakerNames,
}: {
  callUuid: string;
  full?: boolean;
  initialTab?: "summary" | "transcription";
  speakerNames?: TranscriptSpeakerNames;
}) {
  const cloud = useCloudRecordings(callUuid);
  const colors = useColors();
  const router = useRouter();
  const [tab, setTab] = useState<"summary" | "transcription">(initialTab);
  const busy = useSipCallStore(
    (state) =>
      Boolean(state.incomingCall) ||
      Object.values(state.activeCalls).some(
        (call) => call.status !== "disconnected",
      ),
  );
  const detail = cloud.detail;
  if (!detail)
    return (
      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <Text style={{ color: colors.muted, lineHeight: 24 }}>
          {cloud.error ||
            (cloud.loading
              ? "Loading call details…"
              : "Call details unavailable.")}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={{ minHeight: 48, justifyContent: "center" }}
          onPress={() => void cloud.reload()}
        >
          <Text style={{ color: colors.primary }}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  return (
    <View>
      {full && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 24, gap: 8 }}>
          <Text style={{ fontSize: 13, color: colors.muted }}>
            {new Date(detail.startedAt).toLocaleString()}
          </Text>
          <Text
            style={{
              fontSize: 20,
              fontWeight: "600",
              color: colors.foreground,
            }}
          >
            Call with {internationalHistoryNumber(detail.number)}
          </Text>
        </View>
      )}
      <RecordingPanel
        colors={colors}
        full={full}
        activeTab={tab}
        onTabChange={setTab}
        summaryStatus={detail.summaryStatus}
        summary={detail.summary}
        transcript={detail.transcript}
        speakerNames={
          speakerNames || detail.participantNames
            ? { ...speakerNames, ...detail.participantNames }
            : undefined
        }
        notice={
          cloud.error ||
          (busy
            ? "Playback is paused while you are on a call."
            : detail.recordingStatus !== "ready"
              ? recordingLabels[detail.recordingStatus]
              : undefined)
        }
        player={
          detail.recordingStatus === "ready" && detail.playbackPath && !busy ? (
            <Playback
              key={`${cloud.owner}:${callUuid}`}
              callUuid={callUuid}
              path={detail.playbackPath}
            />
          ) : undefined
        }
        controls={
          detail.manualControls &&
          (detail.manualControls.canStart || detail.manualControls.canStop) ? (
            <CaptureControls
              callUuid={detail.callUuid}
              controls={detail.manualControls}
              refresh={cloud.reload}
            />
          ) : undefined
        }
        onViewFull={(nextTab) =>
          router.push({
            pathname: "/call-recording/[callUuid]",
            params: { callUuid, tab: nextTab ?? "summary" },
          })
        }
      />
    </View>
  );
}
