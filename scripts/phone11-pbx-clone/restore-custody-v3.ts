/** Pure consistency of independently authenticated restore observations; never runtime admission. */
import { createHash } from "node:crypto";
import { types } from "node:util";

export const RESTORE_CUSTODY_SCHEMA_V3 = "phone11-pbx-restored-clone-custody-observation/v3";
export const RESTORE_SOURCE_SYSTEM_V3 = "7638134557377753122";
export const RESTORE_PG_IMAGE_V3 = "sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50";
export const RESTORE_SOURCE_CONTAINER_V3 = "6ac4827e744d938ee48bb56e0800f2d3cab06a5af47d8466046f671e5c66279a";
const ROOT = "/var/lib/phone11-pbx-protected-baseline";
const CATEGORIES = ["owners", "acl", "roles", "memberships", "triggers", "functions", "constraints", "defaults"] as const;
const HASH = /^[a-f0-9]{64}(?![\s\S])/;
const ID = /^[a-f0-9]{32}(?![\s\S])/;
type Row = Record<string, unknown>;
class RestoreRefusal extends Error { constructor() { super("RESTORE_CUSTODY_REFUSED"); } }
function requireShape(ok: unknown): asserts ok { if (!ok) throw new RestoreRefusal(); }
function row(value: unknown, keys: readonly string[]): Row {
  requireShape(value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  const fields = Object.getOwnPropertyDescriptors(value);
  requireShape(Reflect.ownKeys(fields).length === keys.length && keys.every(key => Object.hasOwn(fields, key) && "value" in fields[key] && fields[key].enumerable));
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
}
function array(value: unknown, length: number): unknown[] {
  requireShape(value !== null && typeof value === "object" && !types.isProxy(value) && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
  const fields = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
  requireShape(fields.length?.value === length && Reflect.ownKeys(fields).length === length + 1);
  return Array.from({ length }, (_, index) => {
    const entry = fields[String(index)]; requireShape(entry && "value" in entry && entry.enumerable); return entry.value;
  });
}
function hash(value: unknown): asserts value is string { requireShape(typeof value === "string" && HASH.test(value) && !/^0+$/.test(value)); }
function image(value: unknown): void { requireShape(typeof value === "string" && value.startsWith("sha256:")); hash(value.slice(7)); }
function integer(value: unknown, min: number, max: number): asserts value is number { requireShape(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max); }
function login(value: unknown): asserts value is string { requireShape(typeof value === "string" && /^[a-z_][a-z0-9_]{0,62}(?![\s\S])/.test(value)); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function digest(checked: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(checked))).digest("hex"); }

function archive(value: unknown, name: string, runRoot: string, expectedHash: unknown, expectedBytes: unknown): Row {
  const roles = name === "origin-roles.sql";
  const v = row(value, ["path", "sha256", "bytes", "uid", "gid", "mode", "regular", "links", ...(roles ? ["rolePasswordsIncluded"] : ["customerDataProtected", "credentialMaterialMayBePresent"])]);
  hash(v.sha256); const maximum = name === "origin.dump" ? 805306368 : 4194304;
  integer(v.bytes, 1, maximum); integer(expectedBytes, 1, maximum);
  requireShape(v.path === `${runRoot}/${name}` && v.sha256 === expectedHash && v.bytes === expectedBytes && v.uid === 0 && v.gid === 0 && v.mode === 0o400 && v.regular === true && v.links === 1);
  // --no-role-passwords excludes PostgreSQL role passwords only. The full database
  // snapshot can contain customer password hashes, SIP ciphertexts and other credentials.
  requireShape(roles ? v.rolePasswordsIncluded === false : v.customerDataProtected === true && v.credentialMaterialMayBePresent === true);
  return v;
}
function directory(value: unknown, path: string, uid: unknown, gid: unknown): Row {
  const v = row(value, ["path", "uid", "gid", "mode", "directory", "symlink", "fresh"]);
  requireShape(v.path === path && v.uid === uid && v.gid === gid && v.mode === 0o700 && v.directory === true && v.symlink === false && v.fresh === true); return v;
}
function mount(value: unknown, source: string, target: string, rw: boolean): Row {
  const v = row(value, ["type", "source", "target", "rw"]); requireShape(v.type === "bind" && v.source === source && v.target === target && v.rw === rw); return v;
}
function tmpfs(value: unknown, uid: unknown, gid: unknown): Row {
  const v = row(value, ["type", "source", "target", "rw", "bytes", "uid", "gid", "mode", "nosuid", "nodev", "noexec"]);
  requireShape(v.type === "tmpfs" && v.source === "" && v.target === "/tmp" && v.rw === true && v.bytes === 67108864 && v.uid === uid && v.gid === gid && v.mode === 0o700 && v.nosuid === true && v.nodev === true && v.noexec === true); return v;
}
function engine(value: unknown, kind: "pg" | "worker", runRoot: string, expected: Row): Row {
  const v = row(value, ["id", "name", "imageId", "running", "network", "readOnlyRoot", "privileged", "capDrop", "noNewPrivileges", "publishedPorts", "user", "mounts", "restartPolicy", "memoryBytes", "memorySwapBytes", "cpus", "pidsLimit", "logDriver"]);
  const id = expected[kind === "pg" ? "pgContainerId" : "workerContainerId"], imageId = expected[kind === "pg" ? "pgImageId" : "workerImageId"];
  requireShape(v.id === id && v.imageId === imageId && v.name === `phone11-protected-${kind === "pg" ? "baseline" : "worker"}-${expected.attemptId}` && v.running === true);
  requireShape(v.network === "none" && v.readOnlyRoot === true && v.privileged === false && v.noNewPrivileges === true && v.user === `${expected.pgUid}:${expected.pgGid}` && v.restartPolicy === "no" && v.memoryBytes === 536870912 && v.memorySwapBytes === 536870912 && v.cpus === "0.5" && v.pidsLimit === 128 && v.logDriver === "none");
  requireShape(array(v.capDrop, 1)[0] === "ALL"); array(v.publishedPorts, 0);
  const mounts = array(v.mounts, kind === "pg" ? 4 : 2);
  const checked = kind === "pg" ? [mount(mounts[0], `${runRoot}/data`, "/var/lib/postgresql/data", true), mount(mounts[1], `${runRoot}/socket`, "/var/run/postgresql", true), mount(mounts[2], `${runRoot}/secrets`, "/run/phone11-clone-secrets", false), tmpfs(mounts[3], expected.pgUid, expected.pgGid)] : [mount(mounts[0], `${runRoot}/socket`, "/run/phone11-pbx-clone/socket", true), tmpfs(mounts[1], expected.pgUid, expected.pgGid)];
  return { ...v, capDrop: ["ALL"], publishedPorts: [], mounts: checked };
}
function catalog(value: unknown): Row {
  const v = row(value, CATEGORIES); return Object.fromEntries(CATEGORIES.map(key => {
    const entry = row(v[key], ["records", "sha256"]); integer(entry.records, 0, 100000); hash(entry.sha256); return [key, entry];
  }));
}

/** expected pins must come from the independent custodian. This parser authenticates neither
 * observers nor PostgreSQL state; matching digest strings never establish restoration proof.
 * Role-password exclusion is scoped to the password-free PostgreSQL roles archive;
 * no credential absence is inferred for origin.dump from its digest or custody metadata.
 * No JSON parser, IO, pg import, role change or existing admission binding is provided. */
export function validateRestoreCustodyV3(claimValue: unknown, observationValue: unknown, expectedValue: unknown): Readonly<{
  consistencyOnly: true; observationSha256: string; observerAuthority: false; runtimeAuthority: false;
  productionAcceptance: false; credentialEquivalence: false; rolePasswordsCopied: false;
  customerDataProtected: true; credentialMaterialMayBePresent: true;
}> {
  try {
    const expected = row(expectedValue, ["attemptId", "runId", "observationSha256", "pgImageId", "workerImageId", "pgContainerId", "workerContainerId", "pgUid", "pgGid", "backupSha256", "backupBytes", "rolesSha256", "rolesBytes", "sourceSemanticsSha256", "restrictedLoginSha256"]);
    requireShape(typeof expected.attemptId === "string" && ID.test(expected.attemptId) && typeof expected.runId === "string" && ID.test(expected.runId));
    for (const key of ["observationSha256", "pgContainerId", "workerContainerId", "backupSha256", "rolesSha256", "sourceSemanticsSha256", "restrictedLoginSha256"]) hash(expected[key]);
    image(expected.pgImageId); image(expected.workerImageId); requireShape(expected.pgImageId === RESTORE_PG_IMAGE_V3 && expected.pgImageId !== expected.workerImageId && expected.pgContainerId !== expected.workerContainerId && expected.pgContainerId !== RESTORE_SOURCE_CONTAINER_V3 && expected.workerContainerId !== RESTORE_SOURCE_CONTAINER_V3);
    integer(expected.pgUid, 1, 4294967294); integer(expected.pgGid, 1, 4294967294);
    const claim = row(claimValue, ["observationSha256", "observerAuthority", "runtimeAuthority", "productionAcceptance"]);
    requireShape(claim.observationSha256 === expected.observationSha256 && claim.observerAuthority === false && claim.runtimeAuthority === false && claim.productionAcceptance === false);
    const observation = row(observationValue, ["schema", "attemptId", "runId", "purpose", "sourceSystemIdentifier", "cloneSystemIdentifier", "snapshotBacked", "freshSyntheticOnly", "rolePasswordsCopied", "credentialEquivalence", "runtimeAuthority", "productionAcceptance", "archives", "custody", "pg", "worker", "semantics", "sourceCensusRole", "restrictedLogin"]);
    requireShape(observation.schema === RESTORE_CUSTODY_SCHEMA_V3 && observation.attemptId === expected.attemptId && observation.runId === expected.runId && observation.purpose === "RESTORE_METADATA_CONSISTENCY_ONLY" && observation.sourceSystemIdentifier === RESTORE_SOURCE_SYSTEM_V3);
    requireShape(typeof observation.cloneSystemIdentifier === "string" && /^[1-9][0-9]{0,19}(?![\s\S])/.test(observation.cloneSystemIdentifier) && observation.cloneSystemIdentifier !== RESTORE_SOURCE_SYSTEM_V3 && BigInt(observation.cloneSystemIdentifier) <= 18446744073709551615n);
    requireShape(observation.snapshotBacked === true && observation.freshSyntheticOnly === false && [observation.rolePasswordsCopied, observation.credentialEquivalence, observation.runtimeAuthority, observation.productionAcceptance].every(v => v === false));
    const runRoot = `${ROOT}/${expected.attemptId}`;
    const archives = row(observation.archives, ["backup", "roles"]);
    const checkedArchives = { backup: archive(archives.backup, "origin.dump", runRoot, expected.backupSha256, expected.backupBytes), roles: archive(archives.roles, "origin-roles.sql", runRoot, expected.rolesSha256, expected.rolesBytes) };
    const custody = row(observation.custody, ["runDirectory", "data", "socket", "secrets", "secretLeaves"]);
    const leaves = array(custody.secretLeaves, 4).map((leaf, index) => {
      const v = row(leaf, ["path", "uid", "gid", "mode", "regular", "links", "cloneOnly"]);
      requireShape(v.path === `${runRoot}/secrets/${["password", "pgpass", "pg_hba.conf", "runtime-password"][index]}` && v.uid === expected.pgUid && v.gid === expected.pgGid && v.mode === 0o400 && v.regular === true && v.links === 1 && v.cloneOnly === true); return v;
    });
    const checkedCustody = { runDirectory: directory(custody.runDirectory, runRoot, 0, 0), data: directory(custody.data, `${runRoot}/data`, expected.pgUid, expected.pgGid), socket: directory(custody.socket, `${runRoot}/socket`, expected.pgUid, expected.pgGid), secrets: directory(custody.secrets, `${runRoot}/secrets`, expected.pgUid, expected.pgGid), secretLeaves: leaves };
    const pg = engine(observation.pg, "pg", runRoot, expected), worker = engine(observation.worker, "worker", runRoot, expected);
    const semantics = row(observation.semantics, ["canonicalization", "comparisonPhase", "excludedCustodian", "sourceAbsentBefore", "sourceBefore", "sourceAfter", "restored"]);
    requireShape(semantics.canonicalization === "phone11-catalog-semantics-component-arrays/v2" && semantics.comparisonPhase === "POST_RESTORE_PRE_RUNTIME_ROLE" && semantics.excludedCustodian === `p11_clone_custodian_${expected.attemptId.slice(0, 16)}` && semantics.sourceAbsentBefore === true);
    const before = catalog(semantics.sourceBefore), after = catalog(semantics.sourceAfter), restored = catalog(semantics.restored);
    requireShape(digest(before) === expected.sourceSemanticsSha256 && digest(after) === expected.sourceSemanticsSha256 && digest(restored) === expected.sourceSemanticsSha256);
    const sourceRole = row(observation.sourceCensusRole, ["login", "sourceSystemIdentifier", "superuser", "restricted"]); login(sourceRole.login);
    requireShape(sourceRole.login === "phone11ai" && sourceRole.sourceSystemIdentifier === RESTORE_SOURCE_SYSTEM_V3 && sourceRole.superuser === true && sourceRole.restricted === false);
    const role = row(observation.restrictedLogin, ["attemptId", "runId", "cloneSystemIdentifier", "sessionUser", "currentUser", "loginObserved", "authenticationMethod", "nonOwner", "ownedObjectCount", "schemaCreate", "databaseCreate", "privilegedMembership", "sourceLoginEquivalent", "attributes", "memberships"]);
    const attributes = row(role.attributes, ["login", "superuser", "bypassRls", "createDb", "createRole", "replication", "inherits"]);
    requireShape(role.attemptId === expected.attemptId && role.runId === expected.runId && role.cloneSystemIdentifier === observation.cloneSystemIdentifier && role.sessionUser === `p11_clone_runtime_${expected.attemptId}` && role.currentUser === role.sessionUser && role.loginObserved === true && role.authenticationMethod === "password" && role.nonOwner === true && role.ownedObjectCount === 0);
    requireShape([role.schemaCreate, role.databaseCreate, role.privilegedMembership, role.sourceLoginEquivalent].every(v => v === false) && attributes.login === true && [attributes.superuser, attributes.bypassRls, attributes.createDb, attributes.createRole, attributes.replication, attributes.inherits].every(v => v === false)); array(role.memberships, 0);
    const checkedRole = { ...role, attributes, memberships: [] };
    requireShape(digest(checkedRole) === expected.restrictedLoginSha256);
    const checked = { ...observation, archives: checkedArchives, custody: checkedCustody, pg, worker, semantics: { ...semantics, sourceBefore: before, sourceAfter: after, restored }, sourceCensusRole: sourceRole, restrictedLogin: checkedRole };
    requireShape(digest(checked) === expected.observationSha256);
    return Object.freeze({ consistencyOnly: true, observationSha256: expected.observationSha256, observerAuthority: false, runtimeAuthority: false, productionAcceptance: false, credentialEquivalence: false, rolePasswordsCopied: false, customerDataProtected: true, credentialMaterialMayBePresent: true });
  } catch { throw new RestoreRefusal(); } // Never reflects private data, getter/proxy errors or credentials.
}
