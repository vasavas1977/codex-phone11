import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: mocks.auth } }));
vi.mock("../server/pbx/db", () => ({ query: mocks.query }));
import { integrationSecretStatus, requireIntegrationSecret } from "../server/pbx/integration-auth";

let server: Server;
let base: string;
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "phone11-media-test-"));
  vi.stubEnv("RECORDINGS_PATH", directory);
  await mkdir(path.join(directory, "12"));
  await writeFile(path.join(directory, "12", "call-1.wav"), "test-audio");
  const { storageRouter } = await import("../server/pbx/recording-storage");
  const app = express();
  app.use("/recordings", storageRouter);
  app.post("/integration", requireIntegrationSecret("FS_SHARED_SECRET", "x-fs-secret"), (_req, res) => { res.json({ ok: true }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: 17 }); mocks.query.mockResolvedValue({ rows: [] }); delete process.env.FS_SHARED_SECRET; });

describe("integration authentication", () => {
  it.each([undefined, "phone11-fs-secret-change-me", "short", "this-is-a-placeholder-credential"])('rejects an unset or placeholder secret (%s)', async configured => {
    if (configured) process.env.FS_SHARED_SECRET = configured;
    expect(integrationSecretStatus("FS_SHARED_SECRET", configured)).toBe("unavailable");
    const response = await fetch(`${base}/integration`, { method: "POST" });
    expect(response.status).toBe(503);
  });
  it("accepts only the exact configured header, not query credentials or header arrays", async () => {
    process.env.FS_SHARED_SECRET = "test-integration-credential-0123456789";
    expect(integrationSecretStatus("FS_SHARED_SECRET", [process.env.FS_SHARED_SECRET])).toBe("forbidden");
    expect((await fetch(`${base}/integration?secret=${process.env.FS_SHARED_SECRET}`, { method: "POST" })).status).toBe(403);
    expect((await fetch(`${base}/integration`, { method: "POST", headers: { "x-fs-secret": process.env.FS_SHARED_SECRET } })).status).toBe(200);
  });
});

describe("recording ownership", () => {
  it("rejects an unauthenticated playback request before any media query", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("expired"));
    expect((await fetch(`${base}/recordings/play/call-1`)).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns no media for an authenticated user without the assigned call extension", async () => {
    expect((await fetch(`${base}/recordings/play/call-1`)).status).toBe(404);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("ue.user_id = $1"), [17, "call-1"]);
    const sql = mocks.query.mock.calls[0][0];
    expect(sql).toContain("cl.tenant_id = cr.tenant_id");
    expect(sql).toContain("e.tenant_id = cr.tenant_id");
    expect(sql).toContain("e.id = cl.extension_id");
  });
  it("reports unavailable when this deployment has no recording tables", async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error("relation absent"), { code: "42P01" }));
    const response = await fetch(`${base}/recordings/play/call-1`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("relation");
  });
  it("serves an explicitly authorized file with private cache policy", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 12, recording_url: path.join(directory, "12", "call-1.wav") }] });
    const response = await fetch(`${base}/recordings/play/call-1`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("test-audio");
  });
  it("refuses a media path outside the authorized tenant directory", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 29, recording_url: path.join(directory, "12", "call-1.wav") }] });
    expect((await fetch(`${base}/recordings/play/call-1`)).status).toBe(404);
  });
  it("does not invent voicemail tables or a default tenant", async () => {
    expect((await fetch(`${base}/recordings/voicemail/5`)).status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("validates upload identifiers before filesystem writes", async () => {
    const { storeRecording } = await import("../server/pbx/recording-storage");
    await expect(storeRecording(12, "../../escape", Buffer.from("test"))).rejects.toThrow("Invalid");
    await expect(storeRecording(0, "call-1", Buffer.from("test"))).rejects.toThrow("Invalid");
  });
});
