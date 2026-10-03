import { TRPCError } from "@trpc/server";

import {
  meetingHostRemovalSchema,
  type createMeetingHostEvictionRepository,
} from "./meeting-host-eviction-repository";
import {
  createPlainVideoEvictionService,
  type PlainVideoEvictionClient,
  type PlainVideoRemovalStatus,
} from "./plain-video-eviction-service";

export type MeetingHostEvictionRepository = ReturnType<
  typeof createMeetingHostEvictionRepository
>;
export type ReviewedMeetingHostEvictionGate = {
  /** Deployment review must verify Connect11 eviction scope and contract readiness. */
  reviewedEvictionEnabled: true;
  /** Explicit per-tenant clients with isolated, eviction-scoped server credentials. */
  tenantClients: ReadonlyMap<number, PlainVideoEvictionClient>;
};

/**
 * Reusable source contract, intentionally unmounted. Capabilities currently
 * expose no eviction readiness, so the default gate is off and makes no DB or
 * provider calls. Enabling join capability alone cannot enable host removal.
 * The actor ID must come from the protected server session, never client input.
 */
export function createMeetingHostEvictionService(
  repository: MeetingHostEvictionRepository,
  gate?: ReviewedMeetingHostEvictionGate,
) {
  const clients =
    gate?.reviewedEvictionEnabled === true
      ? new Map(gate.tenantClients)
      : new Map<number, PlainVideoEvictionClient>();
  const inFlight = new Map<string, Promise<PlainVideoRemovalStatus>>();
  const unavailable = () =>
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Meeting removal is unavailable",
    });
  async function perform(
    actorId: number,
    raw: unknown,
    mode: "request" | "poll",
  ): Promise<PlainVideoRemovalStatus> {
    if (!Number.isSafeInteger(actorId) || actorId < 1)
      throw new TRPCError({ code: "UNAUTHORIZED" });
    const parsed = meetingHostRemovalSchema.safeParse(raw);
    if (!parsed.success || parsed.data.targetUserId === actorId)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid meeting removal",
      });
    const client = clients.get(parsed.data.tenantId);
    if (!client) throw unavailable();
    try {
      // Every call reauthorizes; an in-flight operation never bypasses a revoked host.
      const operation = await (mode === "request"
        ? repository.begin(actorId, parsed.data)
        : repository.get(actorId, parsed.data));
      if (
        !operation ||
        operation.target.tenantId !== parsed.data.tenantId ||
        operation.target.meetingId !== parsed.data.meetingId ||
        operation.target.userId !== parsed.data.targetUserId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Meeting removal not found",
        });
      }
      const flightKey = `${mode}:${operation.id}`;
      const existing = inFlight.get(flightKey);
      if (existing) return await existing;
      const lifecycle = createPlainVideoEvictionService(
        {
          begin: async () => operation,
          get: async () => operation,
          record: repository.record,
        },
        client,
      );
      const flight = lifecycle[mode](
        operation.target,
        operation.idempotencyKey,
      );
      inFlight.set(flightKey, flight);
      try {
        return await flight;
      } finally {
        if (inFlight.get(flightKey) === flight) inFlight.delete(flightKey);
      }
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw unavailable();
    }
  }
  return {
    request: (actorId: number, raw: unknown) =>
      perform(actorId, raw, "request"),
    poll: (actorId: number, raw: unknown) => perform(actorId, raw, "poll"),
  };
}
