import { describe, expect, it, vi } from "vitest";

import type { PlainVideoAdmissionLease } from "./plain-video-admission-lease-repository";
import {
  createPlainVideoAdmissionResolver,
  PlainVideoAdmissionUnavailableError,
} from "./plain-video-admission-resolver";

const grant = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 41,
  userId: 7,
};

const lease: PlainVideoAdmissionLease = {
  meeting_id: grant.meetingId,
  tenant_id: grant.tenantId,
  user_id: grant.userId,
  participant_id: "participant_41_7",
  grant_profile: "interactive",
  room_revision: "22345678-1234-4234-8234-123456789012",
  member_revision: "32345678-1234-4234-8234-123456789012",
  leaseId: "42345678-1234-4234-8234-123456789012",
  expiresAt: new Date("2026-09-19T00:05:00.000Z"),
};

describe("plain-video admission resolver", () => {
  it("prepares and confirms one server-owned durable lease", async () => {
    const repository = {
      begin: vi.fn().mockResolvedValue(lease),
      confirm: vi.fn().mockResolvedValue(lease),
    };
    const resolver = createPlainVideoAdmissionResolver(vi.fn(), repository);

    await expect(resolver.prepare(grant)).resolves.toEqual({
      admission: {
        meetingId: grant.meetingId,
        participantId: "participant_41_7",
        grantProfile: "interactive",
      },
      lease,
    });
    await expect(resolver.confirm(lease)).resolves.toEqual({
      meetingId: grant.meetingId,
      participantId: "participant_41_7",
      grantProfile: "interactive",
    });
    expect(repository.begin).toHaveBeenCalledWith(grant);
    expect(repository.confirm).toHaveBeenCalledWith(lease);
  });

  it("fails closed before any lease access for an invalid grant", async () => {
    const repository = { begin: vi.fn(), confirm: vi.fn() };
    const resolver = createPlainVideoAdmissionResolver(vi.fn(), repository);
    await expect(resolver.prepare({ ...grant, meetingId: "client-room" }))
      .rejects.toBeInstanceOf(PlainVideoAdmissionUnavailableError);
    await expect(resolver.prepare({ ...grant, tenantId: 0 }))
      .rejects.toBeInstanceOf(PlainVideoAdmissionUnavailableError);
    expect(repository.begin).not.toHaveBeenCalled();
  });

  it("never turns a missing, malformed, or changed durable lease into admission", async () => {
    for (const result of [
      null,
      { ...lease, grant_profile: "host" },
      { ...lease, participant_id: "display name" },
      { ...lease, tenant_id: 99 },
    ]) {
      const repository = {
        begin: vi.fn().mockResolvedValue(result),
        confirm: vi.fn().mockResolvedValue(result),
      };
      const resolver = createPlainVideoAdmissionResolver(vi.fn(), repository as never);
      await expect(resolver.prepare(grant)).rejects.toBeInstanceOf(PlainVideoAdmissionUnavailableError);
      await expect(resolver.confirm(lease)).rejects.toBeInstanceOf(PlainVideoAdmissionUnavailableError);
    }
  });
});
