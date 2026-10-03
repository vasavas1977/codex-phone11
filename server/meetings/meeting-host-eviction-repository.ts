import { createHash } from "node:crypto";
import { z } from "zod";

import { channelMeetingOriginAllows } from "./channel-meeting-origin";
import {
  plainVideoAdmissionAdmitted,
  plainVideoAdmissionSelection,
  parseExactPlainVideoAdmissionRecord,
} from "./plain-video-admission-repository";
import {
  createPlainVideoEvictionRepository,
  type PlainVideoEvictionOperation,
  type PlainVideoEvictionTransaction,
} from "./plain-video-eviction-repository";

const userId = z.number().int().positive().refine(Number.isSafeInteger);
export const meetingHostRemovalSchema = z
  .object({
    tenantId: userId,
    meetingId: z.string().uuid(),
    targetUserId: userId,
  })
  .strict();
export type MeetingHostRemovalInput = z.infer<typeof meetingHostRemovalSchema>;

/** One permanent removal intent for the durable provider subject, across retries/processes. */
export function meetingHostRemovalKey(
  tenantId: number,
  meetingId: string,
  participantId: string,
): string {
  return `phone11_remove_${createHash("sha256")
    .update(JSON.stringify([tenantId, meetingId, participantId]))
    .digest("hex")}`;
}

/**
 * Unmounted host authority boundary. Only the original channel/direct creator
 * has host authority; legacy admitted rooms have no host and are refused.
 * Authorization and durable local denial commit together, before provider I/O.
 */
export function createMeetingHostEvictionRepository(
  transaction: PlainVideoEvictionTransaction,
) {
  const eviction = createPlainVideoEvictionRepository(transaction);
  async function authorizeAndResolve(
    actorId: number,
    raw: unknown,
    begin: boolean,
  ): Promise<PlainVideoEvictionOperation | null> {
    const input = meetingHostRemovalSchema.safeParse(raw);
    if (
      !userId.safeParse(actorId).success ||
      !input.success ||
      actorId === input.data.targetUserId
    )
      return null;
    const scope = input.data;
    return transaction(async (db) => {
      // Same tenant-first order as meeting start and permission revocation.
      const tenant = await db.query(
        "SELECT id FROM tenants WHERE id=$1 AND status='active' FOR SHARE",
        [scope.tenantId],
      );
      if (tenant.rows.length !== 1) return null;
      const support =
        await db.query(`SELECT to_regclass('public.phone11_channel_meetings') IS NOT NULL AS available,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='phone11_channel_meetings' AND column_name='origin_kind') AS direct_available`);
      if (support.rows[0]?.available !== true) return null;
      const source = await db.query(
        `SELECT channel_id, created_by,
        ${support.rows[0]?.direct_available === true ? "origin_kind" : "'channel'::text AS origin_kind"}
        FROM phone11_channel_meetings WHERE meeting_id=$1 AND tenant_id=$2
          AND created_by=$3 AND expires_at>clock_timestamp()+INTERVAL '5 minutes' FOR SHARE`,
        [scope.meetingId, scope.tenantId, actorId],
      );
      const origin = z
        .object({
          channel_id: z.string().uuid(),
          created_by: z.coerce.number().int().positive(),
          origin_kind: z.enum(["channel", "direct"]),
        })
        .strict()
        .safeParse(source.rows[0]);
      if (
        source.rows.length !== 1 ||
        !origin.success ||
        origin.data.created_by !== actorId
      )
        return null;
      for (const memberId of [actorId, scope.targetUserId].sort(
        (a, b) => a - b,
      )) {
        if (
          !(await channelMeetingOriginAllows(
            db,
            {
              meetingId: scope.meetingId,
              tenantId: scope.tenantId,
              userId: memberId,
            },
            true,
          ))
        )
          return null;
      }
      const permission = await db.query(
        `SELECT user_id FROM phone11_chat_members
          WHERE tenant_id=$1 AND conversation_id=$2 AND user_id=$3 AND can_start_meeting=TRUE FOR SHARE`,
        [scope.tenantId, origin.data.channel_id, actorId],
      );
      if (
        permission.rows.length !== 1 ||
        Number(permission.rows[0].user_id) !== actorId
      )
        return null;
      const actor = await db.query(
        `${plainVideoAdmissionSelection}
        WHERE r.id=$1 AND r.tenant_id=$2 AND m.user_id=$3 AND ${plainVideoAdmissionAdmitted}
        FOR UPDATE OF r, m, ai, tm`,
        [scope.meetingId, scope.tenantId, actorId],
      );
      const host =
        actor.rows.length === 1 &&
        parseExactPlainVideoAdmissionRecord(actor.rows[0], {
          meetingId: scope.meetingId,
          tenantId: scope.tenantId,
          userId: actorId,
        });
      if (!host) return null;
      // A revoked target is accepted only by the exact existing operation below,
      // enabling replay/poll without reopening admission or accepting unrelated revocations.
      const targetRows = await db.query(
        `${plainVideoAdmissionSelection}
        WHERE r.id=$1 AND r.tenant_id=$2 AND m.user_id=$3
          AND r.state='open' AND r.ended_at IS NULL AND m.lobby_state='admitted'
        FOR UPDATE OF r, m, ai, tm`,
        [scope.meetingId, scope.tenantId, scope.targetUserId],
      );
      const targetRecord =
        targetRows.rows.length === 1 &&
        parseExactPlainVideoAdmissionRecord(targetRows.rows[0], {
          meetingId: scope.meetingId,
          tenantId: scope.tenantId,
          userId: scope.targetUserId,
        });
      if (!targetRecord || targetRecord.participant_id === host.participant_id)
        return null;
      const target = {
        meetingId: scope.meetingId,
        tenantId: scope.tenantId,
        userId: scope.targetUserId,
        participantId: targetRecord.participant_id,
      };
      const key = meetingHostRemovalKey(
        scope.tenantId,
        scope.meetingId,
        target.participantId,
      );
      // Reuse existing lifecycle writes inside these same held authority locks.
      const local = createPlainVideoEvictionRepository(async (fn) => fn(db));
      return begin ? local.begin(target, key) : local.get(target, key);
    });
  }
  return {
    begin: (actorId: number, input: MeetingHostRemovalInput) =>
      authorizeAndResolve(actorId, input, true),
    get: (actorId: number, input: MeetingHostRemovalInput) =>
      authorizeAndResolve(actorId, input, false),
    record: eviction.record,
  };
}
