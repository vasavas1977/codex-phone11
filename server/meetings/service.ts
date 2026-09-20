import { TRPCError } from "@trpc/server";
import { z } from "zod";
export const joinMeetingSchema = z.object({ meetingId: z.string().uuid() }).strict();
export type MeetingGrant = { meetingId: string; tenantId: number; userId: number };
export type MeetingJoinResult = {
  url: string;
  token: string;
  /** Server-derived capability; clients never select this profile. */
  grant_profile?: "interactive" | "listener";
  /** Provider lifecycle metadata is optional for backwards-compatible adapters. */
  contract_version?: string;
  expires_at?: number;
};

const meetingJoinResultSchema = z.object({
  url: z.string().url().max(2_048),
  token: z.string().min(1).max(16_384),
  grant_profile: z.enum(["interactive", "listener"]).optional(),
  contract_version: z.string().min(1).max(128).optional(),
  expires_at: z.number().int().positive().optional(),
}).strict();

function safeMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "wss:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function safeJoinResult(raw: unknown): MeetingJoinResult | null {
  const parsed = meetingJoinResultSchema.safeParse(raw);
  if (!parsed.success || !safeMediaUrl(parsed.data.url)) return null;

  // Plain-video providers preserve this expiry metadata. Treat it as a
  // short-lived server-minted grant before returning it to the client.
  if (parsed.data.expires_at !== undefined) {
    const now = Math.floor(Date.now() / 1_000);
    if (parsed.data.expires_at <= now || parsed.data.expires_at > now + 330)
      return null;
  }
  return parsed.data;
}
export interface MeetingRepository {
  authorize(userId: number, meetingId: string): Promise<MeetingGrant | null>;
}
export interface MeetingProvider {
  join(grant: MeetingGrant): Promise<MeetingJoinResult>;
}
export const unavailableMeetingCapabilities = {
  available: false, video: false, interpretation: false, voiceBot: false,
  recording: false, reason: "Meeting service is awaiting isolated provider verification",
} as const;
export const availablePlainVideoMeetingCapabilities = {
  available: true, video: true, interpretation: false, voiceBot: false,
  recording: false,
} as const;
export function createMeetingService(repository: MeetingRepository, provider?: MeetingProvider) {
  return {
    // Capability reads intentionally do not contact Connect11. A configured
    // tenant still has to pass durable admission before the provider receives
    // one opaque token request.
    capabilities: () => provider ? availablePlainVideoMeetingCapabilities : unavailableMeetingCapabilities,
    /**
     * The signed client consumes only server-admitted meeting IDs. The signed
     * release source keeps this contract fail-closed until the backend
     * admission provider is enabled.
     */
    async availableMeetingsFor(): Promise<readonly { meetingId: string }[]> {
      return [];
    },
    async join(userId: number, raw: unknown) {
      if (!Number.isSafeInteger(userId) || userId < 1) throw new TRPCError({ code: "UNAUTHORIZED" });
      const input = joinMeetingSchema.parse(raw);
      if (!provider) throw new TRPCError({ code: "PRECONDITION_FAILED", message: unavailableMeetingCapabilities.reason });
      const grant = await repository.authorize(userId, input.meetingId);
      if (!grant || grant.userId !== userId || grant.meetingId !== input.meetingId || !Number.isSafeInteger(grant.tenantId) || grant.tenantId < 1)
        throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
      try {
        const result = safeJoinResult(await provider.join(grant));
        if (!result) throw new Error("Invalid meeting token response");
        return result;
      }
      catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Meeting provider is unavailable" }); }
    },
  };
}
