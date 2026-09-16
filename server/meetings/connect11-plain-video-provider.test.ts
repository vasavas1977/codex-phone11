import { describe, expect, it, vi } from "vitest";

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

describe("Connect11 plain video provider", () => {
  it("passes only a trusted admission to the media facade", async () => {
    const resolve = vi.fn().mockResolvedValue(admission);
    const admit = vi.fn().mockResolvedValue({ rtc_url: "wss://media.example", access_token: "token" });
    const provider = createConnect11PlainVideoProvider({ admit }, { resolve });
    await expect(provider.join(grant)).resolves.toEqual({ url: "wss://media.example", token: "token" });
    expect(resolve).toHaveBeenCalledWith(grant);
    expect(admit).toHaveBeenCalledWith(admission);
  });

  it("does not make provider errors available to the Phone11 client", async () => {
    const provider = createConnect11PlainVideoProvider(
      { admit: vi.fn().mockRejectedValue(new Error("access_token=private")) },
      { resolve: vi.fn().mockResolvedValue(admission) },
    );
    const service = createMeetingService({ authorize: vi.fn().mockResolvedValue(grant) }, provider);
    await expect(service.join(grant.userId, { meetingId: grant.meetingId })).rejects.toThrow(
      "Meeting provider is unavailable",
    );
  });
});
