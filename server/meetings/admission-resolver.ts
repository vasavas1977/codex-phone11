import type { MeetingGrant } from "./service";
import {
  createMeetingAdmissionRepository,
  type MeetingAdmissionRecord,
  type ReadOnlyTransaction,
} from "./admission-repository";

export type TrustedConnect11Admission = {
  meetingId: string;
  participantId: string;
  grantProfile: "interactive" | "listener";
  listenLanguage: "th" | "en" | "zh" | "ja" | "ko" | "fr" | "de" | "es";
  consent: {
    accepted: true;
    purpose: "live_interpretation";
    policyVersion: string;
    assertedAt: string;
  };
};

export class MeetingAdmissionUnavailableError extends Error {
  constructor() {
    super("Meeting admission is unavailable");
  }
}

function isTrustedGrant(grant: MeetingGrant): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grant.meetingId)
    && Number.isSafeInteger(grant.tenantId) && grant.tenantId > 0
    && Number.isSafeInteger(grant.userId) && grant.userId > 0;
}

function admissionFrom(record: MeetingAdmissionRecord, assertedAt: Date): TrustedConnect11Admission {
  return {
    meetingId: record.meeting_id,
    participantId: record.participant_id,
    grantProfile: record.grant_profile,
    listenLanguage: record.listen_language,
    // assertedAt attests a durable, matching consent receipt; it does not
    // replace the receipt timestamp or let the device manufacture consent.
    consent: {
      accepted: true,
      purpose: "live_interpretation",
      policyVersion: record.consent_policy_version,
      assertedAt: assertedAt.toISOString(),
    },
  };
}

/**
 * Converts the existing server-authorized MeetingGrant into Connect11 input.
 * The database is the sole source for tenant, participant, profile, language,
 * room/member revisions, lobby/revocation state, and consent acknowledgement.
 */
export function createMeetingAdmissionResolver(
  transaction: ReadOnlyTransaction,
  repository = createMeetingAdmissionRepository(),
  now: () => Date = () => new Date(),
) {
  return {
    async resolve(grant: MeetingGrant): Promise<TrustedConnect11Admission> {
      if (!isTrustedGrant(grant)) throw new MeetingAdmissionUnavailableError();
      const record = await transaction(db => repository.findAuthorized(db, grant));
      if (!record) throw new MeetingAdmissionUnavailableError();
      return admissionFrom(record, now());
    },
  };
}
