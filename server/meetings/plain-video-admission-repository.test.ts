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
    expect(sql).toContain("r.tenant_id = ANY($2::integer[])");
    expect(values).toEqual([7, [41]]);
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
    expect(values).toEqual([7, [41]]);
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
});
