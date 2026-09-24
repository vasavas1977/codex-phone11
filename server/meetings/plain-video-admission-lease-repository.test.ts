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
  it("reads a label only through the active tenant directory after admission", async () => {
    let revoked = false;
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("FROM tenants") && sql.includes("FOR SHARE")) return { rows: [{ id: 41 }] };
      if (sql.includes("to_regclass")) return { rows: [{ available: false }] };
      if (sql.includes("INSERT INTO phone11_plain_video_admission_leases")) return { rows: [row] };
      if (sql.includes("SELECT u.name FROM users")) return { rows: revoked ? [] : [{ name: "Test Member" }] };
      return { rows: [] };
    });
    const repository = createPlainVideoAdmissionLeaseRepository(async (fn) => fn({ query } as never));
    expect(await repository.begin(grant)).not.toHaveProperty("displayName");
    expect((await repository.begin(grant, true))?.displayName).toBe("Test Member");
    const directory = query.mock.calls.find(([sql]) => sql.includes("SELECT u.name FROM users"))!;
    expect(directory[1]).toEqual([41, 7]);
    expect(directory[0]).toContain("tm.status = 'active'");
    expect(directory[0]).toContain("t.status = 'active'");
    expect(directory[0]).toContain("ai.disabled_at IS NULL");
    expect(directory[0]).toContain("e.status = 'active' AND e.deleted_at IS NULL");
    revoked = true;
    expect(await repository.begin(grant, true)).not.toHaveProperty("displayName");
  });
  it("persists a pending snapshot only from active server-owned admission state", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("FROM tenants") && sql.includes("FOR SHARE")) return { rows: [{ id: 41 }] };
      if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
      if (sql.includes("FROM phone11_channel_meetings")) return { rows: [{ channel_id: "52345678-1234-4234-8234-123456789012" }] };
      if (sql.includes("FOR KEY SHARE OF member")) return { rows: [{ user_id: 7 }] };
      if (sql.includes("FROM user_extensions")) return { rows: [{ id: 1, extension_id: 107 }] };
      if (sql.includes("FROM extensions")) return { rows: [{ id: 107 }] };
      return { rows: [row] };
    });
    const repository = createPlainVideoAdmissionLeaseRepository(async (fn) => fn({ query } as never));

    await expect(repository.begin(grant)).resolves.toMatchObject({
      leaseId: row.lease_id,
      room_revision: row.room_revision,
      member_revision: row.member_revision,
    });
    const [sql, values] = query.mock.calls.find(([statement]) =>
      statement.includes("INSERT INTO phone11_plain_video_admission_leases"))!;
    const statements = query.mock.calls.map(([statement]) => statement as string);
    const tenantLock = statements.findIndex((statement) => statement.includes("FROM tenants") && statement.includes("FOR SHARE"));
    const memberLock = statements.findIndex((statement) => statement.includes("FOR KEY SHARE OF member"));
    const assignmentLock = statements.findIndex((statement) => statement.includes("FROM user_extensions") && statement.includes("FOR SHARE"));
    const extensionLock = statements.findIndex((statement) => statement.includes("FROM extensions") && statement.includes("FOR SHARE"));
    const leaseWrite = statements.findIndex((statement) => statement.includes("INSERT INTO phone11_plain_video_admission_leases"));
    expect(tenantLock).toBe(0);
    expect(tenantLock).toBeLessThan(memberLock);
    expect(memberLock).toBeLessThan(leaseWrite);
    expect(memberLock).toBeLessThan(assignmentLock);
    expect(assignmentLock).toBeLessThan(extensionLock);
    expect(extensionLock).toBeLessThan(leaseWrite);
    expect(sql).toContain("INSERT INTO phone11_plain_video_admission_leases");
    expect(sql).toContain("'pending'");
    expect(sql).toContain("clock_timestamp() + INTERVAL '5 minutes'");
    expect(sql).toContain("FOR UPDATE OF r, m, ai, tm");
    expect(sql).toContain("FOR SHARE OF t");
    expect(sql).toContain("m.revoked_at IS NULL");
    expect(values?.slice(0, 3)).toEqual([grant.meetingId, grant.tenantId, grant.userId]);
  });

  it("does not complete a token issuance after membership or room revision changed", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM tenants") && sql.includes("FOR SHARE")) return { rows: [{ id: 41 }] };
      if (sql.includes("to_regclass")) return { rows: [{ available: false }] };
      if (sql.includes("INSERT INTO phone11_plain_video_admission_leases")) return { rows: [row] };
      // The confirm statement sees no current row when revocation, lobby,
      // identity, membership, room state, or either durable revision changed.
      return { rows: [] };
    });
    const repository = createPlainVideoAdmissionLeaseRepository(async (fn) => fn({ query } as never));
    const lease = await repository.begin(grant);
    expect(lease).not.toBeNull();
    await expect(repository.confirm(lease!)).resolves.toBeNull();
    const call = query.mock.calls.find(([statement]) =>
      statement.includes("WITH current_admission"))!;
    const sql = call[0];
    const values = (call as unknown as [string, unknown[]])[1];
    expect(sql).toContain("l.state = 'pending'");
    expect(sql).toContain("l.room_revision = $6 AND l.member_revision = $7");
    expect(sql).toContain("r.revision = $6 AND m.revision = $7");
    expect(sql).toContain("FOR UPDATE OF l, r, m, ai, tm");
    expect(sql).toContain("FOR SHARE OF t");
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
    const statements = query.mock.calls.map(([statement]) => statement as string);
    const confirmStart = statements.findIndex((statement) => statement.includes("WITH current_admission"));
    const beginWrite = statements.findIndex((statement) => statement.includes("INSERT INTO phone11_plain_video_admission_leases"));
    const precedingTenantLock = statements.findIndex((statement, index) => index > beginWrite
      && statement.includes("FROM tenants") && statement.includes("FOR SHARE"));
    expect(precedingTenantLock).toBeGreaterThan(beginWrite);
    expect(precedingTenantLock).toBeLessThan(confirmStart);
  });

  it("uses a short write transaction and rolls it back on a failed lease operation", async () => {
    const query = vi.fn();
    const release = vi.fn();
    const transaction = createPlainVideoPostgresIssuanceTransaction({
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never);
    await expect(transaction(async () => "ok")).resolves.toBe("ok");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN", "SET LOCAL statement_timeout = '3s'", "SET LOCAL lock_timeout = '2s'", "COMMIT",
    ]);

    query.mockClear();
    await expect(transaction(async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN", "SET LOCAL statement_timeout = '3s'", "SET LOCAL lock_timeout = '2s'", "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
