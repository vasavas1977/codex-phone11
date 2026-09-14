/**
 * Small, deterministic formatter for the transcript shown in call history.
 *
 * Gemini is asked to return one `Speaker 1:` or `Speaker 2:` line per turn.
 * Older records can still be plain text, so they remain one unlabeled turn
 * instead of assigning speech to a person that the audio did not identify.
 */
export type TranscriptSpeakerNames = {
  speaker1?: string;
  speaker2?: string;
};

export type TranscriptTurn = {
  speaker: "speaker1" | "speaker2" | "unknown";
  text: string;
};

const cleanName = (value: string | undefined) => {
  const name = value?.trim();
  return name && name.length <= 80 && !/^\+?[0-9 ()-]+$/.test(name)
    ? name
    : undefined;
};

function namedPrefix(line: string, names: TranscriptSpeakerNames) {
  const entries: Array<["speaker1" | "speaker2", string | undefined]> = [
    ["speaker1", cleanName(names.speaker1)],
    ["speaker2", cleanName(names.speaker2)],
  ];
  for (const [speaker, name] of entries) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = line.match(new RegExp(`^${escaped}\\s*:\\s*(.+)$`, "iu"));
    if (match) return { speaker, text: match[1].trim() };
  }
  return null;
}

function standaloneName(line: string, names: TranscriptSpeakerNames) {
  const normalized = line.trim().toLocaleLowerCase();
  if (!normalized) return null;
  for (const [speaker, name] of [
    ["speaker1", cleanName(names.speaker1)],
    ["speaker2", cleanName(names.speaker2)],
  ] as const) {
    if (name && name.toLocaleLowerCase() === normalized)
      return { speaker, text: "" } as const;
  }
  return null;
}

function labeledPrefix(line: string) {
  // Accept the forms Gemini and earlier diarization code have emitted, while
  // keeping the fallback closed to explicit two-party labels.
  const match = line.match(
    /^\s*(?:(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?)[\s-]*)?(speaker[ _-]*([12])|caller|callee|agent|customer|you|other)\s*:\s*(.+)$/iu,
  );
  if (!match) return null;
  const label = match[1].toLowerCase().replace(/[ _-]/g, "");
  const speaker: TranscriptTurn["speaker"] =
    label === "speaker1" || label === "caller" || label === "agent" || label === "you"
      ? "speaker1"
      : label === "speaker2" || label === "callee" || label === "customer" || label === "other"
        ? "speaker2"
        : "unknown";
  return { speaker, text: match[3].trim() };
}

function standaloneLabel(line: string) {
  const match = line.match(
    /^\s*(speaker[ _-]*([12])|caller|callee|agent|customer|you|other)\s*:?\s*$/iu,
  );
  if (!match) return null;
  const label = match[1].toLowerCase().replace(/[ _-]/g, "");
  const speaker: TranscriptTurn["speaker"] =
    label === "speaker1" || label === "caller" || label === "agent" || label === "you"
      ? "speaker1"
      : label === "speaker2" || label === "callee" || label === "customer" || label === "other"
        ? "speaker2"
        : "unknown";
  return { speaker, text: "" };
}

/** Parse explicit speaker turns without guessing from sentence order. */
export function transcriptTurns(
  transcript: string,
  names: TranscriptSpeakerNames = {},
): TranscriptTurn[] {
  const source = transcript.trim();
  if (!source) return [];
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = lines.map(
    (line) =>
      namedPrefix(line, names) ??
      standaloneName(line, names) ??
      labeledPrefix(line) ??
      standaloneLabel(line),
  );
  if (!parsed.some(Boolean)) return [{ speaker: "unknown", text: source }];

  const turns: TranscriptTurn[] = [];
  for (const [index, line] of lines.entries()) {
    const current = parsed[index];
    if (current) {
      const prior = turns[turns.length - 1];
      if (prior && prior.speaker === current.speaker) prior.text += ` ${current.text}`;
      else turns.push({ ...current });
    } else {
      // Continuation lines belong to the preceding explicit turn. A preamble
      // before the first label remains visibly unassigned.
      const prior = turns[turns.length - 1];
      if (prior) prior.text += `${prior.text ? " " : ""}${line}`;
      else turns.push({ speaker: "unknown", text: line });
    }
  }
  return turns;
}

export function transcriptSpeakerLabel(
  speaker: TranscriptTurn["speaker"],
  names: TranscriptSpeakerNames = {},
) {
  if (speaker === "speaker1") return cleanName(names.speaker1) ?? "Speaker 1";
  if (speaker === "speaker2") return cleanName(names.speaker2) ?? "Speaker 2";
  return "Transcript";
}
