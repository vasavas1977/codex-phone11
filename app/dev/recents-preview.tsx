import { useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
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
import type {
  PlaybackAudioRoute,
  PlaybackAudioRouteStatus,
} from "@/lib/cloud-recordings/playback-route";
import type { PlaybackExternalOutput } from "@/components/cloud-recordings/playback-output-picker";

/** Development-only fixture: renders the real components without private calls or API access. */
export default function RecentsPreview() {
  const [tab, setTab] = useState<"summary" | "transcription">("summary");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [route, setRoute] = useState<PlaybackAudioRoute>("earpiece");
  const [output, setOutput] = useState<PlaybackAudioRouteStatus>({
    route: "earpiece",
    label: "Earpiece",
  });
  const [expanded, setExpanded] = useState(true);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "all" | "missed" | "recorded"
  >("all");
  const [shareNotice, setShareNotice] = useState<string | null>(null);
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
  const sampleCall = {
    id: "preview",
    name: "Nathasa",
    number: "+6620303001",
    direction: "outgoing" as const,
    time: "16:50",
    duration: "3:37",
    recordingReady: true,
    summaryReady: true,
  };
  const previewCalls = [
    sampleCall,
    {
      id: "preview-recorded",
      name: "Ping Ping Daughter",
      number: "+66625503222",
      direction: "outgoing" as const,
      time: "16:42",
      duration: "0:23",
      recordingReady: true,
      summaryReady: false,
    },
    {
      id: "preview-missed",
      name: "020303988",
      number: "+6620303988",
      direction: "missed" as const,
      time: "15:18",
      duration: "Missed",
      recordingReady: false,
      summaryReady: false,
    },
  ];
  const visibleCalls = previewCalls.filter((call) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesFilter =
      filter === "all" ||
      (filter === "missed" && call.direction === "missed") ||
      (filter === "recorded" && call.recordingReady);
    return (
      matchesFilter &&
      `${call.name} ${call.number}`.toLocaleLowerCase().includes(query)
    );
  });
  const outputs: readonly PlaybackExternalOutput[] = [
    {
      id: "bluetooth-preview",
      label: "Bluetooth headset",
      icon: "bluetooth-audio",
    },
  ];
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {([
              ["all", "All"],
              ["missed", "Missed"],
              ["recorded", "Recorded"],
            ] as const).map(([value, label]) => (
              <TouchableOpacity
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Show ${label.toLocaleLowerCase()} calls`}
                accessibilityState={{ selected: filter === value }}
                onPress={() => setFilter(value)}
                style={{
                  minHeight: 44,
                  backgroundColor:
                    filter === value ? colors.primary : colors.surface,
                  borderRadius: 24,
                  paddingHorizontal: 18,
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: filter === value ? "white" : colors.muted,
                    fontWeight: "600",
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput
            accessibilityLabel="Search recent calls"
            placeholder="Search name or number"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            style={{
              minHeight: 44,
              borderRadius: 14,
              paddingHorizontal: 14,
              fontSize: 15,
              color: colors.foreground,
              backgroundColor: colors.surface,
            }}
          />
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
          {visibleCalls.length ? visibleCalls.map((call) => call.id === sampleCall.id ? (
            <CallHistoryRow
              key={call.id}
              colors={colors}
              call={call}
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
                summary={sample}
                transcript={sample.transcript}
                speakerNames={{ speaker1: "Vasavas", speaker2: "Nathasa" }}
                player={
                  <PlaybackControls
                    colors={colors}
                    route={route}
                    output={output}
                    availableOutputs={outputs}
                    onOutputSelect={(selected) => {
                      setOutput({ route: "external", label: selected.label });
                    }}
                    onRouteChange={(nextRoute) => {
                      if (nextRoute !== "system") {
                        setRoute(nextRoute);
                        setOutput({
                          route: nextRoute,
                          label: nextRoute === "speaker" ? "Speaker" : "Earpiece",
                        });
                      }
                    }}
                    currentTime={time}
                    duration={217}
                    playing={playing}
                    loaded
                    onToggle={() => setPlaying(!playing)}
                    onSeek={setTime}
                    onShare={() => {
                      setShareNotice("Recording sharing is ready on supported devices.");
                    }}
                  />
                }
              />
            </CallHistoryRow>
          ) : (
            <CallHistoryRow
              key={call.id}
              colors={colors}
              call={call}
              expanded={false}
              onToggle={() => {}}
              onCall={() => {}}
              onMore={() => {}}
            />
          )) : (
            <Text style={{ padding: 24, color: colors.muted, textAlign: "center" }}>
              No calls match this view
            </Text>
          )}
        </ScrollView>
        {shareNotice ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Dismiss share notice"
            onPress={() => setShareNotice(null)}
            style={{
              position: "absolute",
              left: 20,
              right: 20,
              bottom: 74,
              padding: 12,
              borderRadius: 12,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ color: colors.foreground, textAlign: "center" }}>
              {shareNotice}
            </Text>
          </TouchableOpacity>
        ) : null}
        <CallActionsSheet
          visible={menu}
          call={{
            id: "preview",
            ownerUserId: 1,
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
          extraActions={[
            {
              id: "share-recording",
              label: "Share recording",
              description: "Open the secure system share sheet",
              icon: "square.and.arrow.up",
              onPress: () => {
                setShareNotice("Recording sharing is ready on supported devices.");
              },
            },
            {
              id: "copy-transcript",
              label: "Copy transcript",
              description: "Copy the speaker-labeled transcript",
              icon: "doc.on.clipboard",
              onPress: () => setShareNotice("Transcript copied in the full app."),
            },
          ]}
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
