import { describe, expect, it, vi } from "vitest";

import {
  createPlainVideoAdmissionLeaseRepository,
  createPlainVideoPostgresIssuanceTransaction,
} from "./plain-video-admission-lease-repository";

const grant = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 41,
  userId: 7,
};
const row = {
  meeting_id: grant.meetingId,
  tenant_id: grant.tenantId,
  user_id: grant.userId,
  participant_id: "participant_41_7",
  grant_profile: "interactive",
  room_revision: "22345678-1234-4234-8234-123456789012",
  member_revision: "32345678-1234-4234-8234-123456789012",
  lease_id: "42345678-1234-4234-8234-123456789012",
  lease_expires_at: new Date("2026-09-19T00:05:00.000Z"),
};

describe("plain-video admission issuance lease", () => {
  it("persists a pending snapshot only from active server-owned admission state", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const repository = createPlainVideoAdmissionLeaseRepository(async (fn) => fn({ query }));

    await expect(repository.begin(grant)).resolves.toMatchObject({
      leaseId: row.lease_id,
      room_revision: row.room_revision,
      member_revision: row.member_revision,
    });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO phone11_plain_video_admission_leases");
    expect(sql).toContain("'pending'");
    expect(sql).toContain("clock_timestamp() + INTERVAL '5 minutes'");
    expect(sql).toContain("FOR UPDATE OF r, t, m, ai, tm");
    expect(sql).toContain("m.revoked_at IS NULL");
    expect(values.slice(0, 3)).toEqual([grant.meetingId, grant.tenantId, grant.userId]);
  });

  it("does not complete a token issuance after membership or room revision changed", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [row] })
      // The confirm statement sees no current row when revocation, lobby,
      // identity, membership, room state, or either durable revision changed.
      .mockResolvedValueOnce({ rows: [] });
    const repository = createPlainVideoAdmissionLeaseRepository(async (fn) => fn({ query }));
    const lease = await repository.begin(grant);
    expect(lease).not.toBeNull();
    await expect(repository.confirm(lease!)).resolves.toBeNull();
    const [sql, values] = query.mock.calls[1];
    expect(sql).toContain("l.state = 'pending'");
    expect(sql).toContain("l.room_revision = $6 AND l.member_revision = $7");
    expect(sql).toContain("r.revision = $6 AND m.revision = $7");
    expect(sql).toContain("FOR UPDATE OF l, r, t, m, ai, tm");
    expect(sql).toContain("SET state = 'issued'");
    expect(values).toEqual([
      row.lease_id,
      grant.meetingId,
      grant.tenantId,
      grant.userId,
      row.participant_id,
      row.room_revision,
      row.member_revision,
    ]);
  });

  it("uses a short write transaction and rolls it back on a failed lease operation", async () => {
    const query = vi.fn();
    const release = vi.fn();
    const transaction = createPlainVideoPostgresIssuanceTransaction({
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never);
    await expect(transaction(async () => "ok")).resolves.toBe("ok");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN", "SET LOCAL statement_timeout = '3s'", "COMMIT",
    ]);

    query.mockClear();
    await expect(transaction(async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN", "SET LOCAL statement_timeout = '3s'", "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
