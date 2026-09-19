import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { createChatService } from "../server/chat/service";
import { chatRouter } from "../server/chat/router";
const connectionString = process.env.PHONE11_CHAT_TEST_DATABASE_URL;
const socket = process.env.PHONE11_CHAT_TEST_SOCKET;
if (socket && !socket.startsWith('/')) throw new Error('Private absolute test socket required');
// Explicit local test database only. Never run this schema fixture against a real tenant.
if (connectionString) {
  const url = new URL(connectionString);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/phone11_chat_test") throw new Error("Chat integration tests require a dedicated local phone11_chat_test database");
}
const pool = new Pool(socket ? { host: socket, user: 'phone11_test', database: 'phone11_chat_test', max: 12, ssl: false } : { connectionString, max: 12, ssl: false });
async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
const service = createChatService(transaction);
describe("chat authentication", () => {
  it("rejects anonymous requests before accessing storage", async () => {
    const caller = chatRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
describe.skipIf(!connectionString && !socket)("Team Chat real PostgreSQL persistence and isolation", () => {
  beforeAll(async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
      CREATE TABLE IF NOT EXISTS extensions (id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), extension_number TEXT, status TEXT, deleted_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS user_extensions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), extension_id INTEGER REFERENCES extensions(id), is_primary BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS tenant_memberships (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), tenant_id INTEGER REFERENCES tenants(id), role TEXT, status TEXT, is_default BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, tenant_id));`);
    await pool.query(await readFile(new URL("../server/chat/migration.sql", import.meta.url), "utf8"));
    await pool.query(await readFile(new URL("../server/chat/collaboration-migration.sql", import.meta.url), "utf8"));
    await pool.query(await readFile(new URL("../server/chat/media-migration.sql", import.meta.url), "utf8"));
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE phone11_chat_reports, phone11_chat_blocks, phone11_chat_notification_preferences, phone11_chat_pins, phone11_chat_bookmarks, phone11_chat_reactions, phone11_chat_attachments, phone11_chat_messages, phone11_chat_members, phone11_chat_conversations, user_extensions, tenant_memberships, extensions, users, tenants RESTART IDENTITY CASCADE;
      INSERT INTO users VALUES (1,'Alice'),(2,'Bob'),(3,'Other tenant'),(4,'No assignment'),(5,'Not in conversation'),(6,'Beta teammate');
      INSERT INTO tenants VALUES (10,'Alpha','active'),(20,'Beta','active');
      INSERT INTO tenant_memberships(user_id,tenant_id,role,status,is_default) VALUES (1,10,'owner','active',true),(2,10,'user','active',false),(3,20,'owner','active',true),(5,10,'user','active',false),(6,20,'user','active',false);
      INSERT INTO extensions VALUES (1,10,'1001','active',NULL),(2,10,'1002','active',NULL),(3,20,'2001','active',NULL),(5,10,'1005','active',NULL),(6,20,'2002','active',NULL);
      INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES (1,1,true),(2,2,true),(3,3,true),(5,5,true),(6,6,true);`);
  });
  afterAll(() => pool.end());
  const room = () => service.create(1, 10, "direct", "Direct", [2]);
  it("uses only assigned active workspaces and rejects arbitrary tenant selection", async () => {
    expect((await service.list(1)).workspace).toEqual({ id: 10, name: "Alpha" });
    await expect(service.list(1, 20)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.list(4)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("directory returns only active assigned teammates and safe call targets", async () => {
    expect(await service.directory(1, 10)).toEqual([{ id: 2, name: "Bob", extension: "1002" }, { id: 5, name: "Not in conversation", extension: "1005" }]);
    await pool.query("UPDATE extensions SET status = 'inactive' WHERE id = 2");
    expect((await service.directory(1, 10)).map(p => p.id)).toEqual([5]);
  });
  it("stores only member-resolved mentions and exposes scoped conversation details", async () => {
    const { id } = await room();
    const message = await service.send(1, 10, id, randomUUID(), "Hello @Bob", undefined, [], [{ userId: 2, start: 6, length: 4 }]);
    expect(message.mentions).toEqual([{ userId: 2, name: "Bob", start: 6, length: 4 }]);
    await expect(service.send(1, 10, id, randomUUID(), "Hello @Bob", undefined, [], [{ userId: 5, start: 6, length: 4 }])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.send(1, 10, id, randomUUID(), "Hello @Bob", undefined, [], [{ userId: 2, start: 0, length: 4 }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await service.details(1, 10, id)).members.map(member => member.id)).toEqual([1, 2]);
    await expect(service.details(5, 10, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const beta = await service.create(3, 20, "direct", "Beta", [6]);
    await expect(service.details(1, 10, beta.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("removes deactivated members from Team Chat and restores them only after reactivation", async () => {
    const { id } = await room();
    await pool.query("UPDATE tenant_memberships SET status = 'inactive' WHERE user_id = 2 AND tenant_id = 10");
    expect((await service.directory(1, 10)).map(person => person.id)).not.toContain(2);
    await expect(service.list(2, 10)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.history(2, 10, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.create(1, 10, "direct", "Direct", [2])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.send(1, 10, id, randomUUID(), "Are you there?")).rejects.toMatchObject({ code: "NOT_FOUND" });

    await pool.query("UPDATE tenant_memberships SET status = 'active' WHERE user_id = 2 AND tenant_id = 10");
    expect((await service.directory(1, 10)).map(person => person.id)).toContain(2);
    await expect(service.history(2, 10, id)).resolves.toMatchObject({ messages: [] });
    await expect(service.send(1, 10, id, randomUUID(), "Welcome back")).resolves.toMatchObject({ content: "Welcome back" });
  });
  it("refuses cross-tenant and unassigned participants", async () => {
    await expect(service.create(1, 10, "group", "Private", [2, 3])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.create(1, 10, "direct", "Private", [4])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await service.list(1, 10)).channels).toEqual([]);
  });
  it("supports separate companies without sharing rooms or messages", async () => {
    const alpha = await room();
    const beta = await service.create(3, 20, "direct", "Direct", [6]);
    expect(beta.id).not.toBe(alpha.id);
    await service.send(3, 20, beta.id, randomUUID(), "Beta hello");
    expect((await service.history(6, 20, beta.id)).messages.map(message => message.content)).toEqual(["Beta hello"]);
    expect((await service.list(3, 20)).workspace).toEqual({ id: 20, name: "Beta" });
    expect((await service.list(1, 10)).workspace).toEqual({ id: 10, name: "Alpha" });
    await expect(service.list(3, 10)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.history(1, 10, beta.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("concurrent direct creation converges on one persisted conversation", async () => {
    const results = await Promise.all([room(), service.create(2, 10, "direct", "Direct", [1]), room()]);
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    expect((await service.list(1, 10)).channels).toHaveLength(1);
  });
  it("blocks conversation enumeration/read/send by nonmembers in the same tenant", async () => {
    const { id } = await room(); expect((await service.list(5, 10)).channels).toEqual([]);
    await expect(service.history(5, 10, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.send(5, 10, id, randomUUID(), "forbidden")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.read(5, 10, id, 1000)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.history(3, 20, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("never treats link preview as an arbitrary URL fetcher", async () => {
    const { id } = await room(); const sent = await service.send(1, 10, id, randomUUID(), "Review https://example.com/launch");
    await expect(service.linkPreview(5, 10, id, sent.id, "https://example.com/launch")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.linkPreview(1, 10, id, sent.id, "https://example.com/other")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await service.delete(1, 10, id, sent.id);
    await expect(service.linkPreview(1, 10, id, sent.id, "https://example.com/launch")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("persists a message exactly once across concurrent lost-response retries", async () => {
    const { id } = await room(), clientId = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.send(1, 10, id, clientId, "สวัสดี team")));
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    const independent = createChatService(transaction);
    const history = await independent.history(2, 10, id);
    expect(history.messages).toHaveLength(1); expect(history.messages[0].content).toBe("สวัสดี team"); expect(history.messages[0].senderId).toBe(1);
  });
  it("rejects changing content on an existing retry key without altering the saved message", async () => {
    const { id } = await room(), clientId = randomUUID(); await service.send(1, 10, id, clientId, "original");
    await expect(service.send(1, 10, id, clientId, "replacement")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await service.history(2, 10, id)).messages[0].content).toBe("original");
  });
  it("keeps client keys scoped to their sender", async () => {
    const { id } = await room(), clientId = randomUUID(); await service.send(1, 10, id, clientId, "Alice"); await service.send(2, 10, id, clientId, "Bob");
    expect((await service.history(1, 10, id)).messages.map(m => m.content)).toEqual(["Alice", "Bob"]);
  });
  it("tracks unread messages per member and never marks future messages read", async () => {
    const { id } = await room(); const first = await service.send(1, 10, id, randomUUID(), "One");
    expect((await service.list(2, 10)).channels[0].unreadCount).toBe(1);
    expect((await service.list(1, 10)).channels[0].unreadCount).toBe(0);
    await service.read(2, 10, id, Number.MAX_SAFE_INTEGER); await service.send(1, 10, id, randomUUID(), "Two");
    expect((await service.list(2, 10)).channels[0].unreadCount).toBe(1);
    await service.read(2, 10, id, first.sequence); expect((await service.list(2, 10)).channels[0].unreadCount).toBe(1);
  });
  it("pages persisted history without duplicates or missing messages", async () => {
    const { id } = await room();
    await pool.query(`INSERT INTO phone11_chat_messages(id, tenant_id, conversation_id, sender_id, client_id, content)
      SELECT gen_random_uuid(), 10, $1, 1, gen_random_uuid(), n::text FROM generate_series(0, 104) AS n`, [id]);
    const recent = await service.history(2, 10, id); expect(recent.hasMore).toBe(true); expect(recent.messages).toHaveLength(100);
    const earlier = await service.history(2, 10, id, recent.messages[0].sequence); expect(earlier.hasMore).toBe(false);
    expect([...earlier.messages, ...recent.messages].map(m => m.content)).toEqual(Array.from({ length: 105 }, (_, i) => String(i)));
  });
  it("searches only saved messages inside an authorized conversation with literal matching", async () => {
    const { id } = await room(); await service.send(1, 10, id, randomUUID(), "Invoice 100% ready"); await service.send(2, 10, id, randomUUID(), "Meeting tomorrow");
    expect((await service.search(1, 10, id, "INVOICE")).messages.map(m => m.content)).toEqual(["Invoice 100% ready"]);
    expect((await service.search(2, 10, id, "100%")).messages).toHaveLength(1);
    expect((await service.search(2, 10, id, "%' OR 1=1 --")).messages).toEqual([]);
    await expect(service.search(5, 10, id, "Invoice")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.search(3, 20, id, "Invoice")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await pool.query("DELETE FROM user_extensions WHERE user_id = 2");
    await expect(service.search(2, 10, id, "Invoice")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps replies out of root history while search and the bounded thread retain navigation and authoritative totals", async () => {
    const { id } = await room();
    const parent = await service.send(1, 10, id, randomUUID(), "Can you confirm the invoice?");
    const reply = await service.send(2, 10, id, randomUUID(), "Confirmed", parent.id);
    expect(reply.parent).toMatchObject({ id: parent.id, senderName: "Alice", content: parent.content });
    const history = await service.history(1, 10, id);
    expect(history.messages.map(message => message.id)).toEqual([parent.id]);
    expect(history.messages[0].replyCount).toBe(1);
    expect(history.latestSequence).toBe(reply.sequence); expect(history.rootLatestSequence).toBe(parent.sequence);
    expect((await service.search(1, 10, id, "confirmed")).messages[0].parent).toMatchObject({ id: parent.id });
    const thread = await service.thread(1, 10, id, parent.id);
    expect(thread.root.id).toBe(parent.id); expect(thread.replies.map(message => message.id)).toEqual([reply.id]); expect(thread.hasMore).toBe(false);
  });
  it("rejects a parent from another conversation or tenant before saving a reply", async () => {
    const { id } = await room();
    const second = await service.create(1, 10, "group", "Second", [2]);
    const elsewhere = await service.send(1, 10, second.id, randomUUID(), "Other room");
    const beta = await service.create(3, 20, "direct", "Direct", [6]);
    const betaParent = await service.send(3, 20, beta.id, randomUUID(), "Other tenant");
    await expect(service.send(1, 10, id, randomUUID(), "cross room", elsewhere.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.send(1, 10, id, randomUUID(), "cross tenant", betaParent.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await service.history(1, 10, id)).messages).toEqual([]);
  });
  it("does not reveal or accept a quoted parent for a same-tenant nonmember", async () => {
    const { id } = await room(); const parent = await service.send(1, 10, id, randomUUID(), "Private parent");
    await expect(service.thread(5, 10, id, parent.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.send(5, 10, id, randomUUID(), "Private reply", parent.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects a stale deleted parent and keeps a reply retry idempotent", async () => {
    const { id } = await room(); const parent = await service.send(1, 10, id, randomUUID(), "Soon deleted");
    await pool.query("DELETE FROM phone11_chat_messages WHERE id = $1", [parent.id]);
    await expect(service.send(2, 10, id, randomUUID(), "Too late", parent.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const current = await service.send(1, 10, id, randomUUID(), "Current parent"), clientId = randomUUID();
    const replies = await Promise.all([service.send(2, 10, id, clientId, "One reply", current.id), service.send(2, 10, id, clientId, "One reply", current.id)]);
    expect(new Set(replies.map(reply => reply.id)).size).toBe(1);
    await expect(service.send(2, 10, id, clientId, "One reply", undefined)).rejects.toMatchObject({ code: "CONFLICT" });
    await pool.query("DELETE FROM phone11_chat_messages WHERE id = $1", [current.id]);
    expect((await service.history(2, 10, id)).messages.find(message => message.id === replies[0].id)?.parent).toBeNull();
  });
  it("records a bounded private report idempotently without returning reporter identity", async () => {
    const { id } = await room(); const message = await service.send(2, 10, id, randomUUID(), "Please stop");
    expect(await service.report(1, 10, id, "harassment", "Unwanted contact", message.id)).toEqual({ recorded: true });
    expect(await service.report(1, 10, id, "harassment", "Changed comment does not replace audit evidence", message.id)).toEqual({ recorded: true });
    const reports = await pool.query("SELECT reporter_id, category, comment FROM phone11_chat_reports WHERE tenant_id = 10");
    expect(reports.rows).toEqual([{ reporter_id: 1, category: "harassment", comment: "Unwanted contact" }]);
    await expect(service.report(5, 10, id, "spam", undefined, message.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const beta = await service.create(3, 20, "direct", "Direct", [6]);
    await expect(service.report(1, 10, beta.id, "spam")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("persists convergent reactions with authorized participant names and blocks nonmembers and other tenants", async () => {
    const { id } = await room(); const saved = await service.send(1, 10, id, randomUUID(), "React here");
    await Promise.all([service.setReaction(1, 10, id, saved.id, "👍", true), service.setReaction(1, 10, id, saved.id, "👍", true)]);
    await service.setReaction(2, 10, id, saved.id, "👍", true);
    const result = (await service.history(1, 10, id)).messages[0].reactions?.[0];
    expect(result).toMatchObject({ emoji: "👍", count: 2, reacted: true }); expect(result?.users.map(user => user.id)).toEqual([1, 2]);
    expect(await service.reactionUsers(2, 10, id, saved.id, "👍")).toEqual([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);
    await service.setReaction(1, 10, id, saved.id, "👍", false); await service.setReaction(1, 10, id, saved.id, "👍", false);
    expect((await service.history(2, 10, id)).messages[0].reactions?.[0]).toMatchObject({ count: 1, reacted: true });
    await expect(service.setReaction(5, 10, id, saved.id, "👍", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.setReaction(3, 20, id, saved.id, "👍", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("limits edits and tombstones to the owner while retaining stable thread records", async () => {
    const { id } = await room(); const root = await service.send(1, 10, id, randomUUID(), "Original");
    const reply = await service.send(2, 10, id, randomUUID(), "Reply", root.id);
    await expect(service.edit(2, 10, id, root.id, "Not mine")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const edited = await service.edit(1, 10, id, root.id, "Edited"); expect(edited).toMatchObject({ content: "Edited" }); expect(edited.editedAt).toEqual(expect.any(Number));
    await expect(service.delete(2, 10, id, root.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const deleted = await service.delete(1, 10, id, root.id); expect(deleted).toMatchObject({ content: "Message deleted." }); expect(deleted.deletedAt).toEqual(expect.any(Number));
    expect((await service.thread(2, 10, id, root.id)).replies.map(message => message.id)).toEqual([reply.id]);
    await expect(service.send(2, 10, id, randomUUID(), "Late reply", root.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("keeps saves private, pins shared, and notification muting per member", async () => {
    const { id } = await room(); const saved = await service.send(1, 10, id, randomUUID(), "Save and pin");
    await service.setBookmark(1, 10, id, saved.id, true); await service.setPin(1, 10, id, saved.id, true);
    expect(await service.bookmarks(1, 10)).toEqual([expect.objectContaining({ messageId: saved.id, channelId: id })]);
    expect(await service.bookmarks(2, 10)).toEqual([]);
    expect((await service.history(2, 10, id)).messages[0]).toMatchObject({ isBookmarked: false, isPinned: true });
    await service.setNotificationMute(1, 10, id, true);
    expect((await service.list(1, 10)).channels[0].notificationsMuted).toBe(true);
    expect((await service.list(2, 10)).channels[0].notificationsMuted).toBe(false);
    await expect(service.setPin(5, 10, id, saved.id, false)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("returns saved and pinned message bodies only to an authorized room member", async () => {
    const { id } = await room(); const saved = await service.send(1, 10, id, randomUUID(), "Find me later");
    await service.setBookmark(1, 10, id, saved.id, true); await service.setPin(1, 10, id, saved.id, true);
    expect((await service.savedMessages(1, 10, id)).map(message => message.id)).toEqual([saved.id]);
    expect((await service.savedMessages(2, 10, id))).toEqual([]);
    expect((await service.pinnedMessages(2, 10, id)).map(message => message.id)).toEqual([saved.id]);
    await expect(service.pinnedMessages(5, 10, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("uses an explicit fresh heartbeat with active account mapping for presence", async () => {
    expect(await service.presence(1, 10, [2, 3, 4])).toEqual([{ userId: 2, available: false, lastSeenAt: null }]);
    const heartbeat = await service.heartbeat(2, 10); expect(heartbeat.lastSeenAt).toEqual(expect.any(Number));
    expect(await service.presence(1, 10, [2])).toEqual([expect.objectContaining({ userId: 2, available: true, lastSeenAt: expect.any(Number) })]);
    await pool.query("UPDATE tenant_memberships SET status = 'inactive' WHERE user_id = 2 AND tenant_id = 10");
    expect(await service.presence(1, 10, [2])).toEqual([]);
  });
  it("forwards only an authorized same-tenant message and keeps a lost-response retry stable", async () => {
    const source = await room(); const target = await service.create(1, 10, "group", "Target", [2]);
    const original = await service.send(1, 10, source.id, randomUUID(), "Forward this"); const clientId = randomUUID();
    const [first, retry] = await Promise.all([service.forward(1, 10, target.id, source.id, original.id, clientId), service.forward(1, 10, target.id, source.id, original.id, clientId)]);
    expect(first.id).toBe(retry.id); expect(first.content).toBe("Forward this");
    const beta = await service.create(3, 20, "direct", "Beta", [6]);
    await expect(service.forward(1, 10, target.id, beta.id, randomUUID(), randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.forward(5, 10, target.id, source.id, original.id, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("fails chat AI closed for disabled capability and rejects a same-tenant nonmember before provider work", async () => {
    const { id } = await room(); const root = await service.send(1, 10, id, randomUUID(), "Private context");
    await expect(service.intelligenceCapability(1, 10)).resolves.toMatchObject({ available: false });
    await expect(service.summarizeThread(1, 10, id, root.id)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(service.summarizeThread(5, 10, id, root.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("enforces a block both ways for direct contact without altering group history", async () => {
    const { id } = await room(), savedClientId = randomUUID(); await service.send(1, 10, id, savedClientId, "Saved before block");
    expect(await service.block(1, 10, 2)).toEqual({ blocked: true }); expect(await service.block(1, 10, 2)).toEqual({ blocked: true });
    expect((await service.list(1, 10)).channels[0].blocked).toBe(true); expect((await service.list(2, 10)).channels[0].blocked).toBe(true);
    expect((await service.directory(1, 10)).map(person => person.id)).not.toContain(2); expect((await service.directory(2, 10)).map(person => person.id)).not.toContain(1);
    await expect(service.create(1, 10, "direct", "Direct", [2])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(service.create(2, 10, "direct", "Direct", [1])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(service.send(1, 10, id, randomUUID(), "blocked one")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(service.send(2, 10, id, randomUUID(), "blocked two")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(service.send(1, 10, id, savedClientId, "Saved before block")).resolves.toMatchObject({ content: "Saved before block" });
    expect((await service.history(2, 10, id)).messages.map(message => message.content)).toEqual(["Saved before block"]);
    const group = await service.create(1, 10, "group", "Audit group", [2]);
    await service.send(1, 10, group.id, randomUUID(), "Group audit continues");
    expect((await service.history(2, 10, group.id)).messages.map(message => message.content)).toEqual(["Group audit continues"]);
    await service.unblock(1, 10, 2); await service.send(2, 10, id, randomUUID(), "Allowed after unblock");
  });
  it("refuses blocks outside the caller's authorized tenant or membership", async () => {
    await expect(service.block(1, 10, 3)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.block(4, 10, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.block(1, 10, 1)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("honors deleted assignments and suspended tenants immediately", async () => {
    const { id } = await room(); await pool.query("DELETE FROM user_extensions WHERE user_id = 2");
    await expect(service.history(2, 10, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.send(2, 10, id, randomUUID(), "old account")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pool.query("UPDATE tenants SET status = 'suspended' WHERE id = 10");
    await expect(service.list(1, 10)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
