import { createHash } from "node:crypto";
const ROOT = "/run/phone11-pbx-clone";
export const SYNTHETIC_WORKER_ID = "b2".repeat(32);
export function custodyObservation(attemptId = "a1".repeat(16), imageId = `sha256:${"a1".repeat(32)}`) {
  return {
    schema: "phone11-pbx-clone-custody-observation/v2", attemptId,
    worker: { id: SYNTHETIC_WORKER_ID, name: `phone11-pbx-clone-${attemptId}`, imageId },
    engine: { workerId: SYNTHETIC_WORKER_ID, imageId,
      mounts: [{ type: "tmpfs", source: "", target: ROOT, rw: true }],
      tmpfs: [{ target: ROOT, bytes: 536870912, mode: 0o700, rw: true, nosuid: true, nodev: true, noexec: true, uid: 10001, gid: 10001 }],
      readOnlyRoot: true, network: "none", publishedPorts: [], privileged: false, capDrop: ["ALL"], noNewPrivileges: true, user: "10001:10001" },
    imageConfig: { imageId, volumes: [], user: "10001:10001" },
    storage: { data: `${ROOT}/data`, socket: `${ROOT}/socket`, temporary: `${ROOT}/tmp`, database: "phone11ai", freshSyntheticOnly: true, passwordAuthenticatedLoginRequired: true },
    ephemeralRoot: { path: ROOT, mode: 0o700, uid: 10001, gid: 10001 },
  };
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
  return value;
}
export function custodyDigest(value: unknown): string { return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex"); }
export function custodyClaim(observation = custodyObservation()) {
  return { observationSha256: custodyDigest(observation), workerId: SYNTHETIC_WORKER_ID, privateSocket: true, networkNone: true, noExternalMounts: true, ownedFreshClone: true };
}
