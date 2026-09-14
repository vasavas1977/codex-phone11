import type { TranscriptSpeakerNames } from "./transcript";
import { transcriptSpeakerLabel, transcriptTurns } from "./transcript";

export const recordingTranslationLanguages = [
  { code: "original", label: "Original" },
  { code: "th", label: "ไทย" },
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
] as const;

export type RecordingTranslationLanguage =
  (typeof recordingTranslationLanguages)[number]["code"];
export type TranslatableRecordingLanguage = Exclude<
  RecordingTranslationLanguage,
  "original"
>;

export interface RecordingSummaryContent {
  summary: string;
  actionItems: string[];
  transcript?: string;
  language?: string;
}

export interface PersonalRecordingMetadata {
  editedSummary?: string;
  feedback?: "up" | "down";
  task?: { text: string; completed: boolean };
  billable: boolean;
  updatedAt: number;
}

export const emptyPersonalRecordingMetadata =
  (): PersonalRecordingMetadata => ({
    billable: false,
    updatedAt: 0,
  });

export function personalMetadataStorageKey(ownerId: number, callUuid: string) {
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0)
    throw new Error("A valid recording owner is required");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(callUuid))
    throw new Error("A valid call identifier is required");
  return `@phone11:recording-personal:v1:${ownerId}:${callUuid}`;
}

export function decodePersonalRecordingMetadata(
  raw: string | null,
): PersonalRecordingMetadata {
  if (!raw) return emptyPersonalRecordingMetadata();
  try {
    const input = JSON.parse(raw) as Record<string, unknown>;
    const editedSummary =
      typeof input.editedSummary === "string" &&
      input.editedSummary.trim() &&
      input.editedSummary.length <= 12_000
        ? input.editedSummary
        : undefined;
    const feedback =
      input.feedback === "up" || input.feedback === "down"
        ? input.feedback
        : undefined;
    const candidate = input.task as Record<string, unknown> | undefined;
    const task =
      candidate &&
      typeof candidate.text === "string" &&
      candidate.text.trim() &&
      candidate.text.length <= 2_000 &&
      typeof candidate.completed === "boolean"
        ? { text: candidate.text, completed: candidate.completed }
        : undefined;
    return {
      ...(editedSummary ? { editedSummary } : {}),
      ...(feedback ? { feedback } : {}),
      ...(task ? { task } : {}),
      billable: input.billable === true,
      updatedAt:
        typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
          ? input.updatedAt
          : 0,
    };
  } catch {
    return emptyPersonalRecordingMetadata();
  }
}

function cleanLine(value: string) {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

export function recordingDocument(input: {
  title: string;
  startedAt: number;
  content: RecordingSummaryContent;
  speakerNames?: TranscriptSpeakerNames;
  personal?: PersonalRecordingMetadata;
}) {
  const { content, personal } = input;
  const lines = [
    cleanLine(input.title) || "Phone11 call",
    new Date(input.startedAt).toLocaleString(),
    "",
    "AI summary",
    content.summary.trim(),
  ];
  if (content.actionItems.length) {
    lines.push(
      "",
      "Next steps",
      ...content.actionItems.map((item) => `• ${cleanLine(item)}`),
    );
  }
  if (personal?.editedSummary) {
    lines.push("", "Personal summary", personal.editedSummary.trim());
  }
  if (personal?.task) {
    lines.push(
      "",
      `Saved task${personal.task.completed ? " (completed)" : ""}`,
      personal.task.text.trim(),
    );
  }
  if (content.transcript) {
    const turns = transcriptTurns(content.transcript, input.speakerNames);
    lines.push(
      "",
      "Transcript",
      ...turns.map(
        (turn) =>
          `${transcriptSpeakerLabel(turn.speaker, input.speakerNames)}: ${turn.text}`,
      ),
    );
  }
  return lines.join("\n").trim();
}
