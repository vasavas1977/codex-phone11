import { chmod, copyFile, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildVoicemailBundle } from "../scripts/phone11-voicemail-bundle";
import { verifyVoicemailBundle, validateRuntimePlan } from "../scripts/phone11-voicemail-bundle-verify";
import { artifactModes, canonicalJson, parseContractJson, planSchema, runtimePaths, sha256, sourceFiles } from "../scripts/phone11-voicemail-bundle-contract";

const revision = "f4dd06b676400b31c0b7838b9211081fc890951e";
const uid = process.getuid!();
const gid = process.getgid!();
let root: string;
let baseline: string;
let pin: string;
const runtimePlan = () => ({
  schema: planSchema, runtimeUid: uid, runtimeGid: gid, nodeMajor: 22, runtimePaths: { ...runtimePaths },
  sourceRoot: "/private-voicemail-source", outboxRoot: "/private-voicemail-outbox",
  mailboxRoots: { "1:3001": "/private-voicemail-source/default/phone11.cloud/3001" },
  uploadUrl: "https://offline.example.test/api/recordings/voicemail",
  integrationSecretEnvironment: "FS_SHARED_SECRET", backendHookReady: false, freeswitchHookReady: false,
  filesystemContract: { ownerUid: uid, ownerGid: gid, directoryMode: "0700", fileMode: "0600",
    fileSync: true, directorySync: true, exclusiveHardlinks: true },
});
async function fixture() {
  const directory = await mkdtemp(path.join(root, "case-"));
  const bundle = path.join(directory, "bundle");
  await mkdir(bundle, { mode: 0o700 });
  for (const name of [...Object.keys(artifactModes), "manifest.json"]) {
    await copyFile(path.join(baseline, name), path.join(bundle, name));
    await chmod(path.join(bundle, name), name === "runner.sh" ? 0o700 : 0o600);
  }
  const plan = path.join(directory, "plan.json");
  await writeFile(plan, canonicalJson(runtimePlan()), { mode: 0o600 });
  return { bundle, plan };
}
async function changeManifest(bundle: string, mutate: (value: any) => void) {
  const value = JSON.parse(await readFile(path.join(bundle, "manifest.json"), "utf8"));
  mutate(value);
  const raw = canonicalJson(value);
  await writeFile(path.join(bundle, "manifest.json"), raw);
  return sha256(raw);
}
async function sourceCopy() {
  const source = await mkdtemp(path.join(root, "source-"));
  for (const file of sourceFiles) {
    await mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await copyFile(path.resolve(file), path.join(source, file));
  }
  return source;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(await realpath(tmpdir()), "phone11-offline-bundle-"));
  baseline = path.join(root, "baseline");
  pin = (await buildVoicemailBundle(await realpath(process.cwd()), baseline, revision)).manifestSha256;
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("unsigned offline voicemail bundle", () => {
  it("builds byte-identical bundles across output directories and preserves exact runner/helpers", async () => {
    const second = path.join(root, "second");
    expect((await buildVoicemailBundle(await realpath(process.cwd()), second, revision)).manifestSha256).toBe(pin);
    for (const name of [...Object.keys(artifactModes), "manifest.json"])
      expect(await readFile(path.join(second, name))).toEqual(await readFile(path.join(baseline, name)));
    expect(await readFile(path.join(baseline, "runner.sh"))).toEqual(await readFile("scripts/phone11-voicemail-runner.sh"));
    for (const name of ["phone11_legacy_voicemail.lua", "phone11_voicemail_deposit.lua"])
      expect(await readFile(path.join(baseline, name))).toEqual(await readFile(`infra/configs/freeswitch/scripts/${name}`));
  });
  it("never overwrites a candidate/recovery bundle", async () => {
    await expect(buildVoicemailBundle(await realpath(process.cwd()), baseline, revision)).rejects.toThrow();
    expect(sha256(await readFile(path.join(baseline, "manifest.json")))).toBe(pin);
  });
  it("rejects non-normalized source paths that could bypass the outside-checkout output guard", async () => {
    const source = await sourceCopy();
    await expect(buildVoicemailBundle(source + "/", path.join(source, "bundle"), revision)).rejects.toThrow("normalized");
  });
  it("refuses divergent helper inputs before creating a bundle", async () => {
    const source = await sourceCopy();
    await writeFile(path.join(source, sourceFiles[3]), "changed helper\n");
    await expect(buildVoicemailBundle(source, path.join(root, "bad-output"), revision)).rejects.toThrow("Reviewed helper");
  });
  it("produces identical bytes from the same inputs in a different source checkout", async () => {
    const source = await sourceCopy();
    const result = await buildVoicemailBundle(source, path.join(root, "other-checkout-output"), revision);
    expect(result.manifestSha256).toBe(pin);
  });
  it("refuses symlinked or group-writable source inputs", async () => {
    const source = await sourceCopy();
    const file = path.join(source, sourceFiles[0]);
    await chmod(file, 0o664);
    await expect(buildVoicemailBundle(source, path.join(root, "unsafe-source-output"), revision)).rejects.toThrow("Unsafe artifact");
    await unlink(file);
    await symlink(path.resolve(sourceFiles[0]), file);
    await expect(buildVoicemailBundle(source, path.join(root, "symlink-source-output"), revision)).rejects.toThrow("Source input");
  });
  it("emits syntactically valid unsigned programs without launching them", () => {
    for (const name of ["producer.mjs", "relay.mjs"])
      expect(execFileSync(process.execPath, ["--check", path.join(baseline, name)], { encoding: "utf8" })).toBe("");
  });
  it("verifies valid files without granting host, storage, secrets, deposit or commissioning readiness", async () => {
    const { bundle, plan } = await fixture();
    expect(await verifyVoicemailBundle(bundle, plan, pin)).toMatchObject({ fileChecksPassed: true,
      unsigned: true, activeHostVerified: false, durableStorageVerified: false, secretProvisioningVerified: false,
      depositVerified: false, commissioningApproved: false, rolloutApproved: false, planEvidenceSource: "caller_attestation" });
  });
  it.each(Object.keys(artifactModes))("refuses missing %s", async name => {
    const { bundle, plan } = await fixture();
    await unlink(path.join(bundle, name));
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Incomplete");
  });
  it("refuses extra files, including environment/credential packets", async () => {
    const { bundle, plan } = await fixture();
    await writeFile(path.join(bundle, ".env"), "fixture-not-a-secret");
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("extra");
  });
  it.each(Object.keys(artifactModes))("refuses %s digest drift", async name => {
    const { bundle, plan } = await fixture();
    await writeFile(path.join(bundle, name), "changed artifact\n");
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("digest drift");
  });
  it("refuses replacing the checksums alongside artifacts without the independent manifest pin", async () => {
    const { bundle, plan } = await fixture();
    await changeManifest(bundle, value => { value.sourceRevision = "a".repeat(40); });
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Manifest digest drift");
  });
  it("refuses wrong runtime paths even with a matching manifest digest", async () => {
    const { bundle, plan } = await fixture();
    const changedPin = await changeManifest(bundle, value => { value.runtimePaths.node = "/usr/bin/node"; });
    await expect(verifyVoicemailBundle(bundle, plan, changedPin)).rejects.toThrow("Wrong runtime paths");
  });
  it("refuses missing source digests or relaxed artifact modes in a newly pinned manifest", async () => {
    for (const mutate of [(value: any) => { delete value.inputs[sourceFiles[0]]; },
      (value: any) => { value.artifacts["producer.mjs"].mode = "0644"; }]) {
      const { bundle, plan } = await fixture();
      const changedPin = await changeManifest(bundle, mutate);
      await expect(verifyVoicemailBundle(bundle, plan, changedPin)).rejects.toThrow();
    }
  });
  it.each([0o644, 0o660, 0o4600])("refuses unsafe artifact mode %s", async mode => {
    const { bundle, plan } = await fixture();
    await chmod(path.join(bundle, "producer.mjs"), mode);
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Unsafe artifact");
  });
  it("refuses a non-executable runner", async () => {
    const { bundle, plan } = await fixture();
    await chmod(path.join(bundle, "runner.sh"), 0o600);
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Unsafe artifact");
  });
  it("refuses an unexpected bundle owner", async () => {
    const { bundle, plan } = await fixture();
    await expect(verifyVoicemailBundle(bundle, plan, pin, uid + 1)).rejects.toThrow("Unsafe bundle");
  });
  it("refuses unsafe bundle/plan-parent directory modes", async () => {
    const { bundle, plan } = await fixture();
    await chmod(bundle, 0o755);
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Unsafe bundle");
    await chmod(bundle, 0o700);
    await chmod(path.dirname(plan), 0o755);
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Unsafe plan");
  });
  it("refuses symlink and hardlink artifact substitution", async () => {
    const { bundle, plan } = await fixture();
    const file = path.join(bundle, "producer.mjs");
    await unlink(file);
    await symlink(path.join(baseline, "producer.mjs"), file);
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Unsafe artifact");
    await unlink(file);
    await link(path.join(baseline, "producer.mjs"), file);
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Unsafe artifact");
    await unlink(file);
  });
  it("refuses a symlinked bundle root", async () => {
    const { bundle, plan } = await fixture();
    const alias = path.join(path.dirname(bundle), "alias");
    await symlink(bundle, alias);
    await expect(verifyVoicemailBundle(alias, plan, pin)).rejects.toThrow("Resolved private paths");
  });
  it("rejects duplicate decoded JSON keys, including nested objects and Unicode escapes", () => {
    for (const raw of ['{"schema":1,"schema":2}', '{"a":{"ownerUid":1,"ownerUid":2}}', '{"a":1,"\\u0061":2}'])
      expect(() => parseContractJson(Buffer.from(raw))).toThrow("Duplicate");
    expect(parseContractJson(Buffer.from('{"a":[{"x":1},{"x":2}],"b":"a,b:c"}'))).toEqual({ a: [{ x: 1 }, { x: 2 }], b: "a,b:c" });
  });
});

describe("declared runtime plan fail-closed boundaries", () => {
  it.each(["sourceRoot", "outboxRoot", "mailboxRoots", "uploadUrl", "integrationSecretEnvironment", "runtimeUid", "filesystemContract"])("requires %s", key => {
    const plan: any = runtimePlan();
    delete plan[key];
    expect(() => validateRuntimePlan(plan)).toThrow();
  });
  it.each(["backendHookReady", "freeswitchHookReady"])("requires %s to remain off", key => {
    const plan: any = runtimePlan();
    plan[key] = true;
    expect(() => validateRuntimePlan(plan)).toThrow("flags not off");
  });
  it.each(["node", "flock", "runner", "producer", "relay", "legacyHelper", "depositHelper"])("pins the %s runtime path", key => {
    const plan: any = runtimePlan();
    plan.runtimePaths[key] += ".other";
    expect(() => validateRuntimePlan(plan)).toThrow("Wrong runtime paths");
  });
  it.each(["directoryMode", "fileMode", "fileSync", "directorySync", "exclusiveHardlinks", "ownerUid", "ownerGid"])("rejects unsafe %s assumption", key => {
    const plan: any = runtimePlan();
    plan.filesystemContract[key] = key.includes("Mode") ? "0755" : key.startsWith("owner") ? -1 : false;
    expect(() => validateRuntimePlan(plan)).toThrow("Unsafe filesystem");
  });
  it.each(["http://offline.example.test/api/recordings/voicemail", "https://offline.example.test/other", "https://offline.example.test/api/recordings/voicemail?x=1", "https://user:password@offline.example.test/api/recordings/voicemail"])("refuses incomplete/unsafe endpoint %s", uploadUrl => {
    expect(() => validateRuntimePlan({ ...runtimePlan(), uploadUrl })).toThrow("Exact upload");
  });
  it("refuses empty/ambiguous/unconfined mailbox maps and overlapping source/outbox roots", () => {
    for (const mailboxRoots of [{}, { "1:3001": "/elsewhere/3001" }, { "1:3001": "/private-voicemail-source/a", "2:3001": "/private-voicemail-source/a" },
      { "1:3001": "/private-voicemail-source/a", "2:3001": "/private-voicemail-source/a/b" }, { "01:3001": "/private-voicemail-source/a" }])
      expect(() => validateRuntimePlan({ ...runtimePlan(), mailboxRoots })).toThrow();
    expect(() => validateRuntimePlan({ ...runtimePlan(), outboxRoot: "/private-voicemail-source/outbox" })).toThrow();
  });
  it("does not accept secret values or extra fields", () => {
    expect(() => validateRuntimePlan({ ...runtimePlan(), FS_SHARED_SECRET: "fixture-only" })).toThrow("contract fields");
  });
  it("actually consumes and rejects the separate plan file", async () => {
    const { bundle, plan } = await fixture();
    await writeFile(plan, canonicalJson({ ...runtimePlan(), freeswitchHookReady: true }));
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("flags not off");
  });
  it("rejects public, missing or duplicate-field plan files", async () => {
    const { bundle, plan } = await fixture();
    await chmod(plan, 0o644);
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Unsafe artifact");
    await chmod(plan, 0o600);
    await writeFile(plan, '{"schema":1,"schema":2}');
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow("Duplicate");
    await unlink(plan);
    await expect(verifyVoicemailBundle(bundle, plan, pin)).rejects.toThrow();
  });
});
