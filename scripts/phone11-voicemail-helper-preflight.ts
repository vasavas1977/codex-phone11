#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SaxesParser } from "saxes";

export const reviewedRevision = "b13fd44014152378bbf6b100144b8035bb0b7cb5";
export const reviewedHelpers = {
  "phone11_legacy_voicemail.lua":
    "6883384f279e1e8876f8b312c8783b3101c18b65d190275fbb870c0bba6dcfad",
  "phone11_voicemail_deposit.lua":
    "9552b2c6692c70387fec4eb6f3b13487e2f0f2b69c713a928294670dd86a629b",
} as const;
type HelperName = keyof typeof reviewedHelpers;
type Status = "compatible" | "incompatible" | "unknown";
type FileInput = { bytes: Buffer } | { error: "missing" | "unreadable" };
type Evidence = {
  version: 1;
  scope: "target" | "staging";
  targetIdSha256: string;
  observedAt: string;
  modulesConfigSha256: string;
  backendHookReady: boolean | null;
  freeswitchHookReady: boolean | null;
  moduleProbeExit: number | null;
  luaModuleExists: boolean | null;
  helpers: {
    name: HelperName;
    readable: boolean | null;
    sha256: string | null;
  }[];
};
const names = Object.keys(reviewedHelpers) as HelperName[];
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nullableBoolean = (value: unknown) =>
  value === null || typeof value === "boolean";

function parseEvidence(value: unknown): Evidence | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "version",
      "scope",
      "targetIdSha256",
      "observedAt",
      "modulesConfigSha256",
      "backendHookReady",
      "freeswitchHookReady",
      "moduleProbeExit",
      "luaModuleExists",
      "helpers",
    ]) ||
    value.version !== 1 ||
    !["target", "staging"].includes(String(value.scope)) ||
    !isDigest(value.targetIdSha256) ||
    !isDigest(value.modulesConfigSha256) ||
    typeof value.observedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value.observedAt,
    ) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !nullableBoolean(value.backendHookReady) ||
    !nullableBoolean(value.freeswitchHookReady) ||
    !nullableBoolean(value.luaModuleExists) ||
    !(
      value.moduleProbeExit === null ||
      (Number.isSafeInteger(value.moduleProbeExit) &&
        Number(value.moduleProbeExit) >= 0 &&
        Number(value.moduleProbeExit) <= 255)
    ) ||
    !Array.isArray(value.helpers) ||
    value.helpers.length !== names.length
  )
    return null;
  const seen = new Set<string>();
  for (const helper of value.helpers) {
    if (
      !isRecord(helper) ||
      !exactKeys(helper, ["name", "readable", "sha256"]) ||
      !names.includes(helper.name as HelperName) ||
      seen.has(String(helper.name)) ||
      !nullableBoolean(helper.readable) ||
      !(helper.sha256 === null || isDigest(helper.sha256))
    )
      return null;
    seen.add(String(helper.name));
  }
  return value as Evidence;
}

function luaConfiguration(bytes: Buffer): Status {
  const stack: string[] = [];
  let rootValid = false;
  let luaLoads = 0;
  let unsupported = false;
  try {
    const parser = new SaxesParser();
    parser.on("doctype", () => {
      unsupported = true;
    });
    parser.on("processinginstruction", () => {
      unsupported = true;
    });
    parser.on("opentag", (tag) => {
      if (stack.length === 0)
        rootValid =
          tag.name === "configuration" &&
          tag.attributes.name === "modules.conf";
      if (
        Object.keys(tag.attributes).some(
          (key) => key.startsWith("xmlns") || key.includes(":"),
        )
      )
        unsupported = true;
      if (tag.name === "modules" && Object.keys(tag.attributes).length > 0)
        unsupported = true;
      if (
        tag.name === "load" &&
        tag.attributes.module === "mod_lua" &&
        stack.join("/") === "configuration/modules"
      ) {
        if (Object.keys(tag.attributes).length !== 1) unsupported = true;
        luaLoads++;
      }
      // Includes/conditional templates require separately resolved target configuration.
      if (tag.name.startsWith("X-") || tag.name.includes(":"))
        unsupported = true;
      stack.push(tag.name);
    });
    parser.on("closetag", () => {
      stack.pop();
    });
    parser.write(bytes.toString("utf8")).close();
    if (unsupported) return "unknown";
    return rootValid && luaLoads === 1 ? "compatible" : "incompatible";
  } catch {
    return "unknown";
  }
}

export type PreflightInputs = {
  kind: "target" | "staging";
  reviewed: Record<HelperName, [FileInput, FileInput]>;
  supplied: Record<HelperName, FileInput>;
  modulesConfig: FileInput;
  evidence: unknown;
  now: number;
};

/** Evaluates local snapshots only. Evidence is caller attestation, not live discovery. */
export function inspectVoicemailHelperInputs(input: PreflightInputs) {
  const issues: string[] = [];
  const checks: Status[] = [];
  const helpers = names.map((name) => {
    const source = input.reviewed[name];
    const sourceMatches = source.every(
      (file) => "bytes" in file && digest(file.bytes) === reviewedHelpers[name],
    );
    if (!sourceMatches) {
      issues.push(`${name}:reviewed_source_mismatch`);
      checks.push("incompatible");
    }
    const supplied = input.supplied[name];
    const sha256 = "bytes" in supplied ? digest(supplied.bytes) : null;
    const status: Status =
      "bytes" in supplied
        ? sha256 === reviewedHelpers[name]
          ? "compatible"
          : "incompatible"
        : supplied.error === "missing"
          ? "incompatible"
          : "unknown";
    if (status !== "compatible")
      issues.push(
        `${name}:${"bytes" in supplied ? "digest_mismatch" : supplied.error === "missing" ? "snapshot_missing" : "snapshot_unreadable"}`,
      );
    checks.push(status);
    return {
      name,
      reviewedSha256: reviewedHelpers[name],
      suppliedSha256: sha256,
      sourceMatches,
      status,
    };
  });
  const configStatus: Status =
    "bytes" in input.modulesConfig
      ? luaConfiguration(input.modulesConfig.bytes)
      : "unknown";
  const configSha256 =
    "bytes" in input.modulesConfig ? digest(input.modulesConfig.bytes) : null;
  checks.push(configStatus);
  if (configStatus !== "compatible")
    issues.push(
      configStatus === "unknown"
        ? "lua_configuration_unknown"
        : "lua_configuration_incompatible",
    );
  const evidence = parseEvidence(input.evidence);
  let luaStatus: Status = "unknown";
  let mode: "legacy" | "protected" | "mismatch" | "unknown" = "unknown";
  let evidenceBound = false;
  if (!evidence) issues.push("evidence_invalid_or_missing");
  else {
    const age = input.now - Date.parse(evidence.observedAt);
    const fresh =
      Number.isFinite(input.now) && age >= -60_000 && age <= 15 * 60_000;
    evidenceBound =
      evidence.scope === input.kind &&
      evidence.modulesConfigSha256 === configSha256 &&
      fresh;
    if (evidence.scope !== input.kind) {
      issues.push("evidence_scope_mismatch");
      checks.push("incompatible");
    }
    if (
      configSha256 !== null &&
      evidence.modulesConfigSha256 !== configSha256
    ) {
      issues.push("evidence_configuration_mismatch");
      checks.push("incompatible");
    }
    if (!fresh) {
      issues.push("evidence_stale_or_future");
      checks.push("unknown");
    }
    for (const helper of helpers) {
      const observed = evidence.helpers.find(
        (item) => item.name === helper.name,
      )!;
      if (observed.sha256 === null || observed.readable === null) {
        issues.push(`${helper.name}:runtime_evidence_unknown`);
        checks.push("unknown");
        evidenceBound = false;
      }
      if (observed.readable === false) {
        issues.push(`${helper.name}:runtime_unreadable`);
        checks.push("incompatible");
        evidenceBound = false;
      }
      if (
        observed.sha256 !== null &&
        observed.sha256 !== helper.suppliedSha256
      ) {
        issues.push(`${helper.name}:runtime_digest_mismatch`);
        checks.push("incompatible");
        evidenceBound = false;
      }
    }
    // Transport/command failure invalidates its boolean, including a recorded false.
    luaStatus =
      fresh &&
      evidence.scope === input.kind &&
      evidence.moduleProbeExit === 0 &&
      evidence.luaModuleExists !== null
        ? evidence.luaModuleExists
          ? "compatible"
          : "incompatible"
        : "unknown";
    if (
      fresh &&
      evidence.scope === input.kind &&
      evidence.backendHookReady !== null &&
      evidence.freeswitchHookReady !== null
    ) {
      mode =
        evidence.backendHookReady !== evidence.freeswitchHookReady
          ? "mismatch"
          : evidence.backendHookReady
            ? "protected"
            : "legacy";
    }
  }
  checks.push(
    luaStatus,
    mode === "unknown"
      ? "unknown"
      : mode === "mismatch"
        ? "incompatible"
        : "compatible",
  );
  if (luaStatus !== "compatible")
    issues.push(
      luaStatus === "unknown" ? "lua_runtime_unknown" : "lua_runtime_missing",
    );
  if (mode === "unknown" || mode === "mismatch")
    issues.push(`hook_mode_${mode}`);
  const overall: Status = checks.includes("incompatible")
    ? "incompatible"
    : checks.includes("unknown")
      ? "unknown"
      : "compatible";
  const helperRuntimeReady =
    input.kind === "target" && evidenceBound && overall === "compatible";
  return {
    event: "phone11.voicemail.helper.preflight",
    readOnly: true,
    evidenceSource: "caller_attestation",
    readinessScope: "helper_runtime_prerequisite_only",
    reviewedRevision,
    kind: input.kind,
    overall,
    helpers,
    configuration: { status: configStatus, sha256: configSha256 },
    runtime: { lua: luaStatus, evidenceBound },
    mode,
    helperRuntimeReady,
    flagOffRehearsalReady: helperRuntimeReady && mode === "legacy",
    commissioningApproved: false,
    rolloutApproved: false,
    issues: [...new Set(issues)].sort(),
  };
}

async function readSnapshot(path: string): Promise<FileInput> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024)
      return { error: "unreadable" };
    const bytes = Buffer.alloc(1024 * 1024 + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        size,
        bytes.length - size,
        null,
      );
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    return size > 1024 * 1024
      ? { error: "unreadable" }
      : { bytes: bytes.subarray(0, size) };
  } catch (error) {
    return {
      error:
        isRecord(error) && error.code === "ENOENT" ? "missing" : "unreadable",
    };
  } finally {
    await file?.close();
  }
}

export async function runVoicemailHelperPreflight(args: string[]) {
  const options = new Map<string, string>();
  const allowed = [
    "--kind",
    "--source-root",
    "--helpers-dir",
    "--modules-config",
    "--evidence",
  ];
  for (let index = 0; index < args.length; index += 2) {
    if (
      !allowed.includes(args[index]) ||
      !args[index + 1] ||
      options.has(args[index])
    )
      throw new Error("invalid_arguments");
    options.set(args[index], args[index + 1]);
  }
  const kind = options.get("--kind");
  if (
    (kind !== "target" && kind !== "staging") ||
    !options.get("--helpers-dir") ||
    !options.get("--modules-config") ||
    !options.get("--evidence")
  )
    throw new Error("invalid_arguments");
  const sourceRoot =
    options.get("--source-root") ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const reviewed = {} as PreflightInputs["reviewed"];
  const supplied = {} as PreflightInputs["supplied"];
  for (const name of names) {
    reviewed[name] = [
      await readSnapshot(join(sourceRoot, "deploy/freeswitch/scripts", name)),
      await readSnapshot(
        join(sourceRoot, "infra/configs/freeswitch/scripts", name),
      ),
    ];
    supplied[name] = await readSnapshot(
      join(options.get("--helpers-dir")!, name),
    );
  }
  const modulesConfig = await readSnapshot(options.get("--modules-config")!);
  const evidenceFile = await readSnapshot(options.get("--evidence")!);
  let evidence: unknown = null;
  try {
    if ("bytes" in evidenceFile)
      evidence = JSON.parse(evidenceFile.bytes.toString("utf8"));
  } catch {
    /* fixed issue only */
  }
  return inspectVoicemailHelperInputs({
    kind,
    reviewed,
    supplied,
    modulesConfig,
    evidence,
    now: Date.now(),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runVoicemailHelperPreflight(process.argv.slice(2))
    .then((result) => {
      console.info(JSON.stringify(result));
      process.exitCode =
        result.overall === "compatible"
          ? 0
          : result.overall === "unknown"
            ? 1
            : 2;
    })
    .catch(() => {
      console.info(
        JSON.stringify({
          event: "phone11.voicemail.helper.preflight",
          readOnly: true,
          overall: "unknown",
          helperRuntimeReady: false,
          commissioningApproved: false,
          rolloutApproved: false,
          issues: ["input_error"],
        }),
      );
      process.exitCode = 1;
    });
}
