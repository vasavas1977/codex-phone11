import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { ChannelMeetingRepository } from "./channel-meeting-repository";

const positiveId = z.number().int().positive().refine(Number.isSafeInteger);
export const channelCapabilitiesSchema = z.object({
  tenantId: positiveId,
  channelId: z.string().uuid(),
}).strict();
export const startChannelMeetingSchema = channelCapabilitiesSchema.extend({
  selectedMemberIds: z.array(positiveId).max(50),
  requestId: z.string().uuid(),
}).strict().superRefine((input, context) => {
  if (new Set(input.selectedMemberIds).size !== input.selectedMemberIds.length)
    context.addIssue({ code: "custom", path: ["selectedMemberIds"], message: "Selected members must be unique." });
});
export const channelInvitationsSchema = z.object({
  tenantId: positiveId,
  channelId: z.string().uuid().optional(),
}).strict();

export function channelMeetingFingerprint(channelId: string, selectedMemberIds: readonly number[]) {
  return createHash("sha256")
    .update(JSON.stringify([channelId, [...selectedMemberIds].sort((a, b) => a - b)]))
    .digest("hex");
}

export function createChannelMeetingService(
  repository: ChannelMeetingRepository,
  configuredTenantIds: readonly number[],
) {
  const configured = (tenantId: number) => configuredTenantIds.includes(tenantId);
  return {
    async capabilities(userId: number, input: z.infer<typeof channelCapabilitiesSchema>) {
      if (!configured(input.tenantId)) return { available: false, canStart: false, maxSelectedMembers: 50 };
      const canStart = await repository.canStart(userId, input.tenantId, input.channelId);
      return { available: canStart, canStart, maxSelectedMembers: 50 };
    },
    async start(userId: number, input: z.infer<typeof startChannelMeetingSchema>) {
      if (!configured(input.tenantId))
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Channel meetings are not configured for this workspace." });
      if (input.selectedMemberIds.includes(userId))
        throw new TRPCError({ code: "BAD_REQUEST", message: "The host is included automatically." });
      return repository.start({
        ...input,
        actorId: userId,
        fingerprint: channelMeetingFingerprint(input.channelId, input.selectedMemberIds),
        meetingId: randomUUID(),
      });
    },
    invitations(userId: number, input: z.infer<typeof channelInvitationsSchema>) {
      if (!configured(input.tenantId)) return [];
      return repository.invitations(userId, input.tenantId, input.channelId);
    },
  };
}
