import { describe, expect, it, vi } from "vitest";

import { channelMeetingOriginAllows } from "./channel-meeting-origin";

const grant = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 41,
  userId: 7,
};

describe("channel-origin admission revalidation", () => {
  it("keeps legacy admission compatible when the additive source table is absent", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ available: false }] });
    await expect(channelMeetingOriginAllows({ query } as never, grant)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("requires an unexpired origin and current membership in that exact channel", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [{ channel_id: "22345678-1234-4234-8234-123456789012" }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] });
    await expect(channelMeetingOriginAllows({ query } as never, grant, true)).resolves.toBe(true);
    expect(query.mock.calls[2][0]).toContain("member.conversation_id=$2");
    expect(query.mock.calls[2][0]).toContain("FOR KEY SHARE OF member");
  });

  it("denies an expired origin or a removed member", async () => {
    const expired = vi.fn()
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] });
    await expect(channelMeetingOriginAllows({ query: expired } as never, grant)).resolves.toBe(false);

    const removed = vi.fn()
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [{ channel_id: "22345678-1234-4234-8234-123456789012" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(channelMeetingOriginAllows({ query: removed } as never, grant, true)).resolves.toBe(false);
  });
});
