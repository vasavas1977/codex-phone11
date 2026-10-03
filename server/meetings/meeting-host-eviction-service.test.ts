import { describe, expect, it, vi } from "vitest";
import { createMeetingHostEvictionService } from "./meeting-host-eviction-service";
import { meetingHostRemovalKey } from "./meeting-host-eviction-repository";
import type { PlainVideoEvictionOperation } from "./plain-video-eviction-repository";

const input = {
  tenantId: 41,
  meetingId: "12345678-1234-4234-8234-123456789012",
  targetUserId: 8,
};
const target = {
  meetingId: input.meetingId,
  tenantId: input.tenantId,
  userId: 8,
  participantId: "stable_41_8",
};
const operation: PlainVideoEvictionOperation = {
  id: "22345678-1234-4234-8234-123456789012",
  target,
  idempotencyKey: meetingHostRemovalKey(
    41,
    input.meetingId,
    target.participantId,
  ),
  state: "pending",
  providerEvictionId: null,
  revokeTokenTs: null,
  providerCreatedAt: null,
  providerCompletedAt: null,
};
const response = (
  status: "pending" | "processing" | "completed" | "failed",
) => ({
  eviction_id: "32345678-1234-4234-8234-123456789012",
  contract_version: "phone11-plain-video.v1" as const,
  status,
  revoke_token_ts: 1790000000,
  created_at: null,
  completed_at: status === "completed" ? "2026-10-04T00:00:00.000Z" : null,
});
function fixture() {
  let current = { ...operation };
  const repository = {
    begin: vi.fn(async () => current),
    get: vi.fn(async () => current),
    record: vi.fn(async (_op, observed) => {
      current = {
        ...current,
        state: observed.state,
        providerEvictionId: observed.evictionId,
        revokeTokenTs: observed.revokeTokenTs,
        providerCreatedAt: observed.createdAt,
        providerCompletedAt: observed.completedAt,
      };
      return current;
    }),
  };
  const client = {
    requestEviction: vi.fn(async () => response("pending")),
    evictionStatus: vi.fn(async () => response("completed")),
  };
  const gate = {
    reviewedEvictionEnabled: true as const,
    tenantClients: new Map([[41, client]]),
  };
  return {
    repository,
    client,
    service: createMeetingHostEvictionService(repository, gate),
  };
}

describe("unmounted meeting host eviction control", () => {
  it("defaults off without touching authority, ledger or provider", async () => {
    const { repository, client } = fixture();
    const service = createMeetingHostEvictionService(repository);
    await expect(service.request(7, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(service.poll(7, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(repository.begin).not.toHaveBeenCalled();
    expect(repository.get).not.toHaveBeenCalled();
    expect(client.requestEviction).not.toHaveBeenCalled();
    expect(client.evictionStatus).not.toHaveBeenCalled();
  });
  it("refuses self, client identity overrides, unmapped tenants, and failed authority before provider", async () => {
    const { service, repository, client } = fixture();
    await expect(service.request(8, input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      service.request(7, { ...input, participantId: "attacker" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      service.request(7, { ...input, tenantId: 42 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    repository.begin.mockResolvedValueOnce(null as never);
    await expect(service.request(7, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(client.requestEviction).not.toHaveBeenCalled();
  });
  it("uses stable server identity, preserves replay, and polls only the persisted provider UUID", async () => {
    const { service, repository, client } = fixture();
    await expect(service.request(7, input)).resolves.toMatchObject({
      state: "pending",
      providerAcknowledged: false,
    });
    await service.request(7, input);
    expect(client.requestEviction).toHaveBeenCalledTimes(1);
    expect(client.requestEviction).toHaveBeenCalledWith(
      { meetingId: input.meetingId, participantId: target.participantId },
      operation.idempotencyKey,
    );
    await expect(service.poll(7, input)).resolves.toMatchObject({
      state: "completed",
      providerAcknowledged: true,
    });
    expect(client.evictionStatus).toHaveBeenCalledWith(
      response("pending").eviction_id,
    );
    expect(repository.begin).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent authorized requests while every caller reauthorizes", async () => {
    const { service, repository, client } = fixture();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.requestEviction.mockImplementation(async () => {
      await barrier;
      return response("pending");
    });
    const first = service.request(7, input);
    const second = service.request(7, input);
    await vi.waitFor(() =>
      expect(client.requestEviction).toHaveBeenCalledTimes(1),
    );
    expect(repository.begin).toHaveBeenCalledTimes(2);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    repository.begin.mockResolvedValueOnce(null as never);
    await expect(service.request(7, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(client.requestEviction).toHaveBeenCalledTimes(1);
  });
  it("processing remains pending and failed never acknowledges provider removal", async () => {
    const { service, client } = fixture();
    client.requestEviction.mockResolvedValueOnce(response("processing"));
    await expect(service.request(7, input)).resolves.toMatchObject({
      state: "pending",
      providerAcknowledged: false,
      providerState: "processing",
    });
    client.evictionStatus.mockResolvedValueOnce(response("failed"));
    await expect(service.poll(7, input)).resolves.toMatchObject({
      state: "failed",
      providerAcknowledged: false,
    });
  });
  it("retains local pending state and exact retry key on an uncertain POST", async () => {
    const { service, client } = fixture();
    client.requestEviction.mockRejectedValueOnce(
      new Error("transport failure"),
    );
    await expect(service.request(7, input)).resolves.toMatchObject({
      state: "pending",
      providerAcknowledged: false,
      providerEvictionId: null,
      providerError: "unavailable",
    });
    await service.request(7, input);
    expect(client.requestEviction.mock.calls[0]).toEqual(
      client.requestEviction.mock.calls[1],
    );
  });
  it("rejects an unbound operation and cross-operation provider status", async () => {
    const { service, repository, client } = fixture();
    repository.begin.mockResolvedValueOnce({
      ...operation,
      target: { ...target, tenantId: 42 },
    });
    await expect(service.request(7, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await service.request(7, input);
    client.evictionStatus.mockResolvedValueOnce({
      ...response("completed"),
      eviction_id: "42345678-1234-4234-8234-123456789012",
    });
    await expect(service.poll(7, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
