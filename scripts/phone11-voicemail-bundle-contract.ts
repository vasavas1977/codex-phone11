/** Offline artifact contract only; these declarations never establish host readiness. */
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";

export const bundleSchema = "phone11-voicemail-bundle/v1";
export const planSchema = "phone11-voicemail-runtime-plan/v1";
export const runtimePaths = {
  node: "/usr/local/bin/node",
  flock: "/usr/bin/flock",
  runner: "/opt/phone11ai/voicemail/runner.sh",
  producer: "/opt/phone11ai/voicemail/producer.mjs",
  relay: "/opt/phone11ai/voicemail/relay.mjs",
  legacyHelper: "/etc/freeswitch/scripts/phone11_legacy_voicemail.lua",
  depositHelper: "/etc/freeswitch/scripts/phone11_voicemail_deposit.lua",
} as const;
export const artifactModes = {
  "producer.mjs": "0600",
  "relay.mjs": "0600",
  "runner.sh": "0700",
  "phone11_legacy_voicemail.lua": "0600",
  "phone11_voicemail_deposit.lua": "0600",
} as const;
export const sourceFiles = [
  "scripts/phone11-voicemail-producer.ts",
  "scripts/phone11-voicemail-relay.ts",
  "scripts/phone11-voicemail-runner.sh",
  "deploy/freeswitch/scripts/phone11_legacy_voicemail.lua",
  "deploy/freeswitch/scripts/phone11_voicemail_deposit.lua",
  "infra/configs/freeswitch/scripts/phone11_legacy_voicemail.lua",
  "infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua",
] as const;
export type ArtifactName = keyof typeof artifactModes;
export type BundleManifest = {
  schema: typeof bundleSchema;
  sourceRevision: string;
  builder: { esbuildVersion: string; nodeTarget: "node22" };
  runtimePaths: typeof runtimePaths;
  inputs: Record<string, string>;
  artifacts: Record<ArtifactName, { sha256: string; size: number; mode: string }>;
};
export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export function requireContract(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  requireContract(value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"), "Invalid contract fields");
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sorted(v)]));
  return value;
}
export const canonicalJson = (value: unknown) => JSON.stringify(sorted(value)) + "\n";

/** JSON.parse checks syntax; track decoded object keys before accepting its last-key-wins result. */
export function parseContractJson(bytes: Buffer): unknown {
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(raw);
  const stack: { object: boolean; key: boolean; seen: Set<string> }[] = [];
  const tokens = raw.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
  for (const token of tokens) {
    if (token === "{" || token === "[") stack.push({ object: token === "{", key: token === "{", seen: new Set() });
    else if (token === "}" || token === "]") stack.pop();
    else {
      const top = stack.at(-1);
      if (!top?.object) continue;
      if (token === ",") top.key = true;
      else if (token === ":") top.key = false;
      else if (top.key && token.startsWith('"')) {
        const key = JSON.parse(token) as string;
        requireContract(!top.seen.has(key), "Duplicate contract field");
        top.seen.add(key);
      }
    }
  }
  return value;
}
function unchanged(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.mode === after.mode &&
    before.uid === after.uid && before.gid === after.gid && before.nlink === after.nlink;
}
/** Refuse symlinks/hardlinks and concurrent replacement. Never print file contents on error. */
export async function readArtifact(file: string, uid: number, mode?: string): Promise<Buffer> {
  const before = await lstat(file);
  requireContract(before.isFile() && before.nlink === 1 && before.uid === uid &&
    before.size > 0 && before.size <= 4 * 1024 * 1024 &&
    (mode ? (before.mode & 0o7777) === parseInt(mode, 8) : (before.mode & 0o022) === 0), "Unsafe artifact file");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    requireContract(unchanged(before, await handle.stat()), "Artifact changed");
    const bytes = await handle.readFile();
    requireContract(unchanged(before, await handle.stat()) && unchanged(before, await lstat(file)), "Artifact changed");
    return bytes;
  } finally { await handle.close(); }
}
