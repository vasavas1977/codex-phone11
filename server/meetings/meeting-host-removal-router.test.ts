import { describe, expect, it, vi } from "vitest";
import { createMeetingsRouter } from "./router";
import { meetingHostRemovalKey } from "./meeting-host-eviction-repository";

const meetingId = "12345678-1234-4234-8234-123456789012";
const input = { meetingId, tenantId: 41, targetUserId: 8, expectedParticipantId: "stable_member_8", expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: "32345678-1234-4234-8234-123456789012" };
const scope = { available: true, tenantId: 41, meetingId,
  members: [{ userId: 8, expectedParticipantId: input.expectedParticipantId, expectedRoomRevision: input.expectedRoomRevision, expectedMemberRevision: input.expectedMemberRevision, name: "Member Eight", state: "admitted" as const }] };
function fixture() {
  const authority = { host: true, participantId: input.expectedParticipantId };
  let operation = { id: "22345678-1234-4234-8234-123456789012", target: { meetingId, tenantId: 41, userId: 8, participantId: authority.participantId },
    idempotencyKey: meetingHostRemovalKey(41, meetingId, authority.participantId, input.expectedRoomRevision), state: "pending" as "pending" | "completed" | "failed",
    providerEvictionId: null as string | null, revokeTokenTs: null as number | null,
    providerCreatedAt: null as Date | null, providerCompletedAt: null as Date | null };
  const repository = {
    snapshot: vi.fn(async (actorId: number) => actorId === 7 && authority.host ? scope : { available: false, meetingId, members: [] }),
    begin: vi.fn(async (actorId: number, raw: typeof input) => actorId === 7 && authority.host &&
      raw.expectedParticipantId === authority.participantId ? operation : null),
    get: vi.fn(async (actorId: number, raw: typeof input) => actorId === 7 && authority.host &&
      raw.expectedParticipantId === authority.participantId ? operation : null),
    record: vi.fn(async (_operation, observation) => {
      operation = { ...operation, state: observation.state, providerEvictionId: observation.evictionId,
        revokeTokenTs: observation.revokeTokenTs, providerCompletedAt: observation.completedAt };
      return operation;
    }),
  };
  const response = (status: "pending" | "processing" | "completed" | "failed") => ({
    eviction_id: "32345678-1234-4234-8234-123456789012", contract_version: "phone11-plain-video.v1" as const,
    status, revoke_token_ts: 1790000000, created_at: null,
    completed_at: status === "completed" ? "2026-10-04T00:00:00.000Z" : null });
  const client = { requestEviction: vi.fn(async () => response("pending")), evictionStatus: vi.fn(async () => response("completed")) };
  const api = (enabled = true, actorId = 7) => createMeetingsRouter({}, enabled ? {
    hostEviction: { repository, gate: { reviewedEvictionEnabled: true, tenantClients: new Map([[41, client]]) } },
  } : {}).createCaller({ user: { id: actorId }, req: {}, res: {} } as never);
  return { api, authority, client, repository, response };
}
describe("protected default-off host removal RPC composition", () => {
  it("exposes no member names and performs no authority/provider work by default", async () => {
    const f = fixture();
    expect(await f.api(false).hostControls({ meetingId })).toEqual({ available: false, meetingId, members: [] });
    await expect(f.api(false).removeMember(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(f.api(false).removalStatus(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.repository.snapshot).not.toHaveBeenCalled(); expect(f.client.requestEviction).not.toHaveBeenCalled();
  });
  it("returns only the current host's exact server membership snapshot", async () => {
    const f = fixture(); expect(await f.api().hostControls({ meetingId })).toEqual(scope);
    expect(f.repository.snapshot).toHaveBeenCalledWith(7, meetingId, [41]);
    expect(await f.api(true, 9).hostControls({ meetingId })).toEqual({ available: false, meetingId, members: [] });
    expect(f.client.requestEviction).not.toHaveBeenCalled();
  });
  it.each(["request", "poll"])("reauthorizes lost host permission before %s provider access", async mode => {
    const f = fixture(); await f.api().removeMember(input); f.authority.host = false;
    const call = mode === "request" ? f.api().removeMember(input) : f.api().removalStatus(input);
    await expect(call).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.client.requestEviction).toHaveBeenCalledTimes(1); expect(f.client.evictionStatus).not.toHaveBeenCalled();
  });
  it("refuses stale replacement membership assertions on both request and poll", async () => {
    const f = fixture(); f.authority.participantId = "new_membership_8";
    await expect(f.api().removeMember(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.api().removalStatus(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.client.requestEviction).not.toHaveBeenCalled(); expect(f.client.evictionStatus).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, expectedParticipantId: undefined }, { ...input, expectedRoomRevision: undefined },
    { ...input, expectedMemberRevision: undefined }, { ...input, expectedRoomRevision: "bad" }, { ...input, actorId: 7 },
    { ...input, expectedParticipantId: "provider/coordinates" }, { ...input, tenantId: 42 },
    { ...input, targetUserId: 7 },
  ])("denies malformed/override/unmapped/self request %#", async raw => {
    const f = fixture(); await expect(f.api().removeMember(raw as never)).rejects.toBeDefined();
    expect(f.client.requestEviction).not.toHaveBeenCalled();
  });
  it("retains exact uncertain retry and never reports 202/processing as departure", async () => {
    const f = fixture(); f.client.requestEviction.mockRejectedValueOnce(new Error("private upstream detail"));
    expect(await f.api().removeMember(input)).toMatchObject({ state: "pending", providerAcknowledged: false, providerError: "unavailable" });
    f.client.requestEviction.mockResolvedValueOnce(f.response("processing"));
    expect(await f.api().removeMember(input)).toMatchObject({ state: "pending", providerAcknowledged: false, providerState: "processing" });
    expect(f.client.requestEviction.mock.calls[0]).toEqual(f.client.requestEviction.mock.calls[1]);
    const completed = await f.api().removalStatus(input);
    expect(completed).toMatchObject({ state: "completed", providerAcknowledged: true });
    expect(completed).not.toHaveProperty("providerEvictionId");
  });
  it("unavailable snapshot errors fail closed and cannot expose cached names", async () => {
    const f = fixture(); f.repository.snapshot.mockRejectedValueOnce(new Error("private DB details"));
    expect(await f.api().hostControls({ meetingId })).toEqual({ available: false, meetingId, members: [] });
  });
});
