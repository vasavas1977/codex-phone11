/** Offline content validation only. Never connects, restores, executes SQL, or authorizes an action. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const name = z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/);
const timestamp = z.string().datetime({ offset: true });
const target = z.object({
  hostIdentitySha256: hash, systemIdentifier: z.string().regex(/^[0-9]+$/),
  database: name, schema: name,
}).strict();
export const rehearsalSourceFiles = [
  "server/pbx/extension-tenant-legacy-default-prerequisites.sql",
  "server/pbx/advanced-routing-migration.sql",
  "server/pbx/pbx-router.ts",
  "server/pbx/ivr-router.ts",
  "server/pbx/tenant-middleware.ts",
  "server/phone-provisioning.ts",
  "scripts/phone11-pbx-schema-preflight.ts",
  "scripts/phone11-pbx-local-writer-rehearsal.ts",
  "scripts/phone11-pbx-rehearsal-readiness.ts",
] as const;
const source = z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/),
  files: z.object(Object.fromEntries(rehearsalSourceFiles.map(path => [path, hash]))).strict(),
}).strict();
const prestate = z.object({ tenantType: z.literal("integer"), tenantNullable: z.literal(true),
  tenantDefault: z.literal("1"), tenantForeignKey: z.literal("absent"),
  advancedTables: z.literal("absent"), nullAssignments: z.literal(0), orphanAssignments: z.literal(0),
}).strict();
const principal = z.object({ id: name, owner: name, accessSha256: hash,
  login: z.literal(true), superuser: z.literal(false), bypassRls: z.literal(false),
  createRole: z.literal(false), createDatabase: z.literal(false),
}).strict();
const artifact = z.object({ id: name, purpose: z.enum(["active", "rollback"]),
  imageSha256: hash, bundleSha256: hash, routesSha256: hash,
  principalIds: z.array(name).min(1),
}).strict();
const writerInventory = z.object({ evidenceSha256: hash,
  principals: z.array(principal).min(1), artifacts: z.array(artifact).min(2),
  // These are accountable audit assertions, never inferred from literal SQL or pg_stat_activity.
  auditedBoundaries: z.object({ hostLoopback: z.literal(true), externalClients: z.literal(true),
    scheduledAndManualJobs: z.literal(true), dormantEntrypoints: z.literal(true),
    dynamicSql: z.literal(true), databaseFunctionsAndTriggers: z.literal(true),
    credentialHolders: z.literal(true), activeAndRollbackRoutes: z.literal(true),
  }).strict(),
}).strict();
const clone = z.object({ kind: z.literal("protected_target_clone"), target,
  originSnapshotSha256: hash, accessProfileSha256: hash, provenanceEvidenceSha256: hash,
  controls: z.object({ isolatedNetwork: z.literal(true), providerEgressBlocked: z.literal(true),
    protectedStorage: z.literal(true), customerDataExportProhibited: z.literal(true),
    ownersAclsRolesAndTriggersPreserved: z.literal(true),
  }).strict(),
}).strict();
export const rehearsalCases = ["admin_create_tenant_a", "admin_create_tenant_b",
  "provision_create_tenant_a", "provision_create_tenant_b", "omitted_tenant_rejected",
  "fresh_initializer", "partial_initializer", "application_role_access",
  "cross_tenant_rejected", "application_rollback", "backup_restore"] as const;
const core = z.object({ version: z.literal(1), runId: name, source,
  origin: z.object({ target, snapshotSha256: hash, catalogSha256: hash, accessProfileSha256: hash, prestate }).strict(),
  clone, writerInventory,
  rollback: z.object({ artifactIds: z.array(name).min(1), backupEvidenceSha256: hash,
    originSnapshotSha256: hash, restoreTarget: target, restorePlanSha256: hash, protectedRestoreRequired: z.literal(true),
  }).strict(),
  procedure: z.object({ order: z.tuple([z.literal("legacy_default"), z.literal("advanced"), z.literal("preflight")]),
    freshIdleConnections: z.literal(true), independentTransactions: z.literal(true),
    legacyDefaultAcknowledgementRequired: z.literal(true), compatiblePreflightRequired: z.literal(true),
    perArtifactCases: z.array(z.object({ artifactId: name, cases: z.array(z.enum(rehearsalCases)) }).strict()).min(2),
    stopOnFailure: z.literal(true), activationProhibited: z.literal(true),
  }).strict(),
}).strict();
const approval = z.object({ actor: name, action: z.literal("protected_clone_rehearsal_review_only"),
  planSha256: hash, evidenceSha256: hash, issuedAt: timestamp, expiresAt: timestamp,
}).strict();
const planSchema = z.object({ plan: core, operatorAuthority: approval, independentReview: approval }).strict();
const observationSchema = z.object({ observedAt: timestamp, evidenceSha256: hash,
  origin: core.shape.origin, clone, writerInventory, source, rollback: core.shape.rollback,
  consumedRunIds: z.array(name),
}).strict();
export type RehearsalPlan = z.infer<typeof planSchema>;
export type RehearsalObservation = z.infer<typeof observationSchema>;
export type SourcePins = z.infer<typeof source>;

/** Sorted keys make authority binding independent of JSON formatting and key order. */
export function rehearsalPlanSha256(value: unknown): string {
  function canonical(item: unknown): string {
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.keys(item).sort().map(key =>
      `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`).join(",")}}`;
    throw new Error("Non-JSON plan value");
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function readRehearsalSourcePins(repo: string): SourcePins {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  try { execFileSync("git", ["diff", "--quiet", "HEAD", "--"], { cwd: repo, stdio: "ignore" }); }
  catch { throw new Error("Uncommitted rehearsal source"); }
  const files = Object.fromEntries(rehearsalSourceFiles.map(path => {
    const bytes = readFileSync(resolve(repo, path));
    const committed = execFileSync("git", ["show", `${commit}:${path}`], { cwd: repo, stdio: ["ignore", "pipe", "ignore"] });
    if (!bytes.equals(committed)) throw new Error("Uncommitted rehearsal source");
    return [path, createHash("sha256").update(bytes).digest("hex")];
  }));
  return source.parse({ commit, files });
}

export function validateRehearsalReadiness(planInput: unknown, observationInput: unknown,
  currentSource: SourcePins, now: Date) {
  const parsedPlan = planSchema.safeParse(planInput), parsedObservation = observationSchema.safeParse(observationInput);
  const issues: string[] = [];
  if (!parsedPlan.success) issues.push("plan_shape_or_required_boundary");
  if (!parsedObservation.success) issues.push("observation_shape_or_required_boundary");
  if (!source.safeParse(currentSource).success) issues.push("current_source_shape");
  if (!Number.isFinite(now.getTime())) issues.push("current_time_invalid");
  if (issues.length) return report(issues);
  const input = parsedPlan.data!, observation = parsedObservation.data!, plan = input.plan;
  const equal = (a: unknown, b: unknown) => rehearsalPlanSha256(a) === rehearsalPlanSha256(b);
  const bind = (label: string, a: unknown, b: unknown) => { if (!equal(a, b)) issues.push(label); };
  bind("origin_changed", plan.origin, observation.origin);
  bind("clone_changed", plan.clone, observation.clone);
  bind("writer_inventory_changed", plan.writerInventory, observation.writerInventory);
  bind("rollback_changed", plan.rollback, observation.rollback);
  bind("observed_source_changed", plan.source, observation.source);
  bind("local_source_changed", plan.source, currentSource);
  if (plan.origin.snapshotSha256 !== plan.clone.originSnapshotSha256) issues.push("clone_origin_snapshot_mismatch");
  if (plan.origin.accessProfileSha256 !== plan.clone.accessProfileSha256) issues.push("clone_access_profile_mismatch");
  if (plan.rollback.originSnapshotSha256 !== plan.origin.snapshotSha256) issues.push("rollback_origin_snapshot_mismatch");
  bind("rollback_restore_target_mismatch", plan.rollback.restoreTarget, plan.clone.target);
  if (plan.origin.target.hostIdentitySha256 === plan.clone.target.hostIdentitySha256 ||
      plan.origin.target.systemIdentifier === plan.clone.target.systemIdentifier) issues.push("clone_is_origin_or_not_independent");
  if (plan.origin.target.schema !== plan.clone.target.schema) issues.push("clone_schema_mismatch");
  const observedAt = Date.parse(observation.observedAt);
  if (observedAt > now.getTime() || now.getTime() - observedAt > 15 * 60_000) issues.push("observation_not_current");
  if (new Set(observation.consumedRunIds).size !== observation.consumedRunIds.length) issues.push("consumption_ledger_duplicate");
  if (observation.consumedRunIds.includes(plan.runId)) issues.push("run_id_already_consumed");
  const digest = rehearsalPlanSha256(plan);
  for (const [label, authority] of [["operator", input.operatorAuthority], ["reviewer", input.independentReview]] as const) {
    if (authority.planSha256 !== digest) issues.push(`${label}_plan_binding_mismatch`);
    const issuedAt = Date.parse(authority.issuedAt), expiresAt = Date.parse(authority.expiresAt);
    if (issuedAt > now.getTime() || expiresAt <= now.getTime() || expiresAt <= issuedAt ||
        expiresAt - issuedAt > 60 * 60_000) issues.push(`${label}_authority_not_current`);
  }
  if (input.operatorAuthority.actor === input.independentReview.actor) issues.push("reviewer_not_independent");
  const principals = plan.writerInventory.principals.map(p => p.id), artifacts = plan.writerInventory.artifacts;
  if (new Set(principals).size !== principals.length) issues.push("duplicate_principal");
  if (new Set(artifacts.map(a => a.id)).size !== artifacts.length) issues.push("duplicate_artifact");
  if (!artifacts.some(a => a.purpose === "active")) issues.push("active_artifact_missing");
  const rollbackIds = artifacts.filter(a => a.purpose === "rollback").map(a => a.id).sort();
  if (!rollbackIds.length || !equal(rollbackIds, [...plan.rollback.artifactIds].sort())) issues.push("rollback_set_mismatch");
  for (const artifact of artifacts) {
    if (artifact.principalIds.some(id => !principals.includes(id)) ||
        new Set(artifact.principalIds).size !== artifact.principalIds.length) issues.push("artifact_principal_mapping_invalid");
  }
  if (principals.some(id => !artifacts.some(a => a.principalIds.includes(id)))) issues.push("unmapped_writer_principal");
  const cases = plan.procedure.perArtifactCases;
  if (cases.length !== artifacts.length || new Set(cases.map(c => c.artifactId)).size !== cases.length) issues.push("artifact_case_coverage_invalid");
  for (const artifact of artifacts) {
    const item = cases.find(c => c.artifactId === artifact.id);
    if (!item || !equal([...item.cases].sort(), [...rehearsalCases].sort())) issues.push("required_artifact_case_missing");
  }
  return report(issues);
}

function report(issues: string[]) {
  return { event: "phone11.pbx.rehearsal.readiness", offline: true, authorityVerified: false,
    actionAuthorized: false, activationAuthorized: false, requiresActionTimeOperatorApproval: true,
    status: issues.length ? "blocked" as const : "eligible_for_operator_review" as const,
    issues: [...new Set(issues)].sort(),
    limits: "Content and pin validation only; supplied evidence and authority provenance require independent human verification. No target connection, clone, migration, rollback or activation was performed.",
  };
}

export function readPrivateRehearsalManifest(path: string) {
  if (!path || resolve(path) !== path) throw new Error("Absolute private manifest required");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600 || stat.size > 256 * 1024) throw new Error("Protected metadata manifest required");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateRehearsalReadiness(
      readPrivateRehearsalManifest(process.env.PHONE11_PBX_REHEARSAL_PLAN ?? ""),
      readPrivateRehearsalManifest(process.env.PHONE11_PBX_REHEARSAL_OBSERVATION ?? ""),
      readRehearsalSourcePins(resolve(dirname(fileURLToPath(import.meta.url)), "..")), new Date());
    console.info(JSON.stringify(result));
    if (result.status === "blocked") process.exitCode = 2;
  } catch {
    // No path, imported metadata, database address or credential is echoed.
    console.error(JSON.stringify({ event: "phone11.pbx.rehearsal.readiness", status: "blocked", actionAuthorized: false,
      issues: ["private_manifest_or_local_source_read_failed"] }));
    process.exitCode = 2;
  }
}
