import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Clipboard from "expo-clipboard";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ShareContent,
} from "react-native";
import { useRecordingPersonalMetadata } from "@/hooks/use-recording-personal-metadata";
import {
  recordingDocument,
  recordingTranslationLanguages,
  type PersonalRecordingMetadata,
  type RecordingSummaryContent,
  type RecordingTranslationLanguage,
  type TranslatableRecordingLanguage,
} from "@/lib/cloud-recordings/summary-actions";
import {
  transcriptSpeakerLabel,
  transcriptTurns,
  type TranscriptSpeakerNames,
} from "@/lib/cloud-recordings/transcript";
import type { RecordingColors } from "./call-history-view";

export interface SummaryActionsViewProps {
  title: string;
  startedAt: number;
  original: RecordingSummaryContent;
  content: RecordingSummaryContent;
  speakerNames?: TranscriptSpeakerNames;
  personal: PersonalRecordingMetadata;
  ready?: boolean;
  saving?: boolean;
  storageError?: string;
  selectedLanguage: RecordingTranslationLanguage;
  translating?: boolean;
  translationError?: string;
  showTranslatedContent?: boolean;
  onTranslate?(language: TranslatableRecordingLanguage): Promise<void>;
  onOriginal(): void;
  onUpdate(
    change: (current: PersonalRecordingMetadata) => PersonalRecordingMetadata,
  ): Promise<boolean>;
  colors: RecordingColors;
}

type Editor = "actions" | "summary" | "task" | "language" | "copy" | null;

function MenuRow({
  label,
  description,
  icon,
  selected,
  disabled,
  onPress,
  colors,
}: {
  label: string;
  description?: string;
  icon: ComponentProps<typeof MaterialIcons>["name"];
  selected?: boolean;
  disabled?: boolean;
  onPress(): void;
  colors: RecordingColors;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? colors.primary : colors.surface,
        }}
      >
        <MaterialIcons
          name={icon}
          size={19}
          color={selected ? "#FFFFFF" : colors.foreground}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: colors.foreground, fontSize: 15, fontWeight: "500" }}
        >
          {label}
        </Text>
        {description ? (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <MaterialIcons name="check" size={20} color={colors.primary} />
      ) : (
        <MaterialIcons name="chevron-right" size={20} color={colors.muted} />
      )}
    </TouchableOpacity>
  );
}

export function SummaryActionsView(props: SummaryActionsViewProps) {
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string>();
  const document = recordingDocument({
    title: props.title,
    startedAt: props.startedAt,
    content: props.content,
    speakerNames: props.speakerNames,
    personal: props.personal,
  });
  const openSummary = () => {
    setDraft(props.personal.editedSummary ?? props.original.summary);
    setEditor("summary");
  };
  const openTask = () => {
    setDraft(props.personal.task?.text ?? props.original.actionItems[0] ?? "");
    setEditor("task");
  };
  const saveSummary = async () => {
    const value = draft.trim();
    if (!value) return;
    const saved = await props.onUpdate((current) => ({
      ...current,
      editedSummary:
        value === props.original.summary.trim() ? undefined : value,
    }));
    setStatus(saved ? "Personal summary saved on this device." : undefined);
    if (saved) setEditor(null);
  };
  const saveTask = async () => {
    const value = draft.trim();
    if (!value) return;
    const saved = await props.onUpdate((current) => ({
      ...current,
      task: { text: value, completed: current.task?.completed ?? false },
    }));
    setStatus(saved ? "Task saved with this call on this device." : undefined);
    if (saved) setEditor(null);
  };
  const copy = async (kind: "summary" | "transcript") => {
    const text =
      kind === "summary"
        ? `${props.title}\n\n${props.content.summary.trim()}${
            props.content.actionItems.length
              ? `\n\nNext steps\n${props.content.actionItems.map((item) => `• ${item}`).join("\n")}`
              : ""
          }`
        : props.content.transcript?.trim();
    if (!text) {
      setStatus("No transcript is available to copy.");
      return;
    }
    try {
      const copied = await Clipboard.setStringAsync(text);
      setStatus(
        copied
          ? `${kind === "summary" ? "Summary" : "Transcript"} copied.`
          : "Could not copy.",
      );
      if (copied) setEditor(null);
    } catch {
      setStatus("Could not copy.");
    }
  };
  const share = async (full: boolean) => {
    const content: ShareContent = {
      title: props.title,
      message: full
        ? document
        : `${props.title}\n\n${props.content.summary.trim()}`,
    };
    try {
      await Share.share(content);
    } catch {
      setStatus(
        full ? "Could not export this call." : "Could not open sharing.",
      );
    }
  };
  const feedback = async (value: "up" | "down") => {
    const saved = await props.onUpdate((current) => ({
      ...current,
      feedback: current.feedback === value ? undefined : value,
    }));
    if (saved) setStatus("Feedback saved privately on this device.");
  };
  return (
    <View style={{ gap: 16 }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="More summary actions"
        onPress={() => setEditor("actions")}
        style={{
          alignSelf: "flex-start",
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: props.colors.border,
          backgroundColor: props.colors.surface,
        }}
      >
        <MaterialIcons
          name="more-horiz"
          size={20}
          color={props.colors.primary}
        />
        <Text
          style={{
            color: props.colors.primary,
            fontSize: 13,
            fontWeight: "600",
          }}
        >
          More summary actions
        </Text>
      </TouchableOpacity>

      {props.showTranslatedContent !== false &&
        props.selectedLanguage !== "original" && (
          <View
            style={{
              gap: 10,
              padding: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: props.colors.border,
              backgroundColor: props.colors.surface,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Text
                style={{
                  color: props.colors.foreground,
                  fontWeight: "700",
                  fontSize: 15,
                }}
              >
                {
                  recordingTranslationLanguages.find(
                    (item) => item.code === props.selectedLanguage,
                  )?.label
                }{" "}
                translation
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Show original call summary"
                onPress={props.onOriginal}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ color: props.colors.primary, fontSize: 13 }}>
                  Show original
                </Text>
              </TouchableOpacity>
            </View>
            <Text
              selectable
              style={{
                color: props.colors.foreground,
                fontSize: 15,
                lineHeight: 24,
              }}
            >
              {props.content.summary}
            </Text>
            {props.content.actionItems.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={{ color: props.colors.muted, fontSize: 12 }}>
                  Next steps
                </Text>
                {props.content.actionItems.map((item, index) => (
                  <Text
                    key={index}
                    selectable
                    style={{
                      color: props.colors.foreground,
                      fontSize: 14,
                      lineHeight: 22,
                    }}
                  >
                    • {item}
                  </Text>
                ))}
              </View>
            )}
            {props.content.transcript && (
              <View
                style={{
                  gap: 10,
                  borderTopWidth: 1,
                  borderTopColor: props.colors.border,
                  paddingTop: 10,
                }}
              >
                <Text style={{ color: props.colors.muted, fontSize: 12 }}>
                  Translated transcript
                </Text>
                {transcriptTurns(
                  props.content.transcript,
                  props.speakerNames,
                ).map((turn, index) => (
                  <View key={`${turn.speaker}-${index}`} style={{ gap: 3 }}>
                    <Text
                      style={{
                        color: props.colors.foreground,
                        fontSize: 13,
                        fontWeight: "700",
                      }}
                    >
                      {transcriptSpeakerLabel(turn.speaker, props.speakerNames)}
                    </Text>
                    <Text
                      selectable
                      style={{
                        color: props.colors.foreground,
                        fontSize: 14,
                        lineHeight: 22,
                      }}
                    >
                      {turn.text}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      {props.personal.editedSummary && (
        <View style={{ gap: 5 }}>
          <Text style={{ color: props.colors.muted, fontSize: 12 }}>
            Personal summary · saved on this device
          </Text>
          <Text
            selectable
            style={{
              color: props.colors.foreground,
              fontSize: 15,
              lineHeight: 24,
            }}
          >
            {props.personal.editedSummary}
          </Text>
          <Text style={{ color: props.colors.muted, fontSize: 11 }}>
            The original AI summary is preserved.
          </Text>
        </View>
      )}
      {props.personal.task && (
        <TouchableOpacity
          accessibilityRole="checkbox"
          accessibilityState={{ checked: props.personal.task.completed }}
          accessibilityLabel="Saved call task"
          onPress={() =>
            void props.onUpdate((current) =>
              current.task
                ? {
                    ...current,
                    task: {
                      ...current.task,
                      completed: !current.task.completed,
                    },
                  }
                : current,
            )
          }
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}
        >
          <MaterialIcons
            name={
              props.personal.task.completed
                ? "check-box"
                : "check-box-outline-blank"
            }
            size={20}
            color={props.colors.primary}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: props.colors.foreground,
                fontSize: 14,
                lineHeight: 22,
              }}
            >
              {props.personal.task.text}
            </Text>
            <Text style={{ color: props.colors.muted, fontSize: 11 }}>
              Saved with this call on this device
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {(status ||
        props.storageError ||
        props.translationError ||
        props.saving) && (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color:
              props.translationError || props.storageError
                ? props.colors.error
                : props.colors.muted,
            fontSize: 12,
          }}
        >
          {props.saving
            ? "Saving…"
            : props.translationError || props.storageError || status}
        </Text>
      )}

      <Modal
        visible={editor !== null}
        animationType={editor === "actions" ? "fade" : "slide"}
        transparent={editor === "actions"}
        presentationStyle={
          editor === "actions" ? "overFullScreen" : "pageSheet"
        }
        statusBarTranslucent={editor === "actions"}
        onRequestClose={() => setEditor(null)}
      >
        <View
          style={
            editor === "actions"
              ? {
                  flex: 1,
                  justifyContent: "flex-end",
                  backgroundColor: "rgba(13, 20, 28, 0.44)",
                }
              : { flex: 1 }
          }
        >
          {editor === "actions" && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close summary actions"
              activeOpacity={1}
              onPress={() => setEditor(null)}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
              }}
            />
          )}
          <View
            accessibilityViewIsModal
            accessibilityRole={editor === "actions" ? "menu" : undefined}
            style={
              editor === "actions"
                ? {
                    maxHeight: "80%",
                    backgroundColor: props.colors.background,
                    borderTopLeftRadius: 22,
                    borderTopRightRadius: 22,
                    paddingTop: 10,
                    paddingBottom: 18,
                    paddingHorizontal: 20,
                    gap: 8,
                  }
                : {
                    flex: 1,
                    backgroundColor: props.colors.background,
                    paddingTop: 24,
                    paddingHorizontal: 20,
                    gap: 16,
                  }
            }
          >
            {editor === "actions" && (
              <View
                importantForAccessibility="no-hide-descendants"
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: props.colors.border,
                  alignSelf: "center",
                  marginBottom: 2,
                }}
              />
            )}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={() => setEditor(null)}
                style={{ minHeight: 48, justifyContent: "center" }}
              >
                <Text style={{ color: props.colors.primary, fontSize: 16 }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <Text
                style={{
                  color: props.colors.foreground,
                  fontWeight: "700",
                  fontSize: 17,
                }}
              >
                {editor === "actions"
                  ? "Summary actions"
                  : editor === "summary"
                    ? "Personal summary"
                    : editor === "task"
                      ? "Saved task"
                      : editor === "copy"
                        ? "Copy"
                        : "Translate"}
              </Text>
              {editor === "actions" ||
              editor === "language" ||
              editor === "copy" ? (
                <View style={{ width: 48 }} />
              ) : (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={
                    editor === "summary"
                      ? "Save personal summary"
                      : "Save call task"
                  }
                  disabled={!draft.trim() || props.saving}
                  onPress={() =>
                    void (editor === "summary" ? saveSummary() : saveTask())
                  }
                  style={{ minHeight: 48, justifyContent: "center" }}
                >
                  <Text
                    style={{
                      color:
                        !draft.trim() || props.saving
                          ? props.colors.muted
                          : props.colors.primary,
                      fontSize: 16,
                      fontWeight: "600",
                    }}
                  >
                    Save
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {editor === "actions" ? (
              <ScrollView
                style={{ flexGrow: 0 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                <MenuRow
                  label="Copy"
                  description="Choose summary or transcript"
                  icon="content-copy"
                  onPress={() => setEditor("copy")}
                  colors={props.colors}
                />
                <MenuRow
                  label="Share"
                  description="Open the system share sheet"
                  icon="share"
                  onPress={() => void share(false)}
                  colors={props.colors}
                />
                <MenuRow
                  label="Export"
                  description="Share the complete call text"
                  icon="description"
                  onPress={() => void share(true)}
                  colors={props.colors}
                />
                <MenuRow
                  label="Edit personal summary"
                  description="The original AI summary stays unchanged"
                  icon="edit"
                  disabled={!props.ready}
                  onPress={openSummary}
                  colors={props.colors}
                />
                <MenuRow
                  label="Translate"
                  description="Thai, English, Chinese, Japanese or Korean"
                  icon="language"
                  disabled={!props.onTranslate}
                  onPress={() => setEditor("language")}
                  colors={props.colors}
                />
                <MenuRow
                  label="Save task"
                  description="Keep a private task with this call"
                  icon="checklist"
                  disabled={!props.ready}
                  selected={Boolean(props.personal.task)}
                  onPress={openTask}
                  colors={props.colors}
                />
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: props.colors.border,
                    marginTop: 6,
                    paddingTop: 14,
                    gap: 8,
                  }}
                >
                  <Text style={{ color: props.colors.muted, fontSize: 12 }}>
                    Was this summary accurate?
                  </Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Summary was accurate"
                      accessibilityState={{
                        selected: props.personal.feedback === "up",
                        disabled: !props.ready,
                      }}
                      disabled={!props.ready}
                      onPress={() => void feedback("up")}
                      style={{
                        minWidth: 44,
                        minHeight: 40,
                        borderRadius: 20,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor:
                          props.personal.feedback === "up"
                            ? props.colors.primary
                            : props.colors.surface,
                      }}
                    >
                      <MaterialIcons
                        name="thumb-up-alt"
                        size={18}
                        color={
                          props.personal.feedback === "up"
                            ? "#FFFFFF"
                            : props.colors.foreground
                        }
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Summary was inaccurate"
                      accessibilityState={{
                        selected: props.personal.feedback === "down",
                        disabled: !props.ready,
                      }}
                      disabled={!props.ready}
                      onPress={() => void feedback("down")}
                      style={{
                        minWidth: 44,
                        minHeight: 40,
                        borderRadius: 20,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor:
                          props.personal.feedback === "down"
                            ? props.colors.primary
                            : props.colors.surface,
                      }}
                    >
                      <MaterialIcons
                        name="thumb-down-alt"
                        size={18}
                        color={
                          props.personal.feedback === "down"
                            ? "#FFFFFF"
                            : props.colors.foreground
                        }
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
            ) : editor === "copy" ? (
              <View style={{ gap: 4 }}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Copy summary"
                  onPress={() => void copy("summary")}
                  style={{
                    minHeight: 56,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: props.colors.border,
                  }}
                >
                  <MaterialIcons
                    name="description"
                    size={22}
                    color={props.colors.primary}
                  />
                  <Text
                    style={{ color: props.colors.foreground, fontSize: 16 }}
                  >
                    Copy summary and next steps
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Copy transcript"
                  disabled={!props.content.transcript}
                  onPress={() => void copy("transcript")}
                  style={{
                    minHeight: 56,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    opacity: props.content.transcript ? 1 : 0.45,
                  }}
                >
                  <MaterialIcons
                    name="content-copy"
                    size={22}
                    color={props.colors.primary}
                  />
                  <Text
                    style={{ color: props.colors.foreground, fontSize: 16 }}
                  >
                    Copy transcript
                  </Text>
                </TouchableOpacity>
              </View>
            ) : editor === "language" ? (
              <View style={{ gap: 4 }}>
                {recordingTranslationLanguages.map((language) => (
                  <TouchableOpacity
                    key={language.code}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${language.label}`}
                    accessibilityState={{
                      selected: props.selectedLanguage === language.code,
                    }}
                    disabled={props.translating}
                    onPress={() => {
                      if (language.code === "original") {
                        props.onOriginal();
                        setEditor(null);
                      } else if (props.onTranslate) {
                        void props
                          .onTranslate(language.code)
                          .then(() => setEditor(null));
                      }
                    }}
                    style={{
                      minHeight: 54,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderBottomWidth: 1,
                      borderBottomColor: props.colors.border,
                    }}
                  >
                    <Text
                      style={{ color: props.colors.foreground, fontSize: 16 }}
                    >
                      {language.label}
                    </Text>
                    {props.translating ? (
                      <ActivityIndicator
                        size="small"
                        color={props.colors.primary}
                      />
                    ) : props.selectedLanguage === language.code ? (
                      <Text style={{ color: props.colors.primary }}>✓</Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <>
                <Text
                  style={{
                    color: props.colors.muted,
                    fontSize: 13,
                    lineHeight: 20,
                  }}
                >
                  {editor === "summary"
                    ? "Edit your personal copy. The original AI summary stays unchanged."
                    : "This task stays private on this device with the call."}
                </Text>
                <TextInput
                  accessibilityLabel={
                    editor === "summary" ? "Personal summary" : "Call task"
                  }
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  autoFocus
                  maxLength={editor === "summary" ? 12_000 : 2_000}
                  placeholder={
                    editor === "summary" ? "Add your summary" : "Add a task"
                  }
                  placeholderTextColor={props.colors.muted}
                  style={{
                    minHeight: editor === "summary" ? 220 : 120,
                    padding: 14,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: props.colors.border,
                    color: props.colors.foreground,
                    backgroundColor: props.colors.surface,
                    fontSize: 16,
                    lineHeight: 24,
                    textAlignVertical: "top",
                  }}
                />
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function RecordingSummaryActions({
  ownerId,
  callUuid,
  title,
  startedAt,
  summary,
  transcript,
  speakerNames,
  colors,
  onTranslate,
  onContentChange,
}: {
  ownerId: number;
  callUuid: string;
  title: string;
  startedAt: number;
  summary: { summary: string; actionItems: string[]; language?: string };
  transcript?: string;
  speakerNames?: TranscriptSpeakerNames;
  colors: RecordingColors;
  onTranslate?(
    language: TranslatableRecordingLanguage,
  ): Promise<RecordingSummaryContent>;
  onContentChange?(
    content: RecordingSummaryContent,
    language: RecordingTranslationLanguage,
  ): void;
}) {
  const personal = useRecordingPersonalMetadata(ownerId, callUuid);
  const [selectedLanguage, setSelectedLanguage] =
    useState<RecordingTranslationLanguage>("original");
  const [translated, setTranslated] = useState<RecordingSummaryContent>();
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string>();
  const generation = useRef(0);
  const original = { ...summary, transcript };
  useEffect(() => {
    const generationRef = generation;
    generationRef.current++;
    setSelectedLanguage("original");
    setTranslated(undefined);
    setTranslating(false);
    setTranslationError(undefined);
    return () => {
      generationRef.current++;
    };
  }, [callUuid, ownerId]);
  const translate = async (language: TranslatableRecordingLanguage) => {
    if (!onTranslate) return;
    const revision = ++generation.current;
    setTranslating(true);
    setTranslationError(undefined);
    try {
      const result = await onTranslate(language);
      if (generation.current !== revision) return;
      setTranslated(result);
      setSelectedLanguage(language);
      onContentChange?.(result, language);
    } catch {
      if (generation.current === revision)
        setTranslationError("Translation is unavailable. Please try again.");
    } finally {
      if (generation.current === revision) setTranslating(false);
    }
  };
  return (
    <SummaryActionsView
      title={title}
      startedAt={startedAt}
      original={original}
      content={
        selectedLanguage === "original" ? original : (translated ?? original)
      }
      speakerNames={speakerNames}
      personal={personal.value}
      ready={personal.ready}
      saving={personal.saving}
      storageError={personal.error}
      selectedLanguage={selectedLanguage}
      translating={translating}
      translationError={translationError}
      showTranslatedContent={!onContentChange}
      onTranslate={onTranslate ? translate : undefined}
      onOriginal={() => {
        generation.current++;
        setSelectedLanguage("original");
        setTranslated(undefined);
        setTranslating(false);
        setTranslationError(undefined);
        onContentChange?.(original, "original");
      }}
      onUpdate={personal.update}
      colors={colors}
    />
  );
}
