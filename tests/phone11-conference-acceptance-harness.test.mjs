import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CURRENT_BUILD_ID,
  REQUIRED_CHECKS,
  createAcceptanceReport,
  redactEvidence,
  template,
} from "../scripts/phone11-conference-acceptance-harness.mjs";

const passingChecks = Object.fromEntries(
  REQUIRED_CHECKS.map(({ id }) => [
    id,
    { status: "PASS", evidence: `${id} observed on both phones.` },
  ]),
);

function passingInput() {
  return {
    buildId: CURRENT_BUILD_ID,
    devices: {
      iphone_a: {
        installed: true,
        version: "1.0.0",
        buildId: CURRENT_BUILD_ID,
        evidence: "Settings screen checked.",
      },
      iphone_b: {
        installed: true,
        version: "1.0.0",
        buildId: CURRENT_BUILD_ID,
        evidence: "Settings screen checked.",
      },
    },
    checks: passingChecks,
  };
}

test("the harness requires the complete two-iPhone conference matrix", () => {
  assert.deepEqual(
    REQUIRED_CHECKS.map(({ id }) => id),
    [
      "authorized_two_member_join",
      "local_remote_av",
      "listener_receive_only",
      "permission_denied_receive_only",
      "reconnect",
      "background_foreground",
      "sip_conference_boundary",
      "leave_cleanup",
      "eviction_disconnect_remint_denial",
      "no_auto_dispatch",
    ],
  );
  assert.equal(Object.keys(template().checks).length, REQUIRED_CHECKS.length);
});

test("a complete, matching-build observation produces structured PASS evidence", () => {
  const report = createAcceptanceReport(passingInput());
  assert.equal(report.pass, true);
  assert.equal(report.buildId, CURRENT_BUILD_ID);
  assert.deepEqual(report.devices.iphone_a.status, "PASS");
  assert.deepEqual(report.devices.iphone_b.status, "PASS");
  assert.ok(report.checks.every((check) => check.status === "PASS"));
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.safety, {
    networkCalls: "none",
    credentials: "not accepted",
    providerRoomOrIdentity: "not accepted",
    autoDispatch: "must be proven by no_auto_dispatch",
  });
});

test("missing or mismatched evidence is a FAIL with explicit check IDs", () => {
  const input = passingInput();
  input.devices.iphone_b.buildId = "old-build";
  delete input.checks.reconnect;
  input.checks.no_auto_dispatch = {
    status: "FAIL",
    evidence: "An interpreter started.",
  };
  const report = createAcceptanceReport(input);
  assert.equal(report.pass, false);
  assert.ok(report.failures.some(({ id }) => id === "iphone_b"));
  assert.ok(report.failures.some(({ id }) => id === "reconnect"));
  assert.ok(report.failures.some(({ id }) => id === "no_auto_dispatch"));
});

test("redaction removes credentials and provider room or identity values", () => {
  const raw = {
    note: "Connected to wss://media.example.test/room/secret-room",
    accessToken: "eyJheader.payload.signature",
    provider: { room: "secret-room", identity: "secret-identity" },
    nested: "Bearer very-secret-value; token=also-secret",
  };
  const redacted = redactEvidence(raw);
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(
    serialized,
    /secret-room|secret-identity|very-secret-value|also-secret|eyJheader/,
  );
  assert.match(serialized, /\[REDACTED\]/);
});

test("a malformed device build value is not copied into the report", () => {
  const input = passingInput();
  input.devices.iphone_b.buildId = "room=secret-room token=secret-token";
  const report = createAcceptanceReport(input);
  assert.equal(report.devices.iphone_b.buildId, "[mismatch]");
  assert.doesNotMatch(JSON.stringify(report), /secret-room|secret-token/);
});

test("the harness has no automatic network client", () => {
  const source = readFileSync(
    new URL(
      "../scripts/phone11-conference-acceptance-harness.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(?:fetch|axios|WebSocket|XMLHttpRequest)\s*\(/,
  );
  assert.doesNotMatch(source, /node:(?:http|https|net|tls)/);
});
