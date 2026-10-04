import { execFileSync } from "node:child_process";
import { chmodSync, linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPrivateRehearsalManifest, readRehearsalSourcePins, rehearsalCases, rehearsalPlanSha256, rehearsalSourceFiles,
  validateRehearsalReadiness } from "../scripts/phone11-pbx-rehearsal-readiness";

const now = new Date("2026-10-04T09:00:00Z");
const digest = (label: string) => rehearsalPlanSha256(label);
function fixture() {
  const source = { commit: "a".repeat(40), files: Object.fromEntries(rehearsalSourceFiles.map(p => [p, digest(p)])) };
  const plan = {
    version: 1, runId: "protected-clone-20261004-1", source,
    origin: { target: { hostIdentitySha256: digest("origin-host"), systemIdentifier: "123456789", database: "phone11ai", schema: "public" },
      snapshotSha256: digest("snapshot"), catalogSha256: digest("catalog"), accessProfileSha256: digest("access"),
      prestate: { tenantType: "integer", tenantNullable: true, tenantDefault: "1", tenantForeignKey: "absent", advancedTables: "absent", nullAssignments: 0, orphanAssignments: 0 } },
    clone: { kind: "protected_target_clone", target: { hostIdentitySha256: digest("clone-host"), systemIdentifier: "987654321", database: "phone11_pbx_clone", schema: "public" },
      originSnapshotSha256: digest("snapshot"), accessProfileSha256: digest("access"), provenanceEvidenceSha256: digest("clone-provenance"),
      controls: { isolatedNetwork: true, providerEgressBlocked: true, protectedStorage: true, customerDataExportProhibited: true, ownersAclsRolesAndTriggersPreserved: true } },
    writerInventory: { evidenceSha256: digest("writers"),
      auditedBoundaries: { hostLoopback: true, externalClients: true, scheduledAndManualJobs: true, dormantEntrypoints: true, dynamicSql: true, databaseFunctionsAndTriggers: true, credentialHolders: true, activeAndRollbackRoutes: true },
      principals: [{ id: "backend-login", owner: "backend-owner", accessSha256: digest("backend-role"), login: true, superuser: false, bypassRls: false, createRole: false, createDatabase: false }],
      artifacts: ["active", "rollback"].map(purpose => ({ id: `${purpose}-backend`, purpose, imageSha256: digest(`${purpose}-image`), bundleSha256: digest(`${purpose}-bundle`), routesSha256: digest(`${purpose}-routes`), principalIds: ["backend-login"] })) },
    rollback: { artifactIds: ["rollback-backend"], backupEvidenceSha256: digest("backup"), originSnapshotSha256: digest("snapshot"),
      restoreTarget: { hostIdentitySha256: digest("clone-host"), systemIdentifier: "987654321", database: "phone11_pbx_clone", schema: "public" },
      restorePlanSha256: digest("restore"), protectedRestoreRequired: true },
    procedure: { order: ["legacy_default", "advanced", "preflight"], freshIdleConnections: true, independentTransactions: true,
      legacyDefaultAcknowledgementRequired: true, compatiblePreflightRequired: true, stopOnFailure: true, activationProhibited: true,
      perArtifactCases: ["active-backend", "rollback-backend"].map(artifactId => ({ artifactId, cases: [...rehearsalCases] })) },
  };
  const approval = { action: "protected_clone_rehearsal_review_only", planSha256: rehearsalPlanSha256(plan), evidenceSha256: digest("authority"), issuedAt: "2026-10-04T08:50:00Z", expiresAt: "2026-10-04T09:10:00Z" };
  const input = { plan, operatorAuthority: { ...approval, actor: "operator" }, independentReview: { ...approval, actor: "reviewer" } };
  const observation = structuredClone({ observedAt: "2026-10-04T08:55:00Z", evidenceSha256: digest("observation"), origin: plan.origin, clone: plan.clone,
    source, writerInventory: plan.writerInventory, rollback: plan.rollback, consumedRunIds: [] as string[] });
  return { input, observation, source: structuredClone(source) };
}

function rebind(input: ReturnType<typeof fixture>["input"]) {
  input.operatorAuthority.planSha256 = input.independentReview.planSha256 = rehearsalPlanSha256(input.plan);
}
describe("PBX offline rehearsal content admission", () => {
  it("complete synthetic test metadata is eligible only for independent operator review", () => {
    const { input, observation, source } = fixture();
    const result = validateRehearsalReadiness(input, observation, source, now);
    expect(result.status).toBe("eligible_for_operator_review");
    expect(result.issues).toEqual([]);
    expect(result).toMatchObject({ authorityVerified: false, actionAuthorized: false, activationAuthorized: false, requiresActionTimeOperatorApproval: true });
  });
  it("binds approvals to deterministic JSON content rather than formatting or key insertion order", () => {
    expect(rehearsalPlanSha256({ a: [1, true], b: { x: "a" } })).toBe(rehearsalPlanSha256({ b: { x: "a" }, a: [1, true] }));
    expect(() => rehearsalPlanSha256({ a: undefined })).toThrow();
  });
  it.each(["tenantDefault", "tenantNullable", "advancedTables", "nullAssignments", "orphanAssignments"])("refuses changed %s prestate even with rebound approval", field => {
    const { input, observation, source } = fixture();
    (input.plan.origin.prestate as Record<string, unknown>)[field] = "changed";
    rebind(input);
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toContain("plan_shape_or_required_boundary");
  });
  it.each(["origin", "clone", "writerInventory", "rollback", "source"])("refuses changed current %s evidence", section => {
    const { input, observation, source } = fixture();
    if (section === "origin") observation.origin.catalogSha256 = digest("changed");
    if (section === "clone") observation.clone.provenanceEvidenceSha256 = digest("changed");
    if (section === "writerInventory") observation.writerInventory.artifacts[0].bundleSha256 = digest("changed");
    if (section === "rollback") observation.rollback.backupEvidenceSha256 = digest("changed");
    if (section === "source") observation.source.files[rehearsalSourceFiles[0]] = digest("changed");
    expect(validateRehearsalReadiness(input, observation, source, now).status).toBe("blocked");
  });
  it("refuses substituted local SQL digests", () => {
    const { input, observation, source } = fixture();
    source.files[rehearsalSourceFiles[0]] = digest("wrong SQL");
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toContain("local_source_changed");
  });
  it("refuses a synthetic fixture promoted to protected clone", () => {
    const { input, observation, source } = fixture();
    input.plan.clone.kind = "synthetic_local";
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toContain("plan_shape_or_required_boundary");
  });
  it.each(["hostIdentitySha256", "systemIdentifier"])("refuses original-target reuse through matching %s", key => {
    const { input, observation, source } = fixture();
    input.plan.clone.target[key as "systemIdentifier"] = input.plan.origin.target[key as "systemIdentifier"];
    observation.clone = structuredClone(input.plan.clone); rebind(input);
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toContain("clone_is_origin_or_not_independent");
  });
  it("refuses cross-target snapshot and access-profile binding", () => {
    const { input, observation, source } = fixture();
    input.plan.clone.originSnapshotSha256 = digest("other target"); input.plan.clone.accessProfileSha256 = digest("ACLs stripped");
    observation.clone = structuredClone(input.plan.clone); rebind(input);
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toEqual(expect.arrayContaining(["clone_origin_snapshot_mismatch", "clone_access_profile_mismatch"]));
  });
  it("refuses a rebound rollback against a different database or snapshot", () => {
    const { input, observation, source } = fixture();
    input.plan.rollback.restoreTarget.database = "other_db"; input.plan.rollback.originSnapshotSha256 = digest("other_snapshot");
    observation.rollback = structuredClone(input.plan.rollback); rebind(input);
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toEqual(expect.arrayContaining(["rollback_restore_target_mismatch", "rollback_origin_snapshot_mismatch"]));
  });
  it.each(["hostLoopback", "externalClients", "dormantEntrypoints", "dynamicSql"])("refuses unclosed writer boundary %s", key => {
    const { input, observation, source } = fixture();
    (input.plan.writerInventory.auditedBoundaries as Record<string, boolean>)[key] = false;
    expect(validateRehearsalReadiness(input, observation, source, now).status).toBe("blocked");
  });
  it.each(["superuser", "bypassRls", "createRole", "createDatabase"])("refuses privileged writer %s", key => {
    const { input, observation, source } = fixture();
    (input.plan.writerInventory.principals[0] as Record<string, unknown>)[key] = true;
    expect(validateRehearsalReadiness(input, observation, source, now).status).toBe("blocked");
  });
  it("refuses unmapped external principal and incomplete rollback case coverage", () => {
    const { input, observation, source } = fixture();
    input.plan.writerInventory.principals.push({ ...input.plan.writerInventory.principals[0], id: "external-login" });
    input.plan.rollback.artifactIds = ["missing-rollback"];
    input.plan.procedure.perArtifactCases[1].cases.pop();
    observation.writerInventory = structuredClone(input.plan.writerInventory); observation.rollback = structuredClone(input.plan.rollback); rebind(input);
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toEqual(expect.arrayContaining(["unmapped_writer_principal", "rollback_set_mismatch", "required_artifact_case_missing"]));
  });
  it("refuses stale or self-reviewed authority and reused run IDs", () => {
    const { input, observation, source } = fixture();
    input.operatorAuthority.expiresAt = "2026-10-04T09:00:00Z";
    input.independentReview.actor = input.operatorAuthority.actor;
    observation.consumedRunIds.push(input.plan.runId);
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toEqual(expect.arrayContaining(["operator_authority_not_current", "reviewer_not_independent", "run_id_already_consumed"]));
  });
  it("refuses changed plan after authority was recorded", () => {
    const { input, observation, source } = fixture(); input.plan.runId = "next-run";
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toEqual(expect.arrayContaining(["operator_plan_binding_mismatch", "reviewer_plan_binding_mismatch"]));
  });
  it.each(["2026-10-04T08:44:59Z", "2026-10-04T09:00:01Z"])("refuses observation outside current window %s", observedAt => {
    const { input, observation, source } = fixture(); observation.observedAt = observedAt;
    expect(validateRehearsalReadiness(input, observation, source, now).issues).toContain("observation_not_current");
  });
  it("rejects extra credentials or unrecognized manifest properties without echoing them", () => {
    const { input, observation, source } = fixture(); const secret = "secret-credential-value";
    const result = validateRehearsalReadiness({ ...input, password: secret }, observation, source, now);
    expect(result.status).toBe("blocked"); expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("opens only bounded owner-private regular manifest files without following links", () => {
    const root = mkdtempSync(join(tmpdir(), "p11-pbx-manifest-")), path = join(root, "manifest.json");
    try {
      writeFileSync(path, '{"metadata":"synthetic"}', { mode: 0o600 });
      expect(readPrivateRehearsalManifest(path)).toEqual({ metadata: "synthetic" });
      chmodSync(path, 0o644); expect(() => readPrivateRehearsalManifest(path)).toThrow(); chmodSync(path, 0o600);
      symlinkSync(path, join(root, "symlink.json")); expect(() => readPrivateRehearsalManifest(join(root, "symlink.json"))).toThrow();
      linkSync(path, join(root, "hardlink.json")); expect(() => readPrivateRehearsalManifest(path)).toThrow(); rmSync(join(root, "hardlink.json"));
      writeFileSync(path, " ".repeat(256 * 1024 + 1)); expect(() => readPrivateRehearsalManifest(path)).toThrow();
      expect(() => readPrivateRehearsalManifest("relative.json")).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("hashes committed real source bytes and rejects dirty source instead of claiming commit equivalence", () => {
    const root = mkdtempSync(join(tmpdir(), "p11-pbx-source-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      for (const path of rehearsalSourceFiles) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), `fixture ${path}\n`); }
      execFileSync("git", ["add", "."], { cwd: root });
      execFileSync("git", ["-c", "user.name=PBX fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Synthetic source fixture"], { cwd: root });
      const pins = readRehearsalSourcePins(root); expect(pins.commit).toMatch(/^[a-f0-9]{40}$/);
      writeFileSync(join(root, rehearsalSourceFiles[0]), "changed SQL\n");
      expect(() => readRehearsalSourcePins(root)).toThrow("Uncommitted rehearsal source");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
