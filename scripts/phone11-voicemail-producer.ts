#!/usr/bin/env node
/**
 * FreeSWITCH-side durable producer. A trusted call-flow hook must run `admit`
 * before mod_voicemail and `complete` only after mod_voicemail returns with a
 * final voicemail_file_path. This module intentionally does not infer a
 * deposit from a delayed filesystem scan or CDR.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, link, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WAV_SIZE = 25 * 1024 * 1024;

export type ProducerConfig = {
  sourceRoot: string;
  outboxRoot: string;
  uploadUrl: string;
  integrationSecret: string;
  /** Trusted host inventory: exact mailbox root for each tenant:extension. */
  mailboxRoots: Record<string, string>;
};

export type AdmissionInput = { channelUuid: string; tenantId: number; extension: string };
export type CompletionInput = { channelUuid: string; voicemailFilePath: string; callerNumber?: string; callerName?: string; durationSeconds?: number };
type Pending = AdmissionInput & { messageUuid: string };

function validConfig(config: ProducerConfig): URL {
  if (!config.integrationSecret || config.integrationSecret.length < 32) throw new Error("Integration secret is missing");
  if (!path.isAbsolute(config.sourceRoot) || !path.isAbsolute(config.outboxRoot)) throw new Error("Producer paths must be absolute");
  const url = new URL(config.uploadUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/api/recordings/voicemail") throw new Error("Voicemail upload URL must be the exact HTTPS endpoint");
  return url;
}

function validateAdmission(input: AdmissionInput): void {
  if (typeof input.channelUuid !== "string" || !UUID.test(input.channelUuid) || !Number.isSafeInteger(input.tenantId) || input.tenantId <= 0 ||
      typeof input.extension !== "string" || !/^[1-9][0-9]{0,15}$/.test(input.extension)) throw new Error("Invalid voicemail admission identity");
}

function validateCompletion(input: CompletionInput): void {
  if (typeof input.channelUuid !== "string" || !UUID.test(input.channelUuid) ||
      typeof input.voicemailFilePath !== "string" || !path.isAbsolute(input.voicemailFilePath) ||
      /[\u0000-\u001f\u007f]/.test(input.voicemailFilePath) ||
      (input.callerNumber !== undefined && (typeof input.callerNumber !== "string" || input.callerNumber.length > 64 || /[\u0000-\u001f\u007f]/.test(input.callerNumber))) ||
      (input.callerName !== undefined && (typeof input.callerName !== "string" || input.callerName.length > 160 || /[\u0000-\u001f\u007f]/.test(input.callerName))) ||
      (input.durationSeconds !== undefined && (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds < 0 || input.durationSeconds > 86400))) {
    throw new Error("Invalid voicemail completion metadata");
  }
}

function mailboxRootFor(config: ProducerConfig, tenantId: number, extension: string): string {
  const root = config.mailboxRoots?.[`${tenantId}:${extension}`];
  if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("Voicemail mailbox root is not configured");
  return root;
}

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) throw new Error("Producer outbox directory must be private");
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Publish once with a link, so an existing manifest can never be replaced. */
async function publishJson(directory: string, name: string, value: object): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value));
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  const target = path.join(directory, name);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await link(temporary, target); }
    catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readPrivateJson(target);
      if (JSON.stringify(existing) !== bytes.toString("utf8")) throw new Error("Conflicting voicemail producer identity");
    }
    await syncDirectory(directory);
  } finally { await unlink(temporary); }
}

async function readPrivateJson(file: string): Promise<unknown> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 8192 || (stat.mode & 0o077) !== 0) throw new Error("Admission is not a private regular file");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return JSON.parse(await handle.readFile({ encoding: "utf8" })); }
  finally { await handle.close(); }
}

function pendingFrom(value: unknown, channelUuid: string): Pending {
  if (!value || typeof value !== "object") throw new Error("Invalid voicemail admission record");
  const input = value as Partial<Pending>;
  validateAdmission(input as AdmissionInput);
  if (input.channelUuid !== channelUuid || typeof input.messageUuid !== "string" || !UUID.test(input.messageUuid)) throw new Error("Voicemail admission identity mismatch");
  return input as Pending;
}

/** Must complete before the call flow invokes mod_voicemail. */
export async function admitVoicemail(config: ProducerConfig, input: AdmissionInput, send: typeof fetch = fetch): Promise<string> {
  const endpoint = validConfig(config);
  validateAdmission(input);
  mailboxRootFor(config, input.tenantId, input.extension);
  const pendingDir = path.join(config.outboxRoot, "pending");
  await privateDirectory(config.outboxRoot);
  await privateDirectory(pendingDir);
  const pendingPath = path.join(pendingDir, `${input.channelUuid}.json`);
  try {
    const existing = pendingFrom(await readPrivateJson(pendingPath), input.channelUuid);
    if (existing.tenantId !== input.tenantId || existing.extension !== input.extension) throw new Error("Conflicting voicemail admission identity");
    return existing.messageUuid;
  } catch (error: any) { if (error?.code !== "ENOENT") throw error; }

  endpoint.pathname += "/admission";
  endpoint.searchParams.set("tenant_id", String(input.tenantId));
  endpoint.searchParams.set("extension", input.extension);
  const response = await send(endpoint.toString(), {
    method: "POST", headers: { "x-fs-secret": config.integrationSecret }, signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 201) throw new Error(`Voicemail admission denied: ${response.status}`);
  const body = await response.json() as { message_uuid?: unknown };
  if (typeof body.message_uuid !== "string" || !UUID.test(body.message_uuid)) throw new Error("Invalid voicemail admission response");
  await publishJson(pendingDir, `${input.channelUuid}.json`, { ...input, messageUuid: body.message_uuid });
  return body.message_uuid;
}

async function completedWavPath(root: string, mailboxRoot: string, requested: string): Promise<string> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || (rootStat.mode & 0o077) !== 0) throw new Error("Voicemail source root must be a private directory");
  const base = await realpath(root);
  const mailbox = await realpath(mailboxRoot);
  if (!mailbox.startsWith(base + path.sep)) throw new Error("Voicemail mailbox is outside the private source root");
  const fileStat = await lstat(requested);
  if (!fileStat.isFile() || fileStat.size < 12 || fileStat.size > MAX_WAV_SIZE || !requested.toLowerCase().endsWith(".wav"))
    throw new Error("Completed voicemail WAV is missing or invalid");
  const resolved = await realpath(requested);
  if (!resolved.startsWith(base + path.sep)) throw new Error("Completed voicemail WAV is outside the private source root");
  if (!resolved.startsWith(mailbox + path.sep)) throw new Error("Completed voicemail WAV is outside the admitted mailbox");
  const handle = await open(requested, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    const header = Buffer.alloc(12);
    if ((await handle.read(header, 0, 12, 0)).bytesRead !== 12 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE")
      throw new Error("Completed voicemail is not WAV");
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino ||
        before.ino !== fileStat.ino || before.dev !== fileStat.dev) throw new Error("Completed voicemail changed");
    // A completed callback is the lifecycle proof; fsync makes its bytes
    // durable before any manifest advertises them to the relay.
    await handle.sync();
  } finally { await handle.close(); }
  await syncDirectory(path.dirname(requested));
  const relative = path.relative(base, resolved);
  if (!relative || relative.split(path.sep).some(part => part === ".." || part === ".")) throw new Error("Invalid voicemail relative path");
  return relative;
}

/** Call only after mod_voicemail returns and sets voicemail_file_path. */
export async function completeVoicemail(config: ProducerConfig, input: CompletionInput): Promise<string> {
  validConfig(config);
  validateCompletion(input);
  await privateDirectory(config.outboxRoot);
  const pendingDir = path.join(config.outboxRoot, "pending");
  const pending = pendingFrom(await readPrivateJson(path.join(pendingDir, `${input.channelUuid}.json`)), input.channelUuid);
  const relative = await completedWavPath(config.sourceRoot,
    mailboxRootFor(config, pending.tenantId, pending.extension), input.voicemailFilePath);
  const manifest = {
    message_uuid: pending.messageUuid,
    tenant_id: pending.tenantId,
    extension: pending.extension,
    relative_wav_path: relative,
    caller_number: input.callerNumber ?? "",
    caller_name: input.callerName ?? "",
    duration_seconds: input.durationSeconds ?? 0,
  };
  await publishJson(config.outboxRoot, `${pending.messageUuid}.json`, manifest);
  // Keep admission until the manifest is durable; a crash before unlink retries
  // idempotently and a crash after unlink leaves the durable manifest.
  await unlink(path.join(pendingDir, `${input.channelUuid}.json`));
  await syncDirectory(pendingDir);
  return pending.messageUuid;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const run = async () => {
    const mailboxRoots = JSON.parse(process.env.PHONE11_VOICEMAIL_MAILBOX_ROOTS || "null");
    if (!mailboxRoots || typeof mailboxRoots !== "object" || Array.isArray(mailboxRoots))
      throw new Error("Trusted voicemail mailbox roots are not configured");
    const config: ProducerConfig = {
      sourceRoot: process.env.PHONE11_VOICEMAIL_SOURCE_ROOT || "",
      outboxRoot: process.env.PHONE11_VOICEMAIL_OUTBOX || "",
      uploadUrl: process.env.PHONE11_VOICEMAIL_UPLOAD_URL || "",
      integrationSecret: process.env.FS_SHARED_SECRET || "",
      mailboxRoots,
    };
    const raw = await new Promise<string>((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => { value += chunk; if (value.length > 8192) reject(new Error("Producer input is too large")); });
      process.stdin.on("end", () => resolve(value));
      process.stdin.on("error", reject);
    });
    const value = JSON.parse(raw);
    if (process.argv[2] === "admit") {
      const id = await admitVoicemail(config, value);
      process.stdout.write(`${id}\n`);
    } else if (process.argv[2] === "complete") {
      const id = await completeVoicemail(config, value);
      process.stdout.write(`${id}\n`);
    } else throw new Error("Expected admit or complete");
  };
  run().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Voicemail producer failed"}\n`);
    process.exitCode = 1;
  });
}
