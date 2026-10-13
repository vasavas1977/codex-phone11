import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RESTORE_CUSTODY_SCHEMA_V3, RESTORE_PG_IMAGE_V3, RESTORE_SOURCE_SYSTEM_V3, RESTORE_SOURCE_CONTAINER_V3, validateRestoreCustodyV3 } from "../scripts/phone11-pbx-clone/restore-custody-v3";

const ATTEMPT = "a1".repeat(16), RUN = "b2".repeat(16), UID = 999, GID = 999;
const ROOT = `/var/lib/phone11-pbx-protected-baseline/${ATTEMPT}`;
const H = "c3".repeat(32), PG_ID = "d4".repeat(32), WORKER_ID = "e5".repeat(32), WORKER_IMAGE = `sha256:${"f6".repeat(32)}`;
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)]));
  return v;
}
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
function fixture() {
  const directory = (path: string, uid = UID, gid = GID) => ({ path, uid, gid, mode: 0o700, directory: true, symlink: false, fresh: true });
  const archive = (name: string, bytes: number) => ({ path: `${ROOT}/${name}`, sha256: H, bytes, uid: 0, gid: 0, mode: 0o400, regular: true, links: 1 });
  const bind = (source: string, target: string, rw: boolean) => ({ type: "bind", source, target, rw });
  const tmpfs = () => ({ type: "tmpfs", source: "", target: "/tmp", rw: true, bytes: 67108864, uid: UID, gid: GID, mode: 0o700, nosuid: true, nodev: true, noexec: true });
  const engine = (pg: boolean) => ({ id: pg ? PG_ID : WORKER_ID, name: `phone11-protected-${pg ? "baseline" : "worker"}-${ATTEMPT}`, imageId: pg ? RESTORE_PG_IMAGE_V3 : WORKER_IMAGE, running: true, network: "none", readOnlyRoot: true, privileged: false, capDrop: ["ALL"], noNewPrivileges: true, publishedPorts: [] as unknown[], user: `${UID}:${GID}`, restartPolicy: "no", memoryBytes: 536870912, memorySwapBytes: 536870912, cpus: "0.5", pidsLimit: 128, logDriver: "none", mounts: pg ? [bind(`${ROOT}/data`, "/var/lib/postgresql/data", true), bind(`${ROOT}/socket`, "/var/run/postgresql", true), bind(`${ROOT}/secrets`, "/run/phone11-clone-secrets", false), tmpfs()] : [bind(`${ROOT}/socket`, "/run/phone11-pbx-clone/socket", true), tmpfs()] });
  const catalog = Object.fromEntries(["owners", "acl", "roles", "memberships", "triggers", "functions", "constraints", "defaults"].map((name, i) => [name, { records: i + 1, sha256: digest({ mockCanonicalCategory: name }) }])) as Record<string, { records: number; sha256: string }>;
  const observation = {
    schema: RESTORE_CUSTODY_SCHEMA_V3, attemptId: ATTEMPT, runId: RUN, purpose: "RESTORE_METADATA_CONSISTENCY_ONLY", sourceSystemIdentifier: RESTORE_SOURCE_SYSTEM_V3, cloneSystemIdentifier: "7638134557377753123", snapshotBacked: true, freshSyntheticOnly: false, rolePasswordsCopied: false, credentialEquivalence: false, runtimeAuthority: false, productionAcceptance: false,
    archives: { backup: { ...archive("origin.dump", 123456), customerDataProtected: true, credentialMaterialMayBePresent: true }, roles: { ...archive("origin-roles.sql", 54321), rolePasswordsIncluded: false } },
    custody: { runDirectory: directory(ROOT, 0, 0), data: directory(`${ROOT}/data`), socket: directory(`${ROOT}/socket`), secrets: directory(`${ROOT}/secrets`), secretLeaves: ["password", "pgpass", "pg_hba.conf", "runtime-password"].map(name => ({ path: `${ROOT}/secrets/${name}`, uid: UID, gid: GID, mode: 0o400, regular: true, links: 1, cloneOnly: true })) },
    pg: engine(true), worker: engine(false),
    semantics: { canonicalization: "phone11-catalog-semantics-without-oids/v1", comparisonPhase: "POST_RESTORE_PRE_RUNTIME_ROLE", excludedCustodian: `p11_clone_custodian_${ATTEMPT.slice(0, 16)}`, sourceAbsentBefore: true, sourceBefore: structuredClone(catalog), sourceAfter: structuredClone(catalog), restored: structuredClone(catalog) },
    sourceCensusRole: { login: "phone11ai", sourceSystemIdentifier: RESTORE_SOURCE_SYSTEM_V3, superuser: true, restricted: false },
    restrictedLogin: { attemptId: ATTEMPT, runId: RUN, cloneSystemIdentifier: "7638134557377753123", sessionUser: `p11_clone_runtime_${ATTEMPT}`, currentUser: `p11_clone_runtime_${ATTEMPT}`, loginObserved: true, authenticationMethod: "password", nonOwner: true, ownedObjectCount: 0, schemaCreate: false, databaseCreate: false, privilegedMembership: false, sourceLoginEquivalent: false, attributes: { login: true, superuser: false, bypassRls: false, createDb: false, createRole: false, replication: false, inherits: false }, memberships: [] as string[] },
  };
  const expected = { attemptId: ATTEMPT, runId: RUN, observationSha256: digest(observation), pgImageId: RESTORE_PG_IMAGE_V3, workerImageId: WORKER_IMAGE, pgContainerId: PG_ID, workerContainerId: WORKER_ID, pgUid: UID, pgGid: GID, backupSha256: H, backupBytes: 123456, rolesSha256: H, rolesBytes: 54321, sourceSemanticsSha256: digest(catalog), restrictedLoginSha256: digest(observation.restrictedLogin) };
  const claim = { observationSha256: expected.observationSha256, observerAuthority: false, runtimeAuthority: false, productionAcceptance: false };
  return { observation, expected, claim };
}
type Fixture = ReturnType<typeof fixture>;
function rebind(f: Fixture): void { f.expected.observationSha256 = digest(f.observation); f.claim.observationSha256 = f.expected.observationSha256; }
function validate(f = fixture()) { return validateRestoreCustodyV3(f.claim, f.observation, f.expected); }

describe("restored clone v3 consistency only; mock observations confer no runtime authority", () => {
  it("accepts the exact two-container mock restored context and returns explicit false authority", () => {
    const result = validate(); expect(Object.isFrozen(result)).toBe(true);
    expect(fixture().observation.archives.backup).toMatchObject({ customerDataProtected: true, credentialMaterialMayBePresent: true });
    expect(fixture().observation.archives.roles.rolePasswordsIncluded).toBe(false);
    expect(result).not.toHaveProperty("passwordsCopied");
    expect(result).toEqual({ consistencyOnly: true, observationSha256: fixture().expected.observationSha256, observerAuthority: false, runtimeAuthority: false, productionAcceptance: false, credentialEquivalence: false, rolePasswordsCopied: false, customerDataProtected: true, credentialMaterialMayBePresent: true });
  });
  it.each([
    ["same origin system identifier", (f: Fixture) => { f.observation.cloneSystemIdentifier = RESTORE_SOURCE_SYSTEM_V3; }],
    ["wrong source system identifier", f => { f.observation.sourceSystemIdentifier = "1"; }],
    ["synthetic relabel", f => { f.observation.freshSyntheticOnly = true; }],
    ["not snapshot backed", f => { f.observation.snapshotBacked = false; }],
    ["copied PostgreSQL role passwords", f => { f.observation.rolePasswordsCopied = true; }],
    ["credential equivalence", f => { f.observation.credentialEquivalence = true; }],
    ["runtime authority", f => { f.observation.runtimeAuthority = true; }],
    ["production acceptance", f => { f.observation.productionAcceptance = true; }],
    ["cross run", f => { f.observation.runId = "c3".repeat(16); }],
    ["cross attempt", f => { f.observation.attemptId = "d4".repeat(16); }],
    ["foreign PG container", f => { f.observation.pg.id = H; }],
    ["production container relabeled clone", f => { f.expected.pgContainerId = RESTORE_SOURCE_CONTAINER_V3; f.observation.pg.id = RESTORE_SOURCE_CONTAINER_V3; }],
    ["foreign worker image", f => { f.observation.worker.imageId = `sha256:${H}`; }],
    ["bridge network", f => { f.observation.pg.network = "bridge"; }],
    ["worker network", f => { f.observation.worker.network = "host"; }],
    ["published port", f => { f.observation.pg.publishedPorts.push(5432); }],
    ["privileged worker", f => { f.observation.worker.privileged = true; }],
    ["capability", f => { f.observation.pg.capDrop.push("SYS_ADMIN"); }],
    ["new privileges", f => { f.observation.worker.noNewPrivileges = false; }],
    ["writable root", f => { f.observation.pg.readOnlyRoot = false; }],
    ["unbounded memory", f => { f.observation.worker.memoryBytes = 0; }],
    ["restart", f => { f.observation.pg.restartPolicy = "always"; }],
    ["worker UID cannot use0700 socket", f => { f.observation.worker.user = "10001:10001"; }],
    ["production data mount", f => { f.observation.pg.mounts[0].source = "/var/lib/docker/volumes/phone11_postgres_data/_data"; }],
    ["docker socket mount", f => { f.observation.worker.mounts[0].source = "/var/run/docker.sock"; }],
    ["extra mount", f => { f.observation.worker.mounts.push({ ...f.observation.worker.mounts[0] }); }],
    ["worker mounts secrets", f => { f.observation.worker.mounts[0].source = `${ROOT}/secrets`; }],
    ["private root mode", f => { f.observation.custody.runDirectory.mode = 0o755; }],
    ["private root owner", f => { f.observation.custody.runDirectory.uid = UID; }],
    ["private socket mode", f => { f.observation.custody.socket.mode = 0o770; }],
    ["old data directory", f => { f.observation.custody.data.fresh = false; }],
    ["symlink secrets", f => { f.observation.custody.secrets.symlink = true; }],
    ["secret hardlink", f => { f.observation.custody.secretLeaves[0].links = 2; }],
    ["role archive passwords", f => { f.observation.archives.roles.rolePasswordsIncluded = true; }],
    ["backup substitution", f => { f.observation.archives.backup.sha256 = "e5".repeat(32); }],
    ["role archive size", f => { f.observation.archives.roles.bytes++; }],
    ["backup private mode", f => { f.observation.archives.backup.mode = 0o644; }],
    ["source census relabeled restricted", f => { f.observation.sourceCensusRole.superuser = false; f.observation.sourceCensusRole.restricted = true; }],
    ["clone superuser", f => { f.observation.restrictedLogin.attributes.superuser = true; }],
    ["clone bypass", f => { f.observation.restrictedLogin.attributes.bypassRls = true; }],
    ["clone createdb", f => { f.observation.restrictedLogin.attributes.createDb = true; }],
    ["clone createrole", f => { f.observation.restrictedLogin.attributes.createRole = true; }],
    ["clone privileged membership", f => { f.observation.restrictedLogin.memberships.push("pg_write_server_files"); }],
    ["clone owner", f => { f.observation.restrictedLogin.ownedObjectCount = 1; }],
    ["login not observed", f => { f.observation.restrictedLogin.loginObserved = false; }],
    ["trust authentication", f => { f.observation.restrictedLogin.authenticationMethod = "trust"; }],
    ["cross run login", f => { f.observation.restrictedLogin.runId = "e5".repeat(16); }],
    ["source equivalence login", f => { f.observation.restrictedLogin.sourceLoginEquivalent = true; }],
    ["source baseline drift", f => { f.observation.semantics.sourceAfter.functions.sha256 = H; }],
    ["restored ownership drift", f => { f.observation.semantics.restored.owners.sha256 = H; }],
    ["role flags drift", f => { f.observation.semantics.restored.roles.sha256 = H; }],
    ["membership drift", f => { f.observation.semantics.restored.memberships.records++; }],
    ["OID equality comparison", f => { f.observation.semantics.canonicalization = "oids-match"; }],
    ["broaden custodian exclusion", f => { f.observation.semantics.excludedCustodian = "p11_clone_*"; }],
    ["preexisting source custodian", f => { f.observation.semantics.sourceAbsentBefore = false; }],
  ] as [string, (f: Fixture) => void][]) ("refuses %s despite an internally recomputed observation hash", (_label, mutate) => {
    const f = fixture(); mutate(f); rebind(f); expect(() => validate(f)).toThrow(/^RESTORE_CUSTODY_REFUSED$/);
  });
  it("rejects forged equal digest strings against separately pinned source semantics", () => {
    const f = fixture(); for (const catalog of [f.observation.semantics.sourceBefore, f.observation.semantics.sourceAfter, f.observation.semantics.restored]) catalog.functions.sha256 = H;
    rebind(f); expect(() => validate(f)).toThrow("RESTORE_CUSTODY_REFUSED");
  });
  it("requires independent expected observation and login pins", () => {
    const f = fixture(); f.claim.observationSha256 = H; expect(() => validate(f)).toThrow("RESTORE_CUSTODY_REFUSED");
    const role = fixture(); role.expected.restrictedLoginSha256 = H; expect(() => validate(role)).toThrow("RESTORE_CUSTODY_REFUSED");
  });
  it("rejects secret and unknown fields without reflecting their contents", () => {
    const f = fixture(); Object.assign(f.observation.restrictedLogin, { password: "PRIVATE_SECRET" });
    expect(() => validateRestoreCustodyV3(f.claim, f.observation, f.expected)).toThrow(/^RESTORE_CUSTODY_REFUSED$/);
    expect(() => validateRestoreCustodyV3(f.claim, { ...fixture().observation, password: "PRIVATE_SECRET" }, f.expected)).toThrow(/^RESTORE_CUSTODY_REFUSED$/);
    for (const key of ["customerDataProtected", "credentialMaterialMayBePresent"] as const) {
      const material = fixture(); material.observation.archives.backup[key] = false; rebind(material);
      expect(() => validate(material)).toThrow(/^RESTORE_CUSTODY_REFUSED$/);
    }
    const falseAbsence = fixture(); Object.assign(falseAbsence.observation.archives.backup, { rolePasswordsIncluded: false }); rebind(falseAbsence);
    expect(() => validate(falseAbsence)).toThrow(/^RESTORE_CUSTODY_REFUSED$/);
    const universalAbsence = fixture(); Object.assign(universalAbsence.observation, { passwordsCopied: false }); rebind(universalAbsence);
    expect(() => validate(universalAbsence)).toThrow(/^RESTORE_CUSTODY_REFUSED$/);
  });
  it("never invokes getters on expected or nested observations", () => {
    const f = fixture(), get = vi.fn(() => "PRIVATE_SECRET"); Object.defineProperty(f.observation.pg, "network", { enumerable: true, get });
    expect(() => validate(f)).toThrow(/^RESTORE_CUSTODY_REFUSED$/); expect(get).not.toHaveBeenCalled();
    const e = fixture(); Object.defineProperty(e.expected, "pgUid", { enumerable: true, get }); expect(() => validate(e)).toThrow("RESTORE_CUSTODY_REFUSED"); expect(get).not.toHaveBeenCalled();
  });
  it("rejects proxies before executing traps, prototype and symbol substitution", () => {
    const trap = vi.fn(() => { throw new Error("PRIVATE_SECRET"); }), f = fixture();
    expect(() => validateRestoreCustodyV3(f.claim, new Proxy(f.observation, { ownKeys: trap, getPrototypeOf: trap }), f.expected)).toThrow("RESTORE_CUSTODY_REFUSED"); expect(trap).not.toHaveBeenCalled();
    const proto = fixture(); Object.setPrototypeOf(proto.observation.pg, null); expect(() => validate(proto)).toThrow("RESTORE_CUSTODY_REFUSED");
    const symbol = fixture(); Object.defineProperty(symbol.observation.pg, Symbol("private"), { value: "PRIVATE_SECRET" }); expect(() => validate(symbol)).toThrow("RESTORE_CUSTODY_REFUSED");
  });
  it("rejects arrays with accessors, holes and excessive cardinality without reading their content", () => {
    const f = fixture(), get = vi.fn(() => "PRIVATE_SECRET"); Object.defineProperty(f.observation.pg.mounts, "0", { enumerable: true, get });
    expect(() => validate(f)).toThrow("RESTORE_CUSTODY_REFUSED"); expect(get).not.toHaveBeenCalled();
    const sparse = fixture(); delete (sparse.observation.pg.mounts as unknown[])[0]; expect(() => validate(sparse)).toThrow("RESTORE_CUSTODY_REFUSED");
    const oversized = fixture(); oversized.observation.pg.publishedPorts.length = 1000000; expect(() => validate(oversized)).toThrow("RESTORE_CUSTODY_REFUSED");
  });
  it("does not parse JSON strings or allow duplicate-key JSON to acquire authority", () => {
    const f = fixture(); expect(() => validateRestoreCustodyV3(f.claim, '{"schema":"x","schema":"y"}', f.expected)).toThrow("RESTORE_CUSTODY_REFUSED");
  });
  it("uses canonical object ordering and emits no credential or source role data", () => {
    const f = fixture(), reversed = Object.fromEntries(Object.entries(f.observation).reverse());
    const result = validateRestoreCustodyV3(f.claim, reversed, f.expected); expect(JSON.stringify(result)).not.toContain("phone11ai"); expect(JSON.stringify(result)).not.toContain("runtime-password"); expect(result.consistencyOnly).toBe(true);
  });
});
