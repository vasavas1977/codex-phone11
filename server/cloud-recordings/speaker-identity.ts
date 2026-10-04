import type { VerifiedSpeakerRoleMap } from "../../shared/cloud-recordings";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ChannelRole = "extension" | "remote";

export type VerifiedStereoSpeakerIdentity = {
  schemaVersion: 1;
  verified: true;
  captureChannelUuid: string;
  extensionChannelUuid: string;
  peerChannelUuid: string;
  signalBondUuid: string;
  recordStereoSwap: boolean;
  channels: { left: ChannelRole; right: ChannelRole };
};

function exactUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function channelRole(value: unknown): value is ChannelRole {
  return value === "extension" || value === "remote";
}

/**
 * Validate only durable capture evidence. Direction, caller ID and contacts
 * never manufacture a diarized-speaker identity.
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
    !channelRole(source.channels.left) ||
    !channelRole(source.channels.right)
  )
    return;
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
  if (leftRole === rightRole) return;
  return {
    schemaVersion: 1,
    verified: true,
    speaker1Role: leftRole,
    speaker2Role: rightRole,
  };
}
