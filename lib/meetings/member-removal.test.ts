import { describe, expect, it, vi } from "vitest";
import { MeetingMemberRemoval, type HostControlSnapshot, type MemberRemovalApi, type MemberRemovalResult } from "./member-removal";
const meetingId = "12345678-1234-4234-8234-123456789012";
const operationId = "22345678-1234-4234-8234-123456789012";
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const context = { current: true };
  const scope: HostControlSnapshot = { available: true, tenantId: 41, meetingId,
    members: [{ userId: 8, expectedParticipantId: "member_8", expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: "32345678-1234-4234-8234-123456789012", name: "Target", state: "admitted" }] };
  const api = { snapshot: vi.fn(async () => scope),
    request: vi.fn<MemberRemovalApi["request"]>(async (): Promise<MemberRemovalResult> => ({ operationId, expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: operationId, state: "pending", providerAcknowledged: false })),
    poll: vi.fn<MemberRemovalApi["poll"]>(async (): Promise<MemberRemovalResult> => ({ operationId, expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: operationId, state: "completed", providerAcknowledged: true })) };
  const control = new MeetingMemberRemoval(meetingId, 7, () => context.current, api);
  return { context, scope, api, control };
}
describe("meeting access removal lifecycle", () => {
  it("uses the exact server subject and keeps pending distinct from acknowledged removal", async () => {
    const f = fixture(); await f.control.refresh(); await f.control.act(f.control.getSnapshot().members[0], "request");
    expect(f.api.request).toHaveBeenCalledWith({ tenantId: 41, meetingId, targetUserId: 8, expectedParticipantId: "member_8", expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: "32345678-1234-4234-8234-123456789012" });
    expect(f.control.getSnapshot().members[0].state).toBe("pending");
    await f.control.act(f.control.getSnapshot().members[0], "poll"); expect(f.control.getSnapshot().members[0].state).toBe("completed");
  });
  it("explicit uncertain retry retains the same subject and failure never restores admission", async () => {
    const f = fixture(); await f.control.refresh();
    f.api.request.mockResolvedValueOnce({ operationId, expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: operationId, state: "pending", providerAcknowledged: false, providerError: "unavailable" });
    await f.control.act(f.control.getSnapshot().members[0], "request");
    await f.control.act(f.control.getSnapshot().members[0], "request");
    expect(f.api.request.mock.calls[1][0]).toEqual({ ...f.api.request.mock.calls[0][0], expectedMemberRevision: operationId });
    f.api.poll.mockRejectedValueOnce(new Error("private upstream error"));
    await f.control.act(f.control.getSnapshot().members[0], "poll");
    expect(f.control.getSnapshot()).toMatchObject({ available: false, members: [] });
    expect(f.control.getSnapshot().error).not.toContain("private upstream");
    f.api.snapshot.mockResolvedValueOnce({ ...f.scope, members: [{ ...f.scope.members[0], state: "pending" }] });
    await f.control.refresh(); expect(f.control.getSnapshot().members[0].state).toBe("pending");
  });
  it("retained row callbacks cannot target replacement membership after refresh", async () => {
    const f = fixture(); await f.control.refresh(); const old = f.control.getSnapshot().members[0];
    f.api.snapshot.mockResolvedValueOnce({ ...f.scope, members: [{ ...old, expectedParticipantId: "replacement_member_8" }] });
    await f.control.refresh(); await f.control.act(old, "request"); expect(f.api.request).not.toHaveBeenCalled();
    await f.control.act(f.control.getSnapshot().members[0], "request"); expect(f.api.request.mock.calls[0][0].expectedParticipantId).toBe("replacement_member_8");
  });
  it("a same-participant replacement member requires a fresh loaded row and exact fresh member assertion", async () => {
    const f = fixture(); await f.control.refresh(); const retained = f.control.getSnapshot().members[0];
    const replacement = "42345678-1234-4234-8234-123456789012";
    f.api.snapshot.mockResolvedValueOnce({ ...f.scope, members: [{ ...retained, expectedMemberRevision: replacement }] });
    await f.control.refresh(); await f.control.act(retained, "request"); expect(f.api.request).not.toHaveBeenCalled();
    await f.control.act(f.control.getSnapshot().members[0], "request");
    expect(f.api.request.mock.calls[0][0]).toMatchObject({ expectedParticipantId: retained.expectedParticipantId, expectedMemberRevision: replacement });
  });
  it("a refreshed replacement room lifetime cannot inherit controls from the active room session", async () => {
    const f = fixture(); await f.control.refresh(); const retained = f.control.getSnapshot().members[0];
    f.api.snapshot.mockResolvedValueOnce({ ...f.scope, members: [{ ...retained, expectedRoomRevision: "42345678-1234-4234-8234-123456789012" }] });
    await f.control.refresh(); await f.control.act(retained, "request");
    expect(f.control.getSnapshot()).toMatchObject({ available: false, members: [] }); expect(f.api.request).not.toHaveBeenCalled();
  });
  it.each(["account", "same-ID new session", "room", "SIP interruption", "reconnecting", "unmount"])("retires retained request and completion on %s", async reason => {
    const f = fixture(); await f.control.refresh(); const old = f.control.getSnapshot().members[0];
    const pending = deferred<MemberRemovalResult>(); f.api.request.mockReturnValueOnce(pending.promise);
    const action = f.control.act(old, "request");
    if (reason === "unmount") f.control.dispose(); else f.context.current = false;
    pending.resolve({ operationId, expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: operationId, state: "completed", providerAcknowledged: true }); await action;
    expect(f.control.getSnapshot().members[0]?.state).not.toBe("completed");
    await f.control.act(old, "request"); expect(f.api.request).toHaveBeenCalledTimes(1);
  });
  it("a newer snapshot owns loading/busy even if an old action completes later", async () => {
    const f = fixture(); await f.control.refresh(); const pending = deferred<MemberRemovalResult>(); f.api.request.mockReturnValueOnce(pending.promise);
    const action = f.control.act(f.control.getSnapshot().members[0], "request");
    const fresh = deferred<HostControlSnapshot>(); f.api.snapshot.mockReturnValueOnce(fresh.promise); const refresh = f.control.refresh();
    pending.resolve({ operationId, expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: operationId, state: "completed", providerAcknowledged: true }); await action;
    expect(f.control.getSnapshot()).toMatchObject({ loading: true, available: false, members: [] });
    fresh.resolve({ ...f.scope, members: [{ ...f.scope.members[0], state: "pending" }] }); await refresh;
    expect(f.control.getSnapshot().members[0].state).toBe("pending");
  });
  it("suppresses an older load and keeps refreshed unavailability free of cached names", async () => {
    const f = fixture(); const pending = deferred<HostControlSnapshot>(); f.api.snapshot.mockReturnValueOnce(pending.promise);
    const old = f.control.refresh(); f.api.snapshot.mockResolvedValueOnce({ available: false, meetingId, members: [] });
    await f.control.refresh(); pending.resolve(f.scope); await old;
    expect(f.control.getSnapshot()).toMatchObject({ available: false, members: [] });
  });
  it.each([
    { ...fixture().scope, tenantId: 42, meetingId: "32345678-1234-4234-8234-123456789012" },
    { ...fixture().scope, members: [{ userId: 7, expectedParticipantId: "self", expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: "32345678-1234-4234-8234-123456789012", state: "admitted" as const }] },
    { ...fixture().scope, members: [{ userId: 8, expectedParticipantId: "bad/identity", expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: "32345678-1234-4234-8234-123456789012", state: "admitted" as const }] },
  ])("denies malformed/misbound snapshots %#", async scope => {
    const f = fixture(); f.api.snapshot.mockResolvedValueOnce(scope); await f.control.refresh();
    expect(f.control.getSnapshot()).toMatchObject({ available: false, members: [] });
  });
  it("does not accept a malformed completed result and does not issue simultaneous actions", async () => {
    const f = fixture(); await f.control.refresh(); const pending = deferred<MemberRemovalResult>(); f.api.request.mockReturnValueOnce(pending.promise);
    const row = f.control.getSnapshot().members[0], first = f.control.act(row, "request");
    await f.control.act(row, "request"); expect(f.api.request).toHaveBeenCalledTimes(1);
    pending.resolve({ operationId, expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: operationId, state: "completed", providerAcknowledged: false }); await first;
    expect(f.control.getSnapshot()).toMatchObject({ available: false, members: [] });
  });
  it("rejects a later admitted snapshot for an already durably denied exact subject", async () => {
    const f = fixture(); await f.control.refresh(); await f.control.act(f.control.getSnapshot().members[0], "request");
    await f.control.refresh(); expect(f.control.getSnapshot()).toMatchObject({ available: false, members: [] });
    expect(f.control.getSnapshot().error).toBeTruthy();
  });
  it("refuses tenant drift for the same active room even after snapshot refresh", async () => {
    const f = fixture(); await f.control.refresh(); f.api.snapshot.mockResolvedValueOnce({ ...f.scope, tenantId: 42 });
    await f.control.refresh(); expect(f.control.getSnapshot()).toMatchObject({ available: false, members: [] });
  });
});
