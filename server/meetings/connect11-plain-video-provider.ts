import type { Connect11PlainVideoToken } from "./connect11-plain-video-facade";
import type { MeetingGrant, MeetingProvider } from "./service";

export type TrustedConnect11PlainVideoAdmission = {
  meetingId: string;
  participantId: string;
  grantProfile: "interactive" | "listener";
};

export interface Connect11PlainVideoAdmissionResolver {
  resolve(grant: MeetingGrant): Promise<TrustedConnect11PlainVideoAdmission>;
}

export interface Connect11PlainVideoAdmissionClient {
  admit(
    admission: TrustedConnect11PlainVideoAdmission,
  ): Promise<Connect11PlainVideoToken>;
}

/**
 * Converts only server-authorized Phone11 meeting membership into a plain-video
 * token request. Mounting this provider requires a dedicated resolver backed by
 * active tenant, member, lobby, and revocation records.
 */
export function createConnect11PlainVideoProvider(
  client: Connect11PlainVideoAdmissionClient,
  resolver: Connect11PlainVideoAdmissionResolver,
): MeetingProvider {
  return {
    async join(grant) {
      const admission = await resolver.resolve(grant);
      const token = await client.admit(admission);
      return {
        url: token.rtc_url,
        token: token.access_token,
        contract_version: token.contract_version,
        expires_at: token.expires_at,
      };
    },
  };
}
