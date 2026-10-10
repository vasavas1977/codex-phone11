import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMeetingHostEvictionRepository } from "./meeting-host-eviction-repository";
const meetingId = "12345678-1234-4234-8234-123456789012";
const channelId = "22345678-1234-4234-8234-123456789012";
const originalMember = "32345678-1234-4234-8234-123456789012";
const replacement = "42345678-1234-4234-8234-123456789012";
function fixture() {
  const state = { roomRevision: channelId, memberRevision: originalMember, revoked: false,
    operation: null as Record<string, any> | null, permission: true };
  const record = (userId: number) => ({ meeting_id: meetingId, tenant_id: 41, user_id: userId,
    participant_id: `member_${userId}`, grant_profile: "interactive", room_revision: state.roomRevision,
    member_revision: userId === 8 ? state.memberRevision : originalMember });
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes("to_regclass")) return { rows: [{ available: true, direct_available: true }] };
    if (sql.includes("SELECT tenant_id, channel_id")) return { rows: [{ tenant_id: 41, channel_id: channelId }] };
    if (sql.includes("SELECT channel_id, created_by")) return { rows: [{ channel_id: channelId, created_by: 7, origin_kind: "channel" }] };
    if (sql.includes("SELECT user_id FROM phone11_chat_members")) return { rows: state.permission ? [{ user_id: 7 }] : [] };
    if (sql.includes("SELECT member.user_id")) return { rows: (args[2] as number[]).map(user_id => ({ user_id })) };
    if (sql.includes("LEFT JOIN phone11_plain_video_eviction_operations")) return { rows: [{ ...record(8), name: "Target",
      revoked_at: state.revoked ? new Date() : null, removal_state: state.operation?.state ?? null,
      ...(sql.includes("removal_operation_id") ? { removal_operation_id: state.operation?.id ?? null } : {}), idempotency_key: state.operation?.idempotency_key ?? null }] };
    if (sql.includes("AS meeting_id")) return { rows: [{ ...record(Number(args[2])),
      ...(sql.includes("m.revoked_at AS target_revoked_at") ? { target_revoked_at: state.revoked ? new Date() : null } : {}) }] };
    if (sql.includes("SELECT id FROM tenants")) return { rows: [{ id: 41 }] };
    if (sql.includes("SELECT assignment.id")) return { rows: (args[0] as number[]).map(id => ({ id, user_id: id, extension_id: id + 100 })) };
    if (sql.includes("SELECT id FROM extensions")) return { rows: (args[0] as number[]).map(id => ({ id })) };
    if (sql.includes("FROM phone11_plain_video_eviction_operations")) return { rows: state.operation ? [state.operation] : [] };
    if (sql.includes("UPDATE phone11_plain_video_admission_members")) {
      if (state.revoked) return { rows: [] };
      state.revoked = true; state.memberRevision = String(args[4]); return { rows: [{ meeting_id: meetingId }] };
    }
    if (sql.includes("INSERT INTO phone11_plain_video_eviction_operations")) {
      state.operation = { id: args[0], tenant_id: args[1], meeting_id: args[2], user_id: args[3], participant_id: args[4],
        idempotency_key: args[5], state: "pending", provider_eviction_id: null, revoke_token_ts: null,
        provider_created_at: null, provider_completed_at: null };
      return { rows: [state.operation] };
    }
    return { rows: [] };
  });
  const repository = createMeetingHostEvictionRepository(async fn => fn({ query } as never));
  const load = async () => {
    const snapshot = await repository.snapshot(7, meetingId, [41]);
    const { userId, name: _name, state: _state, ...assertions } = snapshot.members[0];
    return { meetingId, tenantId: snapshot.tenantId!, targetUserId: userId, ...assertions };
  };
  return { state, repository, query, load };
}
describe("exact host-removal admission lifetime", () => {
  it.each(["member", "room"])("a retained snapshot cannot remove a same-participant replacement %s lifetime", async kind => {
    const f = fixture(); const input = await f.load();
    if (kind === "member") f.state.memberRevision = replacement; else f.state.roomRevision = replacement;
    expect(await f.repository.begin(7, input)).toBeNull();
    expect(f.state.revoked).toBe(false); expect(f.state.operation).toBeNull();
  });
  it("uncertain original request and fresh pending assertions reconcile only the same own denial", async () => {
    const f = fixture(); const input = await f.load(); const operation = await f.repository.begin(7, input);
    expect(operation).not.toBeNull(); expect(f.state.memberRevision).toBe(operation!.id);
    expect(await f.repository.begin(7, input)).toEqual(operation);
    expect(await f.repository.get(7, input)).toEqual(operation);
    const fresh = await f.load(); expect(fresh.expectedMemberRevision).toBe(operation!.id);
    expect(await f.repository.get(7, fresh)).toEqual(operation);
    expect(f.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO phone11_plain_video_eviction_operations"))).toHaveLength(1);
  });
  it.each(["unrelated denial", "readmitted", "room replaced", "legacy key", "legacy marker"])("old operations cannot bless %s, even after a fresh snapshot", async kind => {
    const f = fixture(); const input = await f.load(); await f.repository.begin(7, input);
    if (kind === "unrelated denial" || kind === "legacy marker") f.state.memberRevision = replacement;
    if (kind === "readmitted") { f.state.revoked = false; f.state.memberRevision = replacement; }
    if (kind === "room replaced") f.state.roomRevision = replacement;
    if (kind === "legacy key") f.state.operation!.idempotency_key = `phone11_remove_${createHash("sha256")
      .update(JSON.stringify([41, meetingId, "member_8"])).digest("hex")}`;
    expect(await f.repository.begin(7, input)).toBeNull(); expect(await f.repository.get(7, input)).toBeNull();
    expect((await f.repository.snapshot(7, meetingId, [41])).members).toEqual([]);
    const freshAssertions = { ...input, expectedRoomRevision: f.state.roomRevision, expectedMemberRevision: f.state.memberRevision };
    expect(await f.repository.begin(7, freshAssertions)).toBeNull(); expect(await f.repository.get(7, freshAssertions)).toBeNull();
  });
  it("a failed permission recheck also refuses own-denial retry/poll", async () => {
    const f = fixture(); const input = await f.load(); await f.repository.begin(7, input); f.state.permission = false;
    expect(await f.repository.begin(7, input)).toBeNull(); expect(await f.repository.get(7, input)).toBeNull();
  });
});
