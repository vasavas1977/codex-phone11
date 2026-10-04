import { describe, expect, it, vi } from "vitest";
import { createMeetingHostEvictionRepository, meetingHostRemovalKey } from "./meeting-host-eviction-repository";
const meetingId = "12345678-1234-4234-8234-123456789012";
const channelId = "22345678-1234-4234-8234-123456789012";
const row = (userId: number) => ({ meeting_id: meetingId, tenant_id: 41, user_id: userId,
  participant_id: `member_${userId}`, grant_profile: "interactive", room_revision: channelId,
  member_revision: "32345678-1234-4234-8234-123456789012" });
function fixture(kind: "channel" | "direct" = "channel") {
  const state = { creator: 7, tenant: 41, permission: true, hostAdmitted: true, blocked: false,
    members: [7, 8], targetIdentity: "member_8", removed: false, operationKey: "", operationId: "32345678-1234-4234-8234-123456789012", operationState: null as string | null,
    onRoster: undefined as (() => Promise<void>) | undefined };
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (/^\s*(UPDATE|INSERT)\b/.test(sql)) throw new Error("unexpected lifecycle write");
    if (sql.includes("to_regclass")) return { rows: [{ available: true, direct_available: true }] };
    if (sql.includes("SELECT tenant_id, channel_id")) return { rows: args[1] === state.creator ? [{ tenant_id: state.tenant, channel_id: channelId }] : [] };
    if (sql.includes("SELECT channel_id, created_by")) return { rows: [{ channel_id: channelId, created_by: state.creator, origin_kind: kind }] };
    if (sql.includes("SELECT user_id FROM phone11_chat_members")) return { rows: state.permission ? [{ user_id: 7 }] : [] };
    if (sql.includes("SELECT member.user_id")) {
      const ids = sql.includes("LIMIT 3") ? state.members : (args[2] as number[]);
      return { rows: ids.filter(id => state.members.includes(id)).map(user_id => ({ user_id })) };
    }
    if (sql.includes("phone11_chat_blocks")) return { rows: state.blocked ? [{ exists: 1 }] : [] };
    if (sql.includes("LEFT JOIN phone11_plain_video_eviction_operations")) {
      await state.onRoster?.();
      return { rows: [{ ...row(8), participant_id: state.targetIdentity, name: "Target Name", revoked_at: state.removed ? new Date() : null,
        removal_state: state.operationState, removal_operation_id: state.operationKey ? state.operationId : null, idempotency_key: state.operationKey || null }] };
    }
    if (sql.includes("AS meeting_id")) {
      const userId = Number(args[2]);
      if (userId === 7 && (!state.hostAdmitted || (sql.includes("AND EXISTS") && !state.permission))) return { rows: [] };
      return { rows: [{ ...row(userId), ...(userId === 8 ? { participant_id: state.targetIdentity } : {}) }] };
    }
    if (sql.includes("SELECT id FROM tenants")) return { rows: [{ id: 41 }] };
    if (sql.includes("SELECT assignment.id")) return { rows: (args[0] as number[]).map(id => ({ id, user_id: id, extension_id: id + 100 })) };
    if (sql.includes("SELECT id FROM extensions")) return { rows: (args[0] as number[]).map(id => ({ id })) };
    if (sql.includes("FROM phone11_plain_video_eviction_operations")) return { rows: [] };
    return { rows: [] };
  });
  const repository = createMeetingHostEvictionRepository(async fn => fn({ query } as never));
  return { state, query, repository };
}
describe("authoritative host membership presentation read", () => {
  it.each(["channel", "direct"] as const)("lists current admitted %s targets without media identity assumptions or writes", async kind => {
    const f = fixture(kind);
    expect(await f.repository.snapshot(7, meetingId, [41])).toEqual({ available: true, tenantId: 41, meetingId,
      members: [{ userId: 8, name: "Target Name", expectedParticipantId: "member_8", expectedRoomRevision: channelId, expectedMemberRevision: "32345678-1234-4234-8234-123456789012", state: "admitted" }] });
    expect(f.query.mock.calls.every(([sql]) => !/^\s*(UPDATE|INSERT)\b/.test(sql))).toBe(true);
  });
  it.each(["not creator", "unmapped tenant", "host permission lost", "host admission revoked", "direct pair blocked"])("returns no names after %s", async scenario => {
    const f = fixture(scenario === "direct pair blocked" ? "direct" : "channel");
    if (scenario === "host permission lost") f.state.permission = false;
    if (scenario === "host admission revoked") f.state.hostAdmitted = false;
    if (scenario === "direct pair blocked") f.state.blocked = true;
    expect(await f.repository.snapshot(scenario === "not creator" ? 9 : 7, meetingId,
      scenario === "unmapped tenant" ? [42] : [41])).toEqual({ available: false, meetingId, members: [] });
  });
  it("rechecks host permission after an asynchronous member load", async () => {
    const f = fixture(); f.state.onRoster = async () => { f.state.permission = false; };
    expect(await f.repository.snapshot(7, meetingId, [41])).toEqual({ available: false, meetingId, members: [] });
  });
  it("rechecks host admission after an asynchronous member load", async () => {
    const f = fixture(); f.state.onRoster = async () => { f.state.hostAdmitted = false; };
    expect(await f.repository.snapshot(7, meetingId, [41])).toEqual({ available: false, meetingId, members: [] });
  });
  it("excludes a target that lost current channel membership during the read", async () => {
    const f = fixture(); f.state.onRoster = async () => { f.state.members = [7]; };
    expect((await f.repository.snapshot(7, meetingId, [41])).members).toEqual([]);
  });
  it.each(["pending", "completed", "failed"])("retains exact locally revoked %s access for reconciliation only", async state => {
    const f = fixture(); f.state.removed = true; f.state.operationState = state;
    f.state.operationKey = meetingHostRemovalKey(41, meetingId, "member_8", channelId);
    expect((await f.repository.snapshot(7, meetingId, [41])).members[0]).toMatchObject({ expectedParticipantId: "member_8", state });
  });
  it("never restores access or exposes reconciliation for an unrelated revoked member", async () => {
    const f = fixture(); f.state.removed = true; f.state.operationState = "pending"; f.state.operationKey = "unrelated_removal_operation";
    expect((await f.repository.snapshot(7, meetingId, [41])).members).toEqual([]);
  });
  it.each(["begin", "get"] as const)("refuses a replacement identity before %s can create/replay a lifecycle write", async mode => {
    const f = fixture(); f.state.targetIdentity = "replacement_member_8";
    expect(await f.repository[mode](7, { meetingId, tenantId: 41, targetUserId: 8, expectedParticipantId: "member_8", expectedRoomRevision: channelId, expectedMemberRevision: "32345678-1234-4234-8234-123456789012" })).toBeNull();
    expect(f.query.mock.calls.every(([sql]) => !/^\s*(UPDATE|INSERT)\b/.test(sql))).toBe(true);
  });
});
