import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import type { MeetingGrant, MeetingRepository } from "./service";
import { channelMeetingOriginAllows } from "./channel-meeting-origin";

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
  const candidatePage = (
    db: PlainVideoAdmissionQuery,
    userId: number,
    configuredTenantIds: readonly number[],
    afterMeetingId: string | null,
  ) => db.query(
    `WITH candidates AS (
       ${plainVideoAdmissionSelection}
        WHERE m.user_id = $1 AND r.tenant_id = ANY($2::integer[])
          AND ${plainVideoAdmissionAdmitted}
     )
     SELECT meeting_id, tenant_id, user_id FROM candidates
      WHERE ($3::uuid IS NULL OR meeting_id > $3)
      GROUP BY meeting_id, tenant_id, user_id
     HAVING count(*) = 1
      ORDER BY meeting_id
      LIMIT 10`,
    [userId, configuredTenantIds, afterMeetingId],
  );
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
      if (record && !await channelMeetingOriginAllows(db, {
        meetingId: record.meeting_id, tenantId: record.tenant_id, userId: record.user_id,
      })) return null;
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
      const record = parseExactPlainVideoAdmissionRecord(result.rows[0], grant);
      return record && await channelMeetingOriginAllows(db, grant) ? record : null;
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
      let afterMeetingId: string | null = null;
      while (true) {
        const result = await candidatePage(db, userId, configuredTenantIds, afterMeetingId);
        for (const row of result.rows) {
          const parsed = availableMeetingGrantSchema.safeParse(row);
          if (parsed.success && await channelMeetingOriginAllows(db, {
            meetingId: parsed.data.meeting_id, tenantId: parsed.data.tenant_id, userId: parsed.data.user_id,
          })) return true;
        }
        if (result.rows.length < 10) return false;
        const cursor = availableMeetingGrantSchema.safeParse(result.rows.at(-1));
        if (!cursor.success || cursor.data.meeting_id === afterMeetingId) return false;
        afterMeetingId = cursor.data.meeting_id;
      }
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
      const available: MeetingGrant[] = [];
      let afterMeetingId: string | null = null;
      while (available.length < 10) {
        const result = await candidatePage(db, userId, configuredTenantIds, afterMeetingId);
        for (const row of result.rows) {
          const parsed = availableMeetingGrantSchema.safeParse(row);
          if (parsed.success && parsed.data.user_id === userId &&
            configuredTenantIds.includes(parsed.data.tenant_id) &&
            await channelMeetingOriginAllows(db, {
              meetingId: parsed.data.meeting_id, tenantId: parsed.data.tenant_id, userId: parsed.data.user_id,
            })) available.push({ meetingId: parsed.data.meeting_id,
              tenantId: parsed.data.tenant_id, userId: parsed.data.user_id });
          if (available.length === 10) break;
        }
        if (result.rows.length < 10 || available.length === 10) break;
        const cursor = availableMeetingGrantSchema.safeParse(result.rows.at(-1));
        if (!cursor.success || cursor.data.meeting_id === afterMeetingId) break;
        afterMeetingId = cursor.data.meeting_id;
      }
      return available;
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
