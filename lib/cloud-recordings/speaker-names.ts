import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  mergeTranscriptSpeakerNames,
  type TranscriptSpeakerNames,
} from "./transcript";

export function speakerNamesStorageKey(ownerId: number, callUuid: string) {
  if (
    !Number.isSafeInteger(ownerId) ||
    ownerId <= 0 ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(callUuid)
  )
    throw new Error("A valid recording owner and call are required");
  return `@phone11:recording-speakers:v1:${ownerId}:${callUuid}`;
}

export function isReservedSpeakerName(value: string) {
  return /^(?:speaker[\s_-]*[12]|caller|callee|agent|customer|you|other)\s*:?$/iu.test(
    value.trim(),
  );
}

export function normalizeAssignedSpeakerNames(
  input: unknown,
): TranscriptSpeakerNames {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const validName = (value: unknown) =>
    typeof value === "string" && !isReservedSpeakerName(value)
      ? value
      : undefined;
  return (
    mergeTranscriptSpeakerNames({
      speaker1: validName(source.speaker1),
      speaker2: validName(source.speaker2),
    }) ?? {}
  );
}

/**
 * Default a two-party call from its direction: caller is Speaker 1 and callee
 * is Speaker 2. The remote name comes only from the private device contact;
 * the owner uses the stable, language-neutral "Me" label.
 */
export function defaultCallSpeakerNames(
  direction: "inbound" | "outbound",
  contactName?: string,
  ownerName?: string,
): TranscriptSpeakerNames {
  const remote = normalizeAssignedSpeakerNames({
    speaker1: contactName || "Other party",
  }).speaker1!;
  const owner = normalizeAssignedSpeakerNames({
    speaker1: ownerName || "Me",
  }).speaker1!;
  return direction === "inbound"
    ? { speaker1: remote, speaker2: owner }
    : { speaker1: owner, speaker2: remote };
}

export function validateAssignedSpeakerNames(input: TranscriptSpeakerNames) {
  const names = normalizeAssignedSpeakerNames(input);
  for (const key of ["speaker1", "speaker2"] as const) {
    if (input[key] && isReservedSpeakerName(input[key]!))
      throw new Error("Use a person’s name rather than a speaker label.");
    if (input[key]?.trim() && !names[key])
      throw new Error(
        "Enter a name of up to 80 characters, or leave it blank.",
      );
  }
  if (
    names.speaker1 &&
    names.speaker2 &&
    names.speaker1.localeCompare(names.speaker2, undefined, {
      sensitivity: "accent",
    }) === 0
  )
    throw new Error(
      "Use different names so the two speakers can be distinguished.",
    );
  return names;
}

export const transcriptFingerprint = (transcript: string) =>
  bytesToHex(sha256(utf8ToBytes(transcript)));

// Labels may change after retranscription. Version the mapping with a digest
// without retaining a second copy of the private transcript on the device.
export function decodeAssignedSpeakerNames(
  raw: string | null,
  transcript: string,
): TranscriptSpeakerNames {
  try {
    const stored = JSON.parse(raw ?? "null");
    return stored?.transcriptFingerprint === transcriptFingerprint(transcript)
      ? normalizeAssignedSpeakerNames(stored.names)
      : {};
  } catch {
    return {};
  }
}
