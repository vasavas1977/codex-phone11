import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
const epoch = "10000000-0000-4000-8000-000000000001";
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: mocks.auth } }));
vi.mock("../server/pbx/db", () => ({
  query: mocks.query,
  withTransaction: (fn: (client: { query: typeof mocks.query }) => Promise<unknown>) => fn({ query: mocks.query }),
}));

describe("voicemail storage migration contract", () => {
  it("rejects inactive extensions at the database boundary", async () => {
    const migration = await readFile(
      new URL("../server/pbx/voicemail-storage-migration.sql", import.meta.url),
      "utf8",
    );
    const guard = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION phone11_voicemail_extension_tenant_guard"),
      migration.indexOf("DROP TRIGGER IF EXISTS phone11_voicemail_extension_tenant_guard"),
    );
    expect(guard).toContain("e.status = 'active'");
  });
});

let server: Server;
let base: string;
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "phone11-voicemail-test-"));
  vi.stubEnv("VOICEMAIL_PATH", directory);
  const { storageRouter } = await import("../server/pbx/recording-storage");
  const app = express();
  app.use("/recordings", storageRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FS_SHARED_SECRET = "test-voicemail-integration-secret-0123456789";
  mocks.auth.mockResolvedValue({ id: 17 });
});

describe("voicemail storage", () => {
  it("issues a durable pre-record admission for an active personal mailbox", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 42, user_id: 17, voicemail_owner_epoch: epoch }] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await fetch(`${base}/recordings/voicemail/admission?tenant_id=12&extension=3001`, {
      method: "POST",
      headers: { "x-fs-secret": process.env.FS_SHARED_SECRET! },
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.message_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.query.mock.calls[0][0]).toContain("FOR SHARE OF e");
    expect(mocks.query.mock.calls[1][1]).toEqual([body.message_uuid, 12, 42, 17, epoch]);
  });

  it("requires a configured integration secret before mailbox or filesystem work", async () => {
    const response = await fetch(`${base}/recordings/voicemail?tenant_id=12&extension=3001&message_uuid=vm-1`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: "audio",
    });
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("stores a voicemail only for an active voicemail mailbox and persists tenant-scoped metadata", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 42, user_id: 17, voicemail_owner_epoch: epoch }] })
      .mockResolvedValueOnce({ rows: [{ extension_id: 42, owner_user_id: 17, owner_epoch: epoch }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce(async (sql: string, values: unknown[]) => {
        expect(sql).toContain("INSERT INTO voicemail_messages");
        expect(values.slice(0, 8)).toEqual([12, 42, 17, epoch, "vm-200", "+6620303001", "Caller", 19]);
        expect(String(values[8])).toContain(`${path.sep}12${path.sep}`);
        return { rows: [{ id: 5, owner_user_id: 17, owner_epoch: epoch, storage_path: values[8], storage_size_bytes: values[9] }] };
      });
    const response = await fetch(`${base}/recordings/voicemail?tenant_id=12&extension=3001&message_uuid=vm-200&caller_number=%2B6620303001&caller_name=Caller&duration_seconds=19`, {
      method: "POST",
      headers: {
        "content-type": "audio/wav",
        "x-fs-secret": process.env.FS_SHARED_SECRET!,
      },
      body: "voice-bytes",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, id: 5, size: 11, duplicate: false });
    expect(mocks.query.mock.calls[0]).toEqual([
      expect.stringContaining("e.voicemail_enabled = true"),
      [12, "3001"],
    ]);
    expect(mocks.query.mock.calls[0][0]).toContain("JOIN user_extensions ue");
    expect(mocks.query.mock.calls[0][0]).toContain("tm.status = 'active'");
    const insert = mocks.query.mock.calls[3];
    expect(await readFile(insert[1][8], "utf8")).toBe("voice-bytes");
  });

  it("is idempotent only when a repeat upload has identical audio and storage identity", async () => {
    let storedPath = "";
    let storedSize = 0;
    let duplicate = false;
    mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM extensions e")) return { rows: [{ id: 42, user_id: 17, voicemail_owner_epoch: epoch }] };
      if (sql.includes("FROM voicemail_deposit_admissions")) return { rows: [{ extension_id: 42, owner_user_id: 17, owner_epoch: epoch }] };
      if (sql.includes("SELECT id, extension_id, owner_user_id, owner_epoch, storage_path, storage_size_bytes"))
        return { rows: duplicate ? [{ id: 8, extension_id: 42, owner_user_id: 17, owner_epoch: epoch, storage_path: storedPath, storage_size_bytes: storedSize }] : [] };
      if (sql.includes("INSERT INTO voicemail_messages")) {
        storedPath = String(values[8]);
        storedSize = Number(values[9]);
        return { rows: [{ id: 8, extension_id: 42, owner_user_id: 17, owner_epoch: epoch, storage_path: storedPath, storage_size_bytes: storedSize }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const request = () => fetch(`${base}/recordings/voicemail?tenant_id=12&extension=3001&message_uuid=vm-201`, {
      method: "POST",
      headers: { "content-type": "audio/wav", "x-fs-secret": process.env.FS_SHARED_SECRET! },
      body: "same-voice",
    });
    expect((await request()).status).toBe(201);
    duplicate = true;
    const repeated = await request();
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ ok: true, id: 8, duplicate: true });
  });

  it("reuses a verified existing object when an idempotent retry crosses a UTC month boundary", async () => {
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const priorMonth = currentMonth === "2001-01" ? "2001-02" : "2001-01";
    const existingPath = path.join(directory, "12", priorMonth, "vm-month-boundary.wav");
    await mkdir(path.dirname(existingPath), { recursive: true });
    await writeFile(existingPath, "same-voice");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM extensions e")) return { rows: [{ id: 42, user_id: 17, voicemail_owner_epoch: epoch }] };
      if (sql.includes("FROM voicemail_deposit_admissions")) return { rows: [{ extension_id: 42, owner_user_id: 17, owner_epoch: epoch }] };
      if (sql.includes("FROM voicemail_messages")) {
        return { rows: [{ id: 18, extension_id: 42, owner_user_id: 17, owner_epoch: epoch, storage_path: existingPath, storage_size_bytes: 10 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await fetch(`${base}/recordings/voicemail?tenant_id=12&extension=3001&message_uuid=vm-month-boundary`, {
      method: "POST",
      headers: { "content-type": "audio/wav", "x-fs-secret": process.env.FS_SHARED_SECRET! },
      body: "same-voice",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, id: 18, size: 10, duplicate: true });
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO voicemail_messages"), expect.anything());
    expect(await readFile(existingPath, "utf8")).toBe("same-voice");
    const currentPath = path.join(directory, "12", currentMonth, "vm-month-boundary.wav");
    await expect(access(currentPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a replay that points the same message UUID at another mailbox", async () => {
    const existingPath = path.join(directory, "12", "2026-09", "vm-other-mailbox.wav");
    await mkdir(path.dirname(existingPath), { recursive: true });
    await writeFile(existingPath, "same-voice");
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 42, user_id: 17, voicemail_owner_epoch: epoch }] })
      .mockResolvedValueOnce({ rows: [{ extension_id: 42, owner_user_id: 17, owner_epoch: epoch }] })
      .mockResolvedValueOnce({ rows: [{ id: 19, extension_id: 43, owner_user_id: 18, owner_epoch: epoch, storage_path: existingPath, storage_size_bytes: 10 }] });

    const response = await fetch(`${base}/recordings/voicemail?tenant_id=12&extension=3001&message_uuid=vm-other-mailbox`, {
      method: "POST",
      headers: { "content-type": "audio/wav", "x-fs-secret": process.env.FS_SHARED_SECRET! },
      body: "same-voice",
    });

    expect(response.status).toBe(503);
    expect(await readFile(existingPath, "utf8")).toBe("same-voice");
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it("quarantines a delayed upload after mailbox reassignment before writing media", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 42, user_id: 18, voicemail_owner_epoch: "20000000-0000-4000-8000-000000000002" }] })
      .mockResolvedValueOnce({ rows: [{ extension_id: 42, owner_user_id: 17, owner_epoch: epoch }] });
    const response = await fetch(`${base}/recordings/voicemail?tenant_id=12&extension=3001&message_uuid=vm-stale`, {
      method: "POST",
      headers: { "content-type": "audio/wav", "x-fs-secret": process.env.FS_SHARED_SECRET! },
      body: "old-message",
    });
    expect(response.status).toBe(409);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("keeps a written object after an uncertain database failure so a concurrent winner is not erased", async () => {
    let file = "";
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 42, user_id: 17, voicemail_owner_epoch: epoch }] })
      .mockResolvedValueOnce({ rows: [{ extension_id: 42, owner_user_id: 17, owner_epoch: epoch }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce(async (_sql: string, values: unknown[]) => {
        file = String(values[8]);
        throw new Error("uncertain commit");
      });

    const response = await fetch(`${base}/recordings/voicemail?tenant_id=12&extension=3001&message_uuid=vm-uncertain`, {
      method: "POST",
      headers: { "content-type": "audio/wav", "x-fs-secret": process.env.FS_SHARED_SECRET! },
      body: "same-voice",
    });

    expect(response.status).toBe(503);
    expect(await readFile(file, "utf8")).toBe("same-voice");
  });

  it("authorizes voicemail playback by deposit-time owner before opening a file", async () => {
    const file = path.join(directory, "12", "2026-09", "vm-play.wav");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "private voicemail");
    mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 12, storage_path: file }] });
    const response = await fetch(`${base}/recordings/voicemail/9`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("private voicemail");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("vm.owner_user_id = $1"), [17, 9]);
    expect(mocks.query.mock.calls[0][0]).toContain("JOIN tenant_memberships tm");
    expect(mocks.query.mock.calls[0][0]).toContain("tm.status = 'active'");
  });

  it("rejects unauthenticated voicemail playback before querying media ownership", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("expired"));
    expect((await fetch(`${base}/recordings/voicemail/9`)).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe("voicemail inbox queries", () => {
  it("requires the reviewed schema and scopes list results to the deposit-time owner", async () => {
    const { getVoicemails } = await import("../server/pbx/cdr-processor");
    mocks.query
      .mockResolvedValueOnce({ rows: [{ name: "voicemail_messages", admissions: "voicemail_deposit_admissions",
        owner_columns: "2", guard_trigger: true, epoch_trigger: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, extension_number: "3001", caller_number: "+6620303001" }] });
    const rows = await getVoicemails(12, 17, "3001");
    expect(rows).toEqual([{ id: 7, extension_number: "3001", caller_number: "+6620303001" }]);
    const [sql, values] = mocks.query.mock.calls[1];
    expect(sql).toContain("vm.owner_user_id = $2");
    expect(sql).toContain("JOIN tenant_memberships tm");
    expect(sql).toContain("tm.status = 'active'");
    expect(sql).toContain("vm.status != 'deleted'");
    expect(values).toEqual([12, 17, "3001"]);
  });

  it("returns no voicemail when the active-membership join excludes a deactivated assignee, then accepts the restored membership result", async () => {
    const { findOwnedVoicemail } = await import("../server/pbx/media-access");
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(findOwnedVoicemail(17, 9)).resolves.toBeNull();
    expect(mocks.query.mock.calls[0][0]).toContain("JOIN tenant_memberships tm");
    expect(mocks.query.mock.calls[0][0]).toContain("tm.status = 'active'");

    mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 12, storage_path: "/private/12/restored.wav" }] });
    await expect(findOwnedVoicemail(17, 9)).resolves.toEqual({ tenant_id: 12, storage_path: "/private/12/restored.wav" });
  });

  it("reports an absent inbox schema instead of showing an empty inbox", async () => {
    const { requireVoicemailStorage, VoicemailStorageUnavailableError } = await import("../server/pbx/cdr-processor");
    mocks.query.mockResolvedValueOnce({ rows: [{ name: null }] });
    await expect(requireVoicemailStorage()).rejects.toBeInstanceOf(VoicemailStorageUnavailableError);
  });

  it("quarantines a legacy schema without a non-null deposit-time owner", async () => {
    const { requireVoicemailStorage, VoicemailStorageUnavailableError } = await import("../server/pbx/cdr-processor");
    mocks.query.mockResolvedValueOnce({ rows: [{ name: "voicemail_messages", admissions: null, owner_columns: "1" }] });
    await expect(requireVoicemailStorage()).rejects.toBeInstanceOf(VoicemailStorageUnavailableError);
  });

  it("fails closed when either ownership trigger is absent or disabled", async () => {
    const { requireVoicemailStorage, VoicemailStorageUnavailableError } = await import("../server/pbx/cdr-processor");
    for (const flags of [{ guard_trigger: false, epoch_trigger: true },
      { guard_trigger: true, epoch_trigger: false }]) {
      mocks.query.mockResolvedValueOnce({ rows: [{ name: "voicemail_messages",
        admissions: "voicemail_deposit_admissions", owner_columns: "2", ...flags }] });
      await expect(requireVoicemailStorage()).rejects.toBeInstanceOf(VoicemailStorageUnavailableError);
    }
  });

  it("reports schema and writable media directory separately", async () => {
    const { voicemailStorageStatus } = await import("../server/pbx/voicemail-access");
    mocks.query.mockResolvedValueOnce({ rows: [{ name: null, admissions: null, owner_columns: "0" }] });
    await expect(voicemailStorageStatus()).resolves.toEqual({ schemaReady: false, mediaDirectoryWritable: true });
    mocks.query.mockResolvedValueOnce({ rows: [{ name: "voicemail_messages", admissions: "voicemail_deposit_admissions",
      owner_columns: "2", guard_trigger: true, epoch_trigger: true }] });
    await expect(voicemailStorageStatus()).resolves.toEqual({ schemaReady: true, mediaDirectoryWritable: true });
  });
});

describe("voicemail playback presentation", () => {
  it("only constructs the expected authenticated HTTPS media path", async () => {
    const { voicemailPlaybackURL } = await import("../lib/cloud-recordings/presentation");
    expect(
      voicemailPlaybackURL(
        "https://api.phone11.ai",
        9,
        "/api/recordings/voicemail/9",
      ),
    ).toBe("https://api.phone11.ai/api/recordings/voicemail/9");
    expect(voicemailPlaybackURL("http://api.phone11.ai", 9, "/api/recordings/voicemail/9")).toBeNull();
    expect(voicemailPlaybackURL("https://api.phone11.ai", 9, "/api/recordings/play/9")).toBeNull();
  });
});
