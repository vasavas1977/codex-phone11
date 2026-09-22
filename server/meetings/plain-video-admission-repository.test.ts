import { describe, expect, it, vi } from "vitest";

import { createPlainVideoAdmissionRepository } from "./plain-video-admission-repository";

const meetingId = "12345678-1234-4234-8234-123456789012";

describe("plain-video admitted meeting discovery", () => {
  it("keeps duplicate active identity rows from making Meet visible", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = createPlainVideoAdmissionRepository();

    await expect(
      repository.hasAvailablePlainVideoAdmission({ query }, 7, [41]),
    ).resolves.toBe(false);

    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("WITH candidates AS");
    expect(sql).toContain("HAVING count(*) = 1");
    expect(sql).toContain("LIMIT 10");
    expect(sql).toContain("r.tenant_id = ANY($2::integer[])");
    expect(values).toEqual([7, [41], null]);
  });

  it("lists only the caller's exact, uniquely admitted records in configured tenants", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ meeting_id: meetingId, tenant_id: 41, user_id: 7 }],
    });
    const repository = createPlainVideoAdmissionRepository();

    await expect(
      repository.listAvailablePlainVideoMeetings({ query }, 7, [41]),
    ).resolves.toEqual([{ meetingId, tenantId: 41, userId: 7 }]);

    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("HAVING count(*) = 1");
    expect(sql).toContain("LIMIT 10");
    expect(values).toEqual([7, [41], null]);
  });

  it("keeps capability discovery true for one compatible legacy admission", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ meeting_id: meetingId, tenant_id: 41, user_id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ available: false }] });
    const repository = createPlainVideoAdmissionRepository();
    await expect(repository.hasAvailablePlainVideoAdmission({ query }, 7, [41])).resolves.toBe(true);
    expect(query.mock.calls[0][0]).toContain("SELECT meeting_id, tenant_id, user_id FROM candidates");
  });

  it("drops malformed, cross-tenant, and cross-user discovery rows", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { meeting_id: meetingId, tenant_id: 99, user_id: 7 },
        { meeting_id: meetingId, tenant_id: 41, user_id: 8 },
        { meeting_id: "not-a-uuid", tenant_id: 41, user_id: 7 },
      ],
    });
    const repository = createPlainVideoAdmissionRepository();
    await expect(
      repository.listAvailablePlainVideoMeetings({ query }, 7, [41]),
    ).resolves.toEqual([]);
  });

  it("paginates past ten expired channel rooms to find a valid admission", async () => {
    const expired = Array.from({ length: 10 }, (_, index) => ({
      meeting_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      tenant_id: 41,
      user_id: 7,
    }));
    const valid = { meeting_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", tenant_id: 41, user_id: 7 };
    let pages = 0, supportChecks = 0;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("WITH candidates AS")) return { rows: pages++ === 0 ? expired : [valid] };
      if (sql.includes("to_regclass")) return { rows: [{ available: supportChecks++ < 10 }] };
      if (sql.includes("SELECT channel_id")) return { rows: [] };
      if (sql.includes("SELECT 1 FROM phone11_channel_meetings")) return { rows: [{ exists: 1 }] };
      return { rows: [] };
    });
    const repository = createPlainVideoAdmissionRepository();
    await expect(repository.hasAvailablePlainVideoAdmission({ query } as never, 7, [41])).resolves.toBe(true);
    const pageCalls = query.mock.calls.filter(([sql]) => sql.includes("WITH candidates AS"));
    expect(pageCalls).toHaveLength(2);
    expect((pageCalls[1] as unknown as [string, unknown[]])[1]).toEqual([7, [41], expired[9].meeting_id]);
  });
});
