import { internationalHistoryNumber } from "@/lib/phone/phone-number";
import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useCloudRecordings } from "@/hooks/use-cloud-recordings";
import { useColors } from "@/hooks/use-colors";
import { useSipCallStore } from "@/lib/sip/call-store";
import { RecordingPanel } from "./call-history-view";
import { Playback } from "./cloud-playback";
import { CaptureControls } from "./capture-controls";
import { RecordingSummaryActions } from "./summary-actions";
import { createTRPCClient } from "@/lib/trpc";
import { getAuthSnapshot } from "@/lib/_core/auth";
import type { RecordingSummaryContent } from "@/lib/cloud-recordings/summary-actions";
import type { TranscriptSpeakerNames } from "@/lib/cloud-recordings/transcript";
import type { CloudRecordingDetail } from "@/shared/cloud-recordings";

export function recordingStatusMessage(detail: CloudRecordingDetail) {
  if (detail.recordingFinalizing) return "Saving recording…";
  switch (detail.recordingStatus) {
    case "pending":
      return "Preparing recording…";
    case "recording":
      return "Recording in progress";
    case "ready":
      return detail.playbackPath
        ? undefined
        : "Recording saved. Preparing playback…";
    case "failed":
      return detail.manualControls?.canStart
        ? "Recording is off. You can start it again."
        : "Recording could not be saved.";
    default:
      return detail.manualControls?.canStart ? "Recording is off." : undefined;
  }
}

export function recordingStatusNeedsRefresh(detail: CloudRecordingDetail) {
  return (
    detail.recordingFinalizing ||
    detail.recordingStatus === "pending" ||
    (detail.recordingStatus === "ready" && !detail.playbackPath) ||
    (detail.recordingStatus === "failed" && !detail.manualControls?.canStart)
  );
}
export function LiveRecordingPanel({
  callUuid,
  full = false,
  initialTab = "summary",
  trustedSpeakerNames,
  contactName,
}: {
  callUuid: string;
  full?: boolean;
  initialTab?: "summary" | "transcription";
  /**
   * Only pass names when the recording pipeline provides a verified mapping
   * from each diarized speaker label to a participant identity.
   */
  trustedSpeakerNames?: TranscriptSpeakerNames;
  contactName?: string;
}) {
  const cloud = useCloudRecordings(callUuid);
  const colors = useColors();
  const router = useRouter();
  const [tab, setTab] = useState<"summary" | "transcription">(initialTab);
  const [translation, setTranslation] = useState<{
    owner: number;
    callUuid: string;
    content: RecordingSummaryContent;
  }>();
  const busy = useSipCallStore(
    (state) =>
      Boolean(state.incomingCall) ||
      Object.values(state.activeCalls).some(
        (call) => call.status !== "disconnected",
      ),
  );
  const detail = cloud.detail;
  const translated =
    translation?.owner === cloud.owner && translation?.callUuid === callUuid
      ? translation.content
      : undefined;
  // Call direction identifies participants, but does not establish which voice
  // the transcription service labeled Speaker 1 or Speaker 2.
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
  const statusNeedsRefresh =
    recordingStatusNeedsRefresh(detail) ||
    detail.summaryStatus === "queued" ||
    detail.summaryStatus === "processing" ||
    detail.summaryStatus === "failed" ||
    (detail.summaryStatus === "ready" && !detail.summary);
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
        dateLabel={new Date(detail.startedAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        full={full}
        activeTab={tab}
        onTabChange={setTab}
        summaryStatus={detail.summaryStatus}
        summary={translated ?? detail.summary}
        transcript={translated?.transcript ?? detail.transcript}
        speakerNames={trustedSpeakerNames}
        notice={
          cloud.error ||
          (busy
            ? "Playback is paused while you are on a call."
            : recordingStatusMessage(detail))
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
        actions={
          detail.summaryStatus === "ready" && detail.summary && cloud.owner ? (
            <RecordingSummaryActions
              key={`${cloud.owner}:${callUuid}`}
              ownerId={cloud.owner}
              callUuid={callUuid}
              title={`Call with ${contactName || internationalHistoryNumber(detail.number)}`}
              startedAt={detail.startedAt}
              summary={detail.summary}
              transcript={detail.transcript}
              speakerNames={trustedSpeakerNames}
              colors={colors}
              onContentChange={(content, language) =>
                setTranslation(
                  language === "original"
                    ? undefined
                    : { owner: cloud.owner!, callUuid, content },
                )
              }
              onTranslate={async (targetLanguage) => {
                const identity = getAuthSnapshot().user;
                if (!identity || identity.id !== cloud.owner)
                  throw new Error("Sign in required");
                const result =
                  await createTRPCClient().cloudRecordings.tools.translate.mutate(
                    { callUuid, targetLanguage },
                  );
                if (getAuthSnapshot().user !== identity)
                  throw new Error("Account changed");
                return result;
              }}
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
      {statusNeedsRefresh && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Refresh recording and AI status"
            disabled={cloud.loading}
            style={{ minHeight: 48, justifyContent: "center" }}
            onPress={() => void cloud.reload()}
          >
            <Text
              style={{ color: cloud.loading ? colors.muted : colors.primary }}
            >
              {cloud.loading ? "Refreshing status…" : "Refresh status"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
