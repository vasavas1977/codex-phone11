import { describe, expect, it, vi } from "vitest";
import {
  createMeetingAdmissionResolver,
  MeetingAdmissionUnavailableError,
} from "./admission-resolver";
import { createMeetingAdmissionRepository, createPostgresReadOnlyTransaction } from "./admission-repository";

const grant = { meetingId: "12345678-1234-4234-8234-123456789012", tenantId: 41, userId: 7 };
const row = {
  meeting_id: grant.meetingId, tenant_id: 41, user_id: 7, participant_id: "phone11:41:7",
  role: "member", grant_profile: "interactive", listen_language: "th",
  room_revision: "22345678-1234-4234-8234-123456789012",
  member_revision: "32345678-1234-4234-8234-123456789012",
  consent_policy_version: "phone11-conference-consent.v1",
  recording_announcement_version: "recording-announcement.v1",
  accepted_at: new Date("2026-09-16T00:00:00.000Z"),
  announcement_acknowledged_at: new Date("2026-09-16T00:00:01.000Z"),
};

describe("meeting admission resolver", () => {
  it("builds Connect11 admission solely from fresh server-owned membership and consent", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const transaction = vi.fn(async (fn) => fn({ query }));
    const resolver = createMeetingAdmissionResolver(transaction, createMeetingAdmissionRepository(), () => new Date("2026-09-16T00:05:00.000Z"));

    await expect(resolver.resolve(grant)).resolves.toEqual({
      meetingId: grant.meetingId, participantId: "phone11:41:7", grantProfile: "interactive", listenLanguage: "th",
      consent: { accepted: true, purpose: "live_interpretation", policyVersion: "phone11-conference-consent.v1", assertedAt: "2026-09-16T00:05:00.000Z" },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([grant.meetingId, grant.tenantId, grant.userId]);
    expect(query.mock.calls[0][0]).toContain("m.revoked_at IS NULL");
    expect(query.mock.calls[0][0]).toContain("m.lobby_state = 'admitted'");
    expect(query.mock.calls[0][0]).toContain("c.announcement_version = r.recording_announcement_version");
  });

  it("fails closed before a database read for malformed grants", async () => {
    const transaction = vi.fn();
    const resolver = createMeetingAdmissionResolver(transaction);
    await expect(resolver.resolve({ ...grant, meetingId: "client-chosen-room" })).rejects.toBeInstanceOf(MeetingAdmissionUnavailableError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("fails closed for revoked, waiting, malformed, or absent durable records", async () => {
    for (const result of [{ rows: [] }, { rows: [{ ...row, grant_profile: "admin" }] }]) {
      const transaction = vi.fn(async (fn) => fn({ query: vi.fn().mockResolvedValue(result) }));
      await expect(createMeetingAdmissionResolver(transaction).resolve(grant)).rejects.toBeInstanceOf(MeetingAdmissionUnavailableError);
    }
  });

  it("uses an explicit PostgreSQL read-only transaction and rolls back failures", async () => {
    const query = vi.fn();
    const release = vi.fn();
    const transaction = createPostgresReadOnlyTransaction({ connect: vi.fn().mockResolvedValue({ query, release }) } as never);
    await expect(transaction(async () => "ok")).resolves.toBe("ok");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN READ ONLY", "SET LOCAL statement_timeout = '3s'", "COMMIT"]);

    query.mockClear();
    await expect(transaction(async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN READ ONLY", "SET LOCAL statement_timeout = '3s'", "ROLLBACK"]);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
