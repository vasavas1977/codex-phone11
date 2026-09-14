import type { ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
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
  calling = false,
  children,
  colors = lightRecordingColors,
}: {
  call: HistoryRowCall;
  expanded: boolean;
  onToggle(): void;
  onCall(): void;
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
            <Text
              style={{
                fontSize: 18,
                color:
                  call.direction === "missed" ? colors.error : colors.muted,
              }}
            >
              {call.direction === "outgoing" ? "↗" : "↙"}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 16,
                fontWeight: "600",
                color:
                  call.direction === "missed"
                    ? colors.error
                    : colors.foreground,
              }}
            >
              {call.name}
            </Text>
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
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: calling ? colors.muted : colors.primary,
            }}
          >
            Call
          </Text>
        </TouchableOpacity>
      </View>
      {expanded && children}
    </View>
  );
}
export function PlaybackControls({
  currentTime,
  duration,
  playing,
  loaded,
  onToggle,
  onSeek,
  error,
  colors = lightRecordingColors,
}: {
  currentTime: number;
  duration: number;
  playing: boolean;
  loaded: boolean;
  onToggle(): void;
  onSeek(seconds: number): void;
  error?: string;
  colors?: RecordingColors;
}) {
  const time = (n: number) =>
    `${Math.floor(Math.max(0, n) / 60)}:${String(Math.floor(Math.max(0, n) % 60)).padStart(2, "0")}`;
  return (
    <View style={{ gap: 8, paddingBottom: 12 }}>
      {error ? (
        <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>
          {error}
        </Text>
      ) : (
        <>
          <View
            accessible
            accessibilityLabel={`${time(currentTime)} of ${time(duration)}`}
            style={{
              height: 3,
              borderRadius: 2,
              backgroundColor: colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 3,
                width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
                backgroundColor: colors.primary,
              }}
            />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {time(currentTime)}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {time(duration)}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 24,
            }}
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back 15 seconds"
              disabled={!loaded}
              onPress={() => onSeek(Math.max(0, currentTime - 15))}
              style={{
                minHeight: 48,
                minWidth: 56,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ color: colors.primary }}>−15s</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                playing ? "Pause recording" : "Play recording"
              }
              disabled={!loaded}
              onPress={onToggle}
              style={{
                minHeight: 48,
                minWidth: 72,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: colors.primary,
                borderRadius: 24,
              }}
            >
              <Text style={{ color: "white", fontWeight: "600" }}>
                {!loaded ? "Loading" : playing ? "Pause" : "Play"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Forward 15 seconds"
              disabled={!loaded}
              onPress={() => onSeek(Math.min(duration, currentTime + 15))}
              style={{
                minHeight: 48,
                minWidth: 56,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ color: colors.primary }}>+15s</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}
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
  full?: boolean;
  colors?: RecordingColors;
}) {
  const pending = summaryStatus === "queued" || summaryStatus === "processing";
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
            {pending
              ? "Your summary is being prepared."
              : summaryStatus === "failed" || summaryStatus === "ready"
                ? "Summary unavailable. Please try refreshing later."
                : "AI summary is off for this call."}
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
              {pending
                ? "Transcription is being prepared."
                : "No transcription available."}
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
    </View>
  );
}
