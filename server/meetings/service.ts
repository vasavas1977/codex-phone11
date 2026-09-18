import { TRPCError } from "@trpc/server";
import { z } from "zod";
export const joinMeetingSchema = z.object({ meetingId: z.string().uuid() }).strict();
export type MeetingGrant = { meetingId: string; tenantId: number; userId: number };
export interface MeetingRepository {
  authorize(userId: number, meetingId: string): Promise<MeetingGrant | null>;
}
export type MeetingJoinResult = {
  url: string;
  token: string;
  /** Present only when the selected provider has a versioned token contract. */
  contract_version?: string;
  /** Unix seconds; callers must treat this as advisory and never extend it. */
  expires_at?: number;
};
export interface MeetingProvider {
  join(grant: MeetingGrant): Promise<MeetingJoinResult>;
}
export const unavailableMeetingCapabilities = {
  available: false, video: false, interpretation: false, voiceBot: false,
  recording: false, reason: "Meeting service is awaiting isolated provider verification",
} as const;
export function createMeetingService(repository: MeetingRepository, provider?: MeetingProvider) {
  return {
    capabilities: () => unavailableMeetingCapabilities,
    async join(userId: number, raw: unknown) {
      if (!Number.isSafeInteger(userId) || userId < 1) throw new TRPCError({ code: "UNAUTHORIZED" });
      const input = joinMeetingSchema.parse(raw);
      if (!provider) throw new TRPCError({ code: "PRECONDITION_FAILED", message: unavailableMeetingCapabilities.reason });
      const grant = await repository.authorize(userId, input.meetingId);
      if (!grant || grant.userId !== userId || grant.meetingId !== input.meetingId || !Number.isSafeInteger(grant.tenantId) || grant.tenantId < 1)
        throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
      try { return await provider.join(grant); }
      catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Meeting provider is unavailable" }); }
    },
  };
}
