import { createHash, randomUUID } from "node:crypto";
import { OFFICE_MIME_EXTENSIONS, validOfficePackage } from "./office-package";
import * as fs from "node:fs";
import * as path from "node:path";
import { Router, raw, type NextFunction, type Request, type Response } from "express";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { getPool, withTransaction } from "../pbx/db";
import { sdk } from "../_core/sdk";
import { readAuthConfig } from "../_core/phone11-auth";
import { authorizeConversation, authorizeWorkspace } from "./service";

export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const allowedMimeTypes = new Set([
  ...Object.keys(OFFICE_MIME_EXTENSIONS),
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
  "application/pdf", "text/plain", "text/csv",
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm",
  "video/mp4", "video/quicktime", "video/webm",
]);
const extensionForMime: Record<string, string> = {
  ...OFFICE_MIME_EXTENSIONS,
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

type Db = Pick<PoolClient, "query">;
type Transaction = <T>(fn: (db: PoolClient) => Promise<T>) => Promise<T>;
export type ChatAttachmentDescriptor = {
  id: string;
  conversationId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "ready" | "attached";
};
type AttachmentRow = {
  id: string; tenant_id: number; conversation_id: string; uploaded_by: number; client_id: string;
  storage_key: string; filename: string; mime_type: string; size_bytes: number; content_sha256: string;
  state: "ready" | "attached"; message_id: string | null; expires_at: Date | string | null;
};

function descriptor(row: AttachmentRow): ChatAttachmentDescriptor {
  return { id: row.id, conversationId: row.conversation_id, filename: row.filename, mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes), status: row.state };
}
function isUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function requestedIds(ids: readonly string[]): string[] {
  if (!Array.isArray(ids) || ids.length > MAX_CHAT_ATTACHMENTS_PER_MESSAGE || new Set(ids).size !== ids.length || !ids.every(isUuid))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment list is invalid." });
  return [...ids];
}
function firstHeader(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function normalizedMime(value: string | null): string | null {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase() || "";
  return allowedMimeTypes.has(mime) ? mime : null;
}
function filenameFromHeader(value: string | null, mime: string): string | null {
  const fallback = `attachment.${extensionForMime[mime]}`;
  if (!value) return fallback;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  const name = decoded.normalize("NFC").trim();
  if (!name || name.length > 128 || /[\\/\u0000-\u001f\u007f]/.test(name)) return null;
  if (OFFICE_MIME_EXTENSIONS[mime] && !name.toLowerCase().endsWith(`.${OFFICE_MIME_EXTENSIONS[mime]}`)) return null;
  return name;
}
function hasPrefix(bytes: Buffer, prefix: number[]) { return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value); }
function isIsoMedia(bytes: Buffer) { return bytes.length >= 16 && bytes.subarray(4, 8).equals(Buffer.from("ftyp")); }
function validChatMediaBytes(mime: string, bytes: Buffer): boolean {
  if (OFFICE_MIME_EXTENSIONS[mime]) return validOfficePackage(mime, bytes);
  if (mime === "image/png") return hasPrefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10]) && bytes.length >= 20 && bytes.subarray(-8, -4).equals(Buffer.from("IEND"));
  if (mime === "image/gif") return (bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) || bytes.subarray(0, 6).equals(Buffer.from("GIF89a"))) && bytes.at(-1) === 0x3b;
  if (mime === "image/webp") return hasPrefix(bytes, [82, 73, 70, 70]) && bytes.subarray(8, 12).equals(Buffer.from("WEBP")) && bytes.readUInt32LE(4) + 8 === bytes.length;
  if (mime === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]) && bytes.length > 4 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (mime === "image/heic" || mime === "image/heif") return isIsoMedia(bytes) && ["heic", "heix", "hevc", "hevx", "mif1"].includes(bytes.subarray(8, 12).toString("ascii"));
  if (mime === "application/pdf") {
    if (!hasPrefix(bytes, [37, 80, 68, 70, 45])) return false;
    const end = bytes.lastIndexOf(Buffer.from("%%EOF")); return end >= 0 && bytes.subarray(end + 5).every(byte => byte === 9 || byte === 10 || byte === 13 || byte === 32);
  }
  if (mime === "text/plain" || mime === "text/csv") {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return !bytes.includes(0); } catch { return false; }
  }
  if (mime === "audio/wav" || mime === "audio/x-wav") return hasPrefix(bytes, [82, 73, 70, 70]) && bytes.subarray(8, 12).equals(Buffer.from("WAVE")) && bytes.readUInt32LE(4) + 8 === bytes.length;
  if (mime === "audio/ogg") return hasPrefix(bytes, [79, 103, 103, 83]);
  if (mime === "audio/mpeg") return hasPrefix(bytes, [73, 68, 51]) || (bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mime === "audio/aac") return bytes.length > 6 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (mime === "audio/mp4" || mime === "video/mp4" || mime === "video/quicktime") return isIsoMedia(bytes);
  if (mime === "audio/webm" || mime === "video/webm") return hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  return false;
}
function declaredBodyTooLarge(req: Request): boolean {
  const declared = firstHeader(req.headers["content-length"]);
  return declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > MAX_CHAT_ATTACHMENT_BYTES;
}
function chatMediaBase(): string {
  const configured = process.env.PHONE11_CHAT_MEDIA_PATH;
  if (!configured || !path.isAbsolute(configured)) throw new Error("Chat media storage is not configured");
  return configured;
}
async function resolvedBase(): Promise<string> {
  const base = chatMediaBase();
  const stat = await fs.promises.lstat(base);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Chat media storage is unsafe");
  const resolved = await fs.promises.realpath(base);
  return resolved;
}
function tenantPrefix(base: string, tenantId: number): string { return path.join(base, String(tenantId)) + path.sep; }
async function tenantDirectory(base: string, tenantId: number): Promise<string> {
  const dir = path.join(base, String(tenantId));
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(dir, 0o700);
  const stat = await fs.promises.lstat(dir);
  const resolved = await fs.promises.realpath(dir);
  const tenantRoot = path.join(base, String(tenantId));
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || resolved !== tenantRoot)
    throw new Error("Chat media directory is unsafe");
  return resolved;
}
async function storeBytes(tenantId: number, bytes: Buffer, mime: string): Promise<{ storageKey: string; filePath: string }> {
  const base = await resolvedBase();
  const directory = await tenantDirectory(base, tenantId);
  const storageKey = `${tenantId}/${randomUUID()}.${extensionForMime[mime]}`;
  const filePath = path.join(base, storageKey);
  if (!filePath.startsWith(tenantPrefix(base, tenantId)) || path.dirname(filePath) !== directory) throw new Error("Invalid chat media path");
  await fs.promises.writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  return { storageKey, filePath };
}
async function removeStored(tenantId: number, storageKey: string): Promise<void> {
  const base = await resolvedBase();
  const filePath = path.resolve(base, storageKey);
  if (!filePath.startsWith(tenantPrefix(base, tenantId))) throw new Error("Invalid chat media path");
  try { await fs.promises.unlink(filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function readStored(tenantId: number, storageKey: string, expectedBytes: number): Promise<Buffer> {
  const base = await resolvedBase();
  const filePath = path.resolve(base, storageKey);
  if (!filePath.startsWith(tenantPrefix(base, tenantId))) throw new Error("Invalid chat media path");
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== expectedBytes || stat.size > MAX_CHAT_ATTACHMENT_BYTES) throw new Error("Chat media file is unavailable");
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function claimChatAttachments(
  db: Db,
  input: { tenantId: number; conversationId: string; userId: number; attachmentIds: readonly string[] },
): Promise<ChatAttachmentDescriptor[]> {
  const attachmentIds = requestedIds(input.attachmentIds);
  if (!attachmentIds.length) return [];
  // Keep the helper safe when another chat procedure reuses it: attachment
  // ownership alone never substitutes for the caller's current membership.
  await authorizeConversation(db, input.userId, input.tenantId, input.conversationId);
  const result = await db.query<AttachmentRow>(`SELECT id, tenant_id, conversation_id, uploaded_by, client_id, storage_key, filename,
      mime_type, size_bytes, content_sha256, state, message_id, expires_at
    FROM phone11_chat_attachments WHERE tenant_id=$1 AND conversation_id=$2 AND id = ANY($3::uuid[]) FOR UPDATE`,
    [input.tenantId, input.conversationId, attachmentIds]);
  if (result.rows.length !== attachmentIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "An attachment is unavailable." });
  const byId = new Map(result.rows.map(row => [row.id, row]));
  const ordered = attachmentIds.map(id => byId.get(id)!);
  if (ordered.some(row => row.uploaded_by !== input.userId || row.state !== "ready" || row.message_id !== null || !row.expires_at || new Date(row.expires_at).getTime() <= Date.now()))
    throw new TRPCError({ code: "FORBIDDEN", message: "An attachment is unavailable." });
  return ordered.map(descriptor);
}

export async function attachClaimedChatAttachments(
  db: Db,
  input: { tenantId: number; conversationId: string; userId: number; messageId: string; attachmentIds: readonly string[] },
): Promise<void> {
  const attachmentIds = requestedIds(input.attachmentIds);
  if (!attachmentIds.length) return;
  const result = await db.query(`UPDATE phone11_chat_attachments SET state='attached', message_id=$5, expires_at=NULL, attached_at=clock_timestamp()
    WHERE tenant_id=$1 AND conversation_id=$2 AND uploaded_by=$3 AND id = ANY($4::uuid[])
      AND state='ready' AND message_id IS NULL AND expires_at > clock_timestamp() RETURNING id`,
    [input.tenantId, input.conversationId, input.userId, attachmentIds, input.messageId]);
  if (result.rows.length !== attachmentIds.length) throw new TRPCError({ code: "CONFLICT", message: "An attachment changed before the message was sent." });
}

/**
 * A forward creates new target-message metadata, never a public URL or a
 * cross-tenant object reference. The caller must already authorize source and
 * target conversations and persist the target message in this transaction.
 */
export async function forwardChatAttachments(
  db: Db,
  input: { tenantId: number; sourceConversationId: string; targetConversationId: string; userId: number; messageId: string; attachmentIds: readonly string[] },
): Promise<ChatAttachmentDescriptor[]> {
  const attachmentIds = requestedIds(input.attachmentIds);
  if (!attachmentIds.length) return [];
  const source = await db.query<AttachmentRow>(`SELECT id, tenant_id, conversation_id, storage_key, filename, mime_type, size_bytes,
      content_sha256, state, message_id FROM phone11_chat_attachments
    WHERE tenant_id=$1 AND conversation_id=$2 AND id = ANY($3::uuid[]) AND state='attached' FOR KEY SHARE`,
    [input.tenantId, input.sourceConversationId, attachmentIds]);
  if (source.rows.length !== attachmentIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "An attachment is unavailable." });
  const byId = new Map(source.rows.map(row => [row.id, row]));
  const ordered = attachmentIds.map(id => byId.get(id)!);
  const inserted: AttachmentRow[] = [];
  for (const row of ordered) {
    const created = await db.query<AttachmentRow>(`INSERT INTO phone11_chat_attachments
      (id,tenant_id,conversation_id,uploaded_by,client_id,storage_key,filename,mime_type,size_bytes,content_sha256,state,message_id,attached_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'attached',$11,clock_timestamp())
      RETURNING id,tenant_id,conversation_id,filename,mime_type,size_bytes,state`,
      [randomUUID(), input.tenantId, input.targetConversationId, input.userId, randomUUID(), row.storage_key, row.filename,
        row.mime_type, row.size_bytes, row.content_sha256, input.messageId]);
    inserted.push(created.rows[0]);
  }
  return inserted.map(descriptor);
}

export async function messageAttachmentDescriptors(db: Db, tenantId: number, conversationId: string, messageIds: readonly string[]) {
  if (!messageIds.length) return new Map<string, ChatAttachmentDescriptor[]>();
  const result = await db.query<AttachmentRow>(`SELECT id, tenant_id, conversation_id, filename, mime_type, size_bytes, state, message_id
    FROM phone11_chat_attachments WHERE tenant_id=$1 AND conversation_id=$2 AND message_id = ANY($3::uuid[]) AND state='attached'
    ORDER BY attached_at, id`, [tenantId, conversationId, messageIds]);
  const attached = new Map<string, ChatAttachmentDescriptor[]>();
  for (const row of result.rows) {
    const values = attached.get(row.message_id!) ?? [];
    values.push(descriptor(row)); attached.set(row.message_id!, values);
  }
  return attached;
}

async function requireCurrentUser(req: Request, res: Response): Promise<number | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error("invalid user");
    const expectedOwner = firstHeader(req.headers["x-phone11-chat-owner"]);
    if (expectedOwner !== null && expectedOwner !== String(user.id)) { res.status(401).json({ error: "Your chat session changed. Open Team Chat again." }); return null; }
    return user.id;
  } catch { res.status(401).json({ error: "Sign in to access Team Chat media" }); return null; }
}
function cookieMutationOriginAllowed(req: Request): boolean {
  if (firstHeader(req.headers.authorization)) return true;
  if (!firstHeader(req.headers.cookie)) return true;
  try {
    const origin = firstHeader(req.headers.origin);
    return origin !== null && readAuthConfig().trustedOrigins.includes(origin);
  } catch { return false; }
}

export function createChatMediaRouter(transaction: Transaction = withTransaction) {
  const router = Router();
  router.post("/upload", raw({ type: () => true, limit: MAX_CHAT_ATTACHMENT_BYTES }), async (req, res) => {
    if (declaredBodyTooLarge(req)) { res.status(413).json({ error: "Attachments are limited to 10 MiB." }); return; }
    if (!cookieMutationOriginAllowed(req)) { res.status(403).json({ error: "Origin not allowed" }); return; }
    const userId = await requireCurrentUser(req, res); if (!userId) return;
    const tenantId = Number(firstHeader(req.headers["x-phone11-chat-tenant"]));
    const conversationId = firstHeader(req.headers["x-phone11-chat-conversation"]);
    const clientId = firstHeader(req.headers["x-phone11-chat-client-id"]);
    const mime = normalizedMime(firstHeader(req.headers["content-type"]));
    const filename = filenameFromHeader(firstHeader(req.headers["x-phone11-chat-filename"]), mime || "");
    if (!mime) { res.status(415).json({ error: "This media type is not supported." }); return; }
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || !isUuid(conversationId) || !isUuid(clientId) || !filename || !Buffer.isBuffer(req.body) || !req.body.length || req.body.length > MAX_CHAT_ATTACHMENT_BYTES || !validChatMediaBytes(mime, req.body)) {
      res.status(400).json({ error: "Provide a supported file, active conversation, and upload identifier." }); return;
    }
    const bytes = req.body as Buffer;
    const digest = createHash("sha256").update(bytes).digest("hex");
    const storageAttempt: { value: { tenantId: number; storageKey: string } | null } = { value: null };
    try {
      const attachment = await transaction(async db => {
        const workspace = await authorizeWorkspace(db, userId, tenantId);
        await authorizeConversation(db, userId, workspace.id, conversationId);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`phone11-chat-media:${workspace.id}:${conversationId}:${userId}:${clientId}`]);
        const existing = await db.query<AttachmentRow>(`SELECT id, tenant_id, conversation_id, uploaded_by, client_id, storage_key, filename,
          mime_type, size_bytes, content_sha256, state, message_id, expires_at FROM phone11_chat_attachments
          WHERE tenant_id=$1 AND conversation_id=$2 AND uploaded_by=$3 AND client_id=$4 FOR UPDATE`, [workspace.id, conversationId, userId, clientId]);
        if (existing.rows[0]) {
          const row = existing.rows[0];
          if (row.filename !== filename || row.mime_type !== mime || Number(row.size_bytes) !== bytes.length || row.content_sha256 !== digest)
            throw new TRPCError({ code: "CONFLICT", message: "This upload retry has different content." });
          if (row.state !== "ready" || !row.expires_at || new Date(row.expires_at).getTime() <= Date.now())
            throw new TRPCError({ code: "CONFLICT", message: "This upload is no longer available." });
          return descriptor(row);
        }
        const stored = await storeBytes(workspace.id, bytes, mime);
        storageAttempt.value = { tenantId: workspace.id, storageKey: stored.storageKey };
        const inserted = await db.query<AttachmentRow>(`INSERT INTO phone11_chat_attachments
          (id, tenant_id, conversation_id, uploaded_by, client_id, storage_key, filename, mime_type, size_bytes, content_sha256, state, expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready',clock_timestamp() + interval '24 hours')
          RETURNING id, tenant_id, conversation_id, uploaded_by, client_id, storage_key, filename, mime_type, size_bytes, content_sha256, state, message_id, expires_at`,
          [randomUUID(), workspace.id, conversationId, userId, clientId, stored.storageKey, filename, mime, bytes.length, digest]);
        return descriptor(inserted.rows[0]);
      });
      res.setHeader("Cache-Control", "no-store"); res.status(201).json(attachment);
    } catch (error) {
      if (storageAttempt.value) await removeStored(storageAttempt.value.tenantId, storageAttempt.value.storageKey).catch(() => undefined);
      const code = error instanceof TRPCError ? (error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400) : 503;
      res.status(code).json({ error: code === 503 ? "Chat media storage is unavailable" : (error as Error).message });
    }
  });
  router.get("/:id", async (req, res) => {
    const userId = await requireCurrentUser(req, res); if (!userId) return;
    const attachmentId = req.params.id;
    const tenantId = Number(firstHeader(req.headers["x-phone11-chat-tenant"]));
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) { res.status(404).json({ error: "Media is unavailable" }); return; }
    if (!isUuid(attachmentId)) { res.status(404).json({ error: "Media is unavailable" }); return; }
    try {
      const media = await transaction(async db => {
        const workspace = await authorizeWorkspace(db, userId, tenantId);
        // Establish the conversation lock before an attachment lock. Send/claim
        // follows the same order, so a download cannot deadlock a concurrent send.
        const found = await db.query<AttachmentRow>(`SELECT a.conversation_id FROM phone11_chat_attachments a
          JOIN phone11_chat_messages msg ON msg.tenant_id=a.tenant_id AND msg.conversation_id=a.conversation_id AND msg.id=a.message_id
          WHERE a.id=$1 AND a.tenant_id=$2 AND a.state='attached' AND msg.deleted_at IS NULL LIMIT 1`, [attachmentId, workspace.id]);
        if (!found.rows[0]) return null;
        await authorizeConversation(db, userId, workspace.id, found.rows[0].conversation_id);
        const locked = await db.query<AttachmentRow>(`SELECT a.id, a.tenant_id, a.conversation_id, a.storage_key, a.filename, a.mime_type, a.size_bytes, a.state, a.message_id
          FROM phone11_chat_attachments a JOIN phone11_chat_messages msg ON msg.tenant_id=a.tenant_id AND msg.conversation_id=a.conversation_id AND msg.id=a.message_id
          WHERE a.id=$1 AND a.tenant_id=$2 AND a.conversation_id=$3 AND a.state='attached' AND msg.deleted_at IS NULL LIMIT 1 FOR SHARE OF a`,
          [attachmentId, workspace.id, found.rows[0].conversation_id]);
        return locked.rows[0] ?? null;
      });
      if (!media) { res.status(404).json({ error: "Media is unavailable" }); return; }
      const bytes = await readStored(media.tenant_id, media.storage_key, Number(media.size_bytes));
      const inline = media.mime_type.startsWith("image/") || media.mime_type.startsWith("audio/") || media.mime_type.startsWith("video/");
      const safeName = media.filename.replace(/["\\\r\n]/g, "_");
      res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", media.mime_type); res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename=\"${safeName}\"`);
      res.end(bytes);
    } catch (error) {
      if (error instanceof TRPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) { res.status(404).json({ error: "Media is unavailable" }); return; }
      res.status(503).json({ error: "Chat media is temporarily unavailable" });
    }
  });
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if ((error as { type?: string }).type === "entity.too.large") { res.status(413).json({ error: "Attachments are limited to 10 MiB." }); return; }
    res.status(400).json({ error: "Invalid media request" });
  });
  return router;
}

export const chatMediaRouter = createChatMediaRouter();

export async function purgeExpiredChatMedia(limit = 100): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !process.env.PHONE11_CHAT_MEDIA_PATH) return 0;
  const pool = getPool(); const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query<AttachmentRow>(`SELECT id, tenant_id, storage_key FROM phone11_chat_attachments
      WHERE state='ready' AND expires_at <= clock_timestamp() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
    for (const row of result.rows) await removeStored(row.tenant_id, row.storage_key);
    if (result.rows.length) await db.query("DELETE FROM phone11_chat_attachments WHERE id = ANY($1::uuid[]) AND state='ready'", [result.rows.map(row => row.id)]);
    await db.query("COMMIT"); return result.rows.length;
  } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { db.release(); }
}

export async function runMediaRetentionCycle(dependencies: {
  purgeChat?: () => Promise<number>;
  maintainProfile?: () => Promise<number>;
} = {}): Promise<number> {
  const purgeChat = dependencies.purgeChat ?? purgeExpiredChatMedia;
  const maintainProfile = dependencies.maintainProfile ?? (async () => {
    const { maintainProfilePhotoStorage } = await import("../profile/photo");
    return maintainProfilePhotoStorage();
  });
  // Each private-media lifecycle runs even if the other one fails. The caller
  // still receives an error so the retention tick remains observable.
  const [chat, profile] = await Promise.allSettled([
    Promise.resolve().then(() => purgeChat()),
    Promise.resolve().then(() => maintainProfile()),
  ]);
  const failures: unknown[] = [];
  if (chat.status === "rejected") failures.push(chat.reason);
  if (profile.status === "rejected") failures.push(profile.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Media retention failed");
  if (chat.status !== "fulfilled") throw new Error("Chat media retention did not complete");
  return chat.value;
}

export function startChatMediaRetention(options: {
  enabled?: boolean;
  purge?: () => Promise<number>;
  intervalMs?: number;
} = {}): () => Promise<void> {
  if (!(options.enabled ?? !!process.env.PHONE11_CHAT_MEDIA_PATH)) return async () => undefined;
  const purge = options.purge ?? runMediaRetentionCycle;
  let stopped = false, activeTick: Promise<void> | undefined, stopPromise: Promise<void> | undefined;
  const run = () => {
    if (stopped || activeTick) return;
    const current = purge().then(() => undefined, () => undefined);
    activeTick = current;
    void current.finally(() => { if (activeTick === current) activeTick = undefined; });
  };
  run(); const timer = setInterval(run, options.intervalMs ?? 15 * 60 * 1000) as unknown as NodeJS.Timeout; timer.unref();
  return () => {
    if (stopPromise) return stopPromise;
    stopped = true; clearInterval(timer); stopPromise = activeTick ?? Promise.resolve(); return stopPromise;
  };
}
