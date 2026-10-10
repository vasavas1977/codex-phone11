import { describe, expect, it, vi } from "vitest";

import { createChannelMeetingRepository } from "./channel-meeting-repository";

const input = {
  actorId: 7,
  tenantId: 41,
  channelId: "12345678-1234-4234-8234-123456789012",
  selectedMemberIds: [8, 9],
  requestId: "22345678-1234-4234-8234-123456789012",
  fingerprint: "a".repeat(64),
  meetingId: "32345678-1234-4234-8234-123456789012",
};

function repositoryWith(handler: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>) {
  const query = vi.fn(handler);
  const repository = createChannelMeetingRepository(async (fn) => fn({ query } as never));
  return { repository, query };
}

const lockedRows = (sql: string) => {
  if (sql.includes("FROM tenants") && sql.includes("FOR UPDATE")) return [{ id: input.tenantId }];
  if (sql.includes("FROM phone11_chat_conversations") && sql.includes("FOR UPDATE")) return [{ id: input.channelId }];
  if (sql.includes("FOR UPDATE OF member")) return [{ user_id: 7 }, { user_id: 8 }, { user_id: 9 }];
  if (sql.includes("FOR UPDATE OF membership")) return [{ user_id: 7 }, { user_id: 8 }, { user_id: 9 }];
  if (sql.includes("FOR UPDATE OF identity")) return [{ user_id: 7 }, { user_id: 8 }, { user_id: 9 }];
  if (sql.includes("FOR UPDATE OF assignment")) return [
    { user_id: 7, extension_id: 107 }, { user_id: 8, extension_id: 108 }, { user_id: 9, extension_id: 109 },
  ];
  if (sql.includes("FROM extensions") && sql.includes("FOR UPDATE")) return [{ id: 107 }, { id: 108 }, { id: 109 }];
  return undefined;
};

describe("channel meeting repository", () => {
  it("creates one open room for the host and selected active members, with selected-only inbox rows", async () => {
    const { repository, query } = repositoryWith(async (sql) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ available: true }] };
      if (sql.includes("FROM phone11_channel_meetings WHERE")) return { rows: [] };
      const locked = lockedRows(sql); if (locked) return { rows: locked };
      if (sql.includes("SELECT member.user_id") && sql.includes("conversation.kind")) return { rows: [{ user_id: 7 }] };
      if (sql.includes("member.user_id=ANY")) return { rows: [{ user_id: 8 }, { user_id: 9 }] };
      return { rows: [] };
    });
    await expect(repository.start(input)).resolves.toEqual({
      meetingId: input.meetingId, channelId: input.channelId, invitedMemberIds: [8, 9], replayed: false,
    });
    const statements = query.mock.calls.map(([sql]) => sql as string);
    expect(statements.filter((sql) => sql.includes("INSERT INTO phone11_plain_video_admission_members"))).toHaveLength(3);
    expect(statements.filter((sql) => sql.includes("INSERT INTO phone11_channel_meeting_invitations"))).toHaveLength(2);
    expect(statements.join("\n")).not.toContain("access_token");
  });

  it("takes tenant, channel, member, membership, identity and extension locks in that order", async () => {
    const { repository, query } = repositoryWith(async (sql) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ available: true }] };
      const locked = lockedRows(sql); if (locked) return { rows: locked };
      if (sql.includes("SELECT member.user_id") && sql.includes("conversation.kind")) return { rows: [{ user_id: 7 }] };
      if (sql.includes("FROM phone11_channel_meetings WHERE")) return { rows: [] };
      if (sql.includes("member.user_id=ANY")) return { rows: [{ user_id: 8 }, { user_id: 9 }] };
      return { rows: [] };
    });
    await repository.start(input);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    const lockAt = (fragment: string) => statements.findIndex((sql) => sql.includes(fragment));
    const ordered = [
      lockAt("FROM tenants\n          WHERE id=$1 AND status='active' FOR UPDATE"),
      lockAt("FROM phone11_chat_conversations\n          WHERE tenant_id=$1 AND id=$2"),
      lockAt("FROM phone11_chat_members member\n          WHERE member.tenant_id=$1"),
      lockAt("FROM tenant_memberships membership\n          WHERE membership.tenant_id=$1"),
      lockAt("FROM phone11_auth_identity identity\n          WHERE identity.legacy_user_id=ANY"),
      lockAt("FROM user_extensions assignment\n          JOIN extensions extension"),
      lockAt("FROM extensions\n          WHERE id=ANY($1::integer[])"),
    ];
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(statements[ordered[0]]).toContain("FOR UPDATE");
    expect(statements[ordered[1]]).toContain("FOR UPDATE");
  });

  it("returns the same meeting for an exact replay and conflicts on changed payload", async () => {
    const exact = repositoryWith(async (sql) => sql.includes("information_schema.columns")
      ? { rows: [{ available: true }] }
      : lockedRows(sql)
        ? { rows: lockedRows(sql)! }
      : sql.includes("SELECT member.user_id") && sql.includes("conversation.kind")
        ? { rows: [{ user_id: 7 }] }
      : sql.includes("FROM phone11_channel_meetings WHERE")
        ? { rows: [{ meeting_id: input.meetingId, channel_id: input.channelId, selection_fingerprint: input.fingerprint }] }
        : { rows: [] });
    await expect(exact.repository.start(input)).resolves.toMatchObject({ meetingId: input.meetingId, replayed: true });
    expect(exact.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO phone11_plain_video_admission_rooms"))).toBe(false);

    const conflict = repositoryWith(async (sql) => sql.includes("information_schema.columns")
      ? { rows: [{ available: true }] }
      : lockedRows(sql)
        ? { rows: lockedRows(sql)! }
      : sql.includes("SELECT member.user_id") && sql.includes("conversation.kind")
        ? { rows: [{ user_id: 7 }] }
      : sql.includes("FROM phone11_channel_meetings WHERE")
        ? { rows: [{ meeting_id: input.meetingId, channel_id: input.channelId, selection_fingerprint: "b".repeat(64) }] }
        : { rows: [] });
    await expect(conflict.repository.start(input)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("denies unauthorized actors and stale or cross-tenant selections before any room write", async () => {
    for (const actorRows of [[], [{ user_id: 7 }]]) {
      const { repository, query } = repositoryWith(async (sql) => {
        if (sql.includes("information_schema.columns")) return { rows: [{ available: true }] };
        if (sql.includes("FROM phone11_channel_meetings WHERE")) return { rows: [] };
        const locked = lockedRows(sql); if (locked) return { rows: locked };
        if (sql.includes("SELECT member.user_id") && sql.includes("conversation.kind")) return { rows: actorRows };
        if (sql.includes("member.user_id=ANY")) return { rows: [{ user_id: 8 }] };
        return { rows: [] };
      });
      await expect(repository.start(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO phone11_plain_video_admission_rooms"))).toBe(false);
    }
  });
});
