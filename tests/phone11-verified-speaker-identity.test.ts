import { describe, expect, it } from "vitest";
import { parseVerifiedStereoSpeakerIdentity } from "../server/cloud-recordings/speaker-identity";
import { verifiedCallSpeakerNames } from "../lib/cloud-recordings/speaker-names";

const extension = "11111111-1111-4111-8111-111111111111";
const remote = "22222222-2222-4222-8222-222222222222";
const record = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  verified: true,
  captureChannelUuid: extension,
  extensionChannelUuid: extension,
  peerChannelUuid: remote,
  signalBondUuid: remote,
  recordStereoSwap: false,
  channels: { left: "extension", right: "remote" },
  ...overrides,
});

describe("verified stereo speaker identity", () => {
  it("exposes roles only for a complete, anchored channel record", () => {
    expect(parseVerifiedStereoSpeakerIdentity(record(), extension)).toEqual({
      schemaVersion: 1,
      verified: true,
      speaker1Role: "extension",
      speaker2Role: "remote",
    });
  });

  it("honors a durable recorded stereo swap", () => {
    expect(
      parseVerifiedStereoSpeakerIdentity(record({ recordStereoSwap: true })),
    ).toMatchObject({ speaker1Role: "remote", speaker2Role: "extension" });
  });

  it("does not read call direction when determining a verified channel map", () => {
    const outbound = parseVerifiedStereoSpeakerIdentity(
      record({ direction: "outbound" }),
      extension,
    );
    const inbound = parseVerifiedStereoSpeakerIdentity(
      record({ direction: "inbound" }),
      extension,
    );
    expect(outbound).toEqual(inbound);
    expect(
      parseVerifiedStereoSpeakerIdentity({ schemaVersion: 1, verified: true, direction: "outbound" }),
    ).toBeUndefined();
  });

  it.each([
    ["missing bond evidence", { signalBondUuid: undefined }],
    ["wrong expected capture", { captureChannelUuid: remote }],
    ["unanchored extension channel", { extensionChannelUuid: remote }],
    ["self-bonded channel", { peerChannelUuid: extension, signalBondUuid: extension }],
    ["ambiguous stereo roles", { channels: { left: "extension", right: "extension" } }],
    ["unverified capture", { verified: false }],
  ])("fails closed for %s", (_name, overrides) => {
    expect(
      parseVerifiedStereoSpeakerIdentity(record(overrides), extension),
    ).toBeUndefined();
  });

  it("uses device-local names only after the server role map verifies them", () => {
    const roles = parseVerifiedStereoSpeakerIdentity(record(), extension);
    expect(
      verifiedCallSpeakerNames(roles, {
        extensionName: "Vasavas",
        remoteName: "Nathasa",
      }),
    ).toEqual({ speaker1: "Vasavas", speaker2: "Nathasa" });
  });

  it("never uses names with missing, ambiguous, or duplicate identity evidence", () => {
    expect(
      verifiedCallSpeakerNames(undefined, {
        extensionName: "Vasavas",
        remoteName: "Nathasa",
      }),
    ).toEqual({});
    const roles = parseVerifiedStereoSpeakerIdentity(record(), extension)!;
    expect(
      verifiedCallSpeakerNames(roles, {
        extensionName: "Same name",
        remoteName: "same name",
      }),
    ).toEqual({});
  });
});
