import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { z } from "zod";

import { withTransaction } from "../pbx/db";

type StartInput = { actorId: number; tenantId: number; conversationId: string; requestId: string; meetingId: string };
const invitationRow = z.object({ invitation_id: z.string().uuid(), meeting_id: z.string().uuid(),
  conversation_id: z.string().uuid(), created_by: z.coerce.number().int().positive(),
  created_at: z.coerce.date(), expires_at: z.coerce.date() }).strict();

async function installed(db: PoolClient) {
  const rows = await db.query(`SELECT to_regclass('public.phone11_channel_meetings') IS NOT NULL
    AND to_regclass('public.phone11_channel_meeting_invitations') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='phone11_channel_meetings' AND column_name='origin_kind')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.phone11_channel_meetings')
      AND conname='phone11_channel_meetings_origin_kind_check' AND convalidated)
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.phone11_chat_blocks')
      AND tgname='phone11_direct_meeting_block_pair' AND tgenabled='O')
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='phone11_chat_members' AND column_name='can_start_meeting') AS available`);
  return rows.rows[0]?.available === true;
}

function fingerprint(conversationId: string, peerId: number) {
  return createHash("sha256").update(JSON.stringify(["direct", conversationId, peerId])).digest("hex");
}

function pairKey(tenantId: number, first: number, second: number) {
  const [low, high] = [first, second].sort((a, b) => a - b);
  return `phone11-chat-safety:${tenantId}:${low}:${high}`;
}

async function blocked(db: PoolClient, tenantId: number, first: number, second: number) {
  const rows = await db.query(`SELECT 1 FROM phone11_chat_blocks WHERE tenant_id=$1
    AND ((blocker_id=$2 AND blocked_id=$3) OR (blocker_id=$3 AND blocked_id=$2)) LIMIT 1`,
  [tenantId, first, second]);
  return rows.rows.length > 0;
}

async function directMembers(db: PoolClient, tenantId: number, conversationId: string, lock = false) {
  const rows = await db.query(`SELECT user_id,can_start_meeting FROM phone11_chat_members
    WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY user_id LIMIT 3${lock ? " FOR UPDATE" : ""}`,
  [tenantId, conversationId]);
  return rows.rows.map((row) => ({ userId: Number(row.user_id), canStart: row.can_start_meeting === true }));
}

function peerOf(members: readonly { userId: number }[], actorId: number): number | null {
  return members.length === 2 && members[0].userId !== members[1].userId
    ? members.find((member) => member.userId !== actorId)?.userId ?? null : null;
}

async function activeParticipant(db: PoolClient, tenantId: number, userId: number) {
  const rows = await db.query(`SELECT 1 FROM tenant_memberships membership
    JOIN tenants tenant ON tenant.id=membership.tenant_id AND tenant.status='active'
    JOIN phone11_auth_identity identity ON identity.legacy_user_id=membership.user_id AND identity.disabled_at IS NULL
    WHERE membership.tenant_id=$1 AND membership.user_id=$2 AND membership.status='active'
      AND EXISTS(SELECT 1 FROM user_extensions assignment JOIN extensions extension
        ON extension.id=assignment.extension_id AND extension.tenant_id=membership.tenant_id
          AND extension.status='active' AND extension.deleted_at IS NULL
        WHERE assignment.user_id=membership.user_id)`, [tenantId, userId]);
  return rows.rows.length === 1;
}

export type DirectMeetingRepository = ReturnType<typeof createDirectMeetingRepository>;

export function createDirectMeetingRepository(transaction: typeof withTransaction = withTransaction) {
  return {
    async canStart(actorId: number, tenantId: number, conversationId: string) {
      return transaction(async (db) => {
        await db.query("SET LOCAL statement_timeout = '3s'");
        if (!await installed(db)) return false;
        const conversation = await db.query(`SELECT id FROM phone11_chat_conversations
          WHERE tenant_id=$1 AND id=$2 AND kind='direct'`, [tenantId, conversationId]);
        if (conversation.rows.length !== 1) return false;
        const members = await directMembers(db, tenantId, conversationId);
        const peerId = peerOf(members, actorId);
        return peerId !== null && members.some((member) => member.userId === actorId && member.canStart)
          && await activeParticipant(db, tenantId, actorId)
          && await activeParticipant(db, tenantId, peerId)
          && !await blocked(db, tenantId, actorId, peerId);
      });
    },

    async start(input: StartInput) {
      return transaction(async (db) => {
        await db.query("SET LOCAL statement_timeout = '3s'");
        await db.query("SET LOCAL lock_timeout = '2s'");
        if (!await installed(db)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Direct meeting storage is not installed." });
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`phone11-channel-meeting:${input.tenantId}:${input.conversationId}`]);
        // A SHARE lock stabilizes tenant status and remains compatible with
        // chat block's authorizeWorkspace read before both take the pair lock.
        const tenant = await db.query("SELECT id FROM tenants WHERE id=$1 AND status='active' FOR SHARE", [input.tenantId]);
        if (tenant.rows.length !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "This workspace is unavailable." });
        const conversation = await db.query(`SELECT id FROM phone11_chat_conversations
          WHERE tenant_id=$1 AND id=$2 AND kind='direct' FOR UPDATE`, [input.tenantId, input.conversationId]);
        if (conversation.rows.length !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "This direct conversation is unavailable." });
        const members = await directMembers(db, input.tenantId, input.conversationId, true);
        const peerId = peerOf(members, input.actorId);
        if (peerId === null || !members.some((member) => member.userId === input.actorId && member.canStart))
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot start a meeting with this contact." });
        const ids = [input.actorId, peerId].sort((a, b) => a - b);
        const memberships = await db.query(`SELECT user_id FROM tenant_memberships
          WHERE tenant_id=$1 AND user_id=ANY($2::integer[]) AND status='active'
          ORDER BY user_id FOR UPDATE`, [input.tenantId, ids]);
        const identities = await db.query(`SELECT legacy_user_id AS user_id FROM phone11_auth_identity
          WHERE legacy_user_id=ANY($1::integer[]) AND disabled_at IS NULL
          ORDER BY legacy_user_id FOR UPDATE`, [ids]);
        const assignments = await db.query(`SELECT assignment.user_id,assignment.extension_id FROM user_extensions assignment
          JOIN extensions extension ON extension.id=assignment.extension_id AND extension.tenant_id=$1
            AND extension.status='active' AND extension.deleted_at IS NULL
          WHERE assignment.user_id=ANY($2::integer[]) ORDER BY assignment.user_id,assignment.id
          FOR UPDATE OF assignment`, [input.tenantId, ids]);
        const extensionIds = [...new Set(assignments.rows.map((row) => Number(row.extension_id)))].sort((a, b) => a - b);
        const extensions = await db.query(`SELECT id FROM extensions WHERE id=ANY($1::integer[])
          AND tenant_id=$2 AND status='active' AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [extensionIds, input.tenantId]);
        const eligible = new Set(extensions.rows.map((row) => Number(row.id)));
        const matches = (rows: readonly { user_id: unknown }[]) => ids.every((id) => rows.some((row) => Number(row.user_id) === id));
        if (!matches(members.map((member) => ({ user_id: member.userId }))) || !matches(memberships.rows)
          || !matches(identities.rows) || !matches(assignments.rows.filter((row) => eligible.has(Number(row.extension_id)))))
          throw new TRPCError({ code: "FORBIDDEN", message: "A direct meeting participant is no longer eligible." });
        // Chat block/unblock first reads membership/extension authority, then
        // takes this pair lock. Use the same order to avoid a lock upgrade
        // cycle, and hold the pair lock through the meeting writes.
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [pairKey(input.tenantId, input.actorId, peerId)]);
        if (await blocked(db, input.tenantId, input.actorId, peerId))
          throw new TRPCError({ code: "FORBIDDEN", message: "This contact is unavailable." });
        const digest = fingerprint(input.conversationId, peerId);
        const replay = await db.query(`SELECT meeting_id,channel_id,origin_kind,selection_fingerprint
          FROM phone11_channel_meetings WHERE tenant_id=$1 AND created_by=$2 AND request_id=$3`,
        [input.tenantId, input.actorId, input.requestId]);
        if (replay.rows[0]) {
          if (replay.rows[0].origin_kind !== "direct" || replay.rows[0].channel_id !== input.conversationId
            || replay.rows[0].selection_fingerprint !== digest)
            throw new TRPCError({ code: "CONFLICT", message: "This request ID belongs to another meeting." });
          return { meetingId: replay.rows[0].meeting_id, conversationId: input.conversationId,
            invitedMemberId: peerId, replayed: true };
        }
        const recent = await db.query(`SELECT count(*)::integer AS count FROM phone11_channel_meetings
          WHERE tenant_id=$1 AND created_by=$2 AND created_at>=clock_timestamp()-INTERVAL '1 minute'`,
        [input.tenantId, input.actorId]);
        if (Number(recent.rows[0]?.count ?? 0) >= 5)
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many meetings. Try again shortly." });
        await db.query(`INSERT INTO phone11_plain_video_admission_rooms(id,tenant_id,state,revision)
          VALUES($1,$2,'open',$3)`, [input.meetingId, input.tenantId, randomUUID()]);
        await db.query(`INSERT INTO phone11_channel_meetings
          (meeting_id,tenant_id,channel_id,created_by,request_id,selection_fingerprint,origin_kind)
          VALUES($1,$2,$3,$4,$5,$6,'direct')`,
        [input.meetingId, input.tenantId, input.conversationId, input.actorId, input.requestId, digest]);
        for (const userId of ids) await db.query(`INSERT INTO phone11_plain_video_admission_members
          (meeting_id,tenant_id,user_id,participant_id,grant_profile,lobby_state,revision)
          VALUES($1,$2,$3,$4,'interactive','admitted',$5)`,
        [input.meetingId, input.tenantId, userId, `pv_${randomUUID().replaceAll("-", "")}`, randomUUID()]);
        await db.query(`INSERT INTO phone11_channel_meeting_invitations
          (id,meeting_id,tenant_id,channel_id,recipient_id) VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), input.meetingId, input.tenantId, input.conversationId, peerId]);
        return { meetingId: input.meetingId, conversationId: input.conversationId,
          invitedMemberId: peerId, replayed: false };
      });
    },

    async invitations(userId: number, tenantId: number, conversationId?: string) {
      return transaction(async (db) => {
        await db.query("SET LOCAL statement_timeout = '3s'");
        if (!await installed(db)) return [];
        const rows = await db.query(`SELECT invitation.id AS invitation_id, invitation.meeting_id,
            invitation.channel_id AS conversation_id, source.created_by, invitation.created_at, source.expires_at
          FROM phone11_channel_meeting_invitations invitation
          JOIN phone11_channel_meetings source ON source.meeting_id=invitation.meeting_id
            AND source.tenant_id=invitation.tenant_id AND source.channel_id=invitation.channel_id
            AND source.origin_kind='direct'
          JOIN phone11_chat_conversations conversation ON conversation.tenant_id=source.tenant_id
            AND conversation.id=source.channel_id AND conversation.kind='direct'
          JOIN phone11_plain_video_admission_rooms room ON room.id=source.meeting_id
            AND room.tenant_id=source.tenant_id AND room.state='open' AND room.ended_at IS NULL
          JOIN phone11_plain_video_admission_members admission ON admission.meeting_id=source.meeting_id
            AND admission.tenant_id=source.tenant_id AND admission.user_id=invitation.recipient_id
            AND admission.lobby_state='admitted' AND admission.revoked_at IS NULL
          JOIN phone11_chat_members member ON member.tenant_id=source.tenant_id
            AND member.conversation_id=source.channel_id AND member.user_id=invitation.recipient_id
          JOIN phone11_chat_members host_member ON host_member.tenant_id=source.tenant_id
            AND host_member.conversation_id=source.channel_id AND host_member.user_id=source.created_by
          JOIN tenant_memberships membership ON membership.tenant_id=source.tenant_id
            AND membership.user_id=invitation.recipient_id AND membership.status='active'
          JOIN tenant_memberships host_membership ON host_membership.tenant_id=source.tenant_id
            AND host_membership.user_id=source.created_by AND host_membership.status='active'
          JOIN tenants tenant ON tenant.id=source.tenant_id AND tenant.status='active'
          JOIN phone11_auth_identity identity ON identity.legacy_user_id=invitation.recipient_id
            AND identity.disabled_at IS NULL
          JOIN phone11_auth_identity host_identity ON host_identity.legacy_user_id=source.created_by
            AND host_identity.disabled_at IS NULL
          WHERE invitation.tenant_id=$1 AND invitation.recipient_id=$2
            AND ($3::uuid IS NULL OR invitation.channel_id=$3)
            AND source.expires_at>clock_timestamp()+INTERVAL '5 minutes'
            AND (SELECT count(*) FROM phone11_chat_members peer WHERE peer.tenant_id=source.tenant_id
              AND peer.conversation_id=source.channel_id)=2
            AND NOT EXISTS(SELECT 1 FROM phone11_chat_blocks block WHERE block.tenant_id=source.tenant_id
              AND ((block.blocker_id=invitation.recipient_id AND block.blocked_id=source.created_by)
                OR (block.blocker_id=source.created_by AND block.blocked_id=invitation.recipient_id)))
            AND EXISTS(SELECT 1 FROM user_extensions assignment JOIN extensions extension
              ON extension.id=assignment.extension_id AND extension.tenant_id=source.tenant_id
                AND extension.status='active' AND extension.deleted_at IS NULL
              WHERE assignment.user_id=invitation.recipient_id)
            AND EXISTS(SELECT 1 FROM user_extensions assignment JOIN extensions extension
              ON extension.id=assignment.extension_id AND extension.tenant_id=source.tenant_id
                AND extension.status='active' AND extension.deleted_at IS NULL
              WHERE assignment.user_id=source.created_by)
          ORDER BY invitation.created_at DESC LIMIT 50`, [tenantId, userId, conversationId ?? null]);
        return rows.rows.flatMap((row) => {
          const parsed = invitationRow.safeParse(row);
          return parsed.success ? [{ invitationId: parsed.data.invitation_id, meetingId: parsed.data.meeting_id,
            conversationId: parsed.data.conversation_id, createdBy: parsed.data.created_by,
            createdAt: parsed.data.created_at.getTime(), expiresAt: parsed.data.expires_at.getTime() }] : [];
        });
      });
    },
  };
}
