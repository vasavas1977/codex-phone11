// Adapted from onetoall191 3df7aee, src/core-guard/transcription.ts.
// Meeting identity is supplied by the authenticated provider; names resolve from the roster.
export type CoreGuardTranscriptKind = "original" | "translated";

export type CoreGuardTranscriptSegment = {
  id: string;
  kind: CoreGuardTranscriptKind;
  text: string;
  originalText?: string | null;
  translatedText?: string | null;
  participantIdentity: string | null;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  isFinal: boolean;
  createdAt: string;
};

/** Operator-facing live video transcript defaults to Thai; skip redundant Thai→Thai captions. */
export function isThaiLanguageCode(language: string | null | undefined) {
  if (!language) return false;
  const code = language.trim().toLowerCase();
  return code === "th" || code === "tha" || code.startsWith("th-");
}

export function textLooksPredominantlyThai(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const thaiChars = [...trimmed].filter((ch) => /\p{Script=Thai}/u.test(ch)).length;
  const letterChars = [...trimmed].filter((ch) => /\p{L}/u.test(ch)).length;
  if (letterChars === 0) return false;
  return thaiChars / letterChars >= 0.4;
}

export function transcriptOriginalText(
  segment: Pick<CoreGuardTranscriptSegment, "kind" | "text" | "originalText">,
) {
  return (
    (segment.originalText && segment.originalText.trim()) ||
    (segment.kind === "original" ? segment.text.trim() : "") ||
    ""
  );
}

export function shouldAttachTranscriptTranslation(
  segment: Pick<
    CoreGuardTranscriptSegment,
    "kind" | "text" | "originalText" | "translatedText" | "sourceLanguage"
  >,
) {
  const original = transcriptOriginalText(segment);
  const translated = segment.translatedText?.trim() || (segment.kind === "translated" ? segment.text.trim() : "");
  if (!translated) return false;
  if (translated === original) return false;
  return true;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function participantIdentityFrom(input: any): string | null {
  return firstString(
    input?.participantIdentity,
    input?.participant_identity,
    input?.identity,
    input?.participant?.identity,
    input?.speaker?.identity,
    input?.user?.identity,
  );
}

function eventItems(payload: unknown): any[] {
  const input = payload as any;
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.segments)) return input.segments;
  if (Array.isArray(input?.transcriptions)) return input.transcriptions;
  if (Array.isArray(input?.alternatives)) return input.alternatives;
  if (input) return [input];
  return [];
}

export function normalizeCoreGuardTranscriptionEvent(
  payload: unknown,
  targetLanguage: string,
): CoreGuardTranscriptSegment[] {
  const items = eventItems(payload);
  const now = new Date().toISOString();

  return items.flatMap((item, index) => {
    const source = item?.segment ?? item;
    const identity = participantIdentityFrom(item) ?? participantIdentityFrom(source);
    const alternative = Array.isArray(source?.alternatives) ? source.alternatives[0] : null;
    const text = firstString(
      source?.text,
      source?.finalText,
      source?.final_text,
      source?.transcript,
      source?.message,
      alternative?.text,
      alternative?.transcript,
    );
    const translated = firstString(
      source?.translatedText,
      source?.translated_text,
      source?.translation,
      source?.translated,
      source?.translationText,
      source?.translation_text,
      alternative?.translatedText,
      alternative?.translated_text,
      alternative?.translation,
    );
    if (!text && !translated) return [];

    const sourceLanguage = firstString(
      source?.sourceLanguage,
      source?.source_lang,
      source?.source_language,
      source?.language,
      source?.languageCode,
      source?.language_code,
      alternative?.language,
    );
    const translatedLanguage = firstString(
      source?.targetLanguage,
      source?.target_lang,
      source?.target_language,
      source?.translatedLanguage,
      source?.translated_language,
      source?.translationLanguage,
      source?.translation_language,
      targetLanguage,
    );
    const isFinal = firstBoolean(source?.isFinal, source?.is_final, source?.final, source?.stable) ?? true;
    const createdAt = firstString(source?.createdAt, source?.created_at, source?.timestamp, source?.time) ?? now;
    const baseId = firstString(source?.id, source?.segmentId, source?.segment_id, source?.sid) ?? `${createdAt}:${identity ?? "unknown"}:${index}`;
    const segments: CoreGuardTranscriptSegment[] = [];

    if (text) {
      segments.push({
        id: `${baseId}:original`,
        kind: "original",
        text,
        originalText: text,
        translatedText: translated,
        participantIdentity: identity,
        sourceLanguage,
        targetLanguage: translatedLanguage,
        isFinal,
        createdAt,
      });
    }

    if (translated && translated !== text) {
      segments.push({
        id: `${baseId}:translated`,
        kind: "translated",
        text: translated,
        originalText: text,
        translatedText: translated,
        participantIdentity: identity,
        sourceLanguage,
        targetLanguage: translatedLanguage,
        isFinal,
        createdAt,
      });
    }

    return segments;
  });
}
