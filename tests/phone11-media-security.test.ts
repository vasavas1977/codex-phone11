import * as fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import type { Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { integrationSecretStatus, requireIntegrationSecret } from "../server/pbx/integration-auth";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: mocks.auth } }));
vi.mock("../server/pbx/db", () => ({ query: mocks.query }));

let server: Server;
let base: string;
let directory: string;
beforeAll(async () => {
  directory = await fs.promises.realpath(await mkdtemp(path.join(tmpdir(), "phone11-media-test-")));
  vi.stubEnv("RECORDINGS_PATH", directory);
  vi.stubEnv("VOICEMAIL_PATH", directory);
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
    expect(sql).toContain("tm.tenant_id = cr.tenant_id AND tm.status = 'active'");
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
  it("refuses a tenant path replaced by a foreign symlink after containment inspection", async () => {
    const file = path.join(directory, "12", "race.wav");
    const foreign = path.join(directory, "29", "foreign.wav");
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.mkdir(path.dirname(foreign), { recursive: true });
    await fs.promises.writeFile(file, "owned media");
    await fs.promises.writeFile(foreign, "foreign media");
    mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 12, recording_url: file }] });
    const realpath = fs.promises.realpath.bind(fs.promises);
    let replaced = false;
    const spy = vi.spyOn(fs.promises, "realpath").mockImplementation(async (...args) => {
      const result = await realpath(...args);
      if (args[0] === file && !replaced) {
        replaced = true;
        await fs.promises.unlink(file);
        await fs.promises.symlink(foreign, file);
      }
      return result;
    });
    try {
      const response = await fetch(`${base}/recordings/play/call-1`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("foreign media");
      expect(replaced).toBe(true);
    } finally { spy.mockRestore(); }
  });

  it("refuses a media path outside the authorized tenant directory", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 29, recording_url: path.join(directory, "12", "call-1.wav") }] });
    expect((await fetch(`${base}/recordings/play/call-1`)).status).toBe(404);
  });
  it("fails closed when voicemail inbox storage has not been migrated", async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error("relation absent"), { code: "42P01" }));
    expect((await fetch(`${base}/recordings/voicemail/5`)).status).toBe(503);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("FROM voicemail_messages"), [17, 5]);
  });
  it("validates upload identifiers before filesystem writes", async () => {
    const { storeRecording } = await import("../server/pbx/recording-storage");
    await expect(storeRecording(12, "../../escape", Buffer.from("test"))).rejects.toThrow("Invalid");
    await expect(storeRecording(0, "call-1", Buffer.from("test"))).rejects.toThrow("Invalid");
  });
});

for (const route of ["play/call-1", "voicemail/9"]) {
  describe(`descriptor-pinned playback ${route}`, () => {
    async function media(name: string, bytes = "0123456789") {
      const file = path.join(directory, "12", route.split("/")[0] + "-" + name, "media.wav");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 12, recording_url: file, storage_path: file }] });
      return file;
    }

    it("does not inspect storage before owner authorization", async () => {
      const spy = vi.spyOn(fs.promises, "realpath");
      try {
        expect((await fetch(`${base}/recordings/${route}`)).status).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });

    it.each([
      [undefined, 200, "0123456789", undefined],
      ["bytes=2-5", 206, "2345", "bytes 2-5/10"],
      ["bytes=-3", 206, "789", "bytes 7-9/10"],
      ["bytes=7-", 206, "789", "bytes 7-9/10"],
      ["bytes=50-60", 416, "", "bytes */10"],
      ["bytes=malformed", 416, "", "bytes */10"],
      ["malformed", 200, "0123456789", undefined],
      ["bytes=0-1,4-5", 200, "0123456789", undefined],
    ])("preserves GET range %s", async (range, status, body, contentRange) => {
      await media(`range-${status}-${String(range).replace(/[^a-z0-9]/gi, "_")}`);
      const response = await fetch(`${base}/recordings/${route}`, { headers: range ? { Range: range } : {} });
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(body);
      expect(response.headers.get("content-range")).toBe(contentRange ?? null);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it.each([undefined, "bytes=2-5"])("preserves HEAD range %s and closes the opened handle once", async range => {
      const file = await media(`head-${range ? "range" : "full"}`);
      const open = fs.promises.open.bind(fs.promises);
      let close: ReturnType<typeof vi.spyOn> | undefined;
      const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (args[0] === file) close = vi.spyOn(handle, "close");
        return handle;
      });
      try {
        const response = await fetch(`${base}/recordings/${route}`, { method: "HEAD", headers: range ? { Range: range } : {} });
        expect(response.status).toBe(range ? 206 : 200);
        expect(response.headers.get("content-length")).toBe(range ? "4" : "10");
        expect(await response.text()).toBe("");
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      } finally { spy.mockRestore(); }
    });

    it.each(["current", "stale"])("preserves %s If-Range", async freshness => {
      const file = await media(`ifrange-${freshness}`);
      const modified = (await fs.promises.stat(file)).mtime.toUTCString();
      const response = await fetch(`${base}/recordings/${route}`, {
        headers: { Range: "bytes=2-5", "If-Range": freshness === "current" ? modified : '"old-object"' },
      });
      expect(response.status).toBe(freshness === "current" ? 206 : 200);
      expect(await response.text()).toBe(freshness === "current" ? "2345" : "0123456789");
    });

    it("preserves ETag freshness/preconditions and closes both handles once", async () => {
      const file = await media("etag");
      const stat = await fs.promises.stat(file);
      const etag = `W/"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;
      const open = fs.promises.open.bind(fs.promises);
      const closes: ReturnType<typeof vi.spyOn>[] = [];
      const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (args[0] === file) closes.push(vi.spyOn(handle, "close"));
        return handle;
      });
      try {
        const unchanged = await fetch(`${base}/recordings/${route}`, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } });
        expect(unchanged.status).toBe(304); expect(await unchanged.text()).toBe("");
        mocks.query.mockResolvedValueOnce({ rows: [{ tenant_id: 12, recording_url: file, storage_path: file }] });
        const mismatch = await fetch(`${base}/recordings/${route}`, { headers: { "If-Match": '"old-object"' } });
        expect(mismatch.status).toBe(412); expect(await mismatch.text()).toBe("");
        await vi.waitFor(() => { expect(closes).toHaveLength(2); closes.forEach(close => expect(close).toHaveBeenCalledTimes(1)); });
      } finally { spy.mockRestore(); }
    });

    it("refuses an oversized sparse media file before opening it", async () => {
      const file = await media("oversized");
      await fs.promises.truncate(file, (route.startsWith("play") ? 100 : 25) * 1024 * 1024 + 1);
      const spy = vi.spyOn(fs.promises, "open");
      try {
        const response = await fetch(`${base}/recordings/${route}`);
        expect(response.status).toBe(404); expect(await response.text()).not.toContain("0123456789");
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });

    it.each(["open", "identity"])("closes once after cancellation during pending %s", async phase => {
      const file = await media(`cancel-${phase}`);
      const open = fs.promises.open.bind(fs.promises);
      let signalReady!: () => void, release!: () => void;
      const ready = new Promise<void>(resolve => { signalReady = resolve; });
      const barrier = new Promise<void>(resolve => { release = resolve; });
      let close: ReturnType<typeof vi.spyOn> | undefined;
      const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (args[0] === file) {
          close = vi.spyOn(handle, "close");
          if (phase === "open") { signalReady(); await barrier; }
          else {
            const stat = handle.stat.bind(handle);
            vi.spyOn(handle, "stat").mockImplementationOnce(async () => { signalReady(); await barrier; return stat(); });
          }
        }
        return handle;
      });
      try {
        const controller = new AbortController();
        const response = fetch(`${base}/recordings/${route}`, { signal: controller.signal });
        const rejected = expect(response).rejects.toThrow();
        await ready; controller.abort(); await rejected; release();
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      } finally { release(); spy.mockRestore(); }
    });

    it.each(["regular", "fifo", "directory", "ancestor"])("refuses %s replacement at open without bytes and closes acquired handles", async kind => {
      const file = await media(`open-race-${kind}`);
      const foreign = path.join(directory, "29", `open-race-${kind}`, "media.wav");
      await mkdir(path.dirname(foreign), { recursive: true });
      await writeFile(foreign, "foreign000");
      const open = fs.promises.open.bind(fs.promises);
      let replaced = false, close: ReturnType<typeof vi.spyOn> | undefined;
      const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
        if (args[0] === file && !replaced) {
          replaced = true;
          if (kind === "ancestor") {
            await fs.promises.rename(path.dirname(file), path.dirname(file) + "-original");
            await fs.promises.symlink(path.dirname(foreign), path.dirname(file));
          } else {
            await fs.promises.unlink(file);
            if (kind === "regular") await writeFile(file, "foreign000");
            else if (kind === "fifo") execFileSync("/usr/bin/mkfifo", [file]);
            else await mkdir(file);
          }
          expect(Number(args[1]) & fs.constants.O_NONBLOCK).not.toBe(0);
          expect(Number(args[1]) & fs.constants.O_NOFOLLOW).not.toBe(0);
        }
        const handle = await open(...args);
        if (args[0] === file) close = vi.spyOn(handle, "close");
        return handle;
      });
      try {
        const response = await fetch(`${base}/recordings/${route}`);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain("foreign000");
        expect(replaced).toBe(true);
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      } finally { spy.mockRestore(); }
    });

    it("refuses an ancestor replacement after opening the owned inode", async () => {
      const file = await media("after-open-ancestor");
      const foreign = path.join(directory, "29", "after-open-ancestor", "media.wav");
      await mkdir(path.dirname(foreign), { recursive: true }); await writeFile(foreign, "foreign000");
      const open = fs.promises.open.bind(fs.promises);
      let close: ReturnType<typeof vi.spyOn> | undefined;
      const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (args[0] === file) {
          close = vi.spyOn(handle, "close");
          await fs.promises.rename(path.dirname(file), path.dirname(file) + "-original");
          await fs.promises.symlink(path.dirname(foreign), path.dirname(file));
        }
        return handle;
      });
      try {
        const response = await fetch(`${base}/recordings/${route}`);
        expect(response.status).toBe(404); expect(await response.text()).not.toContain("foreign000");
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      } finally { spy.mockRestore(); }
    });

    it("never reopens a pathname replaced after final checks", async () => {
      const file = await media("stream-race");
      const foreign = path.join(directory, "29", "stream-race.wav");
      await mkdir(path.dirname(foreign), { recursive: true }); await writeFile(foreign, "foreign000");
      const open = fs.promises.open.bind(fs.promises);
      const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (args[0] === file) {
          const create = handle.createReadStream.bind(handle);
          vi.spyOn(handle, "createReadStream").mockImplementation(options => {
            fs.unlinkSync(file); fs.symlinkSync(foreign, file);
            return create(options);
          });
        }
        return handle;
      });
      try {
        const response = await fetch(`${base}/recordings/${route}`);
        expect(response.status).toBe(200); expect(await response.text()).toBe("0123456789");
      } finally { spy.mockRestore(); }
    });

    it.each(["error", "disconnect"])("closes the opened handle once after stream %s", async failure => {
      const file = await media(`stream-${failure}`);
      const open = fs.promises.open.bind(fs.promises);
      let close: ReturnType<typeof vi.spyOn> | undefined, destroyed = false;
      const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (args[0] === file) {
          close = vi.spyOn(handle, "close");
          vi.spyOn(handle, "createReadStream").mockImplementation(() => {
            let pushed = false;
            return new Readable({
            read() { if (failure === "error") this.destroy(new Error("synthetic read failure")); else if (!pushed) { pushed = true; this.push("first"); } },
            destroy(_error, done) { destroyed = true; done(); },
          }) as fs.ReadStream;
          });
        }
        return handle;
      });
      try {
        if (failure === "error") await expect(fetch(`${base}/recordings/${route}`)).rejects.toThrow();
        else {
          const controller = new AbortController();
          const response = await fetch(`${base}/recordings/${route}`, { signal: controller.signal });
          await response.body!.getReader().read(); controller.abort();
        }
        await vi.waitFor(() => { expect(close).toHaveBeenCalledTimes(1); expect(destroyed).toBe(true); });
      } finally { spy.mockRestore(); }
    });
  });
}
