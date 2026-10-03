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

  it("returns a normalized title only after exact-tenant active channel authorization", async () => {
    const channelId = "22345678-1234-4234-8234-123456789012";
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("WITH candidates AS")) return { rows: [{ meeting_id: meetingId, tenant_id: 41, user_id: 7 }] };
      if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
      if (sql.includes("SELECT channel_id")) return { rows: [{ channel_id: channelId }] };
      if (sql.includes("SELECT member.user_id")) return { rows: [{ user_id: 7 }] };
      if (sql.includes("SELECT conversation.name AS title")) return { rows: [{ title: "  e\u0301 สวัสดี  " }] };
      throw new Error(`Unexpected title query: ${sql}`);
    });
    const repository = createPlainVideoAdmissionRepository();
    await expect(repository.listAvailablePlainVideoMeetings({ query } as never, 7, [41]))
      .resolves.toEqual([{ meetingId, tenantId: 41, userId: 7, title: "é สวัสดี" }]);
    const [sql, values] = query.mock.calls.find(([statement]) => statement.includes("SELECT conversation.name AS title"))!;
    expect(values).toEqual([meetingId, 41, 7]);
    for (const predicate of [
      "conversation.tenant_id=source.tenant_id", "conversation.id=source.channel_id",
      "conversation.kind IN ('group','channel')", "member.user_id=$3",
      "membership.status='active'", "identity.disabled_at IS NULL",
      "room.state='open'", "room.ended_at IS NULL", "admission.revoked_at IS NULL",
      "admission.lobby_state='admitted'", "source.meeting_id=$1 AND source.tenant_id=$2",
      "source.expires_at>clock_timestamp()+INTERVAL '5 minutes'",
      "extension.status='active'", "LIMIT 2",
    ]) expect(sql).toContain(predicate);
  });

  it("omits title for legacy rooms, unsafe names, and failed exact-key title rechecks", async () => {
    const repository = createPlainVideoAdmissionRepository();
    for (const caseName of ["legacy", "expired", "revoked", "cross-tenant", "unsafe"] as const) {
      const query = vi.fn(async (sql: string, _values?: unknown[]) => {
        if (sql.includes("WITH candidates AS")) return { rows: [{ meeting_id: meetingId, tenant_id: 41, user_id: 7 }] };
        if (sql.includes("to_regclass")) return { rows: [{ available: caseName !== "legacy" }] };
        if (sql.includes("SELECT channel_id")) return { rows: [{ channel_id: "22345678-1234-4234-8234-123456789012" }] };
        if (sql.includes("SELECT member.user_id")) return { rows: [{ user_id: 7 }] };
        if (sql.includes("SELECT conversation.name AS title")) return { rows: caseName === "unsafe"
          ? [{ title: "Bad\u202eName" }] : [] };
        throw new Error(`Unexpected title query: ${sql}`);
      });
      await expect(repository.listAvailablePlainVideoMeetings({ query } as never, 7, [41]))
        .resolves.toEqual([{ meetingId, tenantId: 41, userId: 7 }]);
      const titleQuery = query.mock.calls.find(([sql]) => sql.includes("SELECT conversation.name AS title"));
      if (caseName === "legacy") expect(titleQuery).toBeUndefined();
      else expect(titleQuery?.[1]).toEqual([meetingId, 41, 7]);
    }
  });

  it("never looks up a title for a denied channel origin or a cross-tenant admission", async () => {
    const repository = createPlainVideoAdmissionRepository();
    for (const caseName of ["expired", "revoked", "cross-tenant"] as const) {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes("WITH candidates AS")) return { rows: [{ meeting_id: meetingId,
          tenant_id: caseName === "cross-tenant" ? 42 : 41, user_id: 7 }] };
        if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
        if (sql.includes("SELECT channel_id")) return { rows: caseName === "expired"
          ? [] : [{ channel_id: "22345678-1234-4234-8234-123456789012" }] };
        if (sql.includes("SELECT 1 FROM phone11_channel_meetings")) return { rows: [{ exists: 1 }] };
        if (sql.includes("SELECT member.user_id")) return { rows: [] };
        throw new Error(`Title lookup after denied origin: ${sql}`);
      });
      await expect(repository.listAvailablePlainVideoMeetings({ query } as never, 7, [41]))
        .resolves.toEqual([]);
      expect(query.mock.calls.some(([sql]) => sql.includes("SELECT conversation.name AS title"))).toBe(false);
    }
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
