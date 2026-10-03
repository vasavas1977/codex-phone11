import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import * as fs from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { relayOnce } from "../scripts/phone11-voicemail-relay";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: mocks.auth } }));
vi.mock("../server/pbx/db", () => ({
  query: mocks.query,
  withTransaction: (fn: (client: { query: typeof mocks.query }) => Promise<unknown>) => fn({ query: mocks.query }),
}));

const epoch = "10000000-0000-4000-8000-000000000001";
const messageUuid = "22222222-2222-4222-8222-222222222222";
const audio = Buffer.from("RIFF\x04\x00\x00\x00WAVEfixture audio");
const secret = "test-voicemail-durability-secret-0123456789";
type SyncTarget = "file" | "month" | "tenant" | "base";
let server: Server;
let endpoint: string;
let root: string;
let mediaRoot: string;
let indexed: Record<string, unknown> | undefined;
let events: string[];

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "phone11-vm-durability-"));
  mediaRoot = await realpath(root);
  vi.stubEnv("VOICEMAIL_PATH", mediaRoot);
  vi.stubEnv("FS_SHARED_SECRET", secret);
  const { storageRouter } = await import("../server/pbx/recording-storage");
  const app = express();
  app.use("/api/recordings", storageRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/recordings/voicemail`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await rm(path.join(mediaRoot, "12"), { recursive: true, force: true });
  indexed = undefined;
  events = [];
  mocks.query.mockReset();
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM extensions e"))
      return { rows: [{ id: 42, user_id: 17, voicemail_owner_epoch: epoch }] };
    if (sql.includes("FROM voicemail_deposit_admissions"))
      return { rows: [{ extension_id: 42, owner_user_id: 17, owner_epoch: epoch }] };
    if (sql.includes("INSERT INTO voicemail_messages")) {
      events.push("insert");
      indexed = { id: 5, extension_id: 42, owner_user_id: 17, owner_epoch: epoch,
        storage_path: values[8], storage_size_bytes: values[9] };
      return { rows: [indexed] };
    }
    if (sql.includes("FROM voicemail_messages")) return { rows: indexed ? [indexed] : [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
});

afterEach(() => vi.restoreAllMocks());

function storedPath() {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return path.join(mediaRoot, "12", month, `${messageUuid}.wav`);
}

function observeSyncs(failure?: SyncTarget, failOnAttempt = 1) {
  const originalOpen = fs.promises.open.bind(fs.promises);
  let attempts = 0;
  return vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    const opened = String(args[0]);
    const target: SyncTarget = opened.endsWith(".wav") ? "file"
      : opened === mediaRoot ? "base"
        : opened === path.join(mediaRoot, "12") ? "tenant" : "month";
    const originalSync = handle.sync.bind(handle);
    handle.sync = async () => {
      events.push(target);
      if (target === failure && ++attempts === failOnAttempt)
        throw Object.assign(new Error("fixture sync failure"), { code: "EIO" });
      return originalSync();
    };
    return handle;
  });
}

const upload = () => fetch(`${endpoint}?tenant_id=12&extension=3001&message_uuid=${messageUuid}`, {
  method: "POST", headers: { "content-type": "audio/wav", "x-fs-secret": secret }, body: new Uint8Array(audio),
});

async function seedExisting(index = false, priorMonth = false) {
  const file = priorMonth ? path.join(mediaRoot, "12", "2001-01", `${messageUuid}.wav`) : storedPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, audio, { mode: 0o600 });
  if (index) indexed = { id: 5, extension_id: 42, owner_user_id: 17, owner_epoch: epoch,
    storage_path: file, storage_size_bytes: audio.length };
  return file;
}

async function concurrentWinner() {
  const file = await seedExisting(true, true);
  const winner = indexed;
  indexed = undefined;
  const originalQuery = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO voicemail_messages")) {
      events.push("insert-race");
      indexed = winner;
      return { rows: [] };
    }
    return originalQuery(sql, values);
  });
  return file;
}

describe("voicemail durable delivery receipts", () => {
  it("fails closed instead of implicitly creating a missing configured media root", async () => {
    await rm(mediaRoot, { recursive: true, force: true });
    try {
      expect((await upload()).status).toBe(503);
      expect(indexed).toBeUndefined();
      await expect(realpath(mediaRoot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
    }
  });

  it("syncs the WAV and all new directory links before inserting the inbox row", async () => {
    observeSyncs();
    const response = await upload();
    expect(response.status).toBe(201);
    expect(events).toEqual(["file", "month", "tenant", "base", "insert"]);
    expect(await readFile(storedPath())).toEqual(audio);
  });

  it.each<SyncTarget>(["file", "month", "tenant", "base"])("retains new audio and refuses insert/receipt when %s sync fails", async failure => {
    observeSyncs(failure);
    const response = await upload();
    expect(response.status).toBe(503);
    expect(indexed).toBeUndefined();
    expect(events).not.toContain("insert");
    expect(await readFile(storedPath())).toEqual(audio);
  });

  it("makes an unindexed existing WAV durable before a recovered insert", async () => {
    const file = await seedExisting();
    observeSyncs();
    expect((await upload()).status).toBe(201);
    expect(events).toEqual(["file", "month", "tenant", "base", "insert"]);
    expect(await readFile(file)).toEqual(audio);
  });

  it.each<SyncTarget>(["file", "month", "tenant", "base"])("preserves unindexed replay evidence when %s sync fails", async failure => {
    const file = await seedExisting();
    observeSyncs(failure);
    expect((await upload()).status).toBe(503);
    expect(indexed).toBeUndefined();
    expect(events).not.toContain("insert");
    expect(await readFile(file)).toEqual(audio);
  });

  it("syncs an already indexed previous-month WAV before an idempotent receipt", async () => {
    const file = await seedExisting(true, true);
    observeSyncs();
    const response = await upload();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(events).toEqual(["file", "month", "tenant", "base"]);
    expect(await readFile(file)).toEqual(audio);
  });

  it.each<SyncTarget>(["file", "month", "tenant", "base"])("refuses an indexed replay receipt when %s sync fails", async failure => {
    const file = await seedExisting(true, true);
    observeSyncs(failure);
    expect((await upload()).status).toBe(503);
    expect(indexed?.storage_path).toBe(file);
    expect(events).not.toContain("insert");
    expect(await readFile(file)).toEqual(audio);
  });

  it("makes the concurrent insert winner durable before acknowledging and cleaning up the duplicate", async () => {
    const winner = await concurrentWinner();
    observeSyncs();
    const response = await upload();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(events).toEqual(["file", "month", "tenant", "base", "insert-race", "file", "month", "tenant", "base"]);
    expect(await readFile(winner)).toEqual(audio);
    await expect(readFile(storedPath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each<SyncTarget>(["file", "month", "tenant", "base"])("preserves both race objects if the winning object's %s sync fails", async failure => {
    const winner = await concurrentWinner();
    observeSyncs(failure, 2);
    expect((await upload()).status).toBe(503);
    expect(indexed?.storage_path).toBe(winner);
    expect(await readFile(winner)).toEqual(audio);
    expect(await readFile(storedPath())).toEqual(audio);
  });

  it("keeps the relay manifest and original source after sync failure, then delivers the retry once", async () => {
    const sourceRoot = path.join(mediaRoot, "source");
    const outboxRoot = path.join(mediaRoot, "outbox");
    await mkdir(sourceRoot, { mode: 0o700 });
    await mkdir(outboxRoot, { mode: 0o700 });
    const wav = path.join(sourceRoot, "completed.wav");
    const manifest = path.join(outboxRoot, `${messageUuid}.json`);
    await writeFile(wav, audio, { mode: 0o600 });
    await writeFile(manifest, JSON.stringify({ message_uuid: messageUuid, tenant_id: 12,
      extension: "3001", relative_wav_path: "completed.wav" }), { mode: 0o600 });
    const config = { sourceRoot, outboxRoot, uploadUrl: "https://fixture.example/api/recordings/voicemail", integrationSecret: secret };
    const send = ((url: string, init: RequestInit) => fetch(endpoint + new URL(url).search, init)) as typeof fetch;
    const syncing = observeSyncs("file");
    expect(await relayOnce(config, send)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(indexed).toBeUndefined();
    expect(await readFile(manifest, "utf8")).toContain(messageUuid);
    expect(await readFile(wav)).toEqual(audio);

    syncing.mockRestore();
    events = [];
    observeSyncs();
    expect(await relayOnce(config, send)).toEqual({ delivered: 1, quarantined: 0, retry: 0 });
    expect(events).toEqual(["file", "month", "tenant", "base", "insert"]);
    await expect(readFile(manifest)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(wav)).toEqual(audio);
  });
});
