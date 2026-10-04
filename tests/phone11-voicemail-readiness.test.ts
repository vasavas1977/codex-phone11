import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: mocks.query }));

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "phone11-vm-readiness-test-")));
  vi.stubEnv("VOICEMAIL_PATH", root);
  vi.resetModules();
  mocks.query.mockReset().mockResolvedValue({ rows: [{ name: "voicemail_messages",
    admissions: "voicemail_deposit_admissions", owner_columns: "2", guard_trigger: true, epoch_trigger: true }] });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function status() {
  const { voicemailStorageStatus } = await import("../server/pbx/voicemail-access");
  return voicemailStorageStatus();
}

describe("voicemail readiness required filesystem primitives", () => {
  it.each(["link", "file sync", "directory sync"])("fails closed when a writable root rejects %s", async failure => {
    if (failure === "link") {
      vi.spyOn(fs.promises, "link").mockRejectedValue(Object.assign(new Error("fixture unsupported hardlinks"), { code: "EOPNOTSUPP" }));
    } else {
      const open = fs.promises.open.bind(fs.promises);
      vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof open>) => {
        const handle = await open(...args);
        const isDirectory = typeof args[1] === "number" && Boolean(args[1] & fs.constants.O_DIRECTORY);
        if ((failure === "directory sync") === isDirectory)
          handle.sync = async () => { throw Object.assign(new Error("fixture unsupported fsync"), { code: "EINVAL" }); };
        return handle;
      });
    }
    await expect(status()).resolves.toEqual({ schemaReady: true, mediaDirectoryWritable: false });
    expect(await readdir(root)).toEqual([]);
  });

  it("probes private media and removes all owned artifacts on success", async () => {
    const open = fs.promises.open.bind(fs.promises);
    const modes: number[] = [];
    vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      if (args[1] === "wx") {
        modes.push((await handle.stat()).mode & 0o777);
        modes.push((await stat(path.dirname(String(args[0])))).mode & 0o777);
      }
      return handle;
    });
    await expect(status()).resolves.toEqual({ schemaReady: true, mediaDirectoryWritable: true });
    expect(modes).toEqual([0o600, 0o700]);
    expect(await readdir(root)).toEqual([]);
  });

  it.each(["partial write", "staging close", "replay sync", "replay close"])("cleans its own scratch after %s failure and permits a later readiness retry", async failure => {
    const open = fs.promises.open.bind(fs.promises);
    const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      if (args[1] === "wx" && failure === "partial write") {
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async () => { await write("partial"); throw new Error("fixture interrupted write"); };
      }
      const replay = typeof args[1] === "number" && !(args[1] & fs.constants.O_DIRECTORY);
      if (replay && failure === "replay sync") handle.sync = async () => { throw new Error("fixture replay sync failure"); };
      if ((args[1] === "wx" && failure === "staging close") || (replay && failure === "replay close")) {
        const close = handle.close.bind(handle);
        handle.close = async () => { await close(); throw new Error("fixture closed-handle reporting failure"); };
      }
      return handle;
    });
    expect((await status()).mediaDirectoryWritable).toBe(false);
    expect(await readdir(root)).toEqual([]);
    spy.mockRestore();
    expect((await status()).mediaDirectoryWritable).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });

  it.each(["scratch directory", "staging file"])("fails closed when it cannot create its private %s", async failure => {
    if (failure === "scratch directory") vi.spyOn(fs.promises, "mkdtemp").mockRejectedValue(new Error("fixture create denied"));
    else {
      const open = fs.promises.open.bind(fs.promises);
      vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof open>) => {
        if (args[1] === "wx") throw new Error("fixture file create denied");
        return open(...args);
      });
    }
    expect((await status()).mediaDirectoryWritable).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  it.each(["missing", "file", "symlink"])("does not report an invalid %s root ready or touch its target", async kind => {
    const target = path.join(root, "customer-target");
    await mkdir(target);
    await writeFile(path.join(target, "keep.wav"), "customer fixture");
    const invalid = path.join(root, "configured-root");
    if (kind === "file") await writeFile(invalid, "not a directory");
    if (kind === "symlink") await symlink(target, invalid);
    vi.stubEnv("VOICEMAIL_PATH", invalid);
    expect((await status()).mediaDirectoryWritable).toBe(false);
    expect(await readdir(target)).toEqual(["keep.wav"]);
    expect(await readFile(path.join(target, "keep.wav"), "utf8")).toBe("customer fixture");
  });

  it("keeps schema readiness separate from filesystem support", async () => {
    mocks.query.mockResolvedValue({ rows: [{ name: null, admissions: null, owner_columns: "0" }] });
    await expect(status()).resolves.toEqual({ schemaReady: false, mediaDirectoryWritable: true });
    vi.spyOn(fs.promises, "link").mockRejectedValue(new Error("fixture unsupported link"));
    await expect(status()).resolves.toEqual({ schemaReady: false, mediaDirectoryWritable: false });
    expect(await readdir(root)).toEqual([]);
  });

  it("retains unexpected schema errors rather than asserting ready", async () => {
    const failure = new Error("fixture query failure");
    mocks.query.mockRejectedValue(failure);
    await expect(status()).rejects.toBe(failure);
    expect(await readdir(root)).toEqual([]);
  });

  it("requires exclusive publication and preserves an existing unexpected target", async () => {
    const link = fs.promises.link.bind(fs.promises);
    const spy = vi.spyOn(fs.promises, "link").mockImplementation(async (source, target) => {
      await writeFile(target, "preexisting fixture");
      return link(source, target);
    });
    expect((await status()).mediaDirectoryWritable).toBe(false);
    spy.mockRestore();
    const [retained] = await readdir(root);
    expect(await readdir(path.join(root, retained))).toEqual(["published"]);
    expect(await readFile(path.join(root, retained, "published"), "utf8")).toBe("preexisting fixture");
    expect((await status()).mediaDirectoryWritable).toBe(true);
    expect(await readdir(root)).toEqual([retained]);
  });

  it("fails closed if the second publication does not reject an existing target", async () => {
    const link = fs.promises.link.bind(fs.promises);
    let count = 0;
    vi.spyOn(fs.promises, "link").mockImplementation(async (source, target) => {
      if (++count === 1) await link(source, target);
    });
    expect((await status()).mediaDirectoryWritable).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  it.each(["unlink", "directory removal", "cleanup sync"])("fails closed on %s failure and never sweeps retained evidence on retry", async failure => {
    if (failure === "unlink") {
      const unlink = fs.promises.unlink.bind(fs.promises);
      vi.spyOn(fs.promises, "unlink").mockImplementation(async file => {
        if (path.basename(String(file)) === "published") throw new Error("fixture cleanup denied");
        return unlink(file);
      });
    } else if (failure === "directory removal") {
      vi.spyOn(fs.promises, "rmdir").mockRejectedValue(new Error("fixture directory cleanup denied"));
    } else {
      const open = fs.promises.open.bind(fs.promises);
      let rootSyncs = 0;
      vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof open>) => {
        const handle = await open(...args);
        if (String(args[0]) === root && ++rootSyncs === 2)
          handle.sync = async () => { throw new Error("fixture cleanup synchronization failed"); };
        return handle;
      });
    }
    expect((await status()).mediaDirectoryWritable).toBe(false);
    vi.restoreAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ name: "voicemail_messages", admissions: "voicemail_deposit_admissions",
      owner_columns: "2", guard_trigger: true, epoch_trigger: true }] });
    const retained = await readdir(root);
    expect(retained).toHaveLength(failure === "cleanup sync" ? 0 : 1);
    const snapshots = await Promise.all(retained.map(async name => ({ name, entries: await readdir(path.join(root, name)) })));
    expect((await status()).mediaDirectoryWritable).toBe(true);
    expect(await readdir(root)).toEqual(retained);
    for (const snapshot of snapshots) expect(await readdir(path.join(root, snapshot.name))).toEqual(snapshot.entries);
  });

  it("does not recursively remove unrelated files introduced inside its scratch directory", async () => {
    const link = fs.promises.link.bind(fs.promises);
    let other: string | undefined;
    vi.spyOn(fs.promises, "link").mockImplementation(async (source, target) => {
      other = path.join(path.dirname(String(source)), "not-created-by-probe");
      await writeFile(other, "preserve unrelated fixture");
      return link(source, target);
    });
    expect((await status()).mediaDirectoryWritable).toBe(false);
    expect(await readFile(other!, "utf8")).toBe("preserve unrelated fixture");
    expect(await readdir(path.dirname(other!))).toEqual(["not-created-by-probe"]);
  });

  it("isolates concurrent probes so a failed writer cannot erase another successful probe or existing objects", async () => {
    const existing = path.join(root, ".old.pending.wav");
    await writeFile(existing, "retained voicemail fixture");
    const link = fs.promises.link.bind(fs.promises);
    let firstDirectory: string | undefined;
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { reached = resolve; });
    const directories = new Set<string>();
    vi.spyOn(fs.promises, "link").mockImplementation(async (source, target) => {
      const directory = path.dirname(String(source));
      directories.add(directory);
      if (!firstDirectory) {
        firstDirectory = directory;
        reached();
        await paused;
        throw new Error("fixture first probe publication failed");
      }
      return link(source, target);
    });
    const first = status();
    await started;
    try {
      expect((await status()).mediaDirectoryWritable).toBe(true);
    } finally { release(); }
    expect((await first).mediaDirectoryWritable).toBe(false);
    expect(directories.size).toBe(2);
    expect(await readdir(root)).toEqual([".old.pending.wav"]);
    expect(await readFile(existing, "utf8")).toBe("retained voicemail fixture");
  });
});
