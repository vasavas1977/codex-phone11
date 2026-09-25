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

async function requireAdminPrecheck(db: PoolClient, actorId: number, tenantId: number, lock = false) {
  // A cheap unlocked rejection for writes; locked overview reads retain
  // authority until the read transaction commits. Write authority is rechecked
  // after the channel advisory lock in the shared table order.
  const tenant = await db.query(`SELECT id FROM tenants
    WHERE id=$1 AND status='active' ${lock ? 'FOR SHARE' : ''}`, [tenantId]);
  if (tenant.rows.length !== 1)
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
  const membership = await db.query(`SELECT user_id FROM tenant_memberships
    WHERE tenant_id=$1 AND user_id=$2 AND status='active'
      AND role IN ('owner','admin') ${lock ? 'FOR SHARE' : ''}`, [tenantId, actorId]);
  if (membership.rows.length !== 1)
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
  const identity = await db.query(`SELECT legacy_user_id FROM phone11_auth_identity
    WHERE legacy_user_id=$1 AND disabled_at IS NULL ${lock ? 'FOR SHARE' : ''}`, [actorId]);
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

async function directInstalled(db: PoolClient) {
  const result = await db.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='phone11_channel_meetings' AND column_name='origin_kind')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.phone11_channel_meetings')
      AND conname='phone11_channel_meetings_origin_kind_check' AND convalidated)
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.phone11_chat_blocks')
      AND tgname='phone11_direct_meeting_block_pair' AND tgenabled='O') AS available`);
  return result.rows[0]?.available === true;
}

export type ChannelMeetingAdminRepository = ReturnType<typeof createChannelMeetingAdminRepository>;

export function createChannelMeetingAdminRepository(transaction: typeof withTransaction = withTransaction) {
  return {
    async overview(actorId: number, tenantId: number, enabled: boolean) {
      return transaction(async (db) => {
        await bound(db);
        await requireAdminPrecheck(db, actorId, tenantId, true);
        if (!enabled) return { available: false, reason: "Channel meetings are not configured for this workspace.", channels: [], directConversations: [], directConversationsReason: undefined };
        if (!await installed(db)) return { available: false, reason: "Channel meeting storage is not installed.", channels: [], directConversations: [], directConversationsReason: undefined };
        const channels = await db.query(`SELECT id,name,kind FROM phone11_chat_conversations
          WHERE tenant_id=$1 AND kind IN ('group','channel') ORDER BY name,id LIMIT 51`, [tenantId]);
        if (channels.rows.length > 50)
          return { available: false, reason: "This workspace has more channels than this management view can safely display.", channels: [], directConversations: [], directConversationsReason: undefined };
        const parsedChannels = channels.rows.map((row) => channelRow.parse(row));
        const directEnabled = await directInstalled(db);
        const directs = directEnabled ? await db.query(`SELECT conversation.id,conversation.name,conversation.kind
          FROM phone11_chat_conversations conversation
          WHERE conversation.tenant_id=$1 AND conversation.kind='direct'
            AND (SELECT count(*) FROM phone11_chat_members member
              WHERE member.tenant_id=conversation.tenant_id AND member.conversation_id=conversation.id)=2
          ORDER BY conversation.name,conversation.id LIMIT 101`, [tenantId]) : { rows: [] };
        const directOverflow = directs.rows.length > 100;
        const parsedDirects = directOverflow ? [] : directs.rows.map((row) =>
          z.object({ id: z.string().uuid(), name: z.string(), kind: z.literal("direct") }).parse(row));
        const allConversations = [...parsedChannels, ...parsedDirects];
        if (allConversations.length === 0) return { available: true, channels: [], directConversations: [],
          directConversationsReason: directOverflow ? "This workspace has more direct conversations than this management view can safely display." : undefined };
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
        [tenantId, allConversations.map((conversation) => conversation.id)]);
        if (members.rows.length > 5000)
          return { available: false, reason: "This workspace has more members than this management view can safely display.", channels: [], directConversations: [], directConversationsReason: undefined };
        const parsedMembers = members.rows.map((row) => memberRow.parse(row));
        const directConversations = parsedDirects.flatMap((conversation) => {
          const pair = parsedMembers.filter((member) => member.conversation_id === conversation.id);
          return pair.length === 2 ? [{ ...conversation, members: pair.map((member) => ({
            userId: member.user_id, name: member.name, canStartMeeting: member.can_start_meeting,
          })) }] : [];
        });
        return { available: true, channels: parsedChannels.map((channel) => ({
          ...channel,
          members: parsedMembers.filter((member) => member.conversation_id === channel.id).map((member) => ({
            userId: member.user_id, name: member.name, canStartMeeting: member.can_start_meeting,
          })),
        })), directConversations,
        directConversationsReason: directOverflow ? "This workspace has more direct conversations than this management view can safely display." : undefined };
      });
    },

    async setHostPermission(actorId: number, input: z.infer<typeof adminSetHostPermissionSchema>, enabled: boolean,
      expectedKind: "channel" | "direct" = "channel") {
      return transaction(async (db) => {
        await bound(db);
        // Reject outsiders before they can contend on a channel lock. This
        // first check takes no row locks; the locked recheck below is the
        // authority for the write if membership changes concurrently.
        await requireAdminPrecheck(db, actorId, input.tenantId);
        if (!enabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Channel meetings are not configured for this workspace." });
        if (!await installed(db)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Channel meeting storage is not installed." });
        if (expectedKind === "direct" && !await directInstalled(db))
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Direct meeting storage is not installed." });
        // Meeting start takes this same lock before touching tenant, channel,
        // or member rows. Match that order so an admin permission edit cannot
        // deadlock with a concurrent start in this channel.
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `phone11-channel-meeting:${input.tenantId}:${input.channelId}`,
        ]);
        // Match start's explicit table order. The tenant lock also prevents
        // starts in other channels from advancing to their member locks while
        // this edit validates the actor and target under row locks.
        const tenant = await db.query(`SELECT id FROM tenants
          WHERE id=$1 AND status='active' FOR SHARE`, [input.tenantId]);
        if (tenant.rows.length !== 1)
          throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
        const channel = await db.query(`SELECT id FROM phone11_chat_conversations
          WHERE tenant_id=$1 AND id=$2 AND kind ${expectedKind === "direct" ? "='direct' FOR UPDATE" : "IN ('group','channel') FOR SHARE"}`,
        [input.tenantId, input.channelId]);
        if (channel.rows.length !== 1)
          throw new TRPCError({ code: "FORBIDDEN", message: "Channel is not in this workspace." });
        if (expectedKind === "direct") {
          const participants = await db.query(`SELECT user_id FROM phone11_chat_members
            WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY user_id LIMIT 3 FOR KEY SHARE`, [input.tenantId, input.channelId]);
          if (participants.rows.length !== 2 || !participants.rows.some((row) => Number(row.user_id) === input.userId))
            throw new TRPCError({ code: "FORBIDDEN", message: "Direct conversation must have exactly two members." });
        }
        const member = await db.query(`SELECT user_id FROM phone11_chat_members
          WHERE tenant_id=$1 AND conversation_id=$2 AND user_id=$3 FOR UPDATE`,
        [input.tenantId, input.channelId, input.userId]);
        if (member.rows.length !== 1)
          throw new TRPCError({ code: "FORBIDDEN", message: "Member is not eligible in this channel." });
        const expectedUsers = [...new Set([actorId, input.userId])].sort((a, b) => a - b);
        const memberships = await db.query(`SELECT user_id,role FROM tenant_memberships
          WHERE tenant_id=$1 AND user_id=ANY($2::integer[]) AND status='active'
          ORDER BY user_id FOR SHARE`, [input.tenantId, expectedUsers]);
        if (memberships.rows.length !== expectedUsers.length
          || memberships.rows.some((row, index) => Number(row.user_id) !== expectedUsers[index])
          || !memberships.rows.some((row) => Number(row.user_id) === actorId && ['owner', 'admin'].includes(row.role)))
          throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator or member access is no longer active." });
        const identities = await db.query(`SELECT legacy_user_id FROM phone11_auth_identity
          WHERE legacy_user_id=ANY($1::integer[]) AND disabled_at IS NULL
          ORDER BY legacy_user_id FOR SHARE`, [expectedUsers]);
        if (identities.rows.length !== expectedUsers.length
          || identities.rows.some((row, index) => Number(row.legacy_user_id) !== expectedUsers[index]))
          throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator or member identity is no longer active." });
        const assignments = await db.query(`SELECT assignment.user_id,assignment.extension_id FROM user_extensions assignment
          JOIN extensions extension ON extension.id=assignment.extension_id
            AND extension.tenant_id=$1 AND extension.status='active' AND extension.deleted_at IS NULL
          WHERE assignment.user_id=$2 ORDER BY assignment.user_id,assignment.id
          FOR SHARE OF assignment`, [input.tenantId, input.userId]);
        const extensionIds = [...new Set(assignments.rows.map((row) => Number(row.extension_id)))].sort((a, b) => a - b);
        const extensions = await db.query(`SELECT id FROM extensions
          WHERE id=ANY($1::integer[]) AND tenant_id=$2 AND status='active' AND deleted_at IS NULL
          ORDER BY id FOR SHARE`, [extensionIds, input.tenantId]);
        const eligibleExtensions = new Set(extensions.rows.map((row) => Number(row.id)));
        if (!assignments.rows.some((row) => Number(row.user_id) === input.userId && eligibleExtensions.has(Number(row.extension_id))))
          throw new TRPCError({ code: "FORBIDDEN", message: "Member has no active extension in this workspace." });
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
