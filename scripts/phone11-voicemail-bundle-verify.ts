#!/usr/bin/env node
/** Verify unsigned local files and a caller-declared plan. No host, network or media access. */
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifactModes, bundleSchema, canonicalJson, exactKeys, parseContractJson, planSchema,
  readArtifact, requireContract, runtimePaths, sha256, sourceFiles } from "./phone11-voicemail-bundle-contract";

const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identity = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function absolute(value: unknown): value is string {
  return typeof value === "string" && path.isAbsolute(value) && value === path.normalize(value) &&
    value !== path.parse(value).root && !/[\u0000-\u001f\u007f\\]/.test(value);
}
function checkRuntimePaths(value: unknown) {
  exactKeys(value, Object.keys(runtimePaths));
  requireContract(Object.entries(runtimePaths).every(([key, expected]) => value[key] === expected), "Wrong runtime paths");
}
export function validateRuntimePlan(value: unknown): void {
  exactKeys(value, ["schema", "runtimeUid", "runtimeGid", "nodeMajor", "runtimePaths", "sourceRoot", "outboxRoot",
    "mailboxRoots", "uploadUrl", "integrationSecretEnvironment", "backendHookReady", "freeswitchHookReady", "filesystemContract"]);
  requireContract(value.schema === planSchema && identity(value.runtimeUid) && identity(value.runtimeGid) &&
    value.nodeMajor === 22, "Invalid runtime identity");
  checkRuntimePaths(value.runtimePaths);
  requireContract(absolute(value.sourceRoot) && absolute(value.outboxRoot) && value.sourceRoot !== value.outboxRoot &&
    !value.outboxRoot.startsWith(value.sourceRoot + path.sep) && !value.sourceRoot.startsWith(value.outboxRoot + path.sep), "Invalid source/outbox paths");
  requireContract(value.mailboxRoots !== null && typeof value.mailboxRoots === "object" && !Array.isArray(value.mailboxRoots) &&
    Object.keys(value.mailboxRoots).length > 0, "Trusted mailbox map required");
  const mailboxPaths: string[] = [];
  for (const [key, root] of Object.entries(value.mailboxRoots as Record<string, unknown>)) {
    const [tenant, extension, extra] = key.split(":");
    requireContract(extra === undefined && /^[1-9][0-9]*$/.test(tenant) && Number.isSafeInteger(Number(tenant)) &&
      /^[1-9][0-9]{0,15}$/.test(extension ?? "") && absolute(root) && root.startsWith(value.sourceRoot + path.sep), "Invalid trusted mailbox map");
    requireContract(mailboxPaths.every(other => root !== other && !root.startsWith(other + path.sep) &&
      !other.startsWith(root + path.sep)), "Ambiguous mailbox roots");
    mailboxPaths.push(root);
  }
  requireContract(typeof value.uploadUrl === "string", "Exact upload endpoint required");
  const url = new URL(value.uploadUrl);
  requireContract(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === "/api/recordings/voicemail", "Exact upload endpoint required");
  requireContract(value.integrationSecretEnvironment === "FS_SHARED_SECRET" && value.backendHookReady === false &&
    value.freeswitchHookReady === false, "Incomplete configuration or flags not off");
  exactKeys(value.filesystemContract, ["ownerUid", "ownerGid", "directoryMode", "fileMode", "fileSync", "directorySync", "exclusiveHardlinks"]);
  const fs = value.filesystemContract;
  requireContract(fs.ownerUid === value.runtimeUid && fs.ownerGid === value.runtimeGid && fs.directoryMode === "0700" &&
    fs.fileMode === "0600" && fs.fileSync === true && fs.directorySync === true && fs.exclusiveHardlinks === true,
  "Unsafe filesystem assumptions");
}

export async function verifyVoicemailBundle(bundle: string, plan: string, manifestSha256: string, expectedUid = process.getuid!()) {
  requireContract(hash(manifestSha256) && identity(expectedUid) && absolute(bundle) && absolute(plan), "Exact private bundle pins required");
  requireContract(await realpath(bundle) === bundle && await realpath(path.dirname(plan)) === path.dirname(plan), "Resolved private paths required");
  const before = await lstat(bundle);
  requireContract(before.isDirectory() && before.uid === expectedUid && (before.mode & 0o7777) === 0o700, "Unsafe bundle directory");
  const planParent = await lstat(path.dirname(plan));
  requireContract(planParent.isDirectory() && planParent.uid === expectedUid && (planParent.mode & 0o7777) === 0o700, "Unsafe plan directory");
  const entries = await readdir(bundle);
  requireContract(entries.sort().join("\0") === [...Object.keys(artifactModes), "manifest.json"].sort().join("\0"), "Incomplete or extra bundle artifacts");
  const raw = await readArtifact(path.join(bundle, "manifest.json"), expectedUid, "0600");
  requireContract(sha256(raw) === manifestSha256, "Manifest digest drift");
  const manifest = parseContractJson(raw);
  exactKeys(manifest, ["schema", "sourceRevision", "builder", "runtimePaths", "inputs", "artifacts"]);
  requireContract(raw.equals(Buffer.from(canonicalJson(manifest))), "Manifest must be canonical");
  requireContract(manifest.schema === bundleSchema && typeof manifest.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(manifest.sourceRevision), "Invalid source revision");
  exactKeys(manifest.builder, ["esbuildVersion", "typescriptVersion", "nodeTarget"]);
  requireContract(typeof manifest.builder.esbuildVersion === "string" && /^\d+\.\d+\.\d+$/.test(manifest.builder.esbuildVersion) &&
    manifest.builder.nodeTarget === "node22", "Wrong builder target");
  requireContract(typeof manifest.builder.typescriptVersion === "string" && /^\d+\.\d+\.\d+$/.test(manifest.builder.typescriptVersion), "Wrong dependency parser");
  checkRuntimePaths(manifest.runtimePaths);
  exactKeys(manifest.inputs, sourceFiles);
  requireContract(Object.values(manifest.inputs).every(hash), "Invalid input digests");
  exactKeys(manifest.artifacts, Object.keys(artifactModes));
  for (const [name, mode] of Object.entries(artifactModes)) {
    const item = manifest.artifacts[name];
    exactKeys(item, ["sha256", "size", "mode"]);
    requireContract(hash(item.sha256) && Number.isSafeInteger(item.size) && Number(item.size) > 0 && item.mode === mode, "Invalid artifact contract");
    const bytes = await readArtifact(path.join(bundle, name), expectedUid, mode);
    requireContract(bytes.length === item.size && sha256(bytes) === item.sha256, "Artifact digest drift");
  }
  validateRuntimePlan(parseContractJson(await readArtifact(plan, expectedUid, "0600")));
  const after = await lstat(bundle);
  requireContract(before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
    before.uid === after.uid && before.gid === after.gid && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
  "Bundle directory changed");
  return { event: "phone11.voicemail.bundle.verify", scope: "offline_artifact_and_declared_plan_only",
    manifestSha256, sourceRevision: manifest.sourceRevision, unsigned: true, fileChecksPassed: true,
    planEvidenceSource: "caller_attestation", activeHostVerified: false, durableStorageVerified: false,
    secretProvisioningVerified: false, depositVerified: false, commissioningApproved: false, rolloutApproved: false } as const;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const fields = ["--bundle", "--runtime-plan", "--manifest-sha256"];
  if (args.length !== 6 || fields.some((flag, index) => args[index * 2] !== flag)) {
    process.stderr.write("Usage: phone11-voicemail-bundle-verify --bundle ABS --runtime-plan ABS --manifest-sha256 SHA64\n");
    process.exitCode = 1;
  } else {
    verifyVoicemailBundle(args[1], args[3], args[5]).then(result => {
      process.stdout.write(canonicalJson(result));
    }).catch(() => {
      process.stderr.write("Voicemail offline verification refused\n");
      process.exitCode = 1;
    });
  }
}
