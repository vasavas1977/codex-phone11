import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import type { MeetingGrant, MeetingRepository } from "./service";

const opaqueIdentifier = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);

export const plainVideoAdmissionRowSchema = z
  .object({
    meeting_id: z.string().uuid(),
    tenant_id: z.coerce.number().int().positive().refine(Number.isSafeInteger),
    user_id: z.coerce.number().int().positive().refine(Number.isSafeInteger),
    participant_id: opaqueIdentifier,
    grant_profile: z.enum(["interactive", "listener"]),
    room_revision: z.string().uuid(),
    member_revision: z.string().uuid(),
  })
  .strict();

export type PlainVideoAdmissionRecord = z.infer<
  typeof plainVideoAdmissionRowSchema
>;
const availableMeetingGrantSchema = z
  .object({
    meeting_id: z.string().uuid(),
    tenant_id: z.coerce.number().int().positive().refine(Number.isSafeInteger),
    user_id: z.coerce.number().int().positive().refine(Number.isSafeInteger),
  })
  .strict();
export type PlainVideoAdmissionQuery = Pick<PoolClient, "query">;
export type PlainVideoReadOnlyTransaction = <T>(
  fn: (db: PlainVideoAdmissionQuery) => Promise<T>,
) => Promise<T>;

export function parseExactPlainVideoAdmissionRecord(
  row: unknown,
  expected: { meetingId: string; userId: number; tenantId?: number },
): PlainVideoAdmissionRecord | null {
  const parsed = plainVideoAdmissionRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const record = parsed.data;
  if (
    record.meeting_id !== expected.meetingId ||
    record.user_id !== expected.userId ||
    (expected.tenantId !== undefined && record.tenant_id !== expected.tenantId)
  )
    return null;
  return record;
}

export const plainVideoAdmissionSelection = `SELECT r.id AS meeting_id, r.tenant_id, m.user_id,
                           m.participant_id, m.grant_profile,
                           r.revision AS room_revision, m.revision AS member_revision
                      FROM phone11_plain_video_admission_rooms r
                      JOIN tenants t ON t.id = r.tenant_id AND t.status = 'active'
                      JOIN phone11_plain_video_admission_members m
                        ON m.meeting_id = r.id AND m.tenant_id = r.tenant_id
                      JOIN users u ON u.id = m.user_id
                      JOIN phone11_auth_identity ai
                        ON ai.legacy_user_id = m.user_id AND ai.disabled_at IS NULL
                      JOIN tenant_memberships tm
                        ON tm.tenant_id = r.tenant_id AND tm.user_id = m.user_id
                       AND tm.status = 'active'`;

export const plainVideoAdmissionAdmitted = `r.state = 'open' AND r.ended_at IS NULL
                  AND m.revoked_at IS NULL AND m.lobby_state = 'admitted'`;

/**
 * Reads the plain-video lifecycle only. It never joins the interpretation
 * consent ledger, and it treats a disabled Phone11 identity as inactive.
 */
export function createPlainVideoAdmissionRepository() {
  return {
    async authorize(
      db: PlainVideoAdmissionQuery,
      userId: number,
      meetingId: string,
    ): Promise<MeetingGrant | null> {
      const result = await db.query(
        `${plainVideoAdmissionSelection}
          WHERE r.id = $1 AND m.user_id = $2 AND ${plainVideoAdmissionAdmitted}`,
        [meetingId, userId],
      );
      if (result.rows.length !== 1) return null;
      const record = parseExactPlainVideoAdmissionRecord(result.rows[0], {
        meetingId,
        userId,
      });
      return record
        ? {
            meetingId: record.meeting_id,
            tenantId: record.tenant_id,
            userId: record.user_id,
          }
        : null;
    },

    async findAuthorized(
      db: PlainVideoAdmissionQuery,
      grant: MeetingGrant,
    ): Promise<PlainVideoAdmissionRecord | null> {
      const result = await db.query(
        `${plainVideoAdmissionSelection}
          WHERE r.id = $1 AND r.tenant_id = $2 AND m.user_id = $3 AND ${plainVideoAdmissionAdmitted}`,
        [grant.meetingId, grant.tenantId, grant.userId],
      );
      if (result.rows.length !== 1) return null;
      return parseExactPlainVideoAdmissionRecord(result.rows[0], grant);
    },

    async hasAvailablePlainVideoAdmission(
      db: PlainVideoAdmissionQuery,
      userId: number,
      configuredTenantIds: readonly number[],
    ): Promise<boolean> {
      if (
        !Number.isSafeInteger(userId) ||
        userId < 1 ||
        !configuredTenantIds.length
      )
        return false;
      const result = await db.query(
        `WITH candidates AS (
           ${plainVideoAdmissionSelection}
            WHERE m.user_id = $1 AND r.tenant_id = ANY($2::integer[])
              AND ${plainVideoAdmissionAdmitted}
         )
         SELECT 1 FROM candidates
          GROUP BY meeting_id, tenant_id, user_id
         HAVING count(*) = 1
         LIMIT 1`,
        [userId, configuredTenantIds],
      );
      return result.rows.length === 1;
    },

    async listAvailablePlainVideoMeetings(
      db: PlainVideoAdmissionQuery,
      userId: number,
      configuredTenantIds: readonly number[],
    ): Promise<readonly MeetingGrant[]> {
      if (
        !Number.isSafeInteger(userId) ||
        userId < 1 ||
        !configuredTenantIds.length
      )
        return [];
      const result = await db.query(
        `WITH candidates AS (
           ${plainVideoAdmissionSelection}
            WHERE m.user_id = $1 AND r.tenant_id = ANY($2::integer[])
              AND ${plainVideoAdmissionAdmitted}
         )
         SELECT meeting_id, tenant_id, user_id FROM candidates
          GROUP BY meeting_id, tenant_id, user_id
         HAVING count(*) = 1
          ORDER BY meeting_id
         LIMIT 10`,
        [userId, configuredTenantIds],
      );
      return result.rows.flatMap((row) => {
        const parsed = availableMeetingGrantSchema.safeParse(row);
        return parsed.success &&
          parsed.data.user_id === userId &&
          configuredTenantIds.includes(parsed.data.tenant_id)
          ? [
              {
                meetingId: parsed.data.meeting_id,
                tenantId: parsed.data.tenant_id,
                userId: parsed.data.user_id,
              },
            ]
          : [];
      });
    },
  };
}

/**
 * Use this repository for the initial service authorization as well as the
 * resolver below. That keeps the pre-token grant on the same durable plain
 * video room/member lifecycle instead of mixing it with legacy meeting tables.
 */
export function createPlainVideoMeetingRepository(
  transaction: PlainVideoReadOnlyTransaction,
  repository = createPlainVideoAdmissionRepository(),
): MeetingRepository {
  return {
    authorize: (userId, meetingId) =>
      transaction((db) => repository.authorize(db, userId, meetingId)),
    hasAvailablePlainVideoAdmission: (userId, configuredTenantIds) =>
      transaction((db) =>
        repository.hasAvailablePlainVideoAdmission(
          db,
          userId,
          configuredTenantIds,
        ),
      ),
    listAvailablePlainVideoMeetings: (userId, configuredTenantIds) =>
      transaction((db) =>
        repository.listAvailablePlainVideoMeetings(
          db,
          userId,
          configuredTenantIds,
        ),
      ),
  };
}

export function createPlainVideoPostgresReadOnlyTransaction(
  pool: Pick<Pool, "connect">,
): PlainVideoReadOnlyTransaction {
  return async <T>(fn: (db: PlainVideoAdmissionQuery) => Promise<T>) => {
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
