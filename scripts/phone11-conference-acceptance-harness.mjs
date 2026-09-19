#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** The signed build that this operator run is allowed to accept. */
export const CURRENT_BUILD_ID = "a8bbfe6b-2e3f-4ff4-9843-562d1117b930";
export const HARNESS_SCHEMA_VERSION = 1;

export const REQUIRED_CHECKS = Object.freeze([
  { id: "authorized_two_member_join", label: "Authorized two-member join" },
  { id: "local_remote_av", label: "Local and remote audio/video" },
  { id: "listener_receive_only", label: "Listener receive-only" },
  {
    id: "permission_denied_receive_only",
    label: "Permission-denied receive-only",
  },
  { id: "reconnect", label: "Reconnect" },
  { id: "background_foreground", label: "Background and foreground" },
  { id: "sip_conference_boundary", label: "SIP/conference media boundary" },
  { id: "leave_cleanup", label: "Leave cleanup" },
  {
    id: "eviction_disconnect_remint_denial",
    label: "Eviction disconnect and remint denial",
  },
  { id: "no_auto_dispatch", label: "No agent/interpreter auto-dispatch" },
]);

const sensitiveKey =
  /(?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token|room|identity|endpoint|url|sip(?:[_-]?uri)?|phone(?:[_-]?number)?|email|meeting(?:[_-]?id)?|participant(?:[_-]?id)?)/iu;
const sensitiveText = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu,
  /\b(?:https?|wss?|sip):\/\/[^\s"'<>]+/giu,
  /\b(?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token|room|identity)\s*[:=]\s*[^\s,;]+/giu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
];

function scrubText(value) {
  return sensitiveText.reduce(
    (text, pattern) => text.replace(pattern, "[REDACTED]"),
    value,
  );
}

/**
 * Keep evidence useful to a reviewer while removing accidental secrets and
 * provider coordinates. This is intentionally applied before report output.
 */
export function redactEvidence(value, key = "") {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((entry) => redactEvidence(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactEvidence(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function checkStatus(value) {
  if (value === true || value === "PASS") return "PASS";
  if (value === false || value === "FAIL") return "FAIL";
  if (value && typeof value === "object") {
    if (value.status === "PASS" || value.status === "FAIL") return value.status;
    if (value.pass === true || value.pass === false)
      return value.pass ? "PASS" : "FAIL";
  }
  return "FAIL";
}

function evidenceFor(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return redactEvidence(value.evidence ?? value.note ?? value);
  }
  return redactEvidence(value);
}

function deviceResult(device, label) {
  const input = device && typeof device === "object" ? device : {};
  const installed = input.installed === true;
  const version = typeof input.version === "string" ? input.version.trim() : "";
  const buildId = typeof input.buildId === "string" ? input.buildId.trim() : "";
  const pass = installed && version.length > 0 && buildId === CURRENT_BUILD_ID;
  const reasons = [];
  if (!installed) reasons.push("app is not installed");
  if (!version) reasons.push("app version is missing");
  if (buildId !== CURRENT_BUILD_ID)
    reasons.push("signed build ID does not match the acceptance build");
  return {
    id: label,
    status: pass ? "PASS" : "FAIL",
    installed,
    version: redactEvidence(version || "[missing]", "version"),
    buildId:
      buildId === CURRENT_BUILD_ID
        ? CURRENT_BUILD_ID
        : buildId
          ? "[mismatch]"
          : "[missing]",
    evidence: redactEvidence(
      input.evidence ?? "Operator-confirmed installation and version screen.",
    ),
    failure: reasons.length ? reasons.join("; ") : undefined,
  };
}

function normalizeCheck(input, descriptor) {
  const status = checkStatus(input);
  const evidence = evidenceFor(input);
  const hasEvidence =
    typeof evidence === "string"
      ? evidence.trim().length > 0
      : evidence !== undefined && evidence !== null;
  return {
    id: descriptor.id,
    label: descriptor.label,
    status: status === "PASS" && !hasEvidence ? "FAIL" : status,
    evidence: hasEvidence ? evidence : "[missing operator evidence]",
    ...(status === "PASS" && !hasEvidence
      ? { failure: "PASS requires operator evidence." }
      : {}),
  };
}

/**
 * Build a structured, manual-only acceptance report. No provider, auth,
 * device, or network API is called; all observations come from `input`.
 */
export function createAcceptanceReport(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const devices =
    source.devices && typeof source.devices === "object" ? source.devices : {};
  const deviceResults = {
    iphone_a: deviceResult(devices.iphone_a, "iphone_a"),
    iphone_b: deviceResult(devices.iphone_b, "iphone_b"),
  };
  const observations =
    source.checks && typeof source.checks === "object" ? source.checks : {};
  const checks = REQUIRED_CHECKS.map((descriptor) =>
    normalizeCheck(observations[descriptor.id], descriptor),
  );
  const devicePass = Object.values(deviceResults).every(
    (device) => device.status === "PASS",
  );
  const pass = devicePass && checks.every((check) => check.status === "PASS");
  const failures = [
    ...Object.values(deviceResults)
      .filter((device) => device.status === "FAIL")
      .map((device) => ({ id: device.id, reason: device.failure })),
    ...checks
      .filter((check) => check.status === "FAIL")
      .map((check) => ({
        id: check.id,
        reason: check.failure ?? "Operator reported FAIL or omitted the check.",
      })),
  ];

  return {
    event: "phone11.conference.acceptance",
    schemaVersion: HARNESS_SCHEMA_VERSION,
    mode: "manual-device-observation",
    pass,
    buildId: CURRENT_BUILD_ID,
    devices: deviceResults,
    checks,
    failures,
    safety: {
      networkCalls: "none",
      credentials: "not accepted",
      providerRoomOrIdentity: "not accepted",
      autoDispatch: "must be proven by no_auto_dispatch",
    },
    generatedAt: new Date().toISOString(),
  };
}

export function template() {
  return {
    buildId: CURRENT_BUILD_ID,
    devices: {
      iphone_a: {
        installed: false,
        version: "",
        buildId: CURRENT_BUILD_ID,
        evidence: "",
      },
      iphone_b: {
        installed: false,
        version: "",
        buildId: CURRENT_BUILD_ID,
        evidence: "",
      },
    },
    checks: Object.fromEntries(
      REQUIRED_CHECKS.map(({ id }) => [id, { status: "FAIL", evidence: "" }]),
    ),
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/phone11-conference-acceptance-harness.mjs --template",
    "  node scripts/phone11-conference-acceptance-harness.mjs --input <evidence.json> [--output <report.json>]",
    "",
    "The harness reads only a local JSON evidence file and performs no network calls.",
  ].join("\n");
}

function cli(argv) {
  if (argv.includes("--help")) {
    console.log(usage());
    return 0;
  }
  if (argv.includes("--template")) {
    console.log(JSON.stringify(template(), null, 2));
    return 0;
  }
  const inputIndex = argv.indexOf("--input");
  if (inputIndex < 0 || !argv[inputIndex + 1]) {
    console.error(usage());
    return 2;
  }
  const outputIndex = argv.indexOf("--output");
  try {
    const input = JSON.parse(
      readFileSync(resolve(argv[inputIndex + 1]), "utf8"),
    );
    const report = createAcceptanceReport(input);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (outputIndex >= 0 && argv[outputIndex + 1])
      writeFileSync(resolve(argv[outputIndex + 1]), serialized, "utf8");
    else process.stdout.write(serialized);
    return report.pass ? 0 : 1;
  } catch {
    console.error(
      "FAIL: could not read the local evidence JSON; no network or provider access was attempted.",
    );
    return 2;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url))
  process.exitCode = cli(process.argv.slice(2));
