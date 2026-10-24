import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ query: vi.fn(), ingest: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: f.query, withTransaction: vi.fn() }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("../server/cloud-recordings/ingestion", () => ({ ingestStoredRecording: f.ingest }));
const secret = "owned-recording-upload-secret-0123456789";
const call = "5f5f0000-0000-4000-8000-000000000001";
const token = "5f5f1000-0000-4000-8000-000000000001";
const bytes = Buffer.from("owned synthetic upload bytes");
let directory: string, server: Server, url: string;

beforeAll(async () => {
  directory = await realpath(await mkdtemp("/tmp/p11-upload-owner-http-"));
  vi.stubEnv("RECORDINGS_PATH", directory);
  const { storageRouter } = await import("../server/pbx/recording-storage");
  const app = express(); app.use("/recordings", storageRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/recordings/upload`;
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("FS_SHARED_SECRET", secret);
  vi.stubEnv("PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED", "true");
  f.ingest.mockResolvedValue(true);
  f.query.mockRejectedValue(new Error("UNEXPECTED_TEST_SQL"));
  await rm(directory, { recursive: true, force: true }); await mkdir(directory, { mode: 0o700 });
});
afterAll(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs();
});
function post(options: { secret?: string | null; tenant?: string; captureToken?: string; body?: Buffer } = {}) {
  return fetch(`${url}?${new URLSearchParams({ call_uuid: call, tenant_id: options.tenant ?? "1", capture_token: options.captureToken ?? token })}`, {
    method: "POST", headers: { "content-type": "audio/wav", ...(options.secret === null ? {} : { "x-fs-secret": options.secret ?? secret }) },
    body: options.body ?? bytes, redirect: "error", signal: AbortSignal.timeout(5000),
  });
}

it.each([null, "incorrect"])("rejects an invalid integration secret before SQL/file work (%s)", async supplied => {
  expect((await post({ secret: supplied })).status).toBe(403);
  expect(f.query).not.toHaveBeenCalled(); expect(f.ingest).not.toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});
it("fails closed before storage when the current authorization query fails", async () => {
  f.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockRejectedValueOnce(new Error("PRIVATE_SQL_FAILURE"));
  const response = await post(); expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_SQL_FAILURE");
  expect(f.ingest).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual([]);
});

// Actual maintained handler and authorization SQL in an owned, socket-only native
// cluster. Ingestion is an explicit route-boundary stub; operational candidate
// local.py separately exercises actual registerCall/recordingStored functions.
describe.skipIf(process.env.PHONE11_UPLOAD_OWNER_NATIVE_PG !== "1")("upload owner authorization against PostgreSQL", () => {
  const bin = process.env.PHONE11_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
  let root: string | undefined, database: Pool | undefined, started = false;
  function run(command: string, args: string[]) {
    const result = spawnSync(join(bin, command), args, { encoding: "utf8", timeout: 30000 });
    if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr}`);
  }
  beforeAll(async () => {
    root = await mkdtemp("/tmp/p11-upload-owner-pg-"); await chmod(root, 0o700);
    const socket = join(root, "socket"); await mkdir(socket, { mode: 0o700 });
    run("initdb", ["-D", join(root, "data"), "-U", "phone11_test", "--auth-local=trust", "--auth-host=reject", "--no-locale", "-E", "UTF8"]);
    run("pg_ctl", ["-D", join(root, "data"), "-l", join(root, "postgres.log"), "-o", `-h '' -k '${socket}'`, "-w", "start"]);
    started = true;
    database = new Pool({ host: socket, user: "phone11_test", database: "postgres", password: "", ssl: false });
    await database.query(`CREATE TABLE tenants(id int PRIMARY KEY,status text);
      CREATE TABLE extensions(id int PRIMARY KEY,tenant_id int,status text,deleted_at timestamptz);
      CREATE TABLE call_records(id int PRIMARY KEY,call_uuid text UNIQUE,tenant_id int,direction text,recording_url text);
      CREATE TABLE call_legs(id int PRIMARY KEY,call_record_id int,tenant_id int,extension_id int);
      CREATE TABLE phone11_recording_policies(tenant_id int PRIMARY KEY,mode text);
      CREATE TABLE phone11_cloud_recordings(call_uuid text PRIMARY KEY,tenant_id int,extension_id int,
        storage_key text,recording_status text,expires_at timestamptz,capture_token uuid)`);
  }, 30000);
  beforeEach(async () => {
    await database!.query(`DELETE FROM phone11_cloud_recordings;DELETE FROM phone11_recording_policies;
      DELETE FROM call_legs;DELETE FROM call_records;DELETE FROM extensions;DELETE FROM tenants;
      INSERT INTO tenants VALUES(1,'active'),(2,'active');
      INSERT INTO extensions VALUES(1,1,'active',NULL),(2,1,'active',NULL),(3,2,'active',NULL);
      INSERT INTO call_records VALUES(1,'${call}',1,'inbound',NULL);
      INSERT INTO call_legs VALUES(1,1,1,1);
      INSERT INTO phone11_recording_policies VALUES(1,'automatic');
      INSERT INTO phone11_cloud_recordings VALUES('${call}',1,1,NULL,'recording',now()+interval '1 day','${token}')`);
    f.query.mockImplementation((sql, params) => database!.query(sql, params));
  });
  afterAll(async () => {
    try { await database?.end(); }
    finally { if (root) {
      if (started || existsSync(join(root, "data", "postmaster.pid"))) run("pg_ctl", ["-D", join(root, "data"), "-m", "fast", "-w", "stop"]);
      await rm(root, { recursive: true, force: true });
    } }
  });
  async function noStorage() {
    expect((await post()).status).toBe(409);
    expect((await database!.query("SELECT recording_url FROM call_records")).rows[0].recording_url).toBeNull();
    expect(await readdir(directory)).toEqual([]); expect(f.ingest).not.toHaveBeenCalled();
  }
  it.each([
    ["disabled extension", "UPDATE extensions SET status='inactive'WHERE id=1"],
    ["deleted extension", "UPDATE extensions SET deleted_at=now()WHERE id=1"],
    ["inactive tenant", "UPDATE tenants SET status='inactive'WHERE id=1"],
    ["ambiguous assigned owners", "INSERT INTO call_legs VALUES(2,1,1,2)"],
    ["cloud owner mismatch", "UPDATE phone11_cloud_recordings SET extension_id=2"],
    ["missing assigned leg", "DELETE FROM call_legs"],
    ["cross-tenant leg", "UPDATE call_legs SET tenant_id=2,extension_id=3"],
    ["unsupported direction", "UPDATE call_records SET direction='internal'"],
    ["disabled policy", "UPDATE phone11_recording_policies SET mode='off'"],
    ["expired capture", "UPDATE phone11_cloud_recordings SET expires_at=now()-interval '1 second'"],
  ])("rejects %s before file or CDR URL writes", async (_, sql) => { await database!.query(sql); await noStorage(); });
  it.each([
    ["unique active owner", "SELECT 1"],
    ["duplicate legs for the same owner", "INSERT INTO call_legs VALUES(2,1,1,1)"],
    ["inactive other owner", "UPDATE extensions SET status='inactive'WHERE id=2;INSERT INTO call_legs VALUES(2,1,1,2)"],
  ])("preserves upload, replay and mismatched-byte behavior for %s", async (_, sql) => {
    await database!.query(sql); const response = await post(); expect(response.status).toBe(200);
    const stored = (await database!.query("SELECT recording_url FROM call_records")).rows[0].recording_url;
    expect(await readFile(stored)).toEqual(bytes); const inode = (await stat(stored)).ino;
    expect((await post()).status).toBe(200); expect((await stat(stored)).ino).toBe(inode);
    expect((await post({ body: Buffer.alloc(bytes.length, 1) })).status).toBe(503);
    expect(await readFile(stored)).toEqual(bytes);
  });
  it("preserves tenant and token denials before storage", async () => {
    expect((await post({ tenant: "2" })).status).toBe(404);
    expect((await post({ captureToken: "5f5f1000-0000-4000-8000-000000000002" })).status).toBe(409);
    expect(await readdir(directory)).toEqual([]); expect(f.ingest).not.toHaveBeenCalled();
  });
  it("preserves the capture-disabled legacy branch without applying the capture owner gate", async () => {
    vi.stubEnv("PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED", "false");
    await database!.query("UPDATE extensions SET status='inactive'WHERE id=1");
    expect((await post({ captureToken: "" })).status).toBe(200);
    expect(f.query.mock.calls.some(([sql]) => sql.includes("COUNT(DISTINCT cl.extension_id)"))).toBe(false);
    const stored = (await database!.query("SELECT recording_url FROM call_records")).rows[0].recording_url;
    expect(await readFile(stored)).toEqual(bytes);
  });
  it("applies the same current owner check to ready replays", async () => {
    expect((await post()).status).toBe(200);
    const stored = (await database!.query("SELECT recording_url FROM call_records")).rows[0].recording_url;
    await database!.query("UPDATE phone11_cloud_recordings SET recording_status='ready',storage_key=$1", [stored]);
    await database!.query("UPDATE extensions SET status='inactive'WHERE id=1"); f.ingest.mockClear();
    expect((await post()).status).toBe(409); expect(await readFile(stored)).toEqual(bytes);
    expect(f.ingest).not.toHaveBeenCalled();
  });
  it("documents the boundary when revocation commits after the authorization snapshot", async () => {
    let revoked = false;
    f.query.mockImplementation(async (sql, params) => {
      const result = await database!.query(sql, params);
      if (!revoked && sql.includes("COUNT(DISTINCT cl.extension_id)=1")) {
        revoked = true; await database!.query("UPDATE extensions SET status='inactive'WHERE id=1");
      }
      return result;
    });
    f.ingest.mockResolvedValue(false); // Actual repository late-revocation proof lives in the operational candidate.
    const response = await post(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, analysisQueued: false });
    expect(revoked).toBe(true);
    const stored = (await database!.query("SELECT recording_url FROM call_records")).rows[0].recording_url;
    expect(await readFile(stored)).toEqual(bytes);
  });
});
