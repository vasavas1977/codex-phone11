import { chatNotificationsEnabled, enqueueChatNotifications } from "../chat-notifications/repository";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { withTransaction } from "../pbx/db";
import type { ChatChannel, ChatKind, ChatMessage, ChatPerson, ChatWorkspace } from "../../lib/chat/types";

// Live Phone11 grants workspace access through explicit user_extensions assignments.
// No inferred tenant 1 or extension.user_id fallback. Fresh reads honor revoked assignments.
export async function authorizeWorkspace(db: Pick<PoolClient, "query">, userId: number, tenantId?: number): Promise<ChatWorkspace> {
  const result = await db.query(
    `SELECT t.id, t.name FROM user_extensions ue JOIN extensions e ON e.id = ue.extension_id JOIN tenants t ON t.id = e.tenant_id
     WHERE ue.user_id = $1 AND e.status = 'active' AND e.deleted_at IS NULL AND t.status = 'active'
       AND ($2::integer IS NULL OR t.id = $2)
     ORDER BY ue.is_primary DESC, ue.created_at ASC LIMIT 1 FOR SHARE OF ue, e, t`, [userId, tenantId ?? null]);
  if (!result.rows[0]) throw new TRPCError({ code: "FORBIDDEN", message: "Your account has no access to this workspace. Contact your administrator." });
  return { id: Number(result.rows[0].id), name: result.rows[0].name };
}

export async function authorizeConversation(db: Pick<PoolClient, "query">, userId: number, tenantId: number, id: string) {
  const result = await db.query(
    `SELECT c.id FROM phone11_chat_conversations c JOIN phone11_chat_members m
       ON m.tenant_id = c.tenant_id AND m.conversation_id = c.id
     WHERE c.tenant_id = $1 AND c.id = $2 AND m.user_id = $3 FOR UPDATE OF c`, [tenantId, id, userId]);
  if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation is unavailable or you no longer have access." });
}

function message(row: any): ChatMessage {
  return { id: row.id, clientId: row.client_id, channelId: row.conversation_id, senderId: Number(row.sender_id),
    senderName: row.sender_name || "Team member", content: row.content,
    timestamp: new Date(row.created_at).getTime(), sequence: Number(row.sequence), status: "sent" };
}

export function createChatService(transaction = withTransaction) {
  const scoped = <T>(userId: number, tenantId: number | undefined, fn: (db: PoolClient, workspace: ChatWorkspace) => Promise<T>) =>
    transaction(async db => fn(db, await authorizeWorkspace(db, userId, tenantId)));
  return {
    list(userId: number, tenantId?: number) {
      return scoped(userId, tenantId, async (db, workspace) => {
        const result = await db.query(
          `SELECT c.id, c.kind, c.name, c.created_at,
             ARRAY(SELECT cm.user_id FROM phone11_chat_members cm WHERE cm.tenant_id = c.tenant_id AND cm.conversation_id = c.id ORDER BY cm.user_id) AS member_ids,
             CASE WHEN c.kind = 'direct' THEN (SELECT COALESCE(u.name, 'Team member') FROM phone11_chat_members cm JOIN users u ON u.id = cm.user_id
               WHERE cm.tenant_id = c.tenant_id AND cm.conversation_id = c.id AND cm.user_id <> $2 LIMIT 1) ELSE c.name END AS display_name,
             latest.content AS last_message, latest.created_at AS last_message_at,
             (SELECT COUNT(*)::integer FROM phone11_chat_messages msg WHERE msg.tenant_id = c.tenant_id AND msg.conversation_id = c.id
               AND msg.sequence > m.last_read_sequence AND msg.sender_id <> $2) AS unread_count
           FROM phone11_chat_conversations c JOIN phone11_chat_members m ON m.tenant_id = c.tenant_id AND m.conversation_id = c.id AND m.user_id = $2
           LEFT JOIN LATERAL (SELECT content, created_at, sequence FROM phone11_chat_messages msg
             WHERE msg.tenant_id = c.tenant_id AND msg.conversation_id = c.id ORDER BY sequence DESC LIMIT 1) latest ON TRUE
           WHERE c.tenant_id = $1 ORDER BY COALESCE(latest.created_at, c.created_at) DESC LIMIT 200`, [workspace.id, userId]);
        const workspaces = await db.query(`SELECT DISTINCT t.id, t.name FROM user_extensions ue JOIN extensions e ON e.id = ue.extension_id JOIN tenants t ON t.id = e.tenant_id
          WHERE ue.user_id = $1 AND e.status = 'active' AND e.deleted_at IS NULL AND t.status = 'active' ORDER BY t.name`, [userId]);
        return { workspace, workspaces: workspaces.rows.map((r: any) => ({ id: Number(r.id), name: r.name })), channels: result.rows.map((r: any): ChatChannel => ({
          id: r.id, name: r.display_name || r.name, kind: r.kind, memberIds: r.member_ids.map(Number), lastMessage: r.last_message,
          lastMessageAt: new Date(r.last_message_at || r.created_at).getTime(), unreadCount: r.unread_count,
        })) };
      });
    },
    directory(userId: number, tenantId: number) {
      return scoped(userId, tenantId, async (db, workspace) => {
        const result = await db.query(`SELECT DISTINCT u.id, COALESCE(u.name, 'Team member') AS name,
            (SELECT e.extension_number FROM user_extensions ue JOIN extensions e ON e.id = ue.extension_id
             WHERE ue.user_id = u.id AND e.tenant_id = $1 AND e.status = 'active' AND e.deleted_at IS NULL
             ORDER BY ue.is_primary DESC, ue.id ASC LIMIT 1) AS extension
          FROM user_extensions assignment JOIN extensions assigned ON assigned.id = assignment.extension_id JOIN users u ON u.id = assignment.user_id
          WHERE assigned.tenant_id = $1 AND assigned.status = 'active' AND assigned.deleted_at IS NULL AND u.id <> $2 ORDER BY name, u.id LIMIT 500`, [workspace.id, userId]);
        return result.rows.map((r: any): ChatPerson => ({ id: Number(r.id), name: r.name, extension: r.extension ?? null }));
      });
    },
    create(userId: number, tenantId: number, kind: ChatKind, name: string, memberIds: number[]) {
      return scoped(userId, tenantId, async (db, workspace) => {
        const ids = [...new Set([userId, ...memberIds])].sort((a, b) => a - b);
        if (ids.length < 2 || ids.length > 50 || (kind === "direct" && ids.length !== 2))
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose at least one teammate (exactly one for a direct message)." });
        const members = await db.query(`SELECT DISTINCT ue.user_id FROM user_extensions ue JOIN extensions e ON e.id = ue.extension_id
          WHERE e.tenant_id = $1 AND e.status = 'active' AND e.deleted_at IS NULL AND ue.user_id = ANY($2::integer[])`, [workspace.id, ids]);
        if (members.rows.length !== ids.length) throw new TRPCError({ code: "FORBIDDEN", message: "Every participant must be an active member of this workspace." });
        const directKey = kind === "direct" ? ids.join(":") : null;
        const created = await db.query(`INSERT INTO phone11_chat_conversations (id, tenant_id, kind, name, direct_key)
          VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key RETURNING id`,
          [randomUUID(), workspace.id, kind, kind === "direct" ? "Direct message" : name, directKey]);
        const id = created.rows[0].id;
        for (const memberId of ids) await db.query(`INSERT INTO phone11_chat_members (tenant_id, conversation_id, user_id)
          VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [workspace.id, id, memberId]);
        return { id };
      });
    },
    history(userId: number, tenantId: number, id: string, before?: number) {
      return scoped(userId, tenantId, async (db, workspace) => {
        await authorizeConversation(db, userId, workspace.id, id);
        const rows = await db.query(`SELECT msg.*, u.name AS sender_name FROM phone11_chat_messages msg JOIN users u ON u.id = msg.sender_id
          WHERE msg.tenant_id = $1 AND msg.conversation_id = $2 AND ($3::bigint IS NULL OR msg.sequence < $3)
          ORDER BY msg.sequence DESC LIMIT 101`, [workspace.id, id, before ?? null]);
        const hasMore = rows.rows.length > 100;
        return { messages: rows.rows.slice(0, 100).reverse().map(message), hasMore };
      });
    },
    search(userId: number, tenantId: number, id: string, text: string) {
      return scoped(userId, tenantId, async (db, workspace) => {
        await authorizeConversation(db, userId, workspace.id, id);
        const result = await db.query(`SELECT msg.*, u.name AS sender_name FROM phone11_chat_messages msg JOIN users u ON u.id = msg.sender_id
          WHERE msg.tenant_id = $1 AND msg.conversation_id = $2 AND strpos(lower(msg.content), lower($3)) > 0
          ORDER BY msg.sequence DESC LIMIT 51`, [workspace.id, id, text]);
        return { messages: result.rows.slice(0, 50).reverse().map(message), hasMore: result.rows.length > 50 };
      });
    },
    send(userId: number, tenantId: number, id: string, clientId: string, content: string) {
      return scoped(userId, tenantId, async (db, workspace) => {
        await authorizeConversation(db, userId, workspace.id, id);
        // Retrying a request after a lost response returns the same persisted row.
        // Conversation lock serializes sequence allocation with read markers.
        const rows = await db.query(`INSERT INTO phone11_chat_messages (id, tenant_id, conversation_id, sender_id, client_id, content)
          VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, conversation_id, sender_id, client_id)
          DO UPDATE SET client_id = EXCLUDED.client_id RETURNING *, (xmax = 0) AS newly_inserted`, [randomUUID(), workspace.id, id, userId, clientId, content]);
        if (rows.rows[0].content !== content) throw new TRPCError({ code: "CONFLICT", message: "This retry belongs to a different message. Please send it again." });
        if (rows.rows[0].newly_inserted && chatNotificationsEnabled()) await enqueueChatNotifications(db, rows.rows[0].id);
        const name = await db.query(`SELECT name FROM users WHERE id = $1`, [userId]);
        return message({ ...rows.rows[0], sender_name: name.rows[0]?.name });
      });
    },
    read(userId: number, tenantId: number, id: string, through: number) {
      return scoped(userId, tenantId, async (db, workspace) => {
        await authorizeConversation(db, userId, workspace.id, id);
        // Only acknowledge a sequence that actually exists in this conversation.
        await db.query(`UPDATE phone11_chat_members SET last_read_sequence = GREATEST(last_read_sequence,
          COALESCE((SELECT MAX(sequence) FROM phone11_chat_messages WHERE tenant_id = $1 AND conversation_id = $2 AND sequence <= $4), 0))
          WHERE tenant_id = $1 AND conversation_id = $2 AND user_id = $3`, [workspace.id, id, userId, through]);
        return { ok: true };
      });
    },
  };
}
