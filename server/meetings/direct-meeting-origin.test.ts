import { describe, expect, it, vi } from "vitest";

import { channelMeetingOriginAllows } from "./channel-meeting-origin";

const grant = { meetingId: "12345678-1234-4234-8234-123456789012", tenantId: 41, userId: 8 };
const conversationId = "22345678-1234-4234-8234-123456789012";

function origin(overrides: { blocked?: boolean; members?: number[]; expired?: boolean;
  originKind?: string; createdBy?: number; hostIneligible?: boolean;
  hostMembershipLostAtLock?: boolean; hostIdentityLostAtLock?: boolean;
  hostExtensionLostAtLock?: boolean } = {}) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes("FROM tenants") && sql.includes("FOR SHARE")) return { rows: [{ id: 41 }] };
    if (sql.includes("to_regclass('public.phone11_channel_meetings')"))
      return { rows: [{ available: true, direct_available: true }] };
    if (sql.includes("SELECT channel_id, created_by")) return { rows: overrides.expired ? [] : [{
      channel_id: conversationId, created_by: overrides.createdBy ?? 7,
      origin_kind: overrides.originKind ?? "direct",
    }] };
    if (sql.includes("SELECT 1 FROM phone11_channel_meetings")) return { rows: overrides.expired ? [{ one: 1 }] : [] };
    if (sql.includes("SELECT id FROM phone11_chat_conversations")) return { rows: [{ id: conversationId }] };
    if (sql.includes("SELECT member.user_id FROM phone11_chat_conversations conversation"))
      return { rows: (overrides.members ?? [7, 8]).map(user_id => ({ user_id })) };
    if (sql.includes("FROM phone11_chat_blocks")) return { rows: overrides.blocked ? [{ one: 1 }] : [] };
    if (sql.includes("SELECT member.user_id\n    FROM phone11_chat_members"))
      return { rows: overrides.hostIneligible ? [{ user_id: 8 }] : [{ user_id: 7 }, { user_id: 8 }] };
    if (sql.includes("SELECT user_id FROM tenant_memberships"))
      return { rows: overrides.hostMembershipLostAtLock ? [{ user_id: 8 }] : [{ user_id: 7 }, { user_id: 8 }] };
    if (sql.includes("SELECT legacy_user_id FROM phone11_auth_identity"))
      return { rows: overrides.hostIdentityLostAtLock ? [{ legacy_user_id: 8 }] : [{ legacy_user_id: 7 }, { legacy_user_id: 8 }] };
    if (sql.includes("FROM user_extensions assignment"))
      return { rows: overrides.hostExtensionLostAtLock ? [{ id: 108, user_id: 8, extension_id: 108 }]
        : [{ id: 107, user_id: 7, extension_id: 107 }, { id: 108, user_id: 8, extension_id: 108 }] };
    if (sql.includes("FROM extensions")) return { rows: [{ id: 107 }, { id: 108 }] };
    return { rows: [] };
  });
  return query;
}

describe("direct meeting origin", () => {
  it("keeps exact availability lookups compatible with read-only transactions", async () => {
    const query = origin();
    await expect(channelMeetingOriginAllows({ query } as never, grant)).resolves.toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("FOR SHARE") || sql.includes("FOR UPDATE")
      || sql.includes("pg_advisory_xact_lock"))).toBe(false);
  });

  it("requires both direct participants to be active for invitation availability", async () => {
    const query = origin({ hostIneligible: true });
    await expect(channelMeetingOriginAllows({ query } as never, grant)).resolves.toBe(false);
    expect(query.mock.calls.find(([sql]) => sql.includes("SELECT member.user_id\n    FROM phone11_chat_members"))?.[1])
      .toEqual([41, conversationId, [7, 8]]);
  });

  it.each(["hostMembershipLostAtLock", "hostIdentityLostAtLock", "hostExtensionLostAtLock"] as const)(
    "denies token confirmation when %s", async key => {
      const query = origin({ [key]: true });
      await expect(channelMeetingOriginAllows({ query } as never, grant, true)).resolves.toBe(false);
      expect(query.mock.calls.some(([sql]) => sql.includes("phone11-chat-safety:"))).toBe(false);
    },
  );

  it("checks exact host and recipient membership, pair lock, and no block during token issuance", async () => {
    const query = origin();
    await expect(channelMeetingOriginAllows({ query } as never, grant, true)).resolves.toBe(true);
    const calls = query.mock.calls;
    const pair = calls.find(([, values]) => values?.[0] === "phone11-chat-safety:41:7:8");
    expect(pair?.[0]).toContain("pg_advisory_xact_lock");
    expect(calls.find(([sql]) => sql.includes("SELECT id FROM phone11_chat_conversations"))?.[0])
      .toContain("FOR UPDATE");
    expect(calls.findIndex(([sql]) => sql.includes("SELECT user_id FROM tenant_memberships")))
      .toBeLessThan(calls.findIndex(([, values]) => values?.[0] === "phone11-chat-safety:41:7:8"));
    expect(calls.find(([sql]) => sql.includes("ORDER BY member.user_id LIMIT 3"))?.[0]).toContain("FOR KEY SHARE OF member");
    expect(calls.find(([sql]) => sql.includes("FROM phone11_chat_blocks"))?.[1]).toEqual([41, 7, 8]);
  });

  it("denies a block, changed pair, missing host, wrong origin, or expired source", async () => {
    for (const options of [{ blocked: true }, { members: [8] }, { members: [7, 8, 9] },
      { createdBy: 9 }, { originKind: "other" }, { expired: true }]) {
      const query = origin(options);
      await expect(channelMeetingOriginAllows({ query } as never, grant, true)).resolves.toBe(false);
      if (options.blocked) expect(query.mock.calls.some(([sql]) => sql.includes("FROM user_extensions assignment"))).toBe(true);
    }
  });
});
