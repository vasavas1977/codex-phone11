import { describe, expect, it, vi } from "vitest";

import { createDirectMeetingRepository } from "./direct-meeting-repository";

const input = { actorId: 7, tenantId: 41, conversationId: "12345678-1234-4234-8234-123456789012",
  requestId: "22345678-1234-4234-8234-123456789012",
  meetingId: "32345678-1234-4234-8234-123456789012" };

function harness(overrides: { installed?: boolean; hostGrant?: boolean; members?: number[];
  block?: boolean; replay?: Record<string, unknown>; conversation?: boolean; peerActive?: boolean } = {}) {
  const members = overrides.members ?? [7, 8];
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes("AS available")) return { rows: [{ available: overrides.installed ?? true }] };
    if (sql.includes("FROM tenants WHERE")) return { rows: [{ id: 41 }] };
    if (sql.includes("FROM phone11_chat_conversations")) return { rows: overrides.conversation === false ? [] : [{ id: input.conversationId }] };
    if (sql.includes("SELECT user_id,can_start_meeting FROM phone11_chat_members"))
      return { rows: members.map((id) => ({ user_id: id, can_start_meeting: id === 7 && (overrides.hostGrant ?? true) })) };
    if (sql.includes("FROM phone11_chat_blocks")) return { rows: overrides.block ? [{ one: 1 }] : [] };
    if (sql.includes("FROM tenant_memberships\n")) return { rows: members.map((id) => ({ user_id: id })) };
    if (sql.includes("FROM phone11_auth_identity\n")) return { rows: members.map((id) => ({ user_id: id })) };
    if (sql.includes("FROM user_extensions assignment\n"))
      return { rows: members.filter(id => id !== 8 || (overrides.peerActive ?? true))
        .map(id => ({ user_id: id, extension_id: id + 100 })) };
    if (sql.includes("FROM extensions WHERE"))
      return { rows: members.filter(id => id !== 8 || (overrides.peerActive ?? true)).map(id => ({ id: id + 100 })) };
    if (sql.includes("SELECT meeting_id,channel_id,origin_kind,selection_fingerprint"))
      return { rows: overrides.replay ? [overrides.replay] : [] };
    if (sql.includes("count(*)::integer AS count FROM phone11_channel_meetings")) return { rows: [{ count: 0 }] };
    return { rows: [] };
  });
  return { api: createDirectMeetingRepository(async fn => fn({ query } as never)), query };
}

describe("direct meeting repository", () => {
  it("requires explicit host grant, exact two members, no block, and installed provenance", async () => {
    for (const option of [{ installed: false }, { hostGrant: false }, { members: [7] },
      { members: [7, 8, 9] }, { block: true }, { conversation: false }, { peerActive: false }]) {
      const { api, query } = harness(option);
      await expect(api.start(input)).rejects.toMatchObject({ code: option.installed === false ? "PRECONDITION_FAILED" : "FORBIDDEN" });
      expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO phone11_plain_video_admission_rooms"))).toBe(false);
    }
  });

  it("writes one admitted room for the pair and one recipient-only invitation under the pair lock", async () => {
    const { api, query } = harness();
    await expect(api.start(input)).resolves.toEqual({ meetingId: input.meetingId,
      conversationId: input.conversationId, invitedMemberId: 8, replayed: false });
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter(sql => sql.includes("INSERT INTO phone11_plain_video_admission_members"))).toHaveLength(2);
    expect(statements.filter(sql => sql.includes("INSERT INTO phone11_channel_meeting_invitations"))).toHaveLength(1);
    expect(statements.find(sql => sql.includes("INSERT INTO phone11_channel_meetings"))).toContain("'direct'");
    const pairLock = query.mock.calls.find(([, values]) => Array.isArray(values)
      && String(values[0]).startsWith("phone11-chat-safety:"));
    expect(pairLock?.[1]).toEqual(["phone11-chat-safety:41:7:8"]);
    const pairLockIndex = query.mock.calls.findIndex(([, values]) => Array.isArray(values)
      && String(values[0]).startsWith("phone11-chat-safety:"));
    expect(statements.findIndex(sql => sql.includes("FROM tenant_memberships\n")))
      .toBeLessThan(pairLockIndex);
    expect(statements.findIndex(sql => sql.includes("FROM user_extensions assignment\n")))
      .toBeLessThan(pairLockIndex);
    expect(pairLockIndex).toBeLessThan(statements.findIndex(sql => sql.includes("INSERT INTO phone11_plain_video_admission_rooms")));
    expect(statements.join("\n")).not.toContain("access_token");
  });

  it("recovers an exact request and conflicts when its origin or fingerprint changes", async () => {
    const fresh = harness();
    await fresh.api.start(input);
    const digest = fresh.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO phone11_channel_meetings"))?.[1]?.[5];
    const exact = harness({ replay: { meeting_id: input.meetingId, channel_id: input.conversationId,
      origin_kind: "direct", selection_fingerprint: digest } });
    await expect(exact.api.start(input)).resolves.toMatchObject({ meetingId: input.meetingId, replayed: true });
    expect(exact.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO phone11_plain_video_admission_rooms"))).toBe(false);
    for (const changed of [{ origin_kind: "channel", selection_fingerprint: digest },
      { origin_kind: "direct", selection_fingerprint: "f".repeat(64) }]) {
      const conflict = harness({ replay: { meeting_id: input.meetingId, channel_id: input.conversationId, ...changed } });
      await expect(conflict.api.start(input)).rejects.toMatchObject({ code: "CONFLICT" });
    }
  });

  it("queries only the signed-in recipient in one direct conversation and hides absent migration", async () => {
    const missing = harness({ installed: false });
    await expect(missing.api.invitations(8, 41, input.conversationId)).resolves.toEqual([]);
    const { api, query } = harness();
    await expect(api.invitations(8, 41, input.conversationId)).resolves.toEqual([]);
    const select = query.mock.calls.find(([sql]) => String(sql).includes("invitation.id AS invitation_id"));
    expect(select?.[1]).toEqual([41, 8, input.conversationId]);
    expect(select?.[0]).toContain("invitation.recipient_id=$2");
    expect(select?.[0]).toContain("source.origin_kind='direct'");
    expect(select?.[0]).toContain("phone11_chat_blocks");
    await expect(api.invitations(8, 41)).resolves.toEqual([]);
    const inboxSelect = query.mock.calls.filter(([sql]) => String(sql).includes("invitation.id AS invitation_id")).at(-1);
    expect(inboxSelect?.[1]).toEqual([41, 8, null]);
    expect(inboxSelect?.[0]).toContain("($3::uuid IS NULL OR invitation.channel_id=$3)");
    expect(inboxSelect?.[0]).toContain("admission.revoked_at IS NULL");
    expect(inboxSelect?.[0]).toContain("source.expires_at>clock_timestamp()+INTERVAL '5 minutes'");
  });
});
