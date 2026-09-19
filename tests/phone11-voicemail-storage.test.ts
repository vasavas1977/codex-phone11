import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: mocks.auth } }));
vi.mock("../server/pbx/db", () => ({ query: mocks.query }));

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
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce(async (sql: string, values: unknown[]) => {
        expect(sql).toContain("INSERT INTO voicemail_messages");
        expect(values.slice(0, 6)).toEqual([12, 42, "vm-200", "+6620303001", "Caller", 19]);
        expect(String(values[6])).toContain(`${path.sep}12${path.sep}`);
        return { rows: [{ id: 5, storage_path: values[6], storage_size_bytes: values[7] }] };
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
      expect.stringContaining("voicemail_enabled = true"),
      [12, "3001"],
    ]);
    const insert = mocks.query.mock.calls[2];
    expect(await readFile(insert[1][6], "utf8")).toBe("voice-bytes");
  });

  it("is idempotent only when a repeat upload has identical audio and storage identity", async () => {
    let storedPath = "";
    let storedSize = 0;
    let duplicate = false;
    mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM extensions")) return { rows: [{ id: 42 }] };
      if (sql.includes("SELECT id, storage_path, storage_size_bytes"))
        return { rows: duplicate ? [{ id: 8, storage_path: storedPath, storage_size_bytes: storedSize }] : [] };
      if (sql.includes("INSERT INTO voicemail_messages")) {
        storedPath = String(values[6]);
        storedSize = Number(values[7]);
        return { rows: [{ id: 8, storage_path: storedPath, storage_size_bytes: storedSize }] };
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
      if (sql.includes("FROM extensions")) return { rows: [{ id: 42 }] };
      if (sql.includes("FROM voicemail_messages")) {
        return { rows: [{ id: 18, storage_path: existingPath, storage_size_bytes: 10 }] };
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

  it("authorizes voicemail playback by assigned extension before opening a file", async () => {
    const file = path.join(directory, "12", "2026-09", "vm-play.wav");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "private voicemail");
    mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 12, storage_path: file }] });
    const response = await fetch(`${base}/recordings/voicemail/9`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("private voicemail");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("JOIN user_extensions ue"), [17, 9]);
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
  it("requires the reviewed schema and scopes list results to the assigned extension", async () => {
    const { getVoicemails } = await import("../server/pbx/cdr-processor");
    mocks.query
      .mockResolvedValueOnce({ rows: [{ name: "voicemail_messages" }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, extension_number: "3001", caller_number: "+6620303001" }] });
    const rows = await getVoicemails(12, 17, "3001");
    expect(rows).toEqual([{ id: 7, extension_number: "3001", caller_number: "+6620303001" }]);
    const [sql, values] = mocks.query.mock.calls[1];
    expect(sql).toContain("JOIN user_extensions ue");
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
