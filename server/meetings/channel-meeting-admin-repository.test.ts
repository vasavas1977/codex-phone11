import { describe, expect, it, vi } from "vitest";

import { createChannelMeetingAdminRepository } from "./channel-meeting-admin-repository";

const channelId = "12345678-1234-4234-8234-123456789012";
const directId = "22345678-1234-4234-8234-123456789012";

function repository(options: { admin?: boolean; adminRevokedAtLock?: boolean; extensionRevokedAtLock?: boolean; tenant?: boolean; installed?: boolean; channel?: boolean; member?: boolean; direct?: boolean } = {}) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith("SET LOCAL")) return { rows: [] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("SELECT id FROM tenants"))
      return { rows: options.tenant === false ? [] : [{ id: 41 }] };
    if (sql.includes("SELECT user_id,role FROM tenant_memberships"))
      return { rows: options.member === false ? [{ user_id: 7, role: "admin" }] : [
        { user_id: 7, role: options.adminRevokedAtLock ? "member" : "admin" }, { user_id: 8, role: "member" },
      ] };
    if (sql.includes("SELECT user_id FROM tenant_memberships"))
      return { rows: options.admin === false ? [] : [{ user_id: 7 }] };
    if (sql.includes("WHERE legacy_user_id=ANY"))
      return { rows: [{ legacy_user_id: 7 }, { legacy_user_id: 8 }] };
    if (sql.includes("SELECT legacy_user_id FROM phone11_auth_identity"))
      return { rows: [{ legacy_user_id: 7 }] };
    if (sql.includes("to_regclass('public.phone11_channel_meetings')"))
      return { rows: [{ available: options.installed !== false }] };
    if (sql.includes("phone11_direct_meeting_block_pair"))
      return { rows: [{ available: options.installed !== false }] };
    if (sql.includes("SELECT id,name,kind FROM phone11_chat_conversations"))
      return { rows: [{ id: channelId, name: "Team", kind: "channel" }] };
    if (sql.includes("SELECT conversation.id,conversation.name,conversation.kind"))
      return { rows: options.direct ? [{ id: directId, name: "Direct message", kind: "direct" }] : [] };
    if (sql.includes("COALESCE(NULLIF(users.name"))
      return { rows: [{ conversation_id: channelId, user_id: 8, name: "Colleague", can_start_meeting: true },
        ...(options.direct ? [{ conversation_id: directId, user_id: 7, name: "Admin", can_start_meeting: false },
          { conversation_id: directId, user_id: 8, name: "Colleague", can_start_meeting: false }] : [])] };
    if (sql.includes("SELECT id FROM phone11_chat_conversations"))
      return { rows: options.channel === false ? [] : [{ id: channelId }] };
    if (sql.includes("SELECT user_id FROM phone11_chat_members"))
      return { rows: options.member === false ? [] : sql.includes("LIMIT 3")
        ? [{ user_id: 7 }, { user_id: 8 }] : [{ user_id: 8 }] };
    if (sql.includes("SELECT assignment.user_id FROM user_extensions"))
      return { rows: options.member === false ? [] : [{ user_id: 8, extension_id: 108 }] };
    if (sql.includes("SELECT assignment.user_id,assignment.extension_id FROM user_extensions"))
      return { rows: options.member === false ? [] : [{ user_id: 8, extension_id: 108 }] };
    if (sql.includes("SELECT id FROM extensions") && sql.includes("FOR SHARE"))
      return { rows: options.member === false || options.extensionRevokedAtLock ? [] : [{ id: 108 }] };
    if (sql.includes("UPDATE phone11_chat_members SET can_start_meeting"))
      return { rows: [{ user_id: values?.[2], can_start_meeting: values?.[3] }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const transaction = vi.fn(async (fn: (db: { query: typeof query }) => Promise<unknown>) => fn({ query }));
  return { api: createChannelMeetingAdminRepository(transaction as never), query };
}

describe("channel meeting administration", () => {
  it("denies non-admin callers before reading channels or writing flags", async () => {
    const { api, query } = repository({ admin: false });
    await expect(api.overview(7, 41, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE phone11_chat_members"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes("SELECT id,name,kind"))).toBe(false);
  });

  it("reports disabled configuration and missing migration without writing", async () => {
    const disabled = repository();
    await expect(disabled.api.overview(7, 41, false)).resolves.toMatchObject({ available: false, channels: [] });
    await expect(disabled.api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, false))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const missing = repository({ installed: false });
    await expect(missing.api.overview(7, 41, true)).resolves.toMatchObject({ available: false, channels: [] });
    await expect(missing.api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(missing.query.mock.calls.some(([sql]) => sql.includes("UPDATE phone11_chat_members"))).toBe(false);
  });

  it("lists only the requested tenant and changes only an eligible channel member", async () => {
    const { api, query } = repository();
    await expect(api.overview(7, 41, true)).resolves.toEqual({ available: true, channels: [{
      id: channelId, name: "Team", kind: "channel", members: [{ userId: 8, name: "Colleague", canStartMeeting: true }],
    }], directConversations: [], directConversationsReason: undefined });
    await expect(api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: false }, true))
      .resolves.toEqual({ channelId, userId: 8, canStartMeeting: false });
    const update = query.mock.calls.find(([sql]) => sql.includes("UPDATE phone11_chat_members"));
    expect(update?.[1]).toEqual([41, channelId, 8, false]);
    expect(query.mock.calls.some(([sql, values]) => sql.includes("FROM phone11_chat_members")
      && sql.includes("tenant_id=$1 AND conversation_id=$2 AND user_id=$3")
      && values?.[0] === 41 && values?.[1] === channelId && values?.[2] === 8)).toBe(true);
  });

  it("lists only exact two-member direct conversations and grants a selected member through the admin gate", async () => {
    const { api, query } = repository({ direct: true });
    await expect(api.overview(7, 41, true)).resolves.toMatchObject({ directConversations: [{
      id: directId, kind: "direct", members: [
        { userId: 7, canStartMeeting: false }, { userId: 8, canStartMeeting: false },
      ],
    }] });
    await expect(api.setHostPermission(7, { tenantId: 41, channelId: directId, userId: 8,
      canStartMeeting: true }, true, "direct")).resolves.toMatchObject({ userId: 8, canStartMeeting: true });
    const directConversation = query.mock.calls.find(([sql]) => sql.includes("AND kind ='direct'"));
    expect(directConversation?.[1]).toEqual([41, directId]);
    expect(query.mock.calls.some(([sql, values]) => sql.includes("UPDATE phone11_chat_members")
      && values?.[1] === directId && values?.[2] === 8)).toBe(true);
  });

  it("prechecks admin access without a row lock, then takes the channel lock before locking authorization rows", async () => {
    const { api, query } = repository();
    await api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true);
    const statements = query.mock.calls.map(([sql]) => sql);
    const tenantChecks = statements.map((sql, index) => sql.includes("SELECT id FROM tenants") ? index : -1).filter((index) => index >= 0);
    const membershipChecks = statements.map((sql, index) => sql.includes("FROM tenant_memberships") ? index : -1).filter((index) => index >= 0);
    const identityChecks = statements.map((sql, index) => sql.includes("SELECT legacy_user_id FROM phone11_auth_identity") ? index : -1).filter((index) => index >= 0);
    const advisory = statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const channel = statements.findIndex((sql) => sql.includes("SELECT id FROM phone11_chat_conversations"));
    const member = statements.findIndex((sql) => sql.includes("SELECT user_id FROM phone11_chat_members"));
    expect(tenantChecks).toHaveLength(2);
    expect(membershipChecks).toHaveLength(2);
    expect(identityChecks).toHaveLength(2);
    expect(statements[tenantChecks[0]]).not.toContain("FOR SHARE");
    expect(statements[membershipChecks[0]]).not.toContain("FOR SHARE");
    expect(statements[identityChecks[0]]).not.toContain("FOR SHARE");
    expect(identityChecks[0]).toBeLessThan(advisory);
    expect(advisory).toBeLessThan(tenantChecks[1]);
    expect(tenantChecks[1]).toBeLessThan(membershipChecks[1]);
    expect(channel).toBeLessThan(member);
    expect(member).toBeLessThan(membershipChecks[1]);
    expect(membershipChecks[1]).toBeLessThan(identityChecks[1]);
    expect(statements[tenantChecks[1]]).toContain("FOR SHARE");
    expect(statements[membershipChecks[1]]).toContain("FOR SHARE");
    expect(statements[identityChecks[1]]).toContain("FOR SHARE");
    expect(query.mock.calls[advisory][1]).toEqual([`phone11-channel-meeting:41:${channelId}`]);
  });

  it("locks the shared tenant before actor rows even when editing two different channels", async () => {
    const first = "12345678-1234-4234-8234-123456789012";
    const second = "22345678-1234-4234-8234-123456789012";
    for (const id of [first, second]) {
      const { api, query } = repository();
      await api.setHostPermission(7, { tenantId: 41, channelId: id, userId: 8, canStartMeeting: true }, true);
    const statements = query.mock.calls.map(([sql]) => sql);
      const advisory = statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
      const tenantLock = statements.findIndex((sql) => sql.includes("SELECT id FROM tenants") && sql.includes("FOR SHARE"));
      const membershipLock = statements.findIndex((sql) => sql.includes("SELECT user_id,role FROM tenant_memberships") && sql.includes("FOR SHARE"));
      const identityLock = statements.findIndex((sql) => sql.includes("WHERE legacy_user_id=ANY") && sql.includes("FOR SHARE"));
      const channelLock = statements.findIndex((sql) => sql.includes("SELECT id FROM phone11_chat_conversations") && sql.includes("FOR SHARE"));
      const memberLock = statements.findIndex((sql) => sql.includes("SELECT user_id FROM phone11_chat_members") && sql.includes("FOR UPDATE"));
      const assignmentLock = statements.findIndex((sql) => sql.includes("SELECT assignment.user_id,assignment.extension_id FROM user_extensions") && sql.includes("FOR SHARE"));
      const extensionLock = statements.findIndex((sql) => sql.includes("SELECT id FROM extensions") && sql.includes("FOR SHARE"));
      expect([advisory, tenantLock, channelLock, memberLock, membershipLock, identityLock, assignmentLock, extensionLock])
        .toEqual([...new Set([advisory, tenantLock, channelLock, memberLock, membershipLock, identityLock, assignmentLock, extensionLock])].sort((a, b) => a - b));
      expect(query.mock.calls[advisory][1]).toEqual([`phone11-channel-meeting:41:${id}`]);
      expect(query.mock.calls[tenantLock][1]).toEqual([41]);
    }
  });

  it("rejects cross-tenant channels and inactive or removed members", async () => {
    const crossTenant = repository({ channel: false });
    await expect(crossTenant.api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const inactive = repository({ member: false });
    await expect(inactive.api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(inactive.query.mock.calls.some(([sql]) => sql.includes("UPDATE phone11_chat_members"))).toBe(false);
  });

  it("rechecks administrator role after the advisory, tenant, channel and member locks", async () => {
    const revoked = repository({ adminRevokedAtLock: true });
    await expect(revoked.api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const statements = revoked.query.mock.calls.map(([sql]) => sql);
    expect(statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("SELECT user_id,role FROM tenant_memberships")));
    expect(statements.some((sql) => sql.includes("UPDATE phone11_chat_members"))).toBe(false);
  });

  it("rejects an extension revoked after assignment selection without changing host permission", async () => {
    const revoked = repository({ extensionRevokedAtLock: true });
    await expect(revoked.api.setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(revoked.query.mock.calls.some(([sql]) => sql.includes("UPDATE phone11_chat_members"))).toBe(false);
  });
});
