import type { MeetingGrant } from "./service";
import {
  createPlainVideoAdmissionLeaseRepository,
  type PlainVideoAdmissionLease,
  type PlainVideoIssuanceTransaction,
} from "./plain-video-admission-lease-repository";

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
  record: PlainVideoAdmissionLease,
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
  if (
    !/^[A-Za-z0-9_-]{1,96}$/.test(record.participant_id) ||
    !["interactive", "listener"].includes(record.grant_profile)
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
 * room name, display identity, or client-selected profile input. A pending
 * revision snapshot is persisted before Connect11 issuance and confirmed only
 * after it returns, before the token can leave this server.
 */
export function createPlainVideoAdmissionResolver(
  transaction: PlainVideoIssuanceTransaction,
  repository = createPlainVideoAdmissionLeaseRepository(transaction),
) {
  return {
    async prepare(grant: MeetingGrant): Promise<{
      admission: TrustedConnect11PlainVideoAdmission;
      lease: PlainVideoAdmissionLease;
    }> {
      if (!isTrustedGrant(grant)) throw new PlainVideoAdmissionUnavailableError();
      const record = await repository.begin(grant);
      const admission = record && admissionFrom(record, grant);
      if (!admission) throw new PlainVideoAdmissionUnavailableError();
      return { admission, lease: record };
    },

    async confirm(lease: PlainVideoAdmissionLease): Promise<TrustedConnect11PlainVideoAdmission> {
      const record = await repository.confirm(lease);
      const admission = record && admissionFrom(record, {
        meetingId: lease.meeting_id,
        tenantId: lease.tenant_id,
        userId: lease.user_id,
      });
      if (!admission) throw new PlainVideoAdmissionUnavailableError();
      return admission;
    },
  };
}
