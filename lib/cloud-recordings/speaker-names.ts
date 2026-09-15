import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  mergeTranscriptSpeakerNames,
  type TranscriptSpeakerNames,
} from "./transcript";
import type { VerifiedSpeakerRoleMap } from "@/shared/cloud-recordings";

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
 * A contact and the signed-in owner identify the two call participants, but
 * they do not identify Gemini's generic Speaker 1 / Speaker 2 labels. Until
 * the capture pipeline persists a verified channel-role map, returning names
 * here would silently misattribute speech. Keep the generic labels and let a
 * user make an explicit, recording-local correction instead.
 *
 * Kept as a compatibility export while older callers are migrated to a
 * verified mapping supplied by the server.
 */
export function defaultCallSpeakerNames(
  _direction: "inbound" | "outbound",
  _contactName?: string,
  _ownerName?: string,
  _remoteNumber?: string,
): TranscriptSpeakerNames {
  return {};
}

/**
 * Converts already-verified server roles into device-local display names. This
 * function intentionally has no direction argument: a caller/callee relation
 * alone must never decide which diarized label belongs to whom.
 */
export function verifiedCallSpeakerNames(
  roles: VerifiedSpeakerRoleMap | undefined,
  identities: { extensionName?: string; remoteName?: string },
): TranscriptSpeakerNames {
  if (
    !roles ||
    roles.schemaVersion !== 1 ||
    roles.verified !== true ||
    roles.speaker1Role === roles.speaker2Role
  )
    return {};
  const nameFor = (role: "extension" | "remote") =>
    role === "extension" ? identities.extensionName : identities.remoteName;
  const names = normalizeAssignedSpeakerNames({
    speaker1: nameFor(roles.speaker1Role),
    speaker2: nameFor(roles.speaker2Role),
  });
  // Identical local/contact names cannot distinguish the voices. Preserve the
  // generic labels instead of making a false attribution look authoritative.
  if (
    names.speaker1 &&
    names.speaker2 &&
    names.speaker1.localeCompare(names.speaker2, undefined, {
      sensitivity: "accent",
    }) === 0
  )
    return {};
  return names;
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
