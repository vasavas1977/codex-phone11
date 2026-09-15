import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  transcriptTurns,
  type TranscriptSpeakerNames,
} from "@/lib/cloud-recordings/transcript";
import type { RecordingColors } from "./call-history-view";

export function SpeakerNamesEditor({
  transcript,
  names,
  suggestions,
  ready,
  saving,
  error,
  onSave,
  colors,
}: {
  transcript: string;
  names?: TranscriptSpeakerNames;
  suggestions: string[];
  ready: boolean;
  saving: boolean;
  error?: string;
  onSave(names: TranscriptSpeakerNames): Promise<boolean>;
  colors: RecordingColors;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TranscriptSpeakerNames>({});
  const turns = transcriptTurns(transcript, names);
  const speakers = (["speaker1", "speaker2"] as const).filter((speaker) =>
    turns.some((turn) => turn.speaker === speaker),
  );
  if (!speakers.length) return null;
  const button = (
    label: string,
    onPress: () => void,
    disabled = false,
    accessibilityLabel = label,
  ) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: colors.primary }}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={{ paddingBottom: 4 }}>
      {!editing ? (
        button(
          "Name speakers",
          () => {
            setDraft(names ?? {});
            setEditing(true);
          },
          !ready,
        )
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Match each voice to a name after listening. Names are saved for this
            call on this device.
          </Text>
          {speakers.map((speaker) => (
            <View key={speaker} style={{ gap: 4 }}>
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                {speaker === "speaker1" ? "Speaker 1" : "Speaker 2"}
              </Text>
              <Text
                numberOfLines={2}
                style={{ color: colors.muted, lineHeight: 20 }}
              >
                {turns.find((turn) => turn.speaker === speaker)?.text}
              </Text>
              <TextInput
                accessibilityLabel={`Name for ${speaker === "speaker1" ? "Speaker 1" : "Speaker 2"}`}
                value={draft[speaker] ?? ""}
                placeholder="Enter a name"
                placeholderTextColor={colors.muted}
                maxLength={80}
                editable={!saving}
                onChangeText={(value) =>
                  setDraft((current) => ({ ...current, [speaker]: value }))
                }
                style={{
                  minHeight: 44,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  color: colors.foreground,
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  columnGap: 18,
                }}
              >
                {suggestions.map((name) => (
                  <View key={name}>
                    {button(
                      name,
                      () =>
                        setDraft((current) => ({
                          ...current,
                          [speaker]: name,
                        })),
                      saving,
                      `Use ${name} for ${speaker === "speaker1" ? "Speaker 1" : "Speaker 2"}`,
                    )}
                  </View>
                ))}
              </View>
            </View>
          ))}
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 24 }}
          >
            {button(
              saving ? "Saving names…" : "Save names",
              () => {
                void onSave(draft).then((saved) => {
                  if (saved) setEditing(false);
                });
              },
              saving || !ready,
            )}
            {button("Cancel", () => setEditing(false), saving)}
            {button("Clear names", () => setDraft({}), saving)}
          </View>
        </View>
      )}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.muted, lineHeight: 20 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
