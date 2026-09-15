import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import {
  CallHistoryRow,
  RecordingPanel,
} from "@/components/cloud-recordings/call-history-view";
import { PlaybackControls } from "@/components/cloud-recordings/playback-controls";
import { CallActionsSheet } from "@/components/cloud-recordings/call-actions-sheet";
import { SummaryActionsView } from "@/components/cloud-recordings/summary-actions";
import { emptyPersonalRecordingMetadata } from "@/lib/cloud-recordings/summary-actions";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { SchemeColors } from "@/constants/theme";

/** Development-only fixture: renders the real components without private calls or API access. */
export default function RecentsPreview() {
  const [tab, setTab] = useState<"summary" | "transcription">("summary");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [route, setRoute] = useState<"speaker" | "earpiece">("earpiece");
  const [expanded, setExpanded] = useState(true);
  const [menu, setMenu] = useState(false);
  const [personal, setPersonal] = useState(emptyPersonalRecordingMetadata);
  const sample = {
    summary:
      "The team discussed making customer conversations easier to follow. They agreed to show the product and service beside each enquiry so colleagues can respond with the right context.",
    actionItems: [
      "Review the conversation details and add a clear product label.",
    ],
    transcript:
      "Speaker 1: Can we make the product clearer in each conversation?\nSpeaker 2: Yes, I’ll review the details and add a product label.",
  };
  const colors = SchemeColors.dark;
  if (!__DEV__) return <Redirect href="/(tabs)/recents" />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          width: "100%",
          maxWidth: 440,
          alignSelf: "center",
          flex: 1,
          backgroundColor: colors.background,
        }}
      >
        <View style={{ padding: 20, paddingTop: 30, gap: 22 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontSize: 28,
                fontWeight: "700",
              }}
            >
              Recents
            </Text>
            <Text style={{ color: colors.primary, fontSize: 13 }}>
              Recording settings
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View
              style={{
                backgroundColor: colors.primary,
                borderRadius: 24,
                paddingHorizontal: 25,
                paddingVertical: 14,
              }}
            >
              <Text style={{ color: "white", fontWeight: "600" }}>All</Text>
            </View>
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 24,
                paddingHorizontal: 25,
                paddingVertical: 14,
              }}
            >
              <Text style={{ color: colors.muted }}>Missed</Text>
            </View>
          </View>
        </View>
        <ScrollView style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.muted,
              padding: 20,
              paddingBottom: 8,
              fontSize: 12,
            }}
          >
            Today
          </Text>
          <CallHistoryRow
            colors={colors}
            call={{
              id: "preview",
              name: "Nathasa",
              number: "+6620303001",
              direction: "outgoing",
              time: "16:50",
              duration: "3:37",
              recordingReady: true,
              summaryReady: true,
            }}
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            onCall={() => {}}
            onMore={() => setMenu(true)}
          >
            <RecordingPanel
              colors={colors}
              actions={
                <SummaryActionsView
                  title="Call with Nathasa"
                  startedAt={1789383000000}
                  original={sample}
                  content={sample}
                  speakerNames={{ speaker1: "Vasavas", speaker2: "Nathasa" }}
                  personal={personal}
                  ready
                  selectedLanguage="original"
                  onOriginal={() => {}}
                  onUpdate={async (change) => {
                    setPersonal(change);
                    return true;
                  }}
                  colors={colors}
                />
              }
              dateLabel="Today, 16:50"
              activeTab={tab}
              onTabChange={setTab}
              summaryStatus="ready"
              summary={{
                summary:
                  "The team discussed making customer conversations easier to follow. They agreed to show the product and service beside each enquiry so colleagues can respond with the right context.",
                actionItems: [
                  "Review the conversation details and add a clear product label.",
                ],
              }}
              transcript={
                "Speaker 1: Can we make the product clearer in each conversation?\nSpeaker 2: Yes, I’ll review the details and add a product label."
              }
              speakerNames={{ speaker1: "Vasavas", speaker2: "Nathasa" }}
              player={
                <PlaybackControls
                  colors={colors}
                  route={route}
                  output={{
                    route,
                    label: route === "speaker" ? "Speaker" : "Earpiece",
                  }}
                  onRouteChange={(nextRoute) => {
                    if (nextRoute !== "system") setRoute(nextRoute);
                  }}
                  currentTime={time}
                  duration={217}
                  playing={playing}
                  loaded
                  onToggle={() => setPlaying(!playing)}
                  onSeek={setTime}
                />
              }
            />
          </CallHistoryRow>
        </ScrollView>
        <CallActionsSheet
          visible={menu}
          call={{
            id: "preview",
            ownerUserId: 0,
            name: "Nathasa",
            number: "+6620303001",
            direction: "outgoing",
            duration: "3:37",
            occurredAtLabel: "Today, 16:50",
          }}
          starred={false}
          onCall={() => {}}
          onToggleStar={() => {}}
          onDeleteHistory={() => {}}
          onClose={() => setMenu(false)}
        />
        <View
          style={{
            flexDirection: "row",
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingVertical: 12,
            backgroundColor: colors.surface,
          }}
        >
          {(
            [
              ["Phone", "rectangle.grid.3x2.fill"],
              ["Recents", "clock.fill"],
              ["Contacts", "person.2.fill"],
              ["Team", "message.fill"],
              ["Settings", "gearshape.fill"],
            ] as const
          ).map(([label, icon]) => (
            <View key={label} style={{ flex: 1, alignItems: "center", gap: 5 }}>
              <IconSymbol
                name={icon}
                size={25}
                color={label === "Recents" ? colors.primary : colors.muted}
              />
              <Text
                style={{
                  fontSize: 11,
                  color: label === "Recents" ? colors.primary : colors.muted,
                }}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
