import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { z } from "zod";

import { withTransaction } from "../pbx/db";

const positiveId = z.number().int().positive().refine(Number.isSafeInteger);
export const adminOverviewSchema = z.object({ tenantId: positiveId }).strict();
export const adminSetHostPermissionSchema = adminOverviewSchema.extend({
  channelId: z.string().uuid(),
  userId: positiveId,
  canStartMeeting: z.boolean(),
}).strict();

const channelRow = z.object({ id: z.string().uuid(), name: z.string(), kind: z.enum(["group", "channel"]) });
const memberRow = z.object({ conversation_id: z.string().uuid(), user_id: z.coerce.number().int().positive(), name: z.string(), can_start_meeting: z.boolean() });

async function bound(db: PoolClient) {
  await db.query("SET LOCAL statement_timeout = '3s'");
  await db.query("SET LOCAL lock_timeout = '2s'");
}

async function requireAdmin(db: PoolClient, actorId: number, tenantId: number, lock = true) {
  // Separate queries establish the same tenant-first lock order used by
  // channel meeting start. A joined FOR SHARE can lock relations in planner
  // order, which creates a cross-channel cycle against start's tenant lock.
  const tenant = await db.query(`SELECT id FROM tenants
    WHERE id=$1 AND status='active' ${lock ? "FOR SHARE" : ""}`, [tenantId]);
  if (tenant.rows.length !== 1)
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
  const membership = await db.query(`SELECT user_id FROM tenant_memberships
    WHERE tenant_id=$1 AND user_id=$2 AND status='active'
      AND role IN ('owner','admin') ${lock ? "FOR SHARE" : ""}`, [tenantId, actorId]);
  if (membership.rows.length !== 1)
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
  const identity = await db.query(`SELECT legacy_user_id FROM phone11_auth_identity
    WHERE legacy_user_id=$1 AND disabled_at IS NULL ${lock ? "FOR SHARE" : ""}`, [actorId]);
  if (identity.rows.length !== 1)
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
}

async function installed(db: PoolClient) {
  const result = await db.query(`SELECT
    to_regclass('public.phone11_chat_conversations') IS NOT NULL
    AND to_regclass('public.phone11_chat_members') IS NOT NULL
    AND to_regclass('public.phone11_channel_meetings') IS NOT NULL
    AND to_regclass('public.phone11_channel_meeting_invitations') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='phone11_chat_members' AND column_name='can_start_meeting') AS available`);
  return result.rows[0]?.available === true;
}

export type ChannelMeetingAdminRepository = ReturnType<typeof createChannelMeetingAdminRepository>;

export function createChannelMeetingAdminRepository(transaction: typeof withTransaction = withTransaction) {
  return {
    async overview(actorId: number, tenantId: number, enabled: boolean) {
      return transaction(async (db) => {
        await bound(db);
        await requireAdmin(db, actorId, tenantId);
        if (!enabled) return { available: false, reason: "Channel meetings are not configured for this workspace.", channels: [] };
        if (!await installed(db)) return { available: false, reason: "Channel meeting storage is not installed.", channels: [] };
        const channels = await db.query(`SELECT id,name,kind FROM phone11_chat_conversations
          WHERE tenant_id=$1 AND kind IN ('group','channel') ORDER BY name,id LIMIT 51`, [tenantId]);
        if (channels.rows.length > 50)
          return { available: false, reason: "This workspace has more channels than this management view can safely display.", channels: [] };
        const parsedChannels = channels.rows.map((row) => channelRow.parse(row));
        if (parsedChannels.length === 0) return { available: true, channels: [] };
        const members = await db.query(`SELECT member.conversation_id,member.user_id,
            COALESCE(NULLIF(users.name,''),'Team member') AS name,member.can_start_meeting
          FROM phone11_chat_members member
          JOIN users ON users.id=member.user_id
          JOIN tenant_memberships membership ON membership.tenant_id=member.tenant_id
            AND membership.user_id=member.user_id AND membership.status='active'
          JOIN phone11_auth_identity identity ON identity.legacy_user_id=member.user_id AND identity.disabled_at IS NULL
          WHERE member.tenant_id=$1 AND member.conversation_id=ANY($2::uuid[])
            AND EXISTS(SELECT 1 FROM user_extensions assignment JOIN extensions extension
              ON extension.id=assignment.extension_id AND extension.tenant_id=member.tenant_id
              AND extension.status='active' AND extension.deleted_at IS NULL
              WHERE assignment.user_id=member.user_id)
          ORDER BY member.conversation_id,users.name,member.user_id LIMIT 5001`,
        [tenantId, parsedChannels.map((channel) => channel.id)]);
        if (members.rows.length > 5000)
          return { available: false, reason: "This workspace has more members than this management view can safely display.", channels: [] };
        const parsedMembers = members.rows.map((row) => memberRow.parse(row));
        return { available: true, channels: parsedChannels.map((channel) => ({
          ...channel,
          members: parsedMembers.filter((member) => member.conversation_id === channel.id).map((member) => ({
            userId: member.user_id, name: member.name, canStartMeeting: member.can_start_meeting,
          })),
        })) };
      });
    },

    async setHostPermission(actorId: number, input: z.infer<typeof adminSetHostPermissionSchema>, enabled: boolean) {
      return transaction(async (db) => {
        await bound(db);
        // Reject outsiders before they can contend on a channel lock. This
        // first check takes no row locks; the locked recheck below is the
        // authority for the write if membership changes concurrently.
        await requireAdmin(db, actorId, input.tenantId, false);
        if (!enabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Channel meetings are not configured for this workspace." });
        if (!await installed(db)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Channel meeting storage is not installed." });
        // Meeting start takes this same lock before touching tenant, channel,
        // or member rows. Match that order so an admin permission edit cannot
        // deadlock with a concurrent start in this channel.
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `phone11-channel-meeting:${input.tenantId}:${input.channelId}`,
        ]);
        await requireAdmin(db, actorId, input.tenantId);
        const channel = await db.query(`SELECT conversation.id FROM phone11_chat_conversations conversation
          WHERE conversation.tenant_id=$1 AND conversation.id=$2 AND conversation.kind IN ('group','channel')
          FOR SHARE OF conversation`, [input.tenantId, input.channelId]);
        if (channel.rows.length !== 1)
          throw new TRPCError({ code: "FORBIDDEN", message: "Channel is not in this workspace." });
        const member = await db.query(`SELECT member.user_id
          FROM phone11_chat_members member
          JOIN tenant_memberships membership ON membership.tenant_id=member.tenant_id
            AND membership.user_id=member.user_id AND membership.status='active'
          JOIN phone11_auth_identity identity ON identity.legacy_user_id=member.user_id AND identity.disabled_at IS NULL
          WHERE member.tenant_id=$1 AND member.conversation_id=$2 AND member.user_id=$3
            AND EXISTS(SELECT 1 FROM user_extensions assignment JOIN extensions extension
              ON extension.id=assignment.extension_id AND extension.tenant_id=member.tenant_id
              AND extension.status='active' AND extension.deleted_at IS NULL
              WHERE assignment.user_id=member.user_id)
          FOR UPDATE OF member FOR SHARE OF membership,identity`,
        [input.tenantId, input.channelId, input.userId]);
        if (member.rows.length !== 1)
          throw new TRPCError({ code: "FORBIDDEN", message: "Member is not eligible in this channel." });
        const updated = await db.query(`UPDATE phone11_chat_members SET can_start_meeting=$4
          WHERE tenant_id=$1 AND conversation_id=$2 AND user_id=$3 RETURNING user_id,can_start_meeting`,
        [input.tenantId, input.channelId, input.userId, input.canStartMeeting]);
        if (updated.rows.length !== 1)
          throw new TRPCError({ code: "CONFLICT", message: "Member changed while updating meeting permissions." });
        return { channelId: input.channelId, userId: input.userId, canStartMeeting: updated.rows[0].can_start_meeting === true };
      });
    },
  };
}
