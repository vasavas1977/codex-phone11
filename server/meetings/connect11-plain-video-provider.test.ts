import { describe, expect, it, vi } from "vitest";

import type { PlainVideoAdmissionLease } from "./plain-video-admission-lease-repository";
import { createConnect11PlainVideoProvider } from "./connect11-plain-video-provider";
import { createMeetingService } from "./service";

const grant = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 7,
  userId: 8,
};
const admission = {
  meetingId: grant.meetingId,
  participantId: "member_7_8",
  grantProfile: "interactive" as const,
};
const token = {
  contract_version: "phone11-plain-video.v1" as const,
  rtc_url: "wss://media.example",
  access_token: "token",
  expires_at: Math.floor(Date.now() / 1_000) + 300,
};

const lease: PlainVideoAdmissionLease = {
  meeting_id: grant.meetingId,
  tenant_id: grant.tenantId,
  user_id: grant.userId,
  participant_id: admission.participantId,
  grant_profile: admission.grantProfile,
  room_revision: "22345678-1234-4234-8234-123456789012",
  member_revision: "32345678-1234-4234-8234-123456789012",
  leaseId: "42345678-1234-4234-8234-123456789012",
  expiresAt: new Date("2026-09-19T00:05:00.000Z"),
};

describe("Connect11 plain video provider", () => {
  it("passes only a trusted admission to the media facade", async () => {
    const prepare = vi.fn().mockResolvedValue({ admission, lease });
    const confirm = vi.fn().mockResolvedValue(admission);
    const admit = vi.fn().mockResolvedValue(token);
    const provider = createConnect11PlainVideoProvider({ admit }, { prepare, confirm });
    await expect(provider.join(grant)).resolves.toEqual({
      url: "wss://media.example",
      token: "token",
      grant_profile: "interactive",
      contract_version: "phone11-plain-video.v1",
      expires_at: token.expires_at,
    });
    expect(prepare).toHaveBeenCalledWith(grant);
    expect(admit).toHaveBeenCalledWith(admission);
    expect(confirm).toHaveBeenCalledWith(lease);
  });

  it("keeps the four-field token result through the meeting service seam", async () => {
    const provider = createConnect11PlainVideoProvider(
      { admit: vi.fn().mockResolvedValue(token) },
      { prepare: vi.fn().mockResolvedValue({ admission, lease }), confirm: vi.fn().mockResolvedValue(admission) },
    );
    const service = createMeetingService({ authorize: vi.fn().mockResolvedValue(grant) }, provider);

    await expect(service.join(grant.userId, { meetingId: grant.meetingId })).resolves.toEqual({
      url: "wss://media.example",
      token: "token",
      grant_profile: "interactive",
      contract_version: "phone11-plain-video.v1",
      expires_at: token.expires_at,
    });
  });

  it("does not make provider errors available to the Phone11 client", async () => {
    const provider = createConnect11PlainVideoProvider(
      { admit: vi.fn().mockRejectedValue(new Error("access_token=private")) },
      { prepare: vi.fn().mockResolvedValue({ admission, lease }), confirm: vi.fn().mockResolvedValue(admission) },
    );
    const service = createMeetingService({ authorize: vi.fn().mockResolvedValue(grant) }, provider);
    await expect(service.join(grant.userId, { meetingId: grant.meetingId })).rejects.toThrow(
      "Meeting provider is unavailable",
    );
  });

  it("rejects unsafe or stale provider grants before returning them to the client", async () => {
    for (const invalid of [
      { ...token, rtc_url: "https://media.example" },
      { ...token, expires_at: Math.floor(Date.now() / 1_000) - 1 },
      { ...token, expires_at: Math.floor(Date.now() / 1_000) + 3_600 },
    ]) {
      const service = createMeetingService(
        { authorize: vi.fn().mockResolvedValue(grant) },
        createConnect11PlainVideoProvider(
          { admit: vi.fn().mockResolvedValue(invalid) },
          { prepare: vi.fn().mockResolvedValue({ admission, lease }), confirm: vi.fn().mockResolvedValue(admission) },
        ),
      );
      await expect(service.join(grant.userId, { meetingId: grant.meetingId }))
        .rejects.toThrow("Meeting provider is unavailable");
    }
  });

  it("discards a mint when the durable member changed during the facade request", async () => {
    const admit = vi.fn().mockResolvedValue(token);
    const confirm = vi.fn().mockRejectedValue(new Error("member revoked"));
    const provider = createConnect11PlainVideoProvider(
      { admit },
      { prepare: vi.fn().mockResolvedValue({ admission, lease }), confirm },
    );
    await expect(provider.join(grant)).rejects.toThrow("member revoked");
    expect(admit).toHaveBeenCalledWith(admission);
    expect(confirm).toHaveBeenCalledWith(lease);
  });
});
