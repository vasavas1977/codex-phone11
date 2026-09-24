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
      .mockResolvedValueOnce({ rows: [{ id: 41 }] })
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [{ channel_id: "22345678-1234-4234-8234-123456789012" }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, extension_id: 107 }] })
      .mockResolvedValueOnce({ rows: [{ id: 107 }] });
    await expect(channelMeetingOriginAllows({ query } as never, grant, true)).resolves.toBe(true);
    expect(query.mock.calls[0][0]).toContain("FROM tenants");
    expect(query.mock.calls[0][0]).toContain("FOR SHARE");
    expect(query.mock.calls[3][0]).toContain("member.conversation_id=$2");
    expect(query.mock.calls[3][0]).toContain("FOR KEY SHARE OF member");
    expect(query.mock.calls[4][0]).toContain("FROM user_extensions");
    expect(query.mock.calls[4][0]).toContain("FOR SHARE");
    expect(query.mock.calls[5][0]).toContain("FROM extensions");
    expect(query.mock.calls[5][0]).toContain("FOR SHARE");
  });

  it("denies an expired origin or a removed member", async () => {
    const expired = vi.fn()
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] });
    await expect(channelMeetingOriginAllows({ query: expired } as never, grant)).resolves.toBe(false);

    const removed = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 41 }] })
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [{ channel_id: "22345678-1234-4234-8234-123456789012" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(channelMeetingOriginAllows({ query: removed } as never, grant, true)).resolves.toBe(false);
  });

  it("does not lock a member or query admission after an inactive tenant", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(channelMeetingOriginAllows({ query } as never, grant, true)).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("FROM tenants");
  });

  it("allows two invitees in one tenant to pass the compatible tenant lock concurrently", async () => {
    let waiting = 0;
    let release!: () => void;
    const bothAtTenant = new Promise<void>((resolve) => { release = resolve; });
    const makeQuery = (userId: number) => vi.fn(async (sql: string) => {
      if (sql.includes("FROM tenants") && sql.includes("FOR SHARE")) {
        waiting += 1;
        if (waiting === 2) release();
        await bothAtTenant;
        return { rows: [{ id: grant.tenantId }] };
      }
      if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
      if (sql.includes("FROM phone11_channel_meetings")) return { rows: [{ channel_id: "22345678-1234-4234-8234-123456789012" }] };
      if (sql.includes("FOR KEY SHARE OF member")) return { rows: [{ user_id: userId }] };
      if (sql.includes("FROM user_extensions")) return { rows: [{ id: userId, extension_id: userId + 100 }] };
      if (sql.includes("FROM extensions")) return { rows: [{ id: userId + 100 }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const first = makeQuery(7);
    const second = makeQuery(8);
    await expect(Promise.all([
      channelMeetingOriginAllows({ query: first } as never, grant, true),
      channelMeetingOriginAllows({ query: second } as never, { ...grant, userId: 8 }, true),
    ])).resolves.toEqual([true, true]);
    expect(waiting).toBe(2);
    expect(first.mock.calls[0][0]).toContain("FOR SHARE");
    expect(second.mock.calls[0][0]).toContain("FOR SHARE");
  });
});
