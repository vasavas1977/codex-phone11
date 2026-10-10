import { describe, expect, it, vi } from "vitest";

import { createConnect11MeetingProvider } from "./connect11-provider";
import { createMeetingService } from "./service";

const grant = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 7,
  userId: 8,
};

const trustedAdmission = {
  meetingId: grant.meetingId,
  participantId: "participant_8",
  grantProfile: "interactive",
  listenLanguage: "th",
  consent: {
    accepted: true,
    purpose: "live_interpretation",
    policyVersion: "phone11-conference-consent.v1",
    assertedAt: "2026-09-16T00:00:00.000Z",
  },
};

describe("Connect11 Phone11 provider bridge", () => {
  it("maps only a trusted server admission into the existing media interface", async () => {
    const resolve = vi.fn().mockResolvedValue(trustedAdmission);
    const admit = vi.fn().mockResolvedValue({ rtc_url: "wss://media.example", access_token: "short-lived" });
    const provider = createConnect11MeetingProvider({ admit }, { resolve });

    await expect(provider.join(grant)).resolves.toEqual({ url: "wss://media.example", token: "short-lived" });
    expect(resolve).toHaveBeenCalledWith(grant);
    expect(admit).toHaveBeenCalledWith(trustedAdmission);
  });

  it("does not construct an admission if the trusted resolver rejects", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error("admission unavailable"));
    const admit = vi.fn();
    const provider = createConnect11MeetingProvider({ admit }, { resolve });

    await expect(provider.join(grant)).rejects.toThrow("admission unavailable");
    expect(admit).not.toHaveBeenCalled();
  });

  it("keeps Connect11 errors behind the service's generic admission error", async () => {
    const provider = createConnect11MeetingProvider(
      { admit: vi.fn().mockRejectedValue(new Error("access_token=private")) },
      { resolve: vi.fn().mockResolvedValue(trustedAdmission) },
    );
    const service = createMeetingService({ authorize: vi.fn().mockResolvedValue(grant) }, provider);

    await expect(service.join(grant.userId, { meetingId: grant.meetingId }))
      .rejects.toThrow("Meeting provider is unavailable");
  });
});
