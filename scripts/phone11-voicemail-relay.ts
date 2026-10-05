#!/usr/bin/env node
/**
 * Private FreeSWITCH-side outbox consumer. A trusted producer must obtain a
 * pre-record admission and atomically write one manifest after mod_voicemail
 * completes. This worker never derives ownership from a delayed file scan.
 */
import { constants, type Stats } from "node:fs";
import { open, lstat, readdir, realpath, link, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_WAV_SIZE = 25 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCER_TEMP = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i;

export type RelayManifest = {
  message_uuid: string;
  tenant_id: number;
  extension: string;
  relative_wav_path: string;
  caller_number?: string;
  caller_name?: string;
  duration_seconds?: number;
};

export type RelayConfig = {
  sourceRoot: string;
  outboxRoot: string;
  uploadUrl: string;
  integrationSecret: string;
};

function parseManifest(raw: string): RelayManifest {
  const value = JSON.parse(raw) as Partial<RelayManifest>;
  if (typeof value.message_uuid !== "string" || !UUID.test(value.message_uuid) ||
      !Number.isSafeInteger(value.tenant_id) || Number(value.tenant_id) <= 0 ||
      typeof value.extension !== "string" || !/^[1-9][0-9]{0,15}$/.test(value.extension) ||
      typeof value.relative_wav_path !== "string" ||
      path.isAbsolute(value.relative_wav_path) ||
      value.relative_wav_path.split(/[\\/]/).some(part => part === ".." || part === "" || part === ".") ||
      !value.relative_wav_path.toLowerCase().endsWith(".wav") ||
      (value.caller_number !== undefined && (typeof value.caller_number !== "string" || value.caller_number.length > 64 || /[\u0000-\u001f\u007f]/.test(value.caller_number))) ||
      (value.caller_name !== undefined && (typeof value.caller_name !== "string" || value.caller_name.length > 160 || /[\u0000-\u001f\u007f]/.test(value.caller_name))) ||
      (value.duration_seconds !== undefined && (!Number.isSafeInteger(value.duration_seconds) || value.duration_seconds < 0 || value.duration_seconds > 86_400))) {
    throw new Error("Invalid voicemail relay manifest");
  }
  return value as RelayManifest;
}

function assertSamePrivateDirectory(expected: Stats, current: Stats): void {
  if (!current.isDirectory() || (current.mode & 0o077) !== 0 ||
      current.dev !== expected.dev || current.ino !== expected.ino ||
      current.mode !== expected.mode || current.uid !== expected.uid || current.gid !== expected.gid)
    throw new Error("Voicemail quarantine directory changed or is not private");
}

function assertSamePrivateManifest(expected: Stats, current: Stats): void {
  if (!current.isFile() || (current.mode & 0o077) !== 0 ||
      current.dev !== expected.dev || current.ino !== expected.ino ||
      current.size !== expected.size || current.mtimeMs !== expected.mtimeMs ||
      current.mode !== expected.mode || current.uid !== expected.uid || current.gid !== expected.gid)
    throw new Error("Voicemail manifest evidence changed");
}

async function syncDirectory(directory: string, expected: Stats): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    assertSamePrivateDirectory(expected, await handle.stat());
    await handle.sync();
    assertSamePrivateDirectory(expected, await lstat(directory));
  } finally { await handle.close(); }
}

async function assertQuarantinePair(source: string, target: string, expected: Stats): Promise<void> {
  const [current, preserved] = await Promise.all([lstat(source), lstat(target)]);
  assertSamePrivateManifest(expected, current);
  assertSamePrivateManifest(expected, preserved);
  await assertKnownManifestLinks(source, expected);
}

/** Accept only links produced by publication or an interrupted quarantine move. */
async function assertKnownManifestLinks(source: string, expected: Stats): Promise<void> {
  const root = path.dirname(source);
  const directory = await lstat(root);
  assertSamePrivateDirectory(directory, directory);
  const current = await lstat(source);
  assertSamePrivateManifest(expected, current);
  if (current.nlink === 1) return;
  if (![2, 3].includes(current.nlink)) throw new Error("Conflicting voicemail manifest links");
  let links = 1;
  const quarantine = path.join(root, "quarantine");
  try {
    const retained = await lstat(path.join(quarantine, path.basename(source)));
    if (retained.dev === expected.dev && retained.ino === expected.ino) {
      assertSamePrivateManifest(expected, retained);
      const parent = await lstat(quarantine);
      assertSamePrivateDirectory(parent, parent);
      links++;
    }
  } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  let producerLinks = 0;
  for (const name of (await readdir(root)).filter(name => PRODUCER_TEMP.test(name))) {
    let retained: Stats;
    try { retained = await lstat(path.join(root, name)); }
    catch (error: any) { if (error?.code === "ENOENT") continue; throw error; }
    if (retained.dev === expected.dev && retained.ino === expected.ino) {
      assertSamePrivateManifest(expected, retained);
      producerLinks++; links++;
    }
  }
  const final = await lstat(source);
  assertSamePrivateManifest(expected, final);
  if (producerLinks > 1 || links !== current.nlink || final.nlink !== links)
    throw new Error("Conflicting voicemail manifest links");
}

/** Preserve the first rejected manifest, including across callback retries. */
async function quarantineManifest(outboxRoot: string, name: string, expected: Stats): Promise<void> {
  const parent = await lstat(outboxRoot);
  assertSamePrivateDirectory(parent, parent);
  const quarantine = path.join(outboxRoot, "quarantine");
  try { await mkdir(quarantine, { mode: 0o700 }); }
  catch (error: any) { if (error?.code !== "EEXIST") throw error; }
  const directory = await lstat(quarantine);
  assertSamePrivateDirectory(directory, directory);
  const source = path.join(outboxRoot, name);
  const target = path.join(quarantine, name);
  await assertKnownManifestLinks(source, expected);
  try { await link(source, target); }
  catch (error: any) { if (error?.code !== "EEXIST") throw error; }
  await assertQuarantinePair(source, target, expected);
  await syncDirectory(quarantine, directory);
  // Persist the quarantine directory's entry before removing the retry source.
  // Repeat for an existing directory: a prior interrupted move may not have
  // established this parent barrier. Failure keeps both exact hardlinks.
  await syncDirectory(outboxRoot, parent);
  await assertQuarantinePair(source, target, expected);
  assertSamePrivateDirectory(directory, await lstat(quarantine));
  await unlink(source);
  await syncDirectory(outboxRoot, parent);
}

function uploadEndpoint(config: RelayConfig, manifest: RelayManifest): URL {
  const url = new URL(config.uploadUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/api/recordings/voicemail") {
    throw new Error("Voicemail upload URL must be the exact HTTPS endpoint");
  }
  url.searchParams.set("tenant_id", String(manifest.tenant_id));
  url.searchParams.set("extension", manifest.extension);
  url.searchParams.set("message_uuid", manifest.message_uuid);
  url.searchParams.set("caller_number", manifest.caller_number ?? "");
  url.searchParams.set("caller_name", manifest.caller_name ?? "");
  url.searchParams.set("duration_seconds", String(manifest.duration_seconds ?? 0));
  return url;
}

async function readPrivateManifest(file: string): Promise<{ manifest: RelayManifest; identity: Stats }> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MANIFEST_SIZE || (stat.mode & 0o077) !== 0)
    throw new Error("Manifest is not a private regular file");
  await assertKnownManifestLinks(file, stat);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assertSamePrivateManifest(stat, await handle.stat());
    const manifest = parseManifest(await handle.readFile({ encoding: "utf8" }));
    assertSamePrivateManifest(stat, await handle.stat());
    assertSamePrivateManifest(stat, await lstat(file));
    return { manifest, identity: stat };
  } finally {
    await handle.close();
  }
}

async function readPrivateWav(root: string, relativePath: string): Promise<Buffer> {
  const base = await realpath(root);
  const requested = path.join(base, relativePath);
  const entry = await lstat(requested);
  if (!entry.isFile() || entry.size < 12 || entry.size > MAX_WAV_SIZE)
    throw new Error("Voicemail source is missing or invalid");
  const resolved = await realpath(requested);
  if (!resolved.startsWith(base + path.sep)) throw new Error("Voicemail source left the private volume");
  const handle = await open(requested, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== entry.size) throw new Error("Voicemail source changed");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE")
      throw new Error("Voicemail source changed or is not WAV");
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function relayOnce(config: RelayConfig, send: typeof fetch = fetch) {
  if (!config.integrationSecret || config.integrationSecret.length < 32) throw new Error("Integration secret is missing");
  // Validate before processing a manifest; configuration errors must not drain an outbox.
  uploadEndpoint(config, { message_uuid: "00000000-0000-4000-8000-000000000000", tenant_id: 1, extension: "1", relative_wav_path: "x.wav" });
  const entries = (await readdir(config.outboxRoot)).filter(name => UUID.test(name.replace(/\.json$/, "")) && name.endsWith(".json")).sort();
  let delivered = 0;
  let quarantined = 0;
  let retry = 0;
  for (const name of entries) {
    const file = path.join(config.outboxRoot, name);
    try {
      const { manifest, identity } = await readPrivateManifest(file);
      if (`${manifest.message_uuid}.json` !== name) throw new Error("Manifest identity mismatch");
      const audio = await readPrivateWav(config.sourceRoot, manifest.relative_wav_path);
      const response = await send(uploadEndpoint(config, manifest).toString(), {
        method: "POST",
        headers: { "content-type": "audio/wav", "x-fs-secret": config.integrationSecret },
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 200 || response.status === 201) {
        await assertKnownManifestLinks(file, identity);
        await unlink(file);
        delivered++;
      } else if ([400, 404, 409].includes(response.status)) {
        await quarantineManifest(config.outboxRoot, name, identity);
        quarantined++;
      } else {
        retry++;
      }
    } catch {
      // Keep uncertain files for retry and operator inspection; never delete WAVs.
      retry++;
    }
  }
  return { delivered, quarantined, retry };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config: RelayConfig = {
    sourceRoot: process.env.PHONE11_VOICEMAIL_SOURCE_ROOT || "",
    outboxRoot: process.env.PHONE11_VOICEMAIL_OUTBOX || "",
    uploadUrl: process.env.PHONE11_VOICEMAIL_UPLOAD_URL || "",
    integrationSecret: process.env.FS_SHARED_SECRET || "",
  };
  const run = async () => {
    const result = await relayOnce(config);
    process.stdout.write(`voicemail relay: delivered=${result.delivered} quarantined=${result.quarantined} retry=${result.retry}\n`);
  };
  if (process.argv.includes("--once")) {
    run().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Relay failed"}\n`); process.exitCode = 1; });
  } else {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await run(); }
      catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Relay failed"}\n`); }
      finally { running = false; }
    };
    void tick();
    setInterval(() => { void tick(); }, 30_000);
  }
}
