import type { MeetingGrant } from "./service";
import {
  createPlainVideoAdmissionRepository,
  type PlainVideoAdmissionRecord,
  type PlainVideoReadOnlyTransaction,
} from "./plain-video-admission-repository";

export type TrustedConnect11PlainVideoAdmission = {
  meetingId: string;
  participantId: string;
  grantProfile: "interactive" | "listener";
};

export class PlainVideoAdmissionUnavailableError extends Error {
  constructor() {
    super("Plain video admission is unavailable");
  }
}

function isTrustedGrant(grant: MeetingGrant): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grant.meetingId)
    && Number.isSafeInteger(grant.tenantId) && grant.tenantId > 0
    && Number.isSafeInteger(grant.userId) && grant.userId > 0;
}

function admissionFrom(
  record: PlainVideoAdmissionRecord,
  grant: MeetingGrant,
): TrustedConnect11PlainVideoAdmission | null {
  // The repository filters these values in SQL. Repeat the comparison here so
  // a corrupt driver/mock row cannot change the scope after authorization.
  if (
    record.meeting_id !== grant.meetingId ||
    record.tenant_id !== grant.tenantId ||
    record.user_id !== grant.userId
  )
    return null;
  return {
    meetingId: record.meeting_id,
    participantId: record.participant_id,
    grantProfile: record.grant_profile,
  };
}

/**
 * Produces the deliberately small plain-video admission from fresh, durable
 * Phone11 state. It has no interpreter language, consent assertion, agent,
 * room name, display identity, or client-selected profile input.
 * Lifecycle commands, revision-locked token issuance, provider eviction, and
 * audit/outbox delivery are deliberately not implemented by this read-only
 * seam and remain activation requirements.
 */
export function createPlainVideoAdmissionResolver(
  transaction: PlainVideoReadOnlyTransaction,
  repository = createPlainVideoAdmissionRepository(),
) {
  return {
    async resolve(grant: MeetingGrant): Promise<TrustedConnect11PlainVideoAdmission> {
      if (!isTrustedGrant(grant)) throw new PlainVideoAdmissionUnavailableError();
      const record = await transaction((db) => repository.findAuthorized(db, grant));
      const admission = record && admissionFrom(record, grant);
      if (!admission) throw new PlainVideoAdmissionUnavailableError();
      return admission;
    },
  };
}
