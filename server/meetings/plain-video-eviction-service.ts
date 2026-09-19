import type {
  Connect11PlainVideoEviction,
  createConnect11PlainVideoFacade,
} from "./connect11-plain-video-facade";
import {
  plainVideoEvictionTargetSchema,
  type PlainVideoEvictionOperation,
  type PlainVideoEvictionTarget,
} from "./plain-video-eviction-repository";

const idempotencyKey = /^[A-Za-z0-9_-]{16,128}$/;

export interface PlainVideoEvictionRepository {
  begin(
    target: PlainVideoEvictionTarget,
    idempotencyKey: string,
  ): Promise<PlainVideoEvictionOperation | null>;
  get(
    target: PlainVideoEvictionTarget,
    idempotencyKey: string,
  ): Promise<PlainVideoEvictionOperation | null>;
  record(
    operation: PlainVideoEvictionOperation,
    observation: {
      evictionId: string;
      state: "pending" | "completed" | "failed";
      revokeTokenTs: number;
      createdAt: Date;
      completedAt: Date | null;
    },
  ): Promise<PlainVideoEvictionOperation | null>;
}

/** Evictions may use only the reviewed server-side Connect11 facade contract. */
export type PlainVideoEvictionClient = Pick<
  ReturnType<typeof createConnect11PlainVideoFacade>,
  "requestEviction" | "evictionStatus"
>;

export class PlainVideoEvictionUnavailableError extends Error {
  constructor() {
    super("Plain video eviction is unavailable");
  }
}

export type PlainVideoRemovalStatus = {
  operationId: string;
  state: "pending" | "completed" | "failed";
  providerAcknowledged: boolean;
  providerEvictionId: string | null;
  completedAt: Date | null;
};

function status(operation: PlainVideoEvictionOperation): PlainVideoRemovalStatus {
  return {
    operationId: operation.id,
    state: operation.state,
    // A 202 only creates an operation. Connect11's explicit completed state is
    // the sole evidence that it acknowledged removal.
    providerAcknowledged: operation.state === "completed",
    providerEvictionId: operation.providerEvictionId,
    completedAt: operation.providerCompletedAt,
  };
}

function observation(response: Connect11PlainVideoEviction) {
  return {
    evictionId: response.eviction_id,
    state: response.status,
    revokeTokenTs: response.revoke_token_ts,
    createdAt: new Date(response.created_at),
    completedAt: response.completed_at ? new Date(response.completed_at) : null,
  };
}

function trustedTarget(raw: unknown): PlainVideoEvictionTarget {
  const parsed = plainVideoEvictionTargetSchema.safeParse(raw);
  if (!parsed.success) throw new PlainVideoEvictionUnavailableError();
  return parsed.data;
}

function trustedKey(raw: unknown): string {
  if (typeof raw !== "string" || !idempotencyKey.test(raw)) {
    throw new PlainVideoEvictionUnavailableError();
  }
  return raw;
}

/**
 * A server-workflow-only lifecycle. It has no router or raw client input: its
 * target must be a trusted tenant/member record chosen by Phone11 server code.
 * Each `poll` call performs at most one provider status read.
 */
export function createPlainVideoEvictionService(
  repository: PlainVideoEvictionRepository,
  client: PlainVideoEvictionClient,
) {
  return {
    async request(rawTarget: unknown, rawKey: unknown): Promise<PlainVideoRemovalStatus> {
      const target = trustedTarget(rawTarget);
      const key = trustedKey(rawKey);
      const claimed = await repository.begin(target, key);
      if (!claimed) throw new PlainVideoEvictionUnavailableError();

      // No second POST for a durable pending request. If Connect11 did receive
      // an earlier request, the future reconciliation path must use its status.
      if (claimed.state !== "pending" || claimed.providerEvictionId) return status(claimed);

      try {
        const response = await client.requestEviction(
          { meetingId: target.meetingId, participantId: target.participantId },
          key,
        );
        const recorded = await repository.record(claimed, observation(response));
        if (!recorded) throw new PlainVideoEvictionUnavailableError();
        return status(recorded);
      } catch (error) {
        if (error instanceof PlainVideoEvictionUnavailableError) throw error;
        // The local durable denial remains pending. Do not reinterpret a
        // transport failure as either a provider acknowledgement or a retry.
        return status(claimed);
      }
    },

    async poll(rawTarget: unknown, rawKey: unknown): Promise<PlainVideoRemovalStatus> {
      const target = trustedTarget(rawTarget);
      const key = trustedKey(rawKey);
      const existing = await repository.get(target, key);
      if (!existing) throw new PlainVideoEvictionUnavailableError();
      if (existing.state !== "pending" || !existing.providerEvictionId) return status(existing);

      const response = await client.evictionStatus(existing.providerEvictionId);
      if (response.eviction_id !== existing.providerEvictionId) {
        throw new PlainVideoEvictionUnavailableError();
      }
      const recorded = await repository.record(existing, observation(response));
      if (!recorded) throw new PlainVideoEvictionUnavailableError();
      return status(recorded);
    },
  };
}
