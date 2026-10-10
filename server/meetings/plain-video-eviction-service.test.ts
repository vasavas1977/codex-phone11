import { describe, expect, it, vi } from "vitest";

import type { Connect11PlainVideoEviction } from "./connect11-plain-video-facade";
import { createConnect11PlainVideoFacade } from "./connect11-plain-video-facade";
import type { PlainVideoEvictionOperation } from "./plain-video-eviction-repository";
import {
  createPlainVideoEvictionService,
  PlainVideoEvictionUnavailableError,
} from "./plain-video-eviction-service";

const target = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 41,
  userId: 7,
  participantId: "participant_41_7",
};
const key = "plain_video_remove_0001";
const now = new Date("2026-09-19T00:00:00.000Z");

function operation(overrides: Partial<PlainVideoEvictionOperation> = {}): PlainVideoEvictionOperation {
  return {
    id: "32345678-1234-4234-8234-123456789012",
    target,
    idempotencyKey: key,
    state: "pending",
    providerEvictionId: null,
    revokeTokenTs: null,
    providerCreatedAt: null,
    providerCompletedAt: null,
    ...overrides,
  };
}

function provider(status: Connect11PlainVideoEviction["status"]): Connect11PlainVideoEviction {
  return {
    eviction_id: "42345678-1234-4234-8234-123456789012",
    contract_version: "phone11-plain-video.v1",
    status,
    revoke_token_ts: 1_789_000_000,
    created_at: now.toISOString(),
    completed_at: status === "completed" ? now.toISOString() : null,
  };
}

function serviceFor(
  initial: PlainVideoEvictionOperation | null = operation(),
  requestResult = provider("pending"),
  pollResult = provider("completed"),
) {
  const record = vi.fn(async (_operation, observed) => operation({
    state: observed.state,
    providerEvictionId: observed.evictionId,
    revokeTokenTs: observed.revokeTokenTs,
    providerCreatedAt: observed.createdAt,
    providerCompletedAt: observed.completedAt,
  }));
  const repository = {
    begin: vi.fn().mockResolvedValue(initial),
    get: vi.fn().mockResolvedValue(initial),
    record,
  };
  const client = {
    requestEviction: vi.fn().mockResolvedValue(requestResult),
    evictionStatus: vi.fn().mockResolvedValue(pollResult),
  };
  return { service: createPlainVideoEvictionService(repository, client), repository, client };
}

describe("plain-video eviction service", () => {
  it("keeps a 202 pending eviction non-acknowledged while local denial stays durable", async () => {
    const { service, repository, client } = serviceFor();
    await expect(service.request(target, key)).resolves.toMatchObject({
      state: "pending",
      providerAcknowledged: false,
      providerEvictionId: "42345678-1234-4234-8234-123456789012",
    });
    expect(repository.begin).toHaveBeenCalledWith(target, key);
    expect(client.requestEviction).toHaveBeenCalledWith({
      meetingId: target.meetingId,
      participantId: target.participantId,
    }, key);
  });

  it("recognizes only a completed provider state as acknowledgement", async () => {
    const { service } = serviceFor(operation(), provider("completed"));
    await expect(service.request(target, key)).resolves.toMatchObject({
      state: "completed",
      providerAcknowledged: true,
    });
  });

  it("does one status read and records a failed acknowledgement without reminting", async () => {
    const pending = operation({
      providerEvictionId: "42345678-1234-4234-8234-123456789012",
    });
    const { service, client } = serviceFor(pending, provider("pending"), provider("failed"));
    await expect(service.poll(target, key)).resolves.toMatchObject({
      state: "failed",
      providerAcknowledged: false,
    });
    expect(client.evictionStatus).toHaveBeenCalledTimes(1);
    expect(client.requestEviction).not.toHaveBeenCalled();
  });

  it("refuses a tenant-mismatched durable target before contacting Connect11", async () => {
    const { service, client } = serviceFor(null);
    await expect(service.request({ ...target, tenantId: 42 }, key)).rejects.toBeInstanceOf(
      PlainVideoEvictionUnavailableError,
    );
    expect(client.requestEviction).not.toHaveBeenCalled();
  });

  it("does not retry an unconfirmed pending request or accept client-shaped identities", async () => {
    const pending = operation();
    const { service, client } = serviceFor(pending);
    await expect(service.request(target, key)).resolves.toMatchObject({
      state: "pending",
      providerAcknowledged: false,
    });
    expect(client.requestEviction).toHaveBeenCalledTimes(1);

    const pendingWithProvider = operation({
      providerEvictionId: "42345678-1234-4234-8234-123456789012",
    });
    const alreadyRequested = serviceFor(pendingWithProvider);
    await expect(alreadyRequested.service.request(target, key)).resolves.toMatchObject({
      state: "pending",
    });
    expect(alreadyRequested.client.requestEviction).not.toHaveBeenCalled();
    await expect(service.request({ ...target, room: "client-room" }, key)).rejects.toBeInstanceOf(
      PlainVideoEvictionUnavailableError,
    );
  });

  it("reconciles only through the concrete server-side Connect11 eviction contract", async () => {
    const pending = provider("pending");
    const completed = provider("completed");
    const request = vi
      .fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify(pending), { status: 202 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify(completed), { status: 200 }));
    const facade = createConnect11PlainVideoFacade({
      baseUrl: "https://connect11.example",
      statusCredential: "status-secret",
      joinCredential: "join-secret",
    }, request);
    const repository = {
      begin: vi.fn().mockResolvedValue(operation()),
      get: vi.fn().mockResolvedValue(operation({ providerEvictionId: pending.eviction_id })),
      record: vi.fn(async (_operation, observed) => operation({
        state: observed.state,
        providerEvictionId: observed.evictionId,
        revokeTokenTs: observed.revokeTokenTs,
        providerCreatedAt: observed.createdAt,
        providerCompletedAt: observed.completedAt,
      })),
    };
    const service = createPlainVideoEvictionService(repository, facade);

    await expect(service.request(target, key)).resolves.toMatchObject({ state: "pending" });
    await expect(service.poll(target, key)).resolves.toMatchObject({
      state: "completed", providerAcknowledged: true,
    });
    expect(String(request.mock.calls[0][0])).toBe(
      "https://connect11.example/api/v1/realtime/plain-video/evictions",
    );
    expect(String(request.mock.calls[1][0])).toBe(
      `https://connect11.example/api/v1/realtime/plain-video/evictions/${pending.eviction_id}`,
    );
    expect(request.mock.calls[0][1].headers.authorization).toBe("Bearer join-secret");
  });
});
