import type { Pool, PoolClient } from "pg";
import { z } from "zod";

const admissionRowSchema = z.object({
  meeting_id: z.string().uuid(),
  tenant_id: z.coerce.number().int().positive(),
  user_id: z.coerce.number().int().positive(),
  participant_id: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
  role: z.enum(["host", "cohost", "member", "guest"]),
  grant_profile: z.enum(["interactive", "listener"]),
  listen_language: z.enum(["th", "en", "zh", "ja", "ko", "fr", "de", "es"]),
  room_revision: z.string().uuid(),
  member_revision: z.string().uuid(),
  consent_policy_version: z.string().min(1).max(128),
  meeting_notice_version: z.string().min(1).max(128),
  accepted_at: z.coerce.date(),
  announcement_acknowledged_at: z.coerce.date(),
}).strict();

export type MeetingAdmissionRecord = z.infer<typeof admissionRowSchema>;
export type AdmissionQuery = Pick<PoolClient, "query">;

/**
 * Reads only the durable server-owned state needed to attest an admission.
 * There is intentionally no method that accepts a room, participant, role,
 * language, consent, or revision from a client.
 */
export function createMeetingAdmissionRepository() {
  return {
    async findAuthorized(
      db: AdmissionQuery,
      grant: { meetingId: string; tenantId: number; userId: number },
    ): Promise<MeetingAdmissionRecord | null> {
      const result = await db.query(
        `SELECT r.id AS meeting_id, r.tenant_id, m.user_id, m.participant_id,
                m.role, m.grant_profile, m.listen_language,
                r.revision AS room_revision, m.revision AS member_revision,
                r.consent_policy_version, r.meeting_notice_version,
                c.accepted_at, c.announcement_acknowledged_at
           FROM phone11_meeting_admission_rooms r
           JOIN tenants t ON t.id = r.tenant_id AND t.status = 'active'
           JOIN tenant_memberships tm
             ON tm.tenant_id = r.tenant_id AND tm.user_id = $3 AND tm.status = 'active'
           JOIN phone11_meeting_admission_members m
             ON m.meeting_id = r.id AND m.tenant_id = r.tenant_id
           JOIN phone11_meeting_consent_receipts c
             ON c.meeting_id = r.id AND c.tenant_id = r.tenant_id
            AND c.user_id = m.user_id AND c.participant_id = m.participant_id
            AND c.purpose = 'live_interpretation' AND c.accepted_at IS NOT NULL
            AND c.policy_version = r.consent_policy_version
            AND c.meeting_notice_version = r.meeting_notice_version
            AND c.withdrawn_at IS NULL
          WHERE r.id = $1 AND r.tenant_id = $2 AND m.user_id = $3
            AND r.state = 'open' AND r.ended_at IS NULL
            AND m.revoked_at IS NULL AND m.lobby_state = 'admitted'`,
        [grant.meetingId, grant.tenantId, grant.userId],
      );
      if (result.rows.length !== 1) return null;
      return admissionRowSchema.safeParse(result.rows[0]).data ?? null;
    },
  };
}

export type ReadOnlyTransaction = <T>(
  fn: (db: AdmissionQuery) => Promise<T>,
) => Promise<T>;

/**
 * Small transaction adapter for the future composition root. The admission
 * resolver only receives its transaction through this interface, keeping its
 * authorization path read-only even after it is mounted.
 */
export function createPostgresReadOnlyTransaction(
  pool: Pick<Pool, "connect">,
): ReadOnlyTransaction {
  return async <T>(fn: (db: AdmissionQuery) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '3s'");
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
