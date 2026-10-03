import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtemp, mkdir, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool, type PoolClient } from "pg";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticate } }));
vi.mock("../server/_core/phone11-auth", () => ({ readAuthConfig: () => ({ trustedOrigins: ["https://app.phone11.test"] }) }));
import { attachClaimedChatAttachments, createChatMediaRouter, MAX_CHAT_ATTACHMENT_BYTES } from "../server/chat/media";

const connectionString = process.env.PHONE11_CHAT_TEST_DATABASE_URL;
const socket = process.env.PHONE11_CHAT_TEST_SOCKET;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/phone11_chat_test")
    throw new Error("Chat media HTTP tests require the dedicated local phone11_chat_test database");
}
const pool = new Pool(socket ? { host: socket, user: "phone11_test", database: "phone11_chat_test", ssl: false }
  : { connectionString, ssl: false });
async function transaction<T>(fn: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try { await db.query("BEGIN"); const result = await fn(db); await db.query("COMMIT"); return result; }
  catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
}
const roomId = "11111111-1111-4111-8111-111111111111";
const secondaryRoomId = "22222222-2222-4222-8222-222222222222";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9mQAAAABJRU5ErkJggg==", "base64");
let server: Server, base: string, directory: string;

function storedZip(entries: Array<{ name: string; body: Buffer }>) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const { name: text, body } of entries) {
    const name = Buffer.from(text), header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt32LE(body.length, 20); record.writeUInt32LE(body.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, name, body); central.push(record, name); offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function docx() {
  return storedZip([
    { name: "[Content_Types].xml", body: Buffer.from("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>") },
    { name: "_rels/.rels", body: Buffer.from("<Relationships/>") },
    { name: "word/document.xml", body: Buffer.from("<document/>") },
  ]);
}

function uploadHeaders(clientId = randomUUID(), additions: Record<string, string> = {}) {
  return { Authorization: "Bearer test", "X-Phone11-Chat-Owner": "1", "X-Phone11-Chat-Tenant": "10",
    "X-Phone11-Chat-Conversation": roomId, "X-Phone11-Chat-Client-Id": clientId,
    "X-Phone11-Chat-Filename": "photo%20one.png", "Content-Type": "image/png", ...additions };
}
async function upload(clientId = randomUUID(), body = png, additions: Record<string, string> = {}) {
  return fetch(`${base}/media/upload`, { method: "POST", headers: uploadHeaders(clientId, additions), body });
}

describe.skipIf(!connectionString && !socket)("Team Chat protected media HTTP routes", () => {
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "phone11-chat-media-http-")); await chmod(directory, 0o700);
    vi.stubEnv("PHONE11_CHAT_MEDIA_PATH", directory);
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
      CREATE TABLE IF NOT EXISTS extensions (id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), extension_number TEXT, status TEXT, deleted_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS user_extensions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), extension_id INTEGER REFERENCES extensions(id), is_primary BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS tenant_memberships (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), tenant_id INTEGER REFERENCES tenants(id), role TEXT, status TEXT, is_default BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, tenant_id));`);
    await pool.query(await readFile(new URL("../server/chat/migration.sql", import.meta.url), "utf8"));
    await pool.query(await readFile(new URL("../server/chat/media-migration.sql", import.meta.url), "utf8"));
    const app = express(); app.use("/media", createChatMediaRouter(transaction));
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.on("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(async () => {
    vi.clearAllMocks(); mocks.authenticate.mockImplementation(async req => {
      if (req.headers["x-test-auth"] === "none") throw new Error("unauthenticated");
      return { id: Number(req.headers["x-test-user"] || 1) };
    });
    vi.stubEnv("PHONE11_CHAT_MEDIA_PATH", directory);
    await pool.query(`TRUNCATE phone11_chat_attachments, phone11_chat_messages, phone11_chat_members, phone11_chat_conversations,
      user_extensions, tenant_memberships, extensions, users, tenants RESTART IDENTITY CASCADE;
      INSERT INTO users VALUES(1,'Alice'),(2,'Bob'); INSERT INTO tenants VALUES(10,'Alpha','active'),(20,'Beta','active');
      INSERT INTO extensions VALUES(1,10,'1001','active',NULL),(2,10,'1002','active',NULL),(3,20,'2001','active',NULL);
      INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES(1,1,true),(2,2,true),(1,3,false);
      INSERT INTO tenant_memberships(user_id,tenant_id,role,status,is_default) VALUES(1,10,'owner','active',true),(2,10,'user','active',false),(1,20,'owner','active',false);
      INSERT INTO phone11_chat_conversations(id,tenant_id,kind,name) VALUES('${roomId}',10,'direct','Alpha');
      INSERT INTO phone11_chat_members(tenant_id,conversation_id,user_id) VALUES(10,'${roomId}',1),(10,'${roomId}',2);
      INSERT INTO phone11_chat_conversations(id,tenant_id,kind,name) VALUES('${secondaryRoomId}',20,'channel','Beta');
      INSERT INTO phone11_chat_members(tenant_id,conversation_id,user_id) VALUES(20,'${secondaryRoomId}',1);`);
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

  it("rejects missing authentication, owner mismatch, and cookie requests from an untrusted origin", async () => {
    expect((await fetch(`${base}/media/upload`, { method: "POST", headers: uploadHeaders(randomUUID(), { "X-Test-Auth": "none" }), body: png })).status).toBe(401);
    expect((await upload(randomUUID(), png, { "X-Phone11-Chat-Owner": "2" })).status).toBe(401);
    const untrusted = await fetch(`${base}/media/upload`, { method: "POST", headers: { ...uploadHeaders(), Authorization: "", Cookie: "phone11.session=test", Origin: "https://evil.test" }, body: png });
    expect(untrusted.status).toBe(403);
  });

  it("rejects MIME/body mismatches and actual oversized bodies before storage", async () => {
    expect((await upload(randomUUID(), Buffer.from("GIF89a<script>"))).status).toBe(400);
    expect((await upload(randomUUID(), Buffer.alloc(MAX_CHAT_ATTACHMENT_BYTES + 1, 1))).status).toBe(413);
    expect((await pool.query("SELECT count(*)::int AS count FROM phone11_chat_attachments")).rows[0].count).toBe(0);
  });

  it("accepts a valid Office package and preserves protected download authorization", async () => {
    const packageBytes = docx();
    const uploaded = await upload(randomUUID(), packageBytes, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "X-Phone11-Chat-Filename": "brief.docx",
    });
    expect(uploaded.status).toBe(201);
    const attachment = await uploaded.json() as { id: string; filename: string };
    expect(attachment.filename).toBe("brief.docx");
    expect((await upload(randomUUID(), packageBytes, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Phone11-Chat-Filename": "brief.xlsx",
    })).status).toBe(400);
    const messageId = randomUUID();
    await pool.query(`INSERT INTO phone11_chat_messages(id,tenant_id,conversation_id,sender_id,client_id,content) VALUES($1,10,$2,1,$3,'Office caption')`, [messageId, roomId, randomUUID()]);
    await attachClaimedChatAttachments(pool, { tenantId: 10, conversationId: roomId, userId: 1, messageId, attachmentIds: [attachment.id] });
    const download = await fetch(`${base}/media/${attachment.id}`, { headers: { Authorization: "Bearer test", "X-Phone11-Chat-Tenant": "10" } });
    expect(download.status).toBe(200); expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(packageBytes);
    await pool.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=1 AND tenant_id=10");
    expect((await fetch(`${base}/media/${attachment.id}`, { headers: { Authorization: "Bearer test", "X-Phone11-Chat-Tenant": "10" } })).status).toBe(404);
  });

  it("is idempotent for an exact upload retry, rejects changed bytes, and decodes the safe filename", async () => {
    const clientId = randomUUID(); const first = await upload(clientId); const saved = await first.json() as { id: string; filename: string; error?: string }; expect(first.status, saved.error).toBe(201);
    expect(saved.filename).toBe("photo one.png");
    const retry = await upload(clientId); expect(retry.status).toBe(201); expect((await retry.json() as { id: string }).id).toBe(saved.id);
    const changed = Buffer.concat([png.subarray(0, -12), Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 1])]);
    expect((await upload(clientId, changed)).status).toBe(409);
  });

  it("fails closed without its pre-provisioned private storage directory", async () => {
    vi.stubEnv("PHONE11_CHAT_MEDIA_PATH", path.join(directory, "absent"));
    expect((await upload()).status).toBe(503);
    expect((await pool.query("SELECT count(*)::int AS count FROM phone11_chat_attachments")).rows[0].count).toBe(0);
  });

  it("streams only an attached, current-member, non-deleted message's bytes", async () => {
    const response = await upload(); const attachment = await response.json() as { id: string };
    const messageId = randomUUID(); await pool.query(`INSERT INTO phone11_chat_messages(id,tenant_id,conversation_id,sender_id,client_id,content) VALUES($1,10,$2,1,$3,'caption')`, [messageId, roomId, randomUUID()]);
    await attachClaimedChatAttachments(pool, { tenantId: 10, conversationId: roomId, userId: 1, messageId, attachmentIds: [attachment.id] });
    const download = await fetch(`${base}/media/${attachment.id}`, { headers: { Authorization: "Bearer test", "X-Phone11-Chat-Owner": "1", "X-Phone11-Chat-Tenant": "10" } });
    expect(download.status).toBe(200); expect(Buffer.from(await download.arrayBuffer())).toEqual(png); expect(download.headers.get("cache-control")).toContain("no-store");
    await pool.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=1 AND tenant_id=10");
    expect((await fetch(`${base}/media/${attachment.id}`, { headers: { Authorization: "Bearer test", "X-Phone11-Chat-Tenant": "10" } })).status).toBe(404);
    await pool.query("UPDATE tenant_memberships SET status='active' WHERE user_id=1 AND tenant_id=10");
    await pool.query("UPDATE phone11_chat_messages SET deleted_at=clock_timestamp() WHERE id=$1", [messageId]);
    expect((await fetch(`${base}/media/${attachment.id}`, { headers: { Authorization: "Bearer test", "X-Phone11-Chat-Tenant": "10" } })).status).toBe(404);
  });

  it("streams a selected non-default workspace attachment but denies that id through another workspace", async () => {
    const uploadResponse = await upload(randomUUID(), png, {
      "X-Phone11-Chat-Tenant": "20", "X-Phone11-Chat-Conversation": secondaryRoomId,
    });
    expect(uploadResponse.status).toBe(201);
    const attachment = await uploadResponse.json() as { id: string };
    const messageId = randomUUID();
    await pool.query(`INSERT INTO phone11_chat_messages(id,tenant_id,conversation_id,sender_id,client_id,content)
      VALUES($1,20,$2,1,$3,'Beta caption')`, [messageId, secondaryRoomId, randomUUID()]);
    await attachClaimedChatAttachments(pool, { tenantId: 20, conversationId: secondaryRoomId, userId: 1, messageId, attachmentIds: [attachment.id] });

    const selected = await fetch(`${base}/media/${attachment.id}`, { headers: {
      Authorization: "Bearer test", "X-Phone11-Chat-Owner": "1", "X-Phone11-Chat-Tenant": "20",
    } });
    expect(selected.status).toBe(200); expect(Buffer.from(await selected.arrayBuffer())).toEqual(png);
    const foreignWorkspace = await fetch(`${base}/media/${attachment.id}`, { headers: {
      Authorization: "Bearer test", "X-Phone11-Chat-Owner": "1", "X-Phone11-Chat-Tenant": "10",
    } });
    expect(foreignWorkspace.status).toBe(404);
  });
});
