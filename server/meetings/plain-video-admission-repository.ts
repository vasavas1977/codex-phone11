import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import type { AvailableMeetingGrant, MeetingGrant, MeetingRepository } from "./service";
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

/** A channel name is presentation data, never an admission or media identity. */
function normalizedChannelMeetingTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const title = value.normalize("NFC").trim();
  if (!title || Array.from(title).length > 100 || Buffer.byteLength(title, "utf8") > 400) return undefined;
  if (/[\u0000-\u001f\u007f-\u009f\ud800-\udfff\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(title)) return undefined;
  return title;
}

/** A bounded, exact-key recheck; legacy rooms and unavailable channel storage have no title. */
async function availableChannelMeetingTitle(db: PlainVideoAdmissionQuery, grant: MeetingGrant): Promise<string | undefined> {
  try {
    const support = await db.query("SELECT to_regclass('public.phone11_channel_meetings') IS NOT NULL AS available");
    if (support.rows[0]?.available !== true) return undefined;
    const result = await db.query(`SELECT conversation.name AS title
      FROM phone11_channel_meetings source
      JOIN phone11_chat_conversations conversation ON conversation.tenant_id=source.tenant_id
        AND conversation.id=source.channel_id AND conversation.kind IN ('group','channel')
      JOIN phone11_chat_members member ON member.tenant_id=source.tenant_id
        AND member.conversation_id=source.channel_id AND member.user_id=$3
      JOIN tenant_memberships membership ON membership.tenant_id=source.tenant_id
        AND membership.user_id=member.user_id AND membership.status='active'
      JOIN tenants tenant ON tenant.id=source.tenant_id AND tenant.status='active'
      JOIN phone11_auth_identity identity ON identity.legacy_user_id=member.user_id
        AND identity.disabled_at IS NULL
      JOIN phone11_plain_video_admission_rooms room ON room.id=source.meeting_id
        AND room.tenant_id=source.tenant_id AND room.state='open' AND room.ended_at IS NULL
      JOIN phone11_plain_video_admission_members admission ON admission.meeting_id=room.id
        AND admission.tenant_id=room.tenant_id AND admission.user_id=member.user_id
        AND admission.revoked_at IS NULL AND admission.lobby_state='admitted'
      WHERE source.meeting_id=$1 AND source.tenant_id=$2
        AND source.expires_at>clock_timestamp()+INTERVAL '5 minutes'
        AND EXISTS(SELECT 1 FROM user_extensions ue JOIN extensions extension ON extension.id=ue.extension_id
          WHERE ue.user_id=member.user_id AND extension.tenant_id=source.tenant_id
            AND extension.status='active' AND extension.deleted_at IS NULL)
      LIMIT 2`, [grant.meetingId, grant.tenantId, grant.userId]);
    return result.rows.length === 1 ? normalizedChannelMeetingTitle(result.rows[0].title) : undefined;
  } catch {
    // The title is optional. Failure must not revoke a separately admitted legacy room.
    return undefined;
  }
}

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
      const available: AvailableMeetingGrant[] = [];
      let afterMeetingId: string | null = null;
      while (available.length < 10) {
        const result = await candidatePage(db, userId, configuredTenantIds, afterMeetingId);
        for (const row of result.rows) {
          const parsed = availableMeetingGrantSchema.safeParse(row);
          if (parsed.success && parsed.data.user_id === userId &&
            configuredTenantIds.includes(parsed.data.tenant_id) &&
            await channelMeetingOriginAllows(db, {
              meetingId: parsed.data.meeting_id, tenantId: parsed.data.tenant_id, userId: parsed.data.user_id,
            })) {
              const grant = { meetingId: parsed.data.meeting_id,
                tenantId: parsed.data.tenant_id, userId: parsed.data.user_id };
              const title = await availableChannelMeetingTitle(db, grant);
              available.push(title ? { ...grant, title } : grant);
            }
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
