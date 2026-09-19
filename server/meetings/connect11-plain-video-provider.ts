import type { MeetingGrant, MeetingProvider } from "./service";
import type { Connect11PlainVideoToken } from "./connect11-plain-video-facade";
import type { PlainVideoAdmissionLease } from "./plain-video-admission-lease-repository";

export type TrustedConnect11PlainVideoAdmission = {
  meetingId: string;
  participantId: string;
  grantProfile: "interactive" | "listener";
};

export interface Connect11PlainVideoAdmissionResolver {
  prepare(grant: MeetingGrant): Promise<{
    admission: TrustedConnect11PlainVideoAdmission;
    lease: PlainVideoAdmissionLease;
  }>;
  confirm(lease: PlainVideoAdmissionLease): Promise<TrustedConnect11PlainVideoAdmission>;
}

export interface Connect11PlainVideoAdmissionClient {
  admit(admission: TrustedConnect11PlainVideoAdmission): Promise<Connect11PlainVideoToken>;
}

/**
 * Converts only server-authorized Phone11 meeting membership into a plain-video
 * token request. The resolver records and then confirms the exact durable
 * room/member revision around external issuance, so a changed membership never
 * returns a token to the Phone11 client.
 */
export function createConnect11PlainVideoProvider(
  client: Connect11PlainVideoAdmissionClient,
  resolver: Connect11PlainVideoAdmissionResolver,
): MeetingProvider {
  return {
    async join(grant) {
      const pending = await resolver.prepare(grant);
      const token = await client.admit(pending.admission);
      const confirmed = await resolver.confirm(pending.lease);
      if (
        confirmed.meetingId !== pending.admission.meetingId ||
        confirmed.participantId !== pending.admission.participantId ||
        confirmed.grantProfile !== pending.admission.grantProfile
      ) {
        throw new Error("Plain video admission changed during issuance");
      }
      return {
        url: token.rtc_url,
        token: token.access_token,
        grant_profile: pending.admission.grantProfile,
        contract_version: token.contract_version,
        expires_at: token.expires_at,
      };
    },
  };
}
