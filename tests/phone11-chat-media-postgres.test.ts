import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool } from "pg";
import { attachClaimedChatAttachments, claimChatAttachments, forwardChatAttachments } from "../server/chat/media";

const connectionString = process.env.PHONE11_CHAT_TEST_DATABASE_URL;
const socket = process.env.PHONE11_CHAT_TEST_SOCKET;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/phone11_chat_test")
    throw new Error("Chat media tests require the dedicated local phone11_chat_test database");
}
const pool = new Pool(socket ? { host: socket, user: "phone11_test", database: "phone11_chat_test", ssl: false }
  : { connectionString, ssl: false });
const alphaRoom = "11111111-1111-4111-8111-111111111111";
const alphaTargetRoom = "33333333-3333-4333-8333-333333333333";
const betaRoom = "22222222-2222-4222-8222-222222222222";

async function pendingAttachment(overrides: Partial<{ tenantId: number; conversationId: string; userId: number; id: string }> = {}) {
  const tenantId = overrides.tenantId ?? 10, conversationId = overrides.conversationId ?? alphaRoom;
  const userId = overrides.userId ?? 1, id = overrides.id ?? randomUUID();
  await pool.query(`INSERT INTO phone11_chat_attachments
    (id,tenant_id,conversation_id,uploaded_by,client_id,storage_key,filename,mime_type,size_bytes,content_sha256,state,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,'photo.png','image/png',12,$7,'ready',clock_timestamp()+interval '1 hour')`,
    [id, tenantId, conversationId, userId, randomUUID(), `${tenantId}/${randomUUID()}.png`, "a".repeat(64)]);
  return id;
}

describe.skipIf(!connectionString && !socket)("Team Chat attachment PostgreSQL isolation", () => {
  beforeAll(async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
      CREATE TABLE IF NOT EXISTS extensions (id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), extension_number TEXT, status TEXT, deleted_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS user_extensions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), extension_id INTEGER REFERENCES extensions(id), is_primary BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS tenant_memberships (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), tenant_id INTEGER REFERENCES tenants(id), role TEXT, status TEXT, is_default BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, tenant_id));`);
    await pool.query(await readFile(new URL("../server/chat/migration.sql", import.meta.url), "utf8"));
    await pool.query(await readFile(new URL("../server/chat/media-migration.sql", import.meta.url), "utf8"));
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE phone11_chat_attachments, phone11_chat_messages, phone11_chat_members, phone11_chat_conversations,
      user_extensions, tenant_memberships, extensions, users, tenants RESTART IDENTITY CASCADE;
      INSERT INTO users VALUES(1,'Alice'),(2,'Bob'),(3,'Beta'); INSERT INTO tenants VALUES(10,'Alpha','active'),(20,'Beta','active');
      INSERT INTO phone11_chat_conversations(id,tenant_id,kind,name) VALUES('${alphaRoom}',10,'direct','Alpha'),('${betaRoom}',20,'direct','Beta');
      INSERT INTO phone11_chat_conversations(id,tenant_id,kind,name) VALUES('${alphaTargetRoom}',10,'group','Alpha target');
      INSERT INTO tenant_memberships(user_id,tenant_id,role,status,is_default) VALUES(1,10,'owner','active',true),(2,10,'user','active',false),(3,20,'owner','active',true);
      INSERT INTO phone11_chat_members(tenant_id,conversation_id,user_id) VALUES(10,'${alphaRoom}',1),(10,'${alphaRoom}',2),(10,'${alphaTargetRoom}',1),(10,'${alphaTargetRoom}',2),(20,'${betaRoom}',3);`);
  });
  afterAll(() => pool.end());

  it("claims only an uploader's live, same-conversation attachment and exposes no storage key", async () => {
    const id = await pendingAttachment();
    await expect(claimChatAttachments(pool, { tenantId: 10, conversationId: alphaRoom, userId: 2, attachmentIds: [id] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(claimChatAttachments(pool, { tenantId: 20, conversationId: betaRoom, userId: 3, attachmentIds: [id] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const descriptors = await claimChatAttachments(pool, { tenantId: 10, conversationId: alphaRoom, userId: 1, attachmentIds: [id] });
    expect(descriptors).toEqual([{ id, conversationId: alphaRoom, filename: "photo.png", mimeType: "image/png", sizeBytes: 12, status: "ready" }]);
    expect(JSON.stringify(descriptors)).not.toContain("storage_key");
  });

  it("attaches atomically to one same-room message and cannot be claimed twice", async () => {
    const id = await pendingAttachment();
    await claimChatAttachments(pool, { tenantId: 10, conversationId: alphaRoom, userId: 1, attachmentIds: [id] });
    const messageId = randomUUID();
    await pool.query(`INSERT INTO phone11_chat_messages(id,tenant_id,conversation_id,sender_id,client_id,content)
      VALUES($1,10,$2,1,$3,'image caption')`, [messageId, alphaRoom, randomUUID()]);
    await attachClaimedChatAttachments(pool, { tenantId: 10, conversationId: alphaRoom, userId: 1, messageId, attachmentIds: [id] });
    expect((await pool.query("SELECT state,message_id,expires_at FROM phone11_chat_attachments WHERE id=$1", [id])).rows[0])
      .toMatchObject({ state: "attached", message_id: messageId, expires_at: null });
    await expect(claimChatAttachments(pool, { tenantId: 10, conversationId: alphaRoom, userId: 1, attachmentIds: [id] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects duplicate IDs, expired uploads, and cross-conversation attachment attempts", async () => {
    const id = await pendingAttachment();
    await expect(claimChatAttachments(pool, { tenantId: 10, conversationId: alphaRoom, userId: 1, attachmentIds: [id, id] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await pool.query("UPDATE phone11_chat_attachments SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
    await expect(claimChatAttachments(pool, { tenantId: 10, conversationId: alphaRoom, userId: 1, attachmentIds: [id] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const fresh = await pendingAttachment();
    await expect(attachClaimedChatAttachments(pool, { tenantId: 20, conversationId: betaRoom, userId: 3, messageId: randomUUID(), attachmentIds: [fresh] }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("forwards an attached item only as new same-tenant target metadata", async () => {
    const id = await pendingAttachment();
    const sourceMessageId = randomUUID(), targetMessageId = randomUUID();
    await pool.query(`INSERT INTO phone11_chat_messages(id,tenant_id,conversation_id,sender_id,client_id,content)
      VALUES($1,10,$2,1,$3,'source'),($4,10,$5,1,$6,'forwarded')`, [sourceMessageId, alphaRoom, randomUUID(), targetMessageId, alphaTargetRoom, randomUUID()]);
    await attachClaimedChatAttachments(pool, { tenantId: 10, conversationId: alphaRoom, userId: 1, messageId: sourceMessageId, attachmentIds: [id] });
    const forwarded = await forwardChatAttachments(pool, { tenantId: 10, sourceConversationId: alphaRoom, targetConversationId: alphaTargetRoom, userId: 1, messageId: targetMessageId, attachmentIds: [id] });
    expect(forwarded).toHaveLength(1); expect(forwarded[0]).toMatchObject({ conversationId: alphaTargetRoom, status: "attached" });
    const rows = await pool.query("SELECT conversation_id,storage_key,message_id FROM phone11_chat_attachments WHERE id=ANY($1::uuid[]) ORDER BY created_at", [[id, forwarded[0].id]]);
    expect(rows.rows).toHaveLength(2); expect(rows.rows[0].storage_key).toBe(rows.rows[1].storage_key);
    expect(rows.rows[1]).toMatchObject({ conversation_id: alphaTargetRoom, message_id: targetMessageId });
    await expect(forwardChatAttachments(pool, { tenantId: 20, sourceConversationId: betaRoom, targetConversationId: betaRoom, userId: 3, messageId: randomUUID(), attachmentIds: [id] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
