import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkRuntime } from "../scripts/phone11-voicemail-runtime-check.mjs";

const SHA = bytes => createHash("sha256").update(bytes).digest("hex");
const names = ["producer.mjs", "relay.mjs", "local-fallback-ingress.mjs",
  "phone11_voicemail_local_fallback.lua", "runner.sh", "runtime-check.mjs",
  "fs-entrypoint.sh", "relay-entrypoint.sh", "phone11_voicemail_deposit.lua", "voicemail.conf.xml"];
const roots = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "phone11-vm-runtime-"));
  roots.push(root);
  const release = path.join(root, "release");
  const source = path.join(root, "source");
  const outbox = path.join(root, "outbox");
  await Promise.all([release, source, outbox].map(dir => mkdir(dir, { mode: 0o700 })));
  const files = {};
  for (const name of names) {
    const bytes = Buffer.from(name === "voicemail.conf.xml"
      ? `<param name="storage-dir" value="${source}"/>` : `candidate ${name}\n`);
    await writeFile(path.join(release, name), bytes, { mode: 0o600 });
    files[name] = SHA(bytes);
  }
  const manifest = Buffer.from(JSON.stringify({ schema: "phone11.voicemail-runtime/v1",
    source_sha: "a".repeat(40), files }));
  await writeFile(path.join(release, "release.json"), manifest, { mode: 0o600 });
  const flock = path.join(root, "flock");
  await writeFile(flock, "#!/bin/sh\n", { mode: 0o700 });
  const env = {
    PHONE11_VOICEMAIL_SOURCE_ROOT: source,
    PHONE11_VOICEMAIL_OUTBOX: outbox,
    PHONE11_VOICEMAIL_UPLOAD_URL: "https://api.phone11.ai/api/recordings/voicemail",
    PHONE11_VOICEMAIL_MAILBOX_ROOTS: JSON.stringify({ "1:3001": path.join(source, "tenant-1", "3001") }),
    FS_SHARED_SECRET: "s".repeat(32),
    PHONE11_VM_RELEASE_MANIFEST_SHA256: SHA(manifest),
  };
  return { root, release, source, outbox, flock, env,
    paths: { release, source, outbox, flock, ownerUid: process.getuid() } };
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("accepts an exact, private producer and relay release", async () => {
  const f = await fixture();
  assert.deepEqual(await checkRuntime("producer", f.env, f.paths),
    { result: "ready", mode: "producer", source_sha: "a".repeat(40) });
  assert.deepEqual(await checkRuntime("relay", f.env, f.paths),
    { result: "ready", mode: "relay", source_sha: "a".repeat(40) });
});

test("refuses changed artifacts and manifest pins before startup", async () => {
  const f = await fixture();
  await writeFile(path.join(f.release, "producer.mjs"), "different\n", { mode: 0o600 });
  await assert.rejects(checkRuntime("producer", f.env, f.paths), /release_changed/);
  f.env.PHONE11_VM_RELEASE_MANIFEST_SHA256 = "0".repeat(64);
  await assert.rejects(checkRuntime("relay", f.env, f.paths), /manifest_changed/);
});

test("refuses a public outbox, symlinked release file, and wrong storage path", async () => {
  const f = await fixture();
  await chmod(f.outbox, 0o755);
  await assert.rejects(checkRuntime("relay", f.env, f.paths), /private_directory/);
  await chmod(f.outbox, 0o700);
  const file = path.join(f.release, "producer.mjs");
  const bytes = await readFile(file);
  await rm(file);
  await writeFile(path.join(f.root, "replacement"), bytes, { mode: 0o600 });
  await symlink(path.join(f.root, "replacement"), file);
  await assert.rejects(checkRuntime("relay", f.env, f.paths), /private_file/);
  await rm(file);
  await writeFile(file, bytes, { mode: 0o600 });
  const wrong = Buffer.from('<param name="storage-dir" value="/wrong/volume"/>');
  await writeFile(path.join(f.release, "voicemail.conf.xml"), wrong, { mode: 0o600 });
  const manifestPath = path.join(f.release, "release.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files["voicemail.conf.xml"] = SHA(wrong);
  const updated = Buffer.from(JSON.stringify(manifest));
  await writeFile(manifestPath, updated, { mode: 0o600 });
  f.env.PHONE11_VM_RELEASE_MANIFEST_SHA256 = SHA(updated);
  await assert.rejects(checkRuntime("relay", f.env, f.paths), /storage_path/);
});

test("refuses mismatched mailbox identity and missing integration secret", async () => {
  const f = await fixture();
  f.env.PHONE11_VOICEMAIL_MAILBOX_ROOTS = JSON.stringify({ "2:3001": "/elsewhere/3001" });
  await assert.rejects(checkRuntime("producer", f.env, f.paths), /mailbox_map/);
  f.env.FS_SHARED_SECRET = "short";
  await assert.rejects(checkRuntime("relay", f.env, f.paths), /runtime_environment/);
});
