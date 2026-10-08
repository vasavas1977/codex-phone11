import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { URL } from "node:url";
import type { Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { admitVoicemail, completeVoicemail, type ProducerConfig } from "../scripts/phone11-voicemail-producer";
import { relayOnce } from "../scripts/phone11-voicemail-relay";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
// Only the signed-in-principal boundary is synthetic. Ownership, admission,
// transactions, migration triggers, custody and playback use the real code.
vi.mock("../server/_core/sdk", () => ({ sdk: {
  authenticateRequest: async (req: express.Request) => {
    const id = Number(req.get("x-phone11-fixture-principal"));
    if (id !== 17 && id !== 18) throw new Error("Synthetic principal missing");
    return { id };
  },
} }));
vi.mock("../server/pbx/db", () => ({
  query: (sql: string, values?: unknown[]) => state.pool!.query(sql, values),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const client = await state.pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  },
}));

const socket = process.env.PHONE11_VOICEMAIL_INTEGRATION_SOCKET;
const schema = `phone11_vm_integration_${randomUUID().replaceAll("-", "")}`;
const secret = "synthetic-only-voicemail-integration-0123456789";
const audio = Buffer.alloc(108);
audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(64, 40);
for (let offset = 44; offset < audio.length; offset += 2) audio.writeInt16LE(offset * 10, offset);
let root: string, storageRoot: string, httpSocket: string, server: Server;
let storageRouter: express.Router;
let config: ProducerConfig, wav: string, otherWav: string;

function pool() {
  return new Pool({ host: socket, port: Number(process.env.PHONE11_VOICEMAIL_INTEGRATION_PORT ?? 55443),
    user: "phone11_test", database: "phone11_voicemail_test", ssl: false, options: `-c search_path=${schema}` });
}
async function startRoutes() {
  const app = express(); app.use("/api/recordings", storageRouter);
  server = app.listen(httpSocket);
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
}
async function call(url: string, init: RequestInit = {}, principal?: number): Promise<Response> {
  const endpoint = new URL(url);
  if (endpoint.origin !== "https://voicemail-fixture.invalid") throw new Error("Non-fixture endpoint refused");
  const headers = Object.fromEntries(new Headers(init.headers));
  if (principal !== undefined) headers["x-phone11-fixture-principal"] = String(principal);
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: httpSocket, method: init.method ?? "GET", path: endpoint.pathname + endpoint.search,
      headers, signal: init.signal ?? undefined }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("error", reject);
      res.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) if (value !== undefined)
          responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        resolve(new Response(res.statusCode === 204 || res.statusCode === 304 ? null : Buffer.concat(chunks),
          { status: res.statusCode, headers: responseHeaders }));
      });
    });
    req.once("error", reject);
    if (init.body !== undefined && init.body !== null) req.write(Buffer.from(init.body as Uint8Array));
    req.end();
  });
}
const transport = () => ((url: string, init?: RequestInit) => call(url, init)) as typeof fetch;
const endpoint = (suffix: string) => `https://voicemail-fixture.invalid/api/recordings${suffix}`;
async function deposit() {
  const channelUuid = randomUUID();
  const messageUuid = await admitVoicemail({ ...config }, { channelUuid, tenantId: 12, extension: "3001" }, transport());
  await completeVoicemail({ ...config }, { channelUuid, voicemailFilePath: wav, durationSeconds: 1 });
  expect(await relayOnce({ ...config }, transport())).toEqual({ delivered: 1, quarantined: 0, retry: 0 });
  const row = (await state.pool!.query("SELECT * FROM voicemail_messages WHERE message_uuid=$1", [messageUuid])).rows[0];
  return { channelUuid, messageUuid, row };
}

describe.skipIf(!socket)("voicemail real-component isolated integration", () => {
  beforeAll(async () => {
    if (!socket || !path.isAbsolute(socket) || !path.basename(path.dirname(socket)).startsWith("phone11-vm-integration-pg-"))
      throw new Error("Use the owned disposable PostgreSQL Unix socket fixture");
    root = await mkdtemp("/tmp/phone11-vm-integration-test-");
    storageRoot = path.join(root, "backend"); await mkdir(storageRoot, { mode: 0o700 });
    httpSocket = path.join(root, "http.sock");
    vi.stubEnv("VOICEMAIL_PATH", storageRoot); vi.stubEnv("FS_SHARED_SECRET", secret);
    state.pool = pool();
    await state.pool.query(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.users(id integer PRIMARY KEY);
      CREATE TABLE ${schema}.tenants(id integer PRIMARY KEY,status text NOT NULL);
      CREATE TABLE ${schema}.extensions(id integer PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),
        user_id integer REFERENCES users(id),extension_number text NOT NULL,type text NOT NULL DEFAULT 'user',
        status text NOT NULL,deleted_at timestamptz,voicemail_enabled boolean NOT NULL DEFAULT false);
      CREATE TABLE ${schema}.user_extensions(user_id integer NOT NULL,extension_id integer NOT NULL REFERENCES extensions(id));
      CREATE TABLE ${schema}.tenant_memberships(user_id integer NOT NULL,tenant_id integer NOT NULL REFERENCES tenants(id),status text NOT NULL)`);
    await state.pool.query(await readFile(new URL("../server/pbx/voicemail-storage-migration.sql", import.meta.url), "utf8"));
    ({ storageRouter } = await import("../server/pbx/recording-storage"));
    await startRoutes();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await state.pool!.query(`TRUNCATE voicemail_messages,voicemail_deposit_admissions,user_extensions,tenant_memberships,extensions,tenants,users CASCADE;
      INSERT INTO users VALUES(17),(18); INSERT INTO tenants VALUES(12,'active'),(13,'active');
      INSERT INTO extensions(id,tenant_id,user_id,extension_number,status,voicemail_enabled) VALUES(42,12,17,'3001','active',true),(43,13,18,'3001','active',true);
      INSERT INTO user_extensions VALUES(17,42),(18,43); INSERT INTO tenant_memberships VALUES(17,12,'active'),(18,13,'active')`);
    const fixtureRoot = await mkdtemp(path.join(root, "deposit-"));
    const sourceRoot = path.join(fixtureRoot, "source"), mailbox = path.join(sourceRoot, "12", "3001");
    const foreignMailbox = path.join(sourceRoot, "13", "3001");
    await mkdir(mailbox, { recursive: true, mode: 0o700 }); await mkdir(foreignMailbox, { recursive: true, mode: 0o700 });
    wav = path.join(mailbox, "final.wav"); otherWav = path.join(foreignMailbox, "final.wav");
    await writeFile(wav, audio, { mode: 0o600 }); await writeFile(otherWav, audio, { mode: 0o600 });
    config = { sourceRoot, outboxRoot: path.join(fixtureRoot, "outbox"), uploadUrl: endpoint("/voicemail"),
      integrationSecret: secret, mailboxRoots: { "12:3001": mailbox, "13:3001": foreignMailbox } };
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (state.pool) { await state.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await state.pool.end(); }
    if (root) await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("replays durable admission and delivery across recreated clients/backend routes, then streams an authorized seek", async () => {
    const channelUuid = randomUUID(), messageUuid = randomUUID();
    const lostAdmission = (async (url: string, init: RequestInit) => { expect((await call(url, init)).status).toBe(201); throw new Error("Synthetic lost admission response"); }) as typeof fetch;
    await expect(admitVoicemail({ ...config }, { channelUuid, tenantId: 12, extension: "3001" }, lostAdmission, () => messageUuid)).rejects.toThrow("lost admission");
    expect((await state.pool!.query("SELECT count(*)::int AS count FROM voicemail_deposit_admissions WHERE message_uuid=$1", [messageUuid])).rows[0].count).toBe(1);
    expect(await admitVoicemail({ ...config }, { channelUuid, tenantId: 12, extension: "3001" }, transport(), () => { throw new Error("UUID must survive restart"); })).toBe(messageUuid);
    expect(await relayOnce({ ...config }, transport())).toEqual({ delivered: 0, quarantined: 0, retry: 0 });
    await completeVoicemail({ ...config }, { channelUuid, voicemailFilePath: wav, durationSeconds: 1 });
    const manifest = path.join(config.outboxRoot, `${messageUuid}.json`);
    expect((await stat(manifest)).mode & 0o777).toBe(0o600);
    const lostDelivery = (async (url: string, init: RequestInit) => { expect((await call(url, init)).status).toBe(201); throw new Error("Synthetic response lost after backend commit"); }) as typeof fetch;
    expect(await relayOnce({ ...config }, lostDelivery)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    await stat(manifest);
    const first = (await state.pool!.query("SELECT * FROM voicemail_messages WHERE message_uuid=$1", [messageUuid])).rows[0];
    expect(await readFile(first.storage_path)).toEqual(audio); expect((await stat(first.storage_path)).mode & 0o777).toBe(0o600);
    await state.pool!.end(); state.pool = pool();
    await new Promise<void>(resolve => server.close(() => resolve())); await startRoutes();
    expect(await relayOnce({ ...config }, transport())).toEqual({ delivered: 1, quarantined: 0, retry: 0 });
    await expect(stat(manifest)).rejects.toMatchObject({ code: "ENOENT" }); expect(await readFile(wav)).toEqual(audio);
    const rows = (await state.pool.query("SELECT * FROM voicemail_messages WHERE message_uuid=$1", [messageUuid])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].id).toBe(first.id); expect(rows[0].created_at).toEqual(first.created_at);
    const playback = await call(endpoint(`/voicemail/${first.id}`), { headers: { Range: "bytes=44-51" } }, 17);
    expect(playback.status).toBe(206); expect(playback.headers.get("content-range")).toBe(`bytes 44-51/${audio.length}`);
    expect(playback.headers.get("cache-control")).toBe("private, no-store"); expect(Buffer.from(await playback.arrayBuffer())).toEqual(audio.subarray(44, 52));
    expect((await call(endpoint(`/voicemail/${first.id}`), {}, 18)).status).toBe(404);
    expect((await call(endpoint(`/voicemail/${first.id}`))).status).toBe(401);
    await state.pool.query("UPDATE tenant_memberships SET status='suspended' WHERE user_id=17");
    expect((await call(endpoint(`/voicemail/${first.id}`), {}, 17)).status).toBe(404);
  });

  it("refuses cross-tenant UUID replay and wrong-mailbox publication before storing any media", async () => {
    const channelUuid = randomUUID(), messageUuid = await admitVoicemail({ ...config }, { channelUuid, tenantId: 12, extension: "3001" }, transport());
    const foreign = await call(endpoint(`/voicemail/admission/idempotent?tenant_id=13&extension=3001&message_uuid=${messageUuid}`), { method: "POST", headers: { "x-fs-secret": secret } });
    expect(foreign.status).toBe(409);
    expect((await call(endpoint(`/voicemail?tenant_id=13&extension=3001&message_uuid=${messageUuid}`), { method: "POST", headers: { "x-fs-secret": secret, "content-type": "audio/wav" }, body: audio })).status).toBe(409);
    await expect(state.pool!.query(`INSERT INTO voicemail_messages
      (tenant_id,extension_id,owner_user_id,owner_epoch,message_uuid,storage_path,storage_size_bytes)
      SELECT 13,id,user_id,voicemail_owner_epoch,$1,'/synthetic/no-media.wav',108 FROM extensions WHERE id=42`, [messageUuid]))
      .rejects.toThrow("Voicemail extension is not active in this tenant");
    await expect(completeVoicemail({ ...config }, { channelUuid, voicemailFilePath: otherWav })).rejects.toThrow("outside the admitted mailbox");
    await stat(path.join(config.outboxRoot, "pending", `${channelUuid}.json`));
    await expect(stat(path.join(config.outboxRoot, `${messageUuid}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await state.pool!.query("SELECT count(*)::int AS count FROM voicemail_messages")).rows[0].count).toBe(0);
    await expect(stat(path.join(storageRoot, "13"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("streams the checked descriptor without reopening a pathname replaced after custody checks", async () => {
    const { row } = await deposit(); const originalOpen = fs.promises.open.bind(fs.promises);
    const saved = row.storage_path + ".original"; let streams = 0;
    let playbackHandle: Awaited<ReturnType<typeof fs.promises.open>> | undefined;
    const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (args[0] === row.storage_path) {
        playbackHandle = handle;
        const create = handle.createReadStream.bind(handle);
        handle.createReadStream = options => {
          expect(options?.autoClose).toBe(false); streams++;
          fs.renameSync(row.storage_path, saved); fs.writeFileSync(row.storage_path, Buffer.alloc(audio.length, 77), { mode: 0o600 });
          return create(options);
        };
      }
      return handle;
    });
    try {
      const response = await call(endpoint(`/voicemail/${row.id}`), { headers: { Range: "bytes=44-51" } }, 17);
      expect(response.status).toBe(206); expect(Buffer.from(await response.arrayBuffer())).toEqual(audio.subarray(44, 52));
      expect(streams).toBe(1);
      // Node's stream adapter can reenter FileHandle.close(). Assert released
      // custody instead of equating wrapper calls with native descriptor closes.
      await vi.waitFor(() => expect(playbackHandle?.fd).toBe(-1));
      await expect(playbackHandle!.readFile()).rejects.toMatchObject({ code: "EBADF" });
    } finally { spy.mockRestore(); fs.unlinkSync(row.storage_path); fs.renameSync(saved, row.storage_path); }
  });

  it("refuses a foreign symlink introduced between path inspection and descriptor open", async () => {
    const { row } = await deposit(); const originalRealpath = fs.promises.realpath.bind(fs.promises);
    const saved = row.storage_path + ".original"; let replaced = false;
    const spy = vi.spyOn(fs.promises, "realpath").mockImplementation(async (...args) => {
      const resolved = await originalRealpath(...args);
      if (args[0] === row.storage_path && !replaced) {
        replaced = true; fs.renameSync(row.storage_path, saved); fs.symlinkSync(otherWav, row.storage_path);
      }
      return resolved;
    });
    try { expect((await call(endpoint(`/voicemail/${row.id}`), {}, 17)).status).toBe(404); expect(replaced).toBe(true); }
    finally { spy.mockRestore(); fs.unlinkSync(row.storage_path); fs.renameSync(saved, row.storage_path); }
  });
});
