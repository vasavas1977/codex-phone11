#!/usr/bin/env node
// Read-only startup/health gate shared by the FreeSWITCH producer and relay.
// It prints only a fixed reason code; never print the secret or mailbox map.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE = "/opt/phone11ai/voicemail";
const SOURCE = "/var/lib/freeswitch/voicemail";
const OUTBOX = "/var/lib/phone11-voicemail/outbox";
const UPLOAD = "https://api.phone11.ai/api/recordings/voicemail";
const FILES = ["producer.mjs", "relay.mjs", "runner.sh", "runtime-check.mjs",
  "fs-entrypoint.sh", "relay-entrypoint.sh",
  "phone11_voicemail_deposit.lua", "voicemail.conf.xml"];
const SHA256 = /^[0-9a-f]{64}$/;

function requireState(condition, reason) {
  if (!condition) throw new Error(reason);
}

async function privateDirectory(directory, ownerUid) {
  const info = await lstat(directory);
  requireState(info.isDirectory() && !info.isSymbolicLink() && info.uid === ownerUid &&
    (info.mode & 0o077) === 0, "private_directory");
}

async function privateFile(file, ownerUid) {
  const info = await lstat(file);
  requireState(info.isFile() && !info.isSymbolicLink() && info.uid === ownerUid &&
    (info.mode & 0o077) === 0 && info.size > 0 && info.size < 5_000_000,
  "private_file");
  return readFile(file);
}

export async function checkRuntime(mode, env = process.env, paths = {
  release: RELEASE, source: SOURCE, outbox: OUTBOX, flock: "/usr/bin/flock", ownerUid: 0,
}) {
  requireState(mode === "producer" || mode === "relay", "mode");
  requireState(Number(process.versions.node.split(".")[0]) >= 20, "node_version");
  requireState(env.PHONE11_VOICEMAIL_SOURCE_ROOT === paths.source &&
    env.PHONE11_VOICEMAIL_OUTBOX === paths.outbox &&
    env.PHONE11_VOICEMAIL_UPLOAD_URL === UPLOAD &&
    typeof env.FS_SHARED_SECRET === "string" && env.FS_SHARED_SECRET.length >= 32,
  "runtime_environment");
  requireState(SHA256.test(env.PHONE11_VM_RELEASE_MANIFEST_SHA256 || ""), "manifest_pin");
  await privateDirectory(paths.release, paths.ownerUid);
  await privateDirectory(paths.source, paths.ownerUid);
  await privateDirectory(paths.outbox, paths.ownerUid);
  const manifestBytes = await privateFile(path.join(paths.release, "release.json"), paths.ownerUid);
  requireState(createHash("sha256").update(manifestBytes).digest("hex") ===
    env.PHONE11_VM_RELEASE_MANIFEST_SHA256, "manifest_changed");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  requireState(manifest.schema === "phone11.voicemail-runtime/v1" &&
    /^[0-9a-f]{40}$/.test(manifest.source_sha) &&
    manifest.files && typeof manifest.files === "object" &&
    Object.keys(manifest.files).sort().join(",") === [...FILES].sort().join(","),
  "manifest_format");
  for (const name of FILES) {
    requireState(SHA256.test(manifest.files[name]), "file_pin");
    const bytes = await privateFile(path.join(paths.release, name), paths.ownerUid);
    requireState(createHash("sha256").update(bytes).digest("hex") === manifest.files[name],
      "release_changed");
  }
  const voicemailConfig = (await readFile(path.join(paths.release, "voicemail.conf.xml"), "utf8"));
  requireState(voicemailConfig.includes('<param name="storage-dir" value="' + paths.source + '"/>'),
    "storage_path");
  if (mode === "producer") {
    await access(paths.flock, constants.X_OK);
    const roots = JSON.parse(env.PHONE11_VOICEMAIL_MAILBOX_ROOTS || "null");
    requireState(roots && typeof roots === "object" && !Array.isArray(roots) &&
      Object.keys(roots).length > 0, "mailbox_map");
    for (const [key, root] of Object.entries(roots)) {
      requireState(/^[1-9][0-9]*:[1-9][0-9]{0,15}$/.test(key) &&
        typeof root === "string" && root.startsWith(paths.source + path.sep) &&
        path.normalize(root) === root, "mailbox_map");
    }
  }
  return { result: "ready", mode, source_sha: manifest.source_sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkRuntime(process.argv[2]).then(value => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  }).catch(error => {
    const safe = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "check_failed";
    process.stderr.write(`voicemail_runtime_${safe}\n`);
    process.exitCode = 1;
  });
}
