import { createHash } from "node:crypto";
import { z } from "zod";

import { channelMeetingOriginAllows } from "./channel-meeting-origin";
import { normalizePlainVideoDisplayName } from "./plain-video-display-name";
import {
  plainVideoAdmissionAdmitted,
  plainVideoAdmissionSelection,
  parseExactPlainVideoAdmissionRecord,
} from "./plain-video-admission-repository";
import {
  createPlainVideoEvictionRepository,
  type PlainVideoEvictionQuery,
  type PlainVideoEvictionOperation,
  type PlainVideoEvictionTransaction,
} from "./plain-video-eviction-repository";

const userId = z.number().int().positive().refine(Number.isSafeInteger);
export const meetingHostRemovalSchema = z
  .object({
    tenantId: userId,
    meetingId: z.string().uuid(),
    targetUserId: userId,
    /** Assertion from the server snapshot, never a replacement provider identity. */
    expectedParticipantId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
    expectedRoomRevision: z.string().uuid(),
    expectedMemberRevision: z.string().uuid(),
  })
  .strict();
export type MeetingHostRemovalInput = z.infer<typeof meetingHostRemovalSchema>;
export const meetingHostControlScopeSchema = z.object({ meetingId: z.string().uuid() }).strict();
export type MeetingHostControlSnapshot = {
  available: boolean;
  tenantId?: number;
  meetingId: string;
  members: { userId: number; expectedParticipantId: string; expectedRoomRevision: string; expectedMemberRevision: string; name?: string;
    state: "admitted" | "pending" | "completed" | "failed" }[];
};

/** One removal intent for the exact durable room lifetime and provider subject. */
export function meetingHostRemovalKey(
  tenantId: number,
  meetingId: string,
  participantId: string,
  roomRevision: string,
): string {
  return `phone11_remove_${createHash("sha256")
    .update(JSON.stringify([tenantId, meetingId, participantId, roomRevision]))
    .digest("hex")}`;
}

/**
 * Host authority boundary. Only the original channel/direct creator
 * has host authority; legacy admitted rooms have no host and are refused.
 * Authorization and durable local denial commit together, before provider I/O.
 */
export function createMeetingHostEvictionRepository(
  transaction: PlainVideoEvictionTransaction,
) {
  const eviction = createPlainVideoEvictionRepository(transaction);
  /** Presentation read only; request/poll independently reauthorize under authority locks. */
  async function snapshot(actorId: number, meetingId: string, allowedTenantIds: readonly number[]): Promise<MeetingHostControlSnapshot> {
    const unavailable: MeetingHostControlSnapshot = { available: false, meetingId, members: [] };
    if (!userId.safeParse(actorId).success || !meetingHostControlScopeSchema.safeParse({ meetingId }).success)
      return unavailable;
    return transaction(async (db: PlainVideoEvictionQuery) => {
      const support = await db.query("SELECT to_regclass('public.phone11_channel_meetings') IS NOT NULL AS available");
      if (support.rows[0]?.available !== true) return unavailable;
      const source = await db.query(`SELECT tenant_id, channel_id FROM phone11_channel_meetings
        WHERE meeting_id=$1 AND created_by=$2 AND expires_at>clock_timestamp()+INTERVAL '5 minutes'`,
      [meetingId, actorId]);
      const origin = z.object({ tenant_id: z.coerce.number().int().positive().refine(Number.isSafeInteger),
        channel_id: z.string().uuid() }).strict().safeParse(source.rows[0]);
      if (source.rows.length !== 1 || !origin.success) return unavailable;
      const tenantId = origin.data.tenant_id;
      if (!allowedTenantIds.includes(tenantId)) return unavailable;
      const scope = { tenantId, meetingId, userId: actorId };
      if (!(await channelMeetingOriginAllows(db, scope))) return unavailable;
      const permission = await db.query(`SELECT user_id FROM phone11_chat_members
        WHERE tenant_id=$1 AND conversation_id=$2 AND user_id=$3 AND can_start_meeting=TRUE`,
      [tenantId, origin.data.channel_id, actorId]);
      if (permission.rows.length !== 1 || Number(permission.rows[0].user_id) !== actorId) return unavailable;
      const actor = await db.query(`${plainVideoAdmissionSelection}
        WHERE r.id=$1 AND r.tenant_id=$2 AND m.user_id=$3 AND ${plainVideoAdmissionAdmitted}`,
      [meetingId, tenantId, actorId]);
      const host = actor.rows.length === 1 && parseExactPlainVideoAdmissionRecord(actor.rows[0], scope);
      if (!host) return unavailable;
      // Include only exact operations created for this durable member, so local
      // revocation still exposes bounded status/retry without reopening admission.
      const rows = await db.query(`${plainVideoAdmissionSelection.replace("SELECT r.id", "SELECT u.name, m.revoked_at, operation.state AS removal_state, operation.id AS removal_operation_id, operation.idempotency_key, r.id")}
        LEFT JOIN phone11_plain_video_eviction_operations operation ON operation.tenant_id=m.tenant_id
          AND operation.meeting_id=m.meeting_id AND operation.user_id=m.user_id
          AND operation.participant_id=m.participant_id
        WHERE r.id=$1 AND r.tenant_id=$2 AND m.user_id<>$3
          AND r.state='open' AND r.ended_at IS NULL AND m.lobby_state='admitted'
          AND (m.revoked_at IS NULL OR operation.id IS NOT NULL)
        ORDER BY m.user_id LIMIT 51`, [meetingId, tenantId, actorId]);
      if (rows.rows.length > 50) return unavailable;
      const members: MeetingHostControlSnapshot["members"] = [];
      for (const row of rows.rows) {
        const { name, revoked_at, removal_state, removal_operation_id, idempotency_key, ...admission } = row;
        const member = parseExactPlainVideoAdmissionRecord(admission, { meetingId, tenantId, userId: Number(row.user_id) });
        if (!member || member.participant_id === host.participant_id ||
          !(await channelMeetingOriginAllows(db, { meetingId, tenantId, userId: member.user_id }))) continue;
        const ownOperation = idempotency_key === meetingHostRemovalKey(tenantId, meetingId, member.participant_id, member.room_revision) &&
          removal_operation_id === member.member_revision;
        const state = z.enum(["pending", "completed", "failed"]).safeParse(removal_state);
        if (revoked_at !== null && (!ownOperation || !state.success)) continue;
        if (revoked_at === null && removal_operation_id !== null) continue;
        const label = normalizePlainVideoDisplayName(name);
        members.push({ userId: member.user_id, expectedParticipantId: member.participant_id,
          expectedRoomRevision: member.room_revision, expectedMemberRevision: member.member_revision,
          ...(label ? { name: label } : {}),
          state: ownOperation && state.success ? state.data : "admitted" });
      }
      // A read is advisory, never authority for the later action. Recheck after
      // the bounded member reads so a permission loss during loading fails closed.
      if (!(await channelMeetingOriginAllows(db, scope))) return unavailable;
      const stillHost = await db.query(`${plainVideoAdmissionSelection}
        WHERE r.id=$1 AND r.tenant_id=$2 AND m.user_id=$3 AND ${plainVideoAdmissionAdmitted}
          AND EXISTS(SELECT 1 FROM phone11_channel_meetings source
            JOIN phone11_chat_members permission ON permission.tenant_id=source.tenant_id
              AND permission.conversation_id=source.channel_id AND permission.user_id=source.created_by
              AND permission.can_start_meeting=TRUE
            WHERE source.meeting_id=r.id AND source.tenant_id=r.tenant_id AND source.created_by=$3
              AND source.expires_at>clock_timestamp()+INTERVAL '5 minutes')`, [meetingId, tenantId, actorId]);
      if (stillHost.rows.length !== 1 || !parseExactPlainVideoAdmissionRecord(stillHost.rows[0], scope)) return unavailable;
      return { available: true, tenantId, meetingId, members };
    });
  }
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
        `${plainVideoAdmissionSelection.replace("SELECT r.id", "SELECT m.revoked_at AS target_revoked_at, r.id")}
        WHERE r.id=$1 AND r.tenant_id=$2 AND m.user_id=$3
          AND r.state='open' AND r.ended_at IS NULL AND m.lobby_state='admitted'
        FOR UPDATE OF r, m, ai, tm`,
        [scope.meetingId, scope.tenantId, scope.targetUserId],
      );
      const targetRecord =
        targetRows.rows.length === 1 &&
        parseExactPlainVideoAdmissionRecord((({ target_revoked_at: _revoked, ...record }) => record)(targetRows.rows[0]), {
          meetingId: scope.meetingId,
          tenantId: scope.tenantId,
          userId: scope.targetUserId,
        });
      if (!targetRecord || targetRecord.participant_id === host.participant_id ||
        (scope.expectedParticipantId !== targetRecord.participant_id || scope.expectedRoomRevision !== targetRecord.room_revision))
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
        targetRecord.room_revision,
      );
      // Reuse existing lifecycle writes inside these same held authority locks.
      const local = createPlainVideoEvictionRepository(async (fn) => fn(db));
      // Never infer an old operation's room lifetime from a fresh caller assertion.
      // The key commits to that lifetime; the operation UUID commits to our own
      // local denial. A replacement/revocation, including a same-provider subject,
      // cannot inherit either proof. Legacy unbound operations remain denied.
      const previous = await db.query(`SELECT id, idempotency_key
        FROM phone11_plain_video_eviction_operations
        WHERE tenant_id=$1 AND meeting_id=$2 AND user_id=$3 AND participant_id=$4 FOR UPDATE`,
      [target.tenantId, target.meetingId, target.userId, target.participantId]);
      const revoked = targetRows.rows[0].target_revoked_at;
      if (previous.rows.length) {
        const operation = previous.rows[0];
        if (previous.rows.length !== 1 || revoked == null || operation.idempotency_key !== key ||
          operation.id !== targetRecord.member_revision) return null;
        // Exact original uncertain requests may reconcile their own denial even
        // though that transaction replaced the initiating member revision.
        return begin ? local.begin(target, key) : local.get(target, key);
      }
      if (!begin || revoked !== null || scope.expectedMemberRevision !== targetRecord.member_revision) return null;
      return local.begin(target, key);
    });
  }
  return {
    snapshot,
    begin: (actorId: number, input: MeetingHostRemovalInput) =>
      authorizeAndResolve(actorId, input, true),
    get: (actorId: number, input: MeetingHostRemovalInput) =>
      authorizeAndResolve(actorId, input, false),
    record: eviction.record,
  };
}
