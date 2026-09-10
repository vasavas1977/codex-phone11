import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { createChatService } from "../server/chat/service";
import { chatRouter } from "../server/chat/router";
const connectionString = process.env.PHONE11_CHAT_TEST_DATABASE_URL;
// Explicit local test database only. Never run this schema fixture against a real tenant.
if (connectionString) {
  const url = new URL(connectionString);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/phone11_chat_test") throw new Error("Chat integration tests require a dedicated local phone11_chat_test database");
}
const pool = new Pool({ connectionString, max: 12, ssl: false });
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
describe.skipIf(!connectionString)("Team Chat real PostgreSQL persistence and isolation", () => {
  beforeAll(async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
      CREATE TABLE IF NOT EXISTS extensions (id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), extension_number TEXT, status TEXT, deleted_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS user_extensions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), extension_id INTEGER REFERENCES extensions(id), is_primary BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW());`);
    await pool.query(await readFile(new URL("../server/chat/migration.sql", import.meta.url), "utf8"));
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE phone11_chat_messages, phone11_chat_members, phone11_chat_conversations, user_extensions, extensions, users, tenants RESTART IDENTITY CASCADE;
      INSERT INTO users VALUES (1,'Alice'),(2,'Bob'),(3,'Other tenant'),(4,'No assignment'),(5,'Not in conversation');
      INSERT INTO tenants VALUES (10,'Alpha','active'),(20,'Beta','active');
      INSERT INTO extensions VALUES (1,10,'1001','active',NULL),(2,10,'1002','active',NULL),(3,20,'2001','active',NULL),(5,10,'1005','active',NULL);
      INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES (1,1,true),(2,2,true),(3,3,true),(5,5,true);`);
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
  it("refuses cross-tenant and unassigned participants", async () => {
    await expect(service.create(1, 10, "group", "Private", [2, 3])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.create(1, 10, "direct", "Private", [4])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await service.list(1, 10)).channels).toEqual([]);
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
  it("honors deleted assignments and suspended tenants immediately", async () => {
    const { id } = await room(); await pool.query("DELETE FROM user_extensions WHERE user_id = 2");
    await expect(service.history(2, 10, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.send(2, 10, id, randomUUID(), "old account")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pool.query("UPDATE tenants SET status = 'suspended' WHERE id = 10");
    await expect(service.list(1, 10)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
