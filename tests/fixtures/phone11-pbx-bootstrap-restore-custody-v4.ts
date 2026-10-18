import { createHash } from "node:crypto";
import { BOOTSTRAP_RESTORE_CUSTODY_SCHEMA_V4, BOOTSTRAP_RESTORE_PG_IMAGE_V4, BOOTSTRAP_RESTORE_SOURCE_SYSTEM_V4 } from "../../scripts/phone11-pbx-clone/bootstrap-restore-custody-v4";
const ATTEMPT = "a1".repeat(16), RUN = "b2".repeat(16), UID = 999, GID = 999;
const ROOT = `/var/lib/phone11-pbx-bootstrap-restore/${ATTEMPT}`;
const H = "c3".repeat(32), PG_ID = "d4".repeat(32), WORKER_ID = "e5".repeat(32), WORKER_IMAGE = `sha256:${"f6".repeat(32)}`;
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)]));
  return v;
}
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
export function bootstrapRestoreFixture() {
  const directory = (path: string, uid = UID, gid = GID) => ({ path, uid, gid, mode: 0o700, directory: true, symlink: false, fresh: true });
  const archive = (name: string, bytes: number) => ({ path: `${ROOT}/${name}`, sha256: H, bytes, uid: 0, gid: 0, mode: 0o400, regular: true, links: 1 });
  const bind = (source: string, target: string, rw: boolean) => ({ type: "bind", source, target, rw });
  const tmpfs = () => ({ type: "tmpfs", source: "", target: "/tmp", rw: true, bytes: 67108864, uid: UID, gid: GID, mode: 0o700, nosuid: true, nodev: true, noexec: true });
  const engine = (pg: boolean) => ({ id: pg ? PG_ID : WORKER_ID, name: pg ? `phone11-bootstrap-restore-${ATTEMPT}` : `phone11-protected-worker-${ATTEMPT}`, imageId: pg ? BOOTSTRAP_RESTORE_PG_IMAGE_V4 : WORKER_IMAGE, running: true, network: "none", readOnlyRoot: true, privileged: false, capDrop: ["ALL"], noNewPrivileges: true, publishedPorts: [] as unknown[], user: `${UID}:${GID}`, restartPolicy: "no", memoryBytes: 536870912, memorySwapBytes: 536870912, cpus: "0.5", pidsLimit: 128, logDriver: "none", mounts: pg ? [bind(`${ROOT}/data`, "/var/lib/postgresql/data", true), bind(`${ROOT}/socket`, "/var/run/postgresql", true), bind(`${ROOT}/secrets`, "/run/phone11-clone-secrets", false), tmpfs()] : [bind(`${ROOT}/socket`, "/run/phone11-pbx-clone/socket", true), tmpfs()] });
  const catalog = Object.fromEntries(["owners", "acl", "roles", "memberships", "triggers", "functions", "constraints", "defaults"].map((name, i) => [name, { records: i + 1, sha256: digest({ mockCanonicalCategory: name }) }])) as Record<string, { records: number; sha256: string }>;
  const observation = {
    schema: BOOTSTRAP_RESTORE_CUSTODY_SCHEMA_V4, attemptId: ATTEMPT, runId: RUN, purpose: "RESTORE_METADATA_CONSISTENCY_ONLY", sourceSystemIdentifier: BOOTSTRAP_RESTORE_SOURCE_SYSTEM_V4, cloneSystemIdentifier: "7638134557377753123", snapshotBacked: true, freshSyntheticOnly: false, rolePasswordsCopied: false, credentialEquivalence: false, runtimeAuthority: false, productionAcceptance: false,
    archives: { backup: { ...archive("origin.dump", 123456), customerDataProtected: true, credentialMaterialMayBePresent: true }, roles: { ...archive("origin-roles.sql", 54321), rolePasswordsIncluded: false } },
    custody: { runDirectory: directory(ROOT, 0, 0), data: directory(`${ROOT}/data`), socket: directory(`${ROOT}/socket`), secrets: directory(`${ROOT}/secrets`), secretLeaves: ["password", "pgpass", "pg_hba.conf", "runtime-password"].map(name => ({ path: `${ROOT}/secrets/${name}`, uid: UID, gid: GID, mode: 0o400, regular: true, links: 1, cloneOnly: true })) },
    pg: engine(true), worker: engine(false),
    pristineSemantics: { canonicalization: "phone11-catalog-semantics-component-arrays/v2", comparisonPhase: "POST_RESTORE_PRE_RUNTIME_ROLE", excludedCustodian: `p11_clone_custodian_${ATTEMPT.slice(0, 16)}`, sourceAbsentBefore: true, sourceBefore: structuredClone(catalog), sourceAfter: structuredClone(catalog), restored: structuredClone(catalog) },
    pristineRestoreReceiptSha256: H, pristineObservedAtMs: Date.now() - 1000, currentObservedAtMs: Date.now(), intentionalDeltaReceiptSha256: H, intentionalDeltaSemanticsSha256: "a7".repeat(32),
    sourceCensusRole: { login: "phone11ai", sourceSystemIdentifier: BOOTSTRAP_RESTORE_SOURCE_SYSTEM_V4, superuser: true, restricted: false },
    restrictedLogin: { attemptId: ATTEMPT, runId: RUN, cloneSystemIdentifier: "7638134557377753123", sessionUser: `p11_clone_runtime_${ATTEMPT}`, currentUser: `p11_clone_runtime_${ATTEMPT}`, loginObserved: true, authenticationMethod: "password", nonOwner: true, ownedObjectCount: 0, schemaCreate: false, databaseCreate: false, privilegedMembership: false, sourceLoginEquivalent: false, attributes: { login: true, superuser: false, bypassRls: false, createDb: false, createRole: false, replication: false, inherits: false }, memberships: [] as string[] },
  };
  const expected = { attemptId: ATTEMPT, runId: RUN, observationSha256: digest(observation), pgImageId: BOOTSTRAP_RESTORE_PG_IMAGE_V4, workerImageId: WORKER_IMAGE, pgContainerId: PG_ID, workerContainerId: WORKER_ID, pgUid: UID, pgGid: GID, backupSha256: H, backupBytes: 123456, rolesSha256: H, rolesBytes: 54321, sourceSemanticsSha256: digest(catalog), restrictedLoginSha256: digest(observation.restrictedLogin) };
  const claim = { observationSha256: expected.observationSha256, observerAuthority: false, runtimeAuthority: false, productionAcceptance: false };
  return { observation, expected, claim };
}
