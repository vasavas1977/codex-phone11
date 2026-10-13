/** Root-host signer seam only. Private key FD3 and ledger-directory FD4 are never container mounts.
 * No producer admission/key/ledger is installed; every actual invocation refuses before FD IO.
 * A later independently reviewed observer must supply actual build/fixture/role/delta receipts.
 */
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, openSync, readSync, readlinkSync, writeSync } from "node:fs";
import { CUSTODIAN_PUBLIC_KEY_HEX, CustodianPermitRefusal } from "./custodian-permit-v1";
import { validateBootstrapRestoreCustodyV4 } from "./bootstrap-restore-custody-v4";
import { RESTORED_WORKER_SOURCE_CONTRACT } from "./restored-worker-source-contract-v1";

const CUSTODIAN_PRODUCER_POLICY: "FIXED_ORIGINAL_BOOTSTRAP_CUSTODIAN_V1" | null = null;
const PUBLIC_TEST_VECTOR = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const HASH = /^[a-f0-9]{64}(?![\s\S])/;
const ID = /^[a-f0-9]{32}(?![\s\S])/;
const ACTIONS = ["IVR_CREATE", "IVR_LIST", "PROVISION_CREATE", "PROVISION_ASSIGN"];
function demand(ok: unknown): asserts ok { if (!ok) throw new CustodianPermitRefusal("PERMIT_INVALID"); }
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(value));
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function fields(v: unknown, keys: readonly string[]): Record<string, unknown> {
  demand(v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))); return v as Record<string, unknown>;
}
/** Fixed root-held FDs only; not a public observer or an unauthenticated permit constructor. */
export function issueCustodianPermitFromPrivateFds(requestText: string, password: string): string {
  if (CUSTODIAN_PRODUCER_POLICY === null || CUSTODIAN_PUBLIC_KEY_HEX === null || CUSTODIAN_PUBLIC_KEY_HEX === PUBLIC_TEST_VECTOR) throw new CustodianPermitRefusal("PERMIT_UNBOUND");
  let keyRaw: Buffer | undefined; let ledger: number | undefined;
  try {
    demand(process.platform === "linux" && process.arch === "x64" && process.getuid?.() === 0 && CUSTODIAN_PRODUCER_POLICY === "FIXED_ORIGINAL_BOOTSTRAP_CUSTODIAN_V1" && HASH.test(CUSTODIAN_PUBLIC_KEY_HEX));
    demand(typeof requestText === "string" && Buffer.byteLength(requestText) <= 65536 && typeof password === "string" && HASH.test(password) && !/^([a-f0-9])\1+$/.test(password));
    const raw: unknown = JSON.parse(requestText); demand(canonical(raw) === requestText);
    const body = fields(raw, ["schema", "purpose", "attemptId", "runId", "nonce", "issuedAtMs", "expiresAtMs", "action", "fixture", "software", "admissions", "baseline", "intentionalDelta", "restore", "passwordSha256"]);
    demand(body.schema === "phone11-restored-custodian-permit/v1" && body.purpose === "AUTHORIZE_ONE_RESTORED_HANDLER_ACTION" && typeof body.attemptId === "string" && ID.test(body.attemptId) && typeof body.runId === "string" && ID.test(body.runId) && typeof body.nonce === "string" && HASH.test(body.nonce) && typeof body.action === "string" && ACTIONS.includes(body.action));
    demand(Number.isSafeInteger(body.issuedAtMs) && Number.isSafeInteger(body.expiresAtMs) && (body.issuedAtMs as number) <= Date.now() && Date.now() < (body.expiresAtMs as number) && (body.expiresAtMs as number) - (body.issuedAtMs as number) <= 15000);
    const software = fields(body.software, ["sourceContract", "workerImageId", "workerContainerId", "nodeVersion", "nodeRuntimeSha256", "driverBundleSha256", "buildManifestSha256"]);
    demand(canonical(software.sourceContract) === canonical(RESTORED_WORKER_SOURCE_CONTRACT));
    const approvals = fields(body.admissions, ["buildReceiptSha256", "fixtureReceiptSha256", "restrictedRoleReceiptSha256"]);
    const baseline = fields(body.baseline, ["receiptSha256", "semanticsSha256"]);
    const delta = fields(body.intentionalDelta, ["receiptSha256", "baselineReceiptSha256", "baselineSemanticsSha256", "postDeltaSemanticsSha256"]);
    for (const value of [...Object.values(approvals), ...Object.values(baseline), ...Object.values(delta)]) demand(typeof value === "string" && HASH.test(value) && !/^0+$/.test(value));
    demand(delta.baselineReceiptSha256 === baseline.receiptSha256 && delta.baselineSemanticsSha256 === baseline.semanticsSha256 && delta.postDeltaSemanticsSha256 !== baseline.semanticsSha256);
    const restore = fields(body.restore, ["claim", "observation", "expected"]); validateBootstrapRestoreCustodyV4(restore.claim, restore.observation, restore.expected);
    const expected = restore.expected as Record<string, unknown>; demand(expected.attemptId === body.attemptId && expected.runId === body.runId && expected.workerImageId === software.workerImageId && expected.workerContainerId === software.workerContainerId && expected.sourceSemanticsSha256 === baseline.semanticsSha256);
    const observation = restore.observation as Record<string, unknown>;
    demand(observation.pristineRestoreReceiptSha256 === baseline.receiptSha256 && observation.intentionalDeltaReceiptSha256 === delta.receiptSha256 && observation.intentionalDeltaSemanticsSha256 === delta.postDeltaSemanticsSha256);
    demand(typeof observation.currentObservedAtMs === "number" && observation.currentObservedAtMs <= (body.issuedAtMs as number) + 1000 && (body.issuedAtMs as number) - observation.currentObservedAtMs <= 5000);
    demand(body.passwordSha256 === digest(`PHONE11_RUNTIME_PASSWORD_V1\0${body.attemptId}\0${body.runId}\0${password}`));
    const before = fstatSync(3); demand(before.isFile() && before.uid === 0 && before.nlink === 1 && (before.mode & 0o777) === 0o400 && before.size > 0 && before.size <= 8192);
    keyRaw = Buffer.alloc(before.size); let offset = 0;
    while (offset < keyRaw.length) { const count = readSync(3, keyRaw, offset, keyRaw.length - offset, offset); demand(count > 0); offset += count; }
    const after = fstatSync(3); demand(["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"].every(k => before[k as keyof typeof before] === after[k as keyof typeof after]));
    const key = createPrivateKey({ key: keyRaw, format: "der", type: "pkcs8" }); demand(key.asymmetricKeyType === "ed25519");
    const publicDer = createPublicKey(key).export({ format: "der", type: "spki" }); demand(publicDer.subarray(-32).toString("hex") === CUSTODIAN_PUBLIC_KEY_HEX);
    const parent = fstatSync(4); demand(parent.isDirectory() && parent.uid === 0 && (parent.mode & 0o777) === 0o700 && readlinkSync("/proc/self/fd/4") === `/var/lib/phone11-pbx-bootstrap-restore/${body.attemptId}/permit-ledger`);
    // Allocation record excludes its own hash and final signed payload, avoiding another hash cycle.
    const allocation = canonical({ schema: "phone11-custodian-one-use-allocation/v1", attemptId: body.attemptId, runId: body.runId, action: body.action, nonce: body.nonce, issuedAtMs: body.issuedAtMs, expiresAtMs: body.expiresAtMs, workerImageId: software.workerImageId, workerContainerId: software.workerContainerId, buildReceiptSha256: approvals.buildReceiptSha256, fixtureReceiptSha256: approvals.fixtureReceiptSha256, pristineReceiptSha256: baseline.receiptSha256, intentionalDeltaReceiptSha256: delta.receiptSha256, passwordSha256: body.passwordSha256 });
    // Fixed proc FD path pins the held directory; fixed run/action leaf and O_EXCL prevent restart replay.
    ledger = openSync(`/proc/self/fd/4/${body.runId}-${body.action}.json`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const allocationBytes = Buffer.from(allocation); offset = 0;
    while (offset < allocationBytes.length) { const count = writeSync(ledger, allocationBytes, offset); demand(count > 0); offset += count; }
    fsyncSync(ledger); fchmodSync(ledger, 0o400); fsyncSync(ledger); fsyncSync(4);
    body.admissions = { ...approvals, supervisorLedgerReceiptSha256: digest(allocation) };
    const payload = Buffer.from(canonical(body)); const signature = sign(null, Buffer.concat([Buffer.from("PHONE11_RESTORED_CUSTODIAN_PERMIT_V1\0"), payload]), key);
    return canonical({ schema: "phone11-restored-custodian-private-frame/v1", payload: payload.toString("base64url"), signature: signature.toString("base64url"), password });
  } catch { throw new CustodianPermitRefusal("PERMIT_INVALID"); }
  finally { keyRaw?.fill(0); if (ledger !== undefined) closeSync(ledger); }
}
