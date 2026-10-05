import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { link, mkdtemp, mkdir, readFile, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { relayOnce, type RelayConfig } from "../scripts/phone11-voicemail-relay";

const durability = vi.hoisted(() => ({
  failSync: undefined as ((file: string) => boolean | Promise<boolean>) | undefined,
  failUnlink: undefined as string | undefined,
  syncs: [] as { file: string; manifestExists: boolean }[],
  manifest: "",
  handles: 0,
}));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const sync = handle.sync.bind(handle), close = handle.close.bind(handle);
      durability.handles++;
      handle.sync = async () => {
        const file = String(args[0]);
        durability.syncs.push({ file, manifestExists: await actual.stat(durability.manifest).then(() => true, () => false) });
        if (await durability.failSync?.(file)) throw Object.assign(new Error("fixture directory sync failure"), { code: "EIO" });
        await sync();
      };
      handle.close = async () => { try { await close(); } finally { durability.handles--; } };
      return handle;
    },
    unlink: async (file: Parameters<typeof actual.unlink>[0]) => {
      if (String(file) === durability.failUnlink) throw Object.assign(new Error("fixture unlink failure"), { code: "EIO" });
      await actual.unlink(file);
    },
  };
});

const uuid = "10000000-0000-4000-8000-000000000001";
const audio = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.from("private audio")]);
let directory: string;
let config: RelayConfig;

beforeEach(async () => {
  durability.failSync = undefined; durability.failUnlink = undefined;
  durability.syncs = []; durability.handles = 0;
  directory = await mkdtemp(path.join(tmpdir(), "phone11-vm-relay-"));
  config = {
    sourceRoot: path.join(directory, "source"),
    outboxRoot: path.join(directory, "outbox"),
    uploadUrl: "https://api.phone11.ai/api/recordings/voicemail",
    integrationSecret: "test-voicemail-relay-secret-0123456789",
  };
  await mkdir(path.join(config.sourceRoot, "domain", "3001"), { recursive: true });
  await mkdir(config.outboxRoot, { mode: 0o700 });
  await writeFile(path.join(config.sourceRoot, "domain", "3001", `${uuid}.wav`), audio);
  await writeFile(path.join(config.outboxRoot, `${uuid}.json`), JSON.stringify({
    message_uuid: uuid,
    tenant_id: 12,
    extension: "3001",
    relative_wav_path: `domain/3001/${uuid}.wav`,
    caller_number: "+6620303001",
    duration_seconds: 19,
  }), { mode: 0o600 });
  durability.manifest = path.join(config.outboxRoot, `${uuid}.json`);
});

afterEach(async () => {
  durability.failSync = undefined; durability.failUnlink = undefined;
  expect(durability.handles).toBe(0);
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("private voicemail relay outbox", () => {
  it("uploads the admitted UUID over HTTPS and removes only an acknowledged manifest", async () => {
    const send = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.protocol).toBe("https:");
      expect(url.pathname).toBe("/api/recordings/voicemail");
      expect(url.searchParams.get("message_uuid")).toBe(uuid);
      expect(url.searchParams.get("tenant_id")).toBe("12");
      expect(init?.headers).toMatchObject({ "x-fs-secret": config.integrationSecret });
      expect(Buffer.from(init?.body as Uint8Array)).toEqual(audio);
      return { status: 201 } as Response;
    });
    expect(await relayOnce(config, send as typeof fetch)).toEqual({ delivered: 1, quarantined: 0, retry: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(stat(path.join(config.outboxRoot, `${uuid}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(config.sourceRoot, "domain", "3001", `${uuid}.wav`))).toEqual(audio);
  });

  it("retains uncertain uploads for idempotent retry and quarantines a stale admission", async () => {
    expect(await relayOnce(config, vi.fn(async () => ({ status: 503 } as Response)) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    await stat(path.join(config.outboxRoot, `${uuid}.json`));
    expect(await relayOnce(config, vi.fn(async () => ({ status: 409 } as Response)) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    await stat(path.join(config.outboxRoot, "quarantine", `${uuid}.json`));
  });

  it("never overwrites the first quarantined manifest on a later completion retry", async () => {
    const manifest = path.join(config.outboxRoot, `${uuid}.json`);
    const rejected = vi.fn(async () => ({ status: 409 } as Response)) as typeof fetch;
    expect(await relayOnce(config, rejected)).toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    const preserved = await readFile(path.join(config.outboxRoot, "quarantine", `${uuid}.json`));
    await writeFile(manifest, JSON.stringify({ ...JSON.parse(preserved.toString()), caller_name: "second callback" }), { mode: 0o600 });
    expect(await relayOnce(config, rejected)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(await readFile(path.join(config.outboxRoot, "quarantine", `${uuid}.json`))).toEqual(preserved);
    await stat(manifest);
  });

  it("rejects a path outside the private FreeSWITCH volume without sending audio", async () => {
    await writeFile(path.join(config.outboxRoot, `${uuid}.json`), JSON.stringify({
      message_uuid: uuid, tenant_id: 12, extension: "3001", relative_wav_path: "../other.wav",
    }), { mode: 0o600 });
    const send = vi.fn();
    expect(await relayOnce(config, send as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(send).not.toHaveBeenCalled();
    await stat(path.join(config.outboxRoot, `${uuid}.json`));
  });

  it("refuses a non-HTTPS endpoint before processing the outbox", async () => {
    config.uploadUrl = "http://api.phone11.ai/api/recordings/voicemail";
    await expect(relayOnce(config, vi.fn() as typeof fetch)).rejects.toThrow("exact HTTPS endpoint");
    await stat(path.join(config.outboxRoot, `${uuid}.json`));
  });

  it.each([false, true])("retains the retry manifest until the quarantine directory entry is durable (existing=%s)", async existing => {
    const quarantine = path.join(config.outboxRoot, "quarantine");
    if (existing) await mkdir(quarantine, { mode: 0o700 });
    const original = await readFile(durability.manifest);
    const inode = (await stat(durability.manifest)).ino;
    const rejected = vi.fn(async () => new Response("", { status: 409 }));
    durability.failSync = file => file === config.outboxRoot;
    expect(await relayOnce(config, rejected as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(await readFile(durability.manifest)).toEqual(original);
    expect((await stat(durability.manifest)).ino).toBe(inode);
    expect((await stat(path.join(quarantine, `${uuid}.json`))).ino).toBe(inode);
    expect(durability.syncs.at(-1)).toEqual({ file: config.outboxRoot, manifestExists: true });
    durability.failSync = undefined;
    expect(await relayOnce(config, rejected as typeof fetch)).toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    expect(await readFile(path.join(quarantine, `${uuid}.json`))).toEqual(original);
    expect(await readFile(path.join(config.sourceRoot, "domain", "3001", `${uuid}.wav`))).toEqual(audio);
    expect(await relayOnce(config, rejected as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 0 });
    expect(rejected).toHaveBeenCalledTimes(2);
  });

  it("preserves both exact hardlinks after quarantine content sync failure and recovers once", async () => {
    const quarantine = path.join(config.outboxRoot, "quarantine");
    const preserved = path.join(quarantine, `${uuid}.json`);
    const original = await readFile(durability.manifest);
    durability.failSync = file => file === quarantine;
    const rejected = vi.fn(async () => new Response("", { status: 409 }));
    expect(await relayOnce(config, rejected as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(await readFile(durability.manifest)).toEqual(original);
    expect((await stat(preserved)).ino).toBe((await stat(durability.manifest)).ino);
    expect(durability.syncs).toEqual([{ file: quarantine, manifestExists: true }]);
    durability.failSync = undefined;
    expect(await relayOnce(config, rejected as typeof fetch)).toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    expect(await readFile(preserved)).toEqual(original);
  });

  it("finishes the exact two-link state left by process death before source removal", async () => {
    const quarantine = path.join(config.outboxRoot, "quarantine");
    await mkdir(quarantine, { mode: 0o700 });
    const preserved = path.join(quarantine, `${uuid}.json`);
    await link(durability.manifest, preserved);
    const inode = (await stat(preserved)).ino;
    expect(await relayOnce(config, vi.fn(async () => new Response("", { status: 409 })) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    expect((await stat(preserved)).ino).toBe(inode);
    expect((await stat(preserved)).nlink).toBe(1);
    expect(durability.syncs).toEqual([
      { file: quarantine, manifestExists: true },
      { file: config.outboxRoot, manifestExists: true },
      { file: config.outboxRoot, manifestExists: false },
    ]);
  });

  it("retains the source and durable quarantine when unlink fails, then retries without overwriting", async () => {
    const rejected = vi.fn(async () => new Response("", { status: 409 }));
    durability.failUnlink = durability.manifest;
    expect(await relayOnce(config, rejected as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    const preserved = path.join(config.outboxRoot, "quarantine", `${uuid}.json`);
    expect((await stat(preserved)).ino).toBe((await stat(durability.manifest)).ino);
    durability.failUnlink = undefined;
    expect(await relayOnce(config, rejected as typeof fetch)).toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    expect((await stat(preserved)).nlink).toBe(1);
  });

  it("has already persisted quarantine before a final source-removal sync failure", async () => {
    const quarantine = path.join(config.outboxRoot, "quarantine");
    durability.failSync = async file => file === config.outboxRoot && !await stat(durability.manifest).then(() => true, () => false);
    expect(await relayOnce(config, vi.fn(async () => new Response("", { status: 409 })) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(durability.syncs).toEqual([
      { file: quarantine, manifestExists: true },
      { file: config.outboxRoot, manifestExists: true },
      { file: config.outboxRoot, manifestExists: false },
    ]);
    await stat(path.join(quarantine, `${uuid}.json`));
    expect(await readFile(path.join(config.sourceRoot, "domain", "3001", `${uuid}.wav`))).toEqual(audio);
  });

  it.each([200, 409])("preserves a manifest replaced during the upload response (%s)", async status => {
    const original = await readFile(durability.manifest);
    const retained = `${durability.manifest}.retained`;
    const replacement = Buffer.from(JSON.stringify({ ...JSON.parse(original.toString()), caller_name: "replacement" }));
    const send = vi.fn(async () => {
      await rename(durability.manifest, retained);
      await writeFile(durability.manifest, replacement, { mode: 0o600 });
      return new Response("", { status });
    });
    expect(await relayOnce(config, send as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(await readFile(durability.manifest)).toEqual(replacement);
    expect(await readFile(retained)).toEqual(original);
  });

  it.each(["source", "preserved", "directory"])("refuses a %s replacement during parent sync without removing evidence", async replaced => {
    const quarantine = path.join(config.outboxRoot, "quarantine");
    const preserved = path.join(quarantine, `${uuid}.json`);
    const original = await readFile(durability.manifest);
    const replacement = Buffer.from(JSON.stringify({ ...JSON.parse(original.toString()), caller_name: "replacement" }));
    let changed = false;
    durability.failSync = async file => {
      if (!changed && file === config.outboxRoot) {
        changed = true;
        if (replaced === "directory") {
          await rename(quarantine, `${quarantine}.retained`);
          await mkdir(quarantine, { mode: 0o700 });
          await writeFile(preserved, replacement, { mode: 0o600 });
        } else {
          const target = replaced === "source" ? durability.manifest : preserved;
          await rename(target, `${target}.retained`);
          await writeFile(target, replacement, { mode: 0o600 });
        }
      }
      return false;
    };
    expect(await relayOnce(config, vi.fn(async () => new Response("", { status: 409 })) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(changed).toBe(true);
    expect(await readFile(durability.manifest)).toEqual(replaced === "source" ? replacement : original);
    expect(await readFile(preserved)).toEqual(replaced === "source" ? original : replacement);
  });

  it.each(["directory symlink", "target symlink", "unrelated hardlink", "third hardlink"])("refuses %s without unlinking the retry source", async kind => {
    const quarantine = path.join(config.outboxRoot, "quarantine");
    const preserved = path.join(quarantine, `${uuid}.json`);
    const original = await readFile(durability.manifest);
    if (kind === "directory symlink") {
      const other = path.join(directory, "other");
      await mkdir(other, { mode: 0o700 });
      await symlink(other, quarantine);
    } else if (kind === "target symlink") {
      await mkdir(quarantine, { mode: 0o700 });
      await symlink(durability.manifest, preserved);
    } else {
      await link(durability.manifest, path.join(directory, "other-evidence"));
      if (kind === "third hardlink") {
        await mkdir(quarantine, { mode: 0o700 });
        await link(durability.manifest, preserved);
      }
    }
    const send = vi.fn(async () => new Response("", { status: 409 }));
    expect(await relayOnce(config, send as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(await readFile(durability.manifest)).toEqual(original);
    if (kind.includes("hardlink")) expect(send).not.toHaveBeenCalled();
    if (kind === "target symlink") {
      // A caller-owned symlink remains intact; recovery never removes it.
      await unlink(preserved);
      await stat(durability.manifest);
    }
  });

  it.each([200, 409])("recovers a published producer temp hardlink after process death (%s)", async status => {
    const temporary = path.join(config.outboxRoot, ".33333333-3333-4333-8333-333333333333.tmp");
    await link(durability.manifest, temporary);
    const original = await readFile(temporary);
    const send = vi.fn(async () => new Response("", { status }));
    expect(await relayOnce(config, send as typeof fetch)).toEqual({ delivered: status === 200 ? 1 : 0, quarantined: status === 409 ? 1 : 0, retry: 0 });
    expect(await readFile(temporary)).toEqual(original);
    await expect(stat(durability.manifest)).rejects.toMatchObject({ code: "ENOENT" });
    if (status === 409) expect(await readFile(path.join(config.outboxRoot, "quarantine", `${uuid}.json`))).toEqual(original);
    expect(send).toHaveBeenCalledOnce();
  });

  it("recovers the exact producer/source/quarantine three-link crash state", async () => {
    const temporary = path.join(config.outboxRoot, ".33333333-3333-4333-8333-333333333333.tmp");
    const quarantine = path.join(config.outboxRoot, "quarantine");
    await mkdir(quarantine, { mode: 0o700 });
    const preserved = path.join(quarantine, `${uuid}.json`);
    await link(durability.manifest, temporary);
    await link(durability.manifest, preserved);
    expect(await relayOnce(config, vi.fn(async () => new Response("", { status: 409 })) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    expect((await stat(preserved)).ino).toBe((await stat(temporary)).ino);
    expect((await stat(preserved)).nlink).toBe(2);
  });

  it("refuses a replaced outbox parent during synchronization and preserves both generations", async () => {
    const original = await readFile(durability.manifest);
    const replacement = Buffer.from(JSON.stringify({ ...JSON.parse(original.toString()), caller_name: "replacement" }));
    let changed = false;
    durability.failSync = async file => {
      if (!changed && file === config.outboxRoot) {
        changed = true;
        await rename(config.outboxRoot, `${config.outboxRoot}.retained`);
        await mkdir(config.outboxRoot, { mode: 0o700 });
        await writeFile(durability.manifest, replacement, { mode: 0o600 });
      }
      return false;
    };
    expect(await relayOnce(config, vi.fn(async () => new Response("", { status: 409 })) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(await readFile(durability.manifest)).toEqual(replacement);
    expect(await readFile(path.join(`${config.outboxRoot}.retained`, `${uuid}.json`))).toEqual(original);
    expect(await readFile(path.join(`${config.outboxRoot}.retained`, "quarantine", `${uuid}.json`))).toEqual(original);
  });
});
