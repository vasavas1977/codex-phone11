import type { ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  transcriptSpeakerLabel,
  transcriptTurns,
  type TranscriptSpeakerNames,
} from "@/lib/cloud-recordings/transcript";
export interface RecordingColors {
  foreground: string;
  muted: string;
  primary: string;
  border: string;
  surface: string;
  background: string;
  error: string;
}
export const lightRecordingColors: RecordingColors = {
  foreground: "#182536",
  muted: "#687584",
  primary: "#1672D4",
  border: "#E6EBF0",
  surface: "#F4F7FA",
  background: "#FFFFFF",
  error: "#D64B60",
};
export interface HistoryRowCall {
  id: string;
  name: string;
  number: string;
  direction: "incoming" | "outgoing" | "missed";
  time: string;
  duration: string;
  recordingReady?: boolean;
  summaryReady?: boolean;
}
export function CallHistoryRow({
  call,
  expanded,
  onToggle,
  onCall,
  onMore,
  starred = false,
  calling = false,
  children,
  colors = lightRecordingColors,
}: {
  call: HistoryRowCall;
  expanded: boolean;
  onToggle(): void;
  onCall(): void;
  onMore?(): void;
  starred?: boolean;
  calling?: boolean;
  children?: ReactNode;
  colors?: RecordingColors;
}) {
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: expanded ? colors.surface : colors.background,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
        }}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Details for ${call.name}`}
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={{
            flex: 1,
            minHeight: 90,
            paddingVertical: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 13,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSymbol
              name={
                call.direction === "outgoing"
                  ? "phone.arrow.up.right"
                  : call.direction === "missed"
                    ? "phone.fill.arrow.down.left"
                    : "phone.arrow.down.left"
              }
              size={20}
              color={call.direction === "missed" ? colors.error : colors.muted}
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 16,
                  fontWeight: "600",
                  flexShrink: 1,
                  color:
                    call.direction === "missed"
                      ? colors.error
                      : colors.foreground,
                }}
              >
                {call.name}
              </Text>
              {starred && (
                <IconSymbol name="star.fill" size={13} color={colors.primary} />
              )}
            </View>
            <Text
              numberOfLines={1}
              style={{ fontSize: 13, color: colors.muted }}
            >
              {call.number} ·{" "}
              {call.direction === "missed"
                ? "Missed"
                : call.direction === "incoming"
                  ? "Incoming"
                  : "Outgoing"}
            </Text>
            {(call.recordingReady || call.summaryReady) && (
              <View style={{ flexDirection: "row", gap: 10 }}>
                {call.recordingReady && (
                  <Text style={{ fontSize: 11, color: colors.primary }}>
                    ● Recording
                  </Text>
                )}
                {call.summaryReady && (
                  <Text style={{ fontSize: 11, color: colors.primary }}>
                    ✦ AI summary
                  </Text>
                )}
              </View>
            )}
          </View>
          <View style={{ alignItems: "flex-end", gap: 5, paddingLeft: 6 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {call.time}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {call.duration}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Call ${call.number}`}
          disabled={calling}
          onPress={onCall}
          style={{
            minWidth: 48,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
            marginLeft: 4,
          }}
        >
          <IconSymbol
            name="phone.fill"
            size={21}
            color={calling ? colors.muted : colors.primary}
          />
        </TouchableOpacity>
        {onMore && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`More options for ${call.name}`}
            onPress={onMore}
            style={{
              minWidth: 44,
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSymbol name="ellipsis" size={23} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>
      {expanded && children}
    </View>
  );
}
export { PlaybackControls } from "./playback-controls";
export function RecordingPanel({
  summaryStatus,
  summary,
  transcript,
  speakerNames,
  activeTab,
  onTabChange,
  onViewFull,
  player,
  controls,
  notice,
  dateLabel,
  actions,
  transcriptActions,
  full = false,
  colors = lightRecordingColors,
}: {
  summaryStatus: "off" | "queued" | "processing" | "ready" | "failed";
  summary?: { summary: string; actionItems: string[] };
  transcript?: string;
  speakerNames?: TranscriptSpeakerNames;
  activeTab: "summary" | "transcription";
  onTabChange(tab: "summary" | "transcription"): void;
  onViewFull?(tab?: "summary" | "transcription"): void;
  player?: ReactNode;
  controls?: ReactNode;
  notice?: string;
  dateLabel?: string;
  actions?: ReactNode;
  transcriptActions?: ReactNode;
  full?: boolean;
  colors?: RecordingColors;
}) {
  const summaryMessage = {
    off: "AI summary was not enabled for this call.",
    queued: "Preparing transcription before the AI summary…",
    processing: "Creating AI summary…",
    ready: "AI summary is still processing. Refresh status.",
    failed: "AI summary could not be created. Refresh status to check again.",
  }[summaryStatus];
  const transcriptionMessage = {
    off: "Transcription was not enabled for this call.",
    queued: "Preparing transcription…",
    processing: "Transcription is processing…",
    ready: "Transcript is still processing. Refresh status.",
    failed:
      "Transcription could not be created. Refresh status to check again.",
  }[summaryStatus];
  const turns = transcript ? transcriptTurns(transcript, speakerNames) : [];
  const visibleTurns = full ? turns : turns.slice(0, 4);
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 16 }}>
      {player}
      {controls}
      {notice && (
        <Text style={{ fontSize: 13, lineHeight: 21, color: colors.muted }}>
          {notice}
        </Text>
      )}
      {dateLabel && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 13, color: colors.muted }}>Date</Text>
          <Text
            style={{ fontSize: 13, color: colors.foreground, flexShrink: 1 }}
          >
            {dateLabel}
          </Text>
        </View>
      )}
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          backgroundColor: colors.border,
          borderRadius: 10,
          padding: 3,
        }}
      >
        {(["summary", "transcription"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
            onPress={() => onTabChange(tab)}
            style={{
              flex: 1,
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              backgroundColor:
                activeTab === tab ? colors.background : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: activeTab === tab ? "600" : "400",
                color: activeTab === tab ? colors.foreground : colors.muted,
              }}
            >
              {tab === "summary" ? "Summary" : "Transcription"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {activeTab === "transcription" && transcriptActions}
      {activeTab === "summary" ? (
        summaryStatus === "ready" && summary ? (
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              AI-generated · Review important details
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted }}>
              Quick recap
            </Text>
            <Text
              numberOfLines={full ? undefined : 4}
              style={{ fontSize: 16, lineHeight: 27, color: colors.foreground }}
            >
              {summary.summary}
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
              Next steps
            </Text>
            {summary.actionItems.length ? (
              summary.actionItems.slice(0, full ? 50 : 3).map((item, index) => (
                <Text
                  key={index}
                  numberOfLines={full ? undefined : 2}
                  style={{
                    fontSize: 15,
                    lineHeight: 26,
                    color: colors.foreground,
                  }}
                >
                  • {item}
                </Text>
              ))
            ) : (
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 26,
                  color: colors.foreground,
                }}
              >
                No agreed next steps.
              </Text>
            )}
            {!full && onViewFull && (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => onViewFull("summary")}
                style={{
                  minHeight: 48,
                  justifyContent: "center",
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 15,
                    fontWeight: "600",
                  }}
                >
                  View full summary
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <Text style={{ color: colors.muted, lineHeight: 24 }}>
            {summaryMessage}
          </Text>
        )
      ) : (
        <View style={{ gap: 12 }}>
          {transcript ? (
            visibleTurns.map((turn, index) => (
              <View
                key={`${turn.speaker}-${index}`}
                style={{
                  gap: 4,
                  paddingBottom: 8,
                  borderBottomWidth: index === visibleTurns.length - 1 ? 0 : 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "700",
                    color: colors.foreground,
                  }}
                >
                  {transcriptSpeakerLabel(turn.speaker, speakerNames)}
                </Text>
                <Text
                  selectable
                  numberOfLines={full ? undefined : index === 0 ? 12 : 4}
                  style={{
                    fontSize: 16,
                    lineHeight: 28,
                    color: colors.foreground,
                  }}
                >
                  {turn.text}
                </Text>
              </View>
            ))
          ) : (
            <Text style={{ color: colors.muted, lineHeight: 24 }}>
              {transcriptionMessage}
            </Text>
          )}
          {!full && transcript && onViewFull && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => onViewFull("transcription")}
              style={{
                minHeight: 48,
                justifyContent: "center",
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontSize: 15,
                  fontWeight: "600",
                }}
              >
                View full transcription
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {actions}
    </View>
  );
}
