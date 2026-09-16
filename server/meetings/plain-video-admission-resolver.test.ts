import { describe, expect, it, vi } from "vitest";

import {
  createPlainVideoAdmissionRepository,
  createPlainVideoMeetingRepository,
  createPlainVideoPostgresReadOnlyTransaction,
} from "./plain-video-admission-repository";
import {
  createPlainVideoAdmissionResolver,
  PlainVideoAdmissionUnavailableError,
} from "./plain-video-admission-resolver";

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
};

describe("plain-video admission resolver", () => {
  it("uses the same durable lifecycle for initial authorization and trusted admission", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const transaction = vi.fn(async (fn) => fn({ query }));
    const repository = createPlainVideoAdmissionRepository();
    const initial = createPlainVideoMeetingRepository(transaction, repository);
    const resolver = createPlainVideoAdmissionResolver(transaction, repository);

    await expect(initial.authorize(grant.userId, grant.meetingId)).resolves.toEqual(grant);
    await expect(resolver.resolve(grant)).resolves.toEqual({
      meetingId: grant.meetingId,
      participantId: "participant_41_7",
      grantProfile: "interactive",
    });
    expect(query.mock.calls[0][1]).toEqual([grant.meetingId, grant.userId]);
    expect(query.mock.calls[1][1]).toEqual([grant.meetingId, grant.tenantId, grant.userId]);
    const sql = query.mock.calls[1][0];
    for (const predicate of [
      "t.status = 'active'",
      "tm.status = 'active'",
      "ai.disabled_at IS NULL",
      "r.state = 'open'",
      "r.ended_at IS NULL",
      "m.revoked_at IS NULL",
      "m.lobby_state = 'admitted'",
    ])
      expect(sql).toContain(predicate);
    expect(sql).not.toContain("consent");
    expect(sql).not.toContain("interpret");
  });

  it("fails closed for an invalid grant before any database access", async () => {
    const transaction = vi.fn();
    const resolver = createPlainVideoAdmissionResolver(transaction);
    await expect(resolver.resolve({ ...grant, meetingId: "client-room" }))
      .rejects.toBeInstanceOf(PlainVideoAdmissionUnavailableError);
    await expect(resolver.resolve({ ...grant, tenantId: 0 }))
      .rejects.toBeInstanceOf(PlainVideoAdmissionUnavailableError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed, untrusted-profile, and scope-mismatched records", async () => {
    for (const result of [
      { rows: [] },
      { rows: [{ ...row, grant_profile: "host" }] },
      { rows: [{ ...row, participant_id: "display name" }] },
      { rows: [{ ...row, tenant_id: 99 }] },
      { rows: [{ ...row, meeting_id: "22345678-1234-4234-8234-123456789012" }] },
      { rows: [{ ...row, user_id: 99 }] },
      { rows: [{ ...row, user_id: Number.MAX_SAFE_INTEGER + 1 }] },
      { rows: [{ ...row }, { ...row }] },
    ]) {
      const transaction = vi.fn(async (fn) => fn({ query: vi.fn().mockResolvedValue(result) }));
      await expect(createPlainVideoAdmissionResolver(transaction).resolve(grant))
        .rejects.toBeInstanceOf(PlainVideoAdmissionUnavailableError);
    }
  });

  it("does not create a grant from a malformed or scope-mismatched initial row", async () => {
    const repository = createPlainVideoAdmissionRepository();
    await expect(repository.authorize(
      { query: vi.fn().mockResolvedValue({ rows: [{ ...row, user_id: 99 }] }) },
      grant.userId,
      grant.meetingId,
    )).resolves.toBeNull();
  });

  it("uses an explicit PostgreSQL read-only transaction and rolls back failures", async () => {
    const query = vi.fn();
    const release = vi.fn();
    const transaction = createPlainVideoPostgresReadOnlyTransaction({
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never);
    await expect(transaction(async () => "ok")).resolves.toBe("ok");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = '3s'",
      "COMMIT",
    ]);

    query.mockClear();
    await expect(transaction(async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = '3s'",
      "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
