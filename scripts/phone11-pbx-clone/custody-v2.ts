/** Pure consistency checks only. No engine reads, fixture execution or custody authority. */
import { createHash } from "crypto";

export const EPHEMERAL_ROOT = "/run/phone11-pbx-clone";
export const EPHEMERAL_BYTES = 536870912;
export const CUSTODY_SCHEMA = "phone11-pbx-clone-custody-observation/v2";
const HASH = /^[a-f0-9]{64}(?![\s\S])/;
type Row = Record<string, unknown>;
class CustodyRefusal extends Error { constructor() { super("ADMISSION_REFUSED"); } }
function requireShape(ok: unknown): asserts ok { if (!ok) throw new CustodyRefusal(); }
function row(value: unknown, keys: readonly string[]): Row {
  requireShape(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireShape(Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key) && "value" in descriptors[key] && descriptors[key].enumerable));
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function hash(value: unknown): asserts value is string {
  requireShape(typeof value === "string" && HASH.test(value) && !/^0+$/.test(value));
}
function image(value: unknown): asserts value is string {
  requireShape(typeof value === "string" && value.startsWith("sha256:")); hash(value.slice(7));
}
function one(value: unknown): unknown {
  requireShape(Array.isArray(value) && value.length === 1);
  const fields = Object.getOwnPropertyDescriptors(value);
  requireShape(Reflect.ownKeys(fields).length === 2 && "value" in fields["0"]); return fields["0"].value;
}
function empty(value: unknown): void { requireShape(Array.isArray(value) && value.length === 0 && Reflect.ownKeys(value).length === 1); }
function numericUser(value: unknown): [number, number] {
  requireShape(typeof value === "string" && /^[1-9][0-9]{0,9}:[1-9][0-9]{0,9}(?![\s\S])/.test(value));
  const [uid, gid] = value.split(":").map(Number);
  requireShape(uid <= 4294967294 && gid <= 4294967294); return [uid, gid];
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Row)[key])]));
  return value;
}

/** Observation data must be independently collected and pinned by a later custodian.
 * Hash/shape equality authenticates neither the observer nor any runtime authority. */
export function validateCloneCustodyV2(custodyValue: unknown, observationValue: unknown,
  expected: Readonly<{ attemptId: string; workerImageId: string }>): void {
  try {
    requireShape(/^[a-f0-9]{32}(?![\s\S])/.test(expected.attemptId));
    const custody = row(custodyValue, ["observationSha256", "workerId", "privateSocket", "networkNone", "noExternalMounts", "ownedFreshClone"]);
    hash(custody.observationSha256); hash(custody.workerId); image(expected.workerImageId);
    requireShape([custody.privateSocket, custody.networkNone, custody.noExternalMounts, custody.ownedFreshClone].every(value => value === true));
    const observation = row(observationValue, ["schema", "attemptId", "worker", "engine", "imageConfig", "storage", "ephemeralRoot"]);
    requireShape(observation.schema === CUSTODY_SCHEMA && observation.attemptId === expected.attemptId);
    const worker = row(observation.worker, ["id", "name", "imageId"]);
    requireShape(worker.id === custody.workerId && worker.name === `phone11-pbx-clone-${expected.attemptId}` && worker.imageId === expected.workerImageId);
    const engine = row(observation.engine, ["workerId", "imageId", "mounts", "tmpfs", "readOnlyRoot", "network", "publishedPorts", "privileged", "capDrop", "noNewPrivileges", "user"]);
    requireShape(engine.workerId === custody.workerId && engine.imageId === expected.workerImageId && engine.readOnlyRoot === true && engine.network === "none" && engine.privileged === false && engine.noNewPrivileges === true);
    requireShape(one(engine.capDrop) === "ALL"); empty(engine.publishedPorts);
    const [uid, gid] = numericUser(engine.user);
    const imageConfig = row(observation.imageConfig, ["imageId", "volumes", "user"]);
    requireShape(imageConfig.imageId === expected.workerImageId && imageConfig.user === engine.user); empty(imageConfig.volumes);
    // Both engine inventory and independently observed tmpfs config are mandatory.
    const mount = row(one(engine.mounts), ["type", "source", "target", "rw"]);
    requireShape(mount.type === "tmpfs" && mount.source === "" && mount.target === EPHEMERAL_ROOT && mount.rw === true);
    const tmpfs = row(one(engine.tmpfs), ["target", "bytes", "mode", "rw", "nosuid", "nodev", "noexec", "uid", "gid"]);
    requireShape(tmpfs.target === EPHEMERAL_ROOT && tmpfs.bytes === EPHEMERAL_BYTES && tmpfs.mode === 0o700 && tmpfs.uid === uid && tmpfs.gid === gid);
    requireShape([tmpfs.rw, tmpfs.nosuid, tmpfs.nodev, tmpfs.noexec].every(value => value === true));
    const root = row(observation.ephemeralRoot, ["path", "mode", "uid", "gid"]);
    requireShape(root.path === EPHEMERAL_ROOT && root.mode === 0o700 && root.uid === uid && root.gid === gid);
    const storage = row(observation.storage, ["data", "socket", "temporary", "database", "freshSyntheticOnly", "passwordAuthenticatedLoginRequired"]);
    requireShape(storage.data === `${EPHEMERAL_ROOT}/data` && storage.socket === `${EPHEMERAL_ROOT}/socket` && storage.temporary === `${EPHEMERAL_ROOT}/tmp` && storage.database === "phone11ai" && storage.freshSyntheticOnly === true && storage.passwordAuthenticatedLoginRequired === true);
    const checked = { ...observation, worker, engine: { ...engine, mounts: [mount], tmpfs: [tmpfs], capDrop: ["ALL"], publishedPorts: [] }, imageConfig: { ...imageConfig, volumes: [] }, storage, ephemeralRoot: root };
    const actual = createHash("sha256").update(JSON.stringify(canonical(checked))).digest("hex");
    requireShape(actual === custody.observationSha256);
  } catch { throw new CustodyRefusal(); } // Never reflects raw observations/proxy errors.
}
