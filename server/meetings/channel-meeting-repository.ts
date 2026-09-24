import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { z } from "zod";

import { withTransaction } from "../pbx/db";

type Transaction = typeof withTransaction;
type StartInput = {
  actorId: number;
  tenantId: number;
  channelId: string;
  selectedMemberIds: readonly number[];
  requestId: string;
  fingerprint: string;
  meetingId: string;
};
const invitationRow = z.object({
  invitation_id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  created_by: z.coerce.number().int().positive(),
  created_at: z.coerce.date(),
  expires_at: z.coerce.date(),
}).strict();

async function bound(db: PoolClient) {
  await db.query("SET LOCAL statement_timeout = '3s'");
  await db.query("SET LOCAL lock_timeout = '2s'");
}

async function installed(db: PoolClient) {
  const result = await db.query(`SELECT
    to_regclass('public.phone11_channel_meetings') IS NOT NULL
    AND to_regclass('public.phone11_channel_meeting_invitations') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='phone11_chat_members' AND column_name='can_start_meeting') AS available`);
  return result.rows[0]?.available === true;
}

async function starterAuthorized(db: PoolClient, input: StartInput) {
  const actor = await db.query(`SELECT member.user_id
    FROM phone11_chat_conversations conversation
    JOIN phone11_chat_members member ON member.tenant_id=conversation.tenant_id
      AND member.conversation_id=conversation.id AND member.user_id=$3
    JOIN tenant_memberships membership ON membership.tenant_id=conversation.tenant_id
      AND membership.user_id=member.user_id AND membership.status='active'
    JOIN tenants tenant ON tenant.id=conversation.tenant_id AND tenant.status='active'
    JOIN phone11_auth_identity identity ON identity.legacy_user_id=member.user_id AND identity.disabled_at IS NULL
    WHERE conversation.tenant_id=$1 AND conversation.id=$2
      AND conversation.kind IN ('group','channel') AND member.can_start_meeting=TRUE
      AND EXISTS(SELECT 1 FROM user_extensions ue JOIN extensions extension ON extension.id=ue.extension_id
        WHERE ue.user_id=member.user_id AND extension.tenant_id=conversation.tenant_id
          AND extension.status='active' AND extension.deleted_at IS NULL)`,
    [input.tenantId, input.channelId, input.actorId]);
  return actor.rows.length === 1;
}

function hasEveryParticipant(rows: readonly { user_id?: unknown }[], expected: readonly number[]) {
  const actual = [...new Set(rows.map(row => Number(row.user_id)))].sort((a, b) => a - b);
  return actual.length === expected.length && actual.every((userId, index) => userId === expected[index]);
}

export type ChannelMeetingRepository = ReturnType<typeof createChannelMeetingRepository>;

export function createChannelMeetingRepository(transaction: Transaction = withTransaction) {
  return {
    async canStart(userId: number, tenantId: number, channelId: string) {
      return transaction(async (db) => {
        await bound(db);
        if (!await installed(db)) return false;
        const result = await db.query(`SELECT 1
          FROM phone11_chat_conversations conversation
          JOIN phone11_chat_members member ON member.tenant_id=conversation.tenant_id
            AND member.conversation_id=conversation.id AND member.user_id=$3
          JOIN tenant_memberships membership ON membership.tenant_id=conversation.tenant_id
            AND membership.user_id=member.user_id AND membership.status='active'
          JOIN tenants tenant ON tenant.id=conversation.tenant_id AND tenant.status='active'
          JOIN phone11_auth_identity identity ON identity.legacy_user_id=member.user_id AND identity.disabled_at IS NULL
          WHERE conversation.tenant_id=$1 AND conversation.id=$2
            AND conversation.kind IN ('group','channel') AND member.can_start_meeting=TRUE
            AND EXISTS(SELECT 1 FROM user_extensions ue JOIN extensions extension ON extension.id=ue.extension_id
              WHERE ue.user_id=member.user_id AND extension.tenant_id=conversation.tenant_id
                AND extension.status='active' AND extension.deleted_at IS NULL)`, [tenantId, channelId, userId]);
        return result.rows.length === 1;
      });
    },

    async start(input: StartInput) {
      return transaction(async (db) => {
        await bound(db);
        if (!await installed(db))
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Channel meeting storage is not installed." });
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `phone11-channel-meeting:${input.tenantId}:${input.channelId}`,
        ]);
        const requestedParticipants = [input.actorId, ...input.selectedMemberIds].sort((a, b) => a - b);
        // Explicit table order is shared with admin host-permission edits:
        // tenant, channel, member, membership, identity, assignment/extension.
        // A joined FOR UPDATE leaves tenant/channel acquisition to the planner.
        const lockedTenant = await db.query(`SELECT id FROM tenants
          WHERE id=$1 AND status='active' FOR UPDATE`, [input.tenantId]);
        if (lockedTenant.rows.length !== 1)
          throw new TRPCError({ code: "FORBIDDEN", message: "This channel is no longer eligible for a meeting." });
        const lockedChannel = await db.query(`SELECT id FROM phone11_chat_conversations
          WHERE tenant_id=$1 AND id=$2 AND kind IN ('group','channel') FOR UPDATE`, [input.tenantId, input.channelId]);
        if (lockedChannel.rows.length !== 1)
          throw new TRPCError({ code: "FORBIDDEN", message: "This channel is no longer eligible for a meeting." });

        // Lock every mutable authorization source in a fixed table and user
        // order. A concurrent permission/status/identity/extension revocation
        // must therefore commit before these checks or wait until this start
        // transaction has committed its complete room and invitation set.
        const lockedMembers = await db.query(`SELECT member.user_id,member.can_start_meeting
          FROM phone11_chat_members member
          WHERE member.tenant_id=$1 AND member.conversation_id=$2
            AND member.user_id=ANY($3::integer[])
          ORDER BY member.user_id FOR UPDATE OF member`,
          [input.tenantId, input.channelId, requestedParticipants]);
        if (!hasEveryParticipant(lockedMembers.rows, requestedParticipants))
          throw new TRPCError({ code: "FORBIDDEN", message: "A channel meeting participant is no longer eligible." });
        const lockedMemberships = await db.query(`SELECT membership.user_id
          FROM tenant_memberships membership
          WHERE membership.tenant_id=$1 AND membership.user_id=ANY($2::integer[])
            AND membership.status='active'
          ORDER BY membership.user_id FOR UPDATE OF membership`,
          [input.tenantId, requestedParticipants]);
        if (!hasEveryParticipant(lockedMemberships.rows, requestedParticipants))
          throw new TRPCError({ code: "FORBIDDEN", message: "A channel meeting participant is no longer active." });
        const lockedIdentities = await db.query(`SELECT identity.legacy_user_id AS user_id
          FROM phone11_auth_identity identity
          WHERE identity.legacy_user_id=ANY($1::integer[]) AND identity.disabled_at IS NULL
          ORDER BY identity.legacy_user_id FOR UPDATE OF identity`, [requestedParticipants]);
        if (!hasEveryParticipant(lockedIdentities.rows, requestedParticipants))
          throw new TRPCError({ code: "FORBIDDEN", message: "A channel meeting participant has no active identity." });
        const lockedAssignments = await db.query(`SELECT assignment.user_id,assignment.extension_id
          FROM user_extensions assignment
          JOIN extensions extension ON extension.id=assignment.extension_id
            AND extension.tenant_id=$1 AND extension.status='active' AND extension.deleted_at IS NULL
          WHERE assignment.user_id=ANY($2::integer[])
          ORDER BY assignment.user_id,assignment.id
          FOR UPDATE OF assignment`, [input.tenantId, requestedParticipants]);
        const extensionIds = [...new Set(lockedAssignments.rows.map((row) => Number(row.extension_id)))].sort((a, b) => a - b);
        const lockedExtensions = await db.query(`SELECT id FROM extensions
          WHERE id=ANY($1::integer[]) AND tenant_id=$2 AND status='active' AND deleted_at IS NULL
          ORDER BY id FOR UPDATE`, [extensionIds, input.tenantId]);
        const eligibleExtensions = new Set(lockedExtensions.rows.map((row) => Number(row.id)));
        if (!hasEveryParticipant(lockedAssignments.rows.filter((row) => eligibleExtensions.has(Number(row.extension_id))), requestedParticipants))
          throw new TRPCError({ code: "FORBIDDEN", message: "A channel meeting participant has no active extension." });
        if (!await starterAuthorized(db, input))
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot start a meeting in this channel." });

        const replay = await db.query(`SELECT meeting_id,channel_id,selection_fingerprint
          FROM phone11_channel_meetings WHERE tenant_id=$1 AND created_by=$2 AND request_id=$3`,
          [input.tenantId, input.actorId, input.requestId]);
        if (replay.rows[0]) {
          if (replay.rows[0].channel_id !== input.channelId || replay.rows[0].selection_fingerprint !== input.fingerprint)
            throw new TRPCError({ code: "CONFLICT", message: "This request ID belongs to a different channel meeting." });
          return { meetingId: replay.rows[0].meeting_id, channelId: input.channelId,
            invitedMemberIds: [...input.selectedMemberIds].sort((a, b) => a - b), replayed: true };
        }
        const recent = await db.query(`SELECT count(*)::integer AS count
          FROM phone11_channel_meetings WHERE tenant_id=$1 AND created_by=$2
            AND created_at>=clock_timestamp()-INTERVAL '1 minute'`, [input.tenantId, input.actorId]);
        if (Number(recent.rows[0]?.count ?? 0) >= 5)
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many channel meetings. Try again shortly." });

        const invitees = input.selectedMemberIds.length ? await db.query(`SELECT member.user_id
          FROM phone11_chat_members member
          JOIN tenant_memberships membership ON membership.tenant_id=member.tenant_id
            AND membership.user_id=member.user_id AND membership.status='active'
          JOIN phone11_auth_identity identity ON identity.legacy_user_id=member.user_id AND identity.disabled_at IS NULL
          WHERE member.tenant_id=$1 AND member.conversation_id=$2 AND member.user_id=ANY($3::integer[])
            AND member.user_id<>$4
            AND EXISTS(SELECT 1 FROM user_extensions ue JOIN extensions extension ON extension.id=ue.extension_id
              WHERE ue.user_id=member.user_id AND extension.tenant_id=member.tenant_id
                AND extension.status='active' AND extension.deleted_at IS NULL)
          ORDER BY member.user_id`,
          [input.tenantId, input.channelId, input.selectedMemberIds, input.actorId]) : { rows: [] };
        const resolved = invitees.rows.map((row) => Number(row.user_id));
        const selected = [...input.selectedMemberIds].sort((a, b) => a - b);
        if (resolved.length !== selected.length || resolved.some((id, index) => id !== selected[index]))
          throw new TRPCError({ code: "FORBIDDEN", message: "A selected member is no longer eligible for this channel meeting." });
        // Repeat the complete mutable authorization predicate immediately before
        // writes. This closes the decision if a revocation transaction won the
        // race before our row locks were established.
        if (!await starterAuthorized(db, input))
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot start a meeting in this channel." });

        const participants = [input.actorId, ...selected];
        const roomRevision = randomUUID();
        await db.query(`INSERT INTO phone11_plain_video_admission_rooms(id,tenant_id,state,revision)
          VALUES($1,$2,'open',$3)`, [input.meetingId, input.tenantId, roomRevision]);
        await db.query(`INSERT INTO phone11_channel_meetings
          (meeting_id,tenant_id,channel_id,created_by,request_id,selection_fingerprint)
          VALUES($1,$2,$3,$4,$5,$6)`, [input.meetingId, input.tenantId, input.channelId,
          input.actorId, input.requestId, input.fingerprint]);
        for (const userId of participants) await db.query(`INSERT INTO phone11_plain_video_admission_members
          (meeting_id,tenant_id,user_id,participant_id,grant_profile,lobby_state,revision)
          VALUES($1,$2,$3,$4,'interactive','admitted',$5)`, [input.meetingId, input.tenantId,
          userId, `pv_${randomUUID().replaceAll("-", "")}`, randomUUID()]);
        for (const userId of selected) await db.query(`INSERT INTO phone11_channel_meeting_invitations
          (id,meeting_id,tenant_id,channel_id,recipient_id) VALUES($1,$2,$3,$4,$5)`,
          [randomUUID(), input.meetingId, input.tenantId, input.channelId, userId]);
        return { meetingId: input.meetingId, channelId: input.channelId,
          invitedMemberIds: selected, replayed: false };
      });
    },

    async invitations(userId: number, tenantId: number, channelId?: string) {
      return transaction(async (db) => {
        await bound(db);
        if (!await installed(db)) return [];
        const result = await db.query(`SELECT invitation.id AS invitation_id,invitation.meeting_id,
            invitation.channel_id,source.created_by,invitation.created_at,source.expires_at
          FROM phone11_channel_meeting_invitations invitation
          JOIN phone11_channel_meetings source ON source.meeting_id=invitation.meeting_id
            AND source.tenant_id=invitation.tenant_id AND source.channel_id=invitation.channel_id
          JOIN phone11_plain_video_admission_rooms room ON room.id=invitation.meeting_id
            AND room.tenant_id=invitation.tenant_id AND room.state='open' AND room.ended_at IS NULL
          JOIN phone11_plain_video_admission_members admission ON admission.meeting_id=invitation.meeting_id
            AND admission.tenant_id=invitation.tenant_id AND admission.user_id=invitation.recipient_id
            AND admission.lobby_state='admitted' AND admission.revoked_at IS NULL
          JOIN phone11_chat_members member ON member.tenant_id=invitation.tenant_id
            AND member.conversation_id=invitation.channel_id AND member.user_id=invitation.recipient_id
          JOIN tenant_memberships membership ON membership.tenant_id=invitation.tenant_id
            AND membership.user_id=invitation.recipient_id AND membership.status='active'
          JOIN tenants tenant ON tenant.id=invitation.tenant_id AND tenant.status='active'
          JOIN phone11_auth_identity identity ON identity.legacy_user_id=invitation.recipient_id AND identity.disabled_at IS NULL
          WHERE invitation.tenant_id=$1 AND invitation.recipient_id=$2
            AND ($3::uuid IS NULL OR invitation.channel_id=$3)
            AND source.expires_at>clock_timestamp()
            AND EXISTS(SELECT 1 FROM user_extensions ue JOIN extensions extension ON extension.id=ue.extension_id
              WHERE ue.user_id=invitation.recipient_id AND extension.tenant_id=invitation.tenant_id
                AND extension.status='active' AND extension.deleted_at IS NULL)
          ORDER BY invitation.created_at DESC LIMIT 50`, [tenantId, userId, channelId ?? null]);
        return result.rows.flatMap((row) => {
          const parsed = invitationRow.safeParse(row);
          return parsed.success ? [{ invitationId: parsed.data.invitation_id, meetingId: parsed.data.meeting_id,
            channelId: parsed.data.channel_id, createdBy: parsed.data.created_by,
            createdAt: parsed.data.created_at.getTime(), expiresAt: parsed.data.expires_at.getTime() }] : [];
        });
      });
    },
  };
}
