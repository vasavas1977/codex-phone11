import { describe, expect, it, vi } from "vitest";

import {
  channelMeetingFingerprint,
  createChannelMeetingService,
  startChannelMeetingSchema,
} from "./channel-meeting-service";

const input = {
  tenantId: 41,
  channelId: "12345678-1234-4234-8234-123456789012",
  selectedMemberIds: [9, 8],
  requestId: "22345678-1234-4234-8234-123456789012",
};

describe("channel meeting service", () => {
  it("fails closed outside the configured tenant without repository work", async () => {
    const repository = { canStart: vi.fn(), start: vi.fn(), invitations: vi.fn() };
    const service = createChannelMeetingService(repository, [41]);
    await expect(service.capabilities(7, { tenantId: 99, channelId: input.channelId }))
      .resolves.toEqual({ available: false, canStart: false, maxSelectedMembers: 50 });
    await expect(service.start(7, { ...input, tenantId: 99 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(service.invitations(7, { tenantId: 99 })).toEqual([]);
    expect(repository.canStart).not.toHaveBeenCalled();
    expect(repository.start).not.toHaveBeenCalled();
  });

  it("binds actor, request, channel and canonical selected-member fingerprint", async () => {
    const start = vi.fn().mockImplementation(async (value) => value);
    const service = createChannelMeetingService({ canStart: vi.fn(), start, invitations: vi.fn() }, [41]);
    await service.start(7, input);
    const value = start.mock.calls[0][0];
    expect(value).toMatchObject({ actorId: 7, tenantId: 41, channelId: input.channelId });
    expect(value.fingerprint).toBe(channelMeetingFingerprint(input.channelId, [8, 9]));
    expect(value.meetingId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps the implicit host out of selections and rejects duplicate selection", async () => {
    expect(startChannelMeetingSchema.safeParse({ ...input, selectedMemberIds: [8, 8] }).success).toBe(false);
    const service = createChannelMeetingService({ canStart: vi.fn(), start: vi.fn(), invitations: vi.fn() }, [41]);
    await expect(service.start(7, { ...input, selectedMemberIds: [7] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
