import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import type { MeetingGrant } from "./service";
import { channelMeetingOriginAllows } from "./channel-meeting-origin";
import {
  parseExactPlainVideoAdmissionRecord,
  plainVideoAdmissionAdmitted,
  plainVideoAdmissionRowSchema,
  plainVideoAdmissionSelection,
  type PlainVideoAdmissionQuery,
  type PlainVideoAdmissionRecord,
} from "./plain-video-admission-repository";

const trustedGrantSchema = z.object({
  meetingId: z.string().uuid(),
  tenantId: z.number().int().positive().refine(Number.isSafeInteger),
  userId: z.number().int().positive().refine(Number.isSafeInteger),
}).strict();

const leaseRowSchema = plainVideoAdmissionRowSchema.extend({
  lease_id: z.string().uuid(),
  lease_expires_at: z.coerce.date(),
}).strict();

export type PlainVideoAdmissionLease = PlainVideoAdmissionRecord & {
  leaseId: string;
  expiresAt: Date;
};

export type PlainVideoIssuanceTransaction = <T>(
  fn: (db: PlainVideoAdmissionQuery) => Promise<T>,
) => Promise<T>;

function leaseFrom(
  row: unknown,
  grant: MeetingGrant,
): PlainVideoAdmissionLease | null {
  const parsed = leaseRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const { lease_id, lease_expires_at, ...admissionRow } = parsed.data;
  const record = parseExactPlainVideoAdmissionRecord(admissionRow, grant);
  if (!record) return null;
  return {
    ...record,
    leaseId: lease_id,
    expiresAt: lease_expires_at,
  };
}

/**
 * Persists an admission snapshot before external issuance, then rechecks that
 * exact room/member revision while holding the authoritative rows. A changed
 * lobby, membership, identity, tenant, room, or revocation invalidates the
 * lease and keeps the just-minted token inside the server.
 */
export function createPlainVideoAdmissionLeaseRepository(
  transaction: PlainVideoIssuanceTransaction,
) {
  return {
    async begin(rawGrant: MeetingGrant): Promise<PlainVideoAdmissionLease | null> {
      const grant = trustedGrantSchema.safeParse(rawGrant);
      if (!grant.success) return null;
      return transaction(async (db) => {
        if (!await channelMeetingOriginAllows(db, grant.data, true)) return null;
        const result = await db.query(
          `WITH admitted AS (
             ${plainVideoAdmissionSelection}
              WHERE r.id = $1 AND r.tenant_id = $2 AND m.user_id = $3
                AND ${plainVideoAdmissionAdmitted}
              FOR UPDATE OF r, m, ai, tm
              FOR SHARE OF t
           ), created AS (
             INSERT INTO phone11_plain_video_admission_leases
               (id, tenant_id, meeting_id, user_id, participant_id,
                room_revision, member_revision, state, expires_at)
             SELECT $4, tenant_id, meeting_id, user_id, participant_id,
                    room_revision, member_revision, 'pending',
                    clock_timestamp() + INTERVAL '5 minutes'
               FROM admitted
             RETURNING id, expires_at
           )
           SELECT admitted.*, created.id AS lease_id,
                  created.expires_at AS lease_expires_at
             FROM admitted CROSS JOIN created`,
          [grant.data.meetingId, grant.data.tenantId, grant.data.userId, randomUUID()],
        );
        if (result.rows.length !== 1) return null;
        return leaseFrom(result.rows[0], grant.data);
      });
    },

    async confirm(rawLease: PlainVideoAdmissionLease): Promise<PlainVideoAdmissionLease | null> {
      const lease = leaseFrom({
        meeting_id: rawLease.meeting_id,
        tenant_id: rawLease.tenant_id,
        user_id: rawLease.user_id,
        participant_id: rawLease.participant_id,
        grant_profile: rawLease.grant_profile,
        room_revision: rawLease.room_revision,
        member_revision: rawLease.member_revision,
        lease_id: rawLease.leaseId,
        lease_expires_at: rawLease.expiresAt,
      }, {
        meetingId: rawLease.meeting_id,
        tenantId: rawLease.tenant_id,
        userId: rawLease.user_id,
      });
      if (!lease) return null;

      return transaction(async (db) => {
        if (!await channelMeetingOriginAllows(db, {
          meetingId: lease.meeting_id, tenantId: lease.tenant_id, userId: lease.user_id,
        }, true)) return null;
        const result = await db.query(
          `WITH current_admission AS (
             SELECT r.id AS meeting_id, r.tenant_id, m.user_id,
                    m.participant_id, m.grant_profile,
                    r.revision AS room_revision, m.revision AS member_revision,
                    l.id AS lease_id, l.expires_at AS lease_expires_at
               FROM phone11_plain_video_admission_leases l
               JOIN phone11_plain_video_admission_rooms r
                 ON r.id = l.meeting_id AND r.tenant_id = l.tenant_id
               JOIN tenants t ON t.id = r.tenant_id AND t.status = 'active'
               JOIN phone11_plain_video_admission_members m
                 ON m.meeting_id = r.id AND m.tenant_id = r.tenant_id
                AND m.user_id = l.user_id AND m.participant_id = l.participant_id
               JOIN phone11_auth_identity ai
                 ON ai.legacy_user_id = m.user_id AND ai.disabled_at IS NULL
               JOIN tenant_memberships tm
                 ON tm.tenant_id = r.tenant_id AND tm.user_id = m.user_id
                AND tm.status = 'active'
              WHERE l.id = $1 AND l.state = 'pending'
                AND l.expires_at > clock_timestamp()
                AND r.id = $2 AND r.tenant_id = $3 AND m.user_id = $4
                AND m.participant_id = $5
                AND l.room_revision = $6 AND l.member_revision = $7
                AND r.revision = $6 AND m.revision = $7
                AND ${plainVideoAdmissionAdmitted}
              FOR UPDATE OF l, r, m, ai, tm
              FOR SHARE OF t
           ), issued AS (
             UPDATE phone11_plain_video_admission_leases l
                SET state = 'issued'
               FROM current_admission current
              WHERE l.id = current.lease_id AND l.state = 'pending'
             RETURNING l.id
           )
           SELECT current_admission.*
             FROM current_admission
             JOIN issued ON issued.id = current_admission.lease_id`,
          [
            lease.leaseId,
            lease.meeting_id,
            lease.tenant_id,
            lease.user_id,
            lease.participant_id,
            lease.room_revision,
            lease.member_revision,
          ],
        );
        if (result.rows.length !== 1) return null;
        return leaseFrom(result.rows[0], {
          meetingId: lease.meeting_id,
          tenantId: lease.tenant_id,
          userId: lease.user_id,
        });
      });
    },
  };
}

export function createPlainVideoPostgresIssuanceTransaction(
  pool: Pick<Pool, "connect">,
): PlainVideoIssuanceTransaction {
  return async <T>(fn: (db: PlainVideoAdmissionQuery) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '3s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}
