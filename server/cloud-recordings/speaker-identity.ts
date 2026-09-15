import type { VerifiedSpeakerRoleMap } from "../../shared/cloud-recordings";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ChannelRole = "extension" | "remote";
type StereoChannel = "left" | "right";

/**
 * This is deliberately narrower than a call record. Call direction, caller ID,
 * contacts, and authenticated user data are useful participant metadata, but
 * do not prove which voice is in a diarized label. A capture collector may
 * persist this record only after it has observed the anchored extension leg,
 * its exact signal-bond peer, and the channel assignment made by RECORD_STEREO.
 */
export type VerifiedStereoSpeakerIdentity = {
  schemaVersion: 1;
  verified: true;
  captureChannelUuid: string;
  extensionChannelUuid: string;
  peerChannelUuid: string;
  signalBondUuid: string;
  recordStereoSwap: boolean;
  channels: Record<StereoChannel, ChannelRole>;
};

function exactUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function channelRole(value: unknown): value is ChannelRole {
  return value === "extension" || value === "remote";
}

/**
 * Validate only durable capture evidence. The extractor must never manufacture
 * this record from direction, dialled number, contact name, or a Gemini label.
 * An invalid or incomplete record is equivalent to no verified identity.
 */
export function parseVerifiedStereoSpeakerIdentity(
  value: unknown,
  expectedCaptureChannelUuid?: string,
): VerifiedSpeakerRoleMap | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const source = value as Partial<VerifiedStereoSpeakerIdentity>;
  if (
    source.schemaVersion !== 1 ||
    source.verified !== true ||
    !exactUuid(source.captureChannelUuid) ||
    !exactUuid(source.extensionChannelUuid) ||
    !exactUuid(source.peerChannelUuid) ||
    !exactUuid(source.signalBondUuid) ||
    typeof source.recordStereoSwap !== "boolean" ||
    !source.channels ||
    typeof source.channels !== "object" ||
    !channelRole(source.channels.left) ||
    !channelRole(source.channels.right)
  )
    return;

  // Phone11 records only from the authenticated extension anchor. This makes
  // the stored channel relationship auditable and prevents an unrelated bridge
  // leg from gaining the extension's identity.
  if (
    source.captureChannelUuid !== source.extensionChannelUuid ||
    (expectedCaptureChannelUuid &&
      source.captureChannelUuid !== expectedCaptureChannelUuid) ||
    source.peerChannelUuid === source.captureChannelUuid ||
    source.signalBondUuid !== source.peerChannelUuid ||
    source.channels.left === source.channels.right
  )
    return;

  const leftRole = source.recordStereoSwap
    ? source.channels.right
    : source.channels.left;
  const rightRole = source.recordStereoSwap
    ? source.channels.left
    : source.channels.right;
  const speaker1Role = leftRole;
  const speaker2Role = rightRole;
  if (speaker1Role === speaker2Role) return;

  return { schemaVersion: 1, verified: true, speaker1Role, speaker2Role };
}
