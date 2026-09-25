import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { DirectMeetingRepository } from "./direct-meeting-repository";

const positiveId = z.number().int().positive().refine(Number.isSafeInteger);
export const directMeetingScopeSchema = z.object({ tenantId: positiveId,
  conversationId: z.string().uuid() }).strict();
export const directMeetingInboxSchema = z.object({ tenantId: positiveId }).strict();
export const startDirectMeetingSchema = directMeetingScopeSchema.extend({ requestId: z.string().uuid() }).strict();
export const adminSetDirectHostPermissionSchema = directMeetingScopeSchema.extend({
  userId: positiveId, canStartMeeting: z.boolean(),
}).strict();

export function createDirectMeetingService(
  repository: DirectMeetingRepository, configuredTenantIds: readonly number[],
) {
  const configured = (tenantId: number) => configuredTenantIds.includes(tenantId);
  return {
    async capabilities(userId: number, input: z.infer<typeof directMeetingScopeSchema>) {
      if (!configured(input.tenantId)) return { available: false, canStart: false, maxSelectedMembers: 1 as const };
      const canStart = await repository.canStart(userId, input.tenantId, input.conversationId);
      return { available: canStart, canStart, maxSelectedMembers: 1 as const };
    },
    async start(userId: number, input: z.infer<typeof startDirectMeetingSchema>) {
      if (!configured(input.tenantId))
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Direct meetings are not configured for this workspace." });
      return repository.start({ ...input, actorId: userId, meetingId: randomUUID() });
    },
    invitations(userId: number, input: z.infer<typeof directMeetingScopeSchema>) {
      if (!configured(input.tenantId)) return [];
      return repository.invitations(userId, input.tenantId, input.conversationId);
    },
    inbox(userId: number, input: z.infer<typeof directMeetingInboxSchema>) {
      if (!configured(input.tenantId)) return [];
      return repository.invitations(userId, input.tenantId);
    },
  };
}
