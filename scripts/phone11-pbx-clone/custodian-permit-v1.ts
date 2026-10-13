/** Signed, one-use restored-worker permit. No keys, production producer or trust anchor are installed. */
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { createReadStream, fstatSync } from "node:fs";
import { types } from "node:util";
import { validateBootstrapRestoreCustodyV4 } from "./bootstrap-restore-custody-v4";
import { RESTORED_WORKER_SOURCE_CONTRACT } from "./restored-worker-source-contract-v1";

// Fix this independent clone-only public anchor BEFORE the final image build.
// Never embed the resulting image/container/observation/build receipt hash here.
export const CUSTODIAN_PUBLIC_KEY_HEX: string | null = null;
const DOMAIN = Buffer.from("PHONE11_RESTORED_CUSTODIAN_PERMIT_V1\0", "utf8");
const FRAME_MAX = 131072;
const PUBLIC_TEST_VECTOR = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
function productionAnchor(): string {
  if (CUSTODIAN_PUBLIC_KEY_HEX === null || !HASH.test(CUSTODIAN_PUBLIC_KEY_HEX) || /^0+$/.test(CUSTODIAN_PUBLIC_KEY_HEX) || CUSTODIAN_PUBLIC_KEY_HEX === PUBLIC_TEST_VECTOR) refuse("PERMIT_UNBOUND");
  return CUSTODIAN_PUBLIC_KEY_HEX;
}
const ACTIONS = ["IVR_CREATE", "IVR_LIST", "PROVISION_CREATE", "PROVISION_ASSIGN"] as const;
export type CustodianAction = typeof ACTIONS[number];
export type PermitCode = "PERMIT_UNBOUND" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_REPLAY" | "PERMIT_CANCELLED" | "PERMIT_ENVIRONMENT" | "PERMIT_TEST_ONLY" | "PRIVATE_FD_REFUSED";
export class CustodianPermitRefusal extends Error {
  constructor(readonly code: PermitCode) { super(code); }
}
function refuse(code: PermitCode): never { throw new CustodianPermitRefusal(code); }
function demand(ok: unknown): asserts ok { if (!ok) refuse("PERMIT_INVALID"); }
const HASH = /^[a-f0-9]{64}(?![\s\S])/;
const ID = /^[a-f0-9]{32}(?![\s\S])/;
function hash(value: unknown): asserts value is string { demand(typeof value === "string" && HASH.test(value) && !/^0+$/.test(value)); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  demand(value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  demand(Reflect.ownKeys(descriptors).length === keys.length && keys.every(k => Object.hasOwn(descriptors, k) && "value" in descriptors[k] && descriptors[k].enumerable));
  return Object.fromEntries(keys.map(k => [k, descriptors[k].value]));
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sorted(v)]));
  return value;
}
function canonical(value: unknown): string { return JSON.stringify(sorted(value)); }
function canonicalJson(raw: string): unknown {
  demand(typeof raw === "string" && Buffer.byteLength(raw) > 0 && Buffer.byteLength(raw) <= FRAME_MAX);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { refuse("PERMIT_INVALID"); }
  // Exact canonical bytes also reject duplicate keys, __proto__ omissions, whitespace and alternate encodings.
  demand(canonical(value) === raw); return value;
}
function base64(value: unknown, size?: number): Buffer {
  demand(typeof value === "string" && /^[A-Za-z0-9_-]+(?![\s\S])/.test(value) && value.length <= FRAME_MAX);
  const raw = Buffer.from(value, "base64url"); demand(raw.toString("base64url") === value && (size === undefined || raw.length === size)); return raw;
}
function checkSignal(signal: AbortSignal): void {
  if (!(signal instanceof AbortSignal)) refuse("PERMIT_INVALID");
  if (signal.aborted) refuse("PERMIT_CANCELLED");
}
export function assertCustodianEnvironment(keys: readonly string[]): void {
  if (keys.some(k => /^(?:PG|POSTGRES|DATABASE|DB_|NODE_PG_|NODE_OPTIONS|NODE_PATH|SIP_|REDIS)/i.test(k))) refuse("PERMIT_ENVIRONMENT");
}
declare const challengeBrand: unique symbol;
declare const permitBrand: unique symbol;
export type CustodianChallenge = Readonly<{ readonly [challengeBrand]: true }>;
export type CustodianPermit = Readonly<{ readonly [permitBrand]: true }>;
export type CustodianFixture = Readonly<{ lane: CustodianAction; actorUserId: number; tenantId: number; assigneeUserId: number; extensionId: number; extensionNumber: string }>;
type ChallengeState = { nonce: string; action: CustodianAction; issuedAtMs: number; deadline: number; used: boolean; mode: "production" | "test" };
type PermitState = { fixture: CustodianFixture; attemptId: string; runId: string; login: string; password: string; nodeVersion: string; deadline: number; consumed: boolean; mode: "production" | "test" };
const challenges = new WeakMap<CustodianChallenge, ChallengeState>();
const permits = new WeakMap<CustodianPermit, PermitState>();
let challengeIssued = false;
function issueChallenge(action: CustodianAction, nonce: string, mode: "production" | "test", now = Date.now()): Readonly<{ token: CustodianChallenge; nonce: string; action: CustodianAction; issuedAtMs: number; expiresAtMs: number }> {
  demand(ACTIONS.includes(action) && HASH.test(nonce));
  const token = Object.freeze({}) as CustodianChallenge;
  challenges.set(token, { nonce, action, issuedAtMs: now, deadline: performance.now() + 30000, used: false, mode });
  return Object.freeze({ token, nonce, action, issuedAtMs: now, expiresAtMs: now + 30000 });
}
/** Fixed worker challenge; private supervisor channel only. Anchor absence refuses before RNG/FD IO. */
export function beginCustodianChallenge(action: CustodianAction, signal: AbortSignal) {
  productionAnchor();
  checkSignal(signal); assertCustodianEnvironment(Object.keys(process.env));
  if (process.platform !== "linux" || process.arch !== "x64" || !/^22\.[0-9]+\.[0-9]+$/.test(process.versions.node)) refuse("PERMIT_ENVIRONMENT");
  if (challengeIssued) refuse("PERMIT_REPLAY"); challengeIssued = true;
  return issueChallenge(action, randomBytes(32).toString("hex"), "production");
}
function activeChallenge(token: CustodianChallenge, signal: AbortSignal): ChallengeState {
  const state = challenges.get(token);
  if (!(signal instanceof AbortSignal)) refuse("PERMIT_INVALID");
  if (signal.aborted) { if (state) state.used = true; refuse("PERMIT_CANCELLED"); }
  if (!state || state.used) refuse("PERMIT_REPLAY");
  if (performance.now() >= state.deadline) refuse("PERMIT_EXPIRED"); return state;
}
function verifyFrame(frameText: string, state: ChallengeState, publicKeyHex: string, signal: AbortSignal): CustodianPermit {
  checkSignal(signal); demand(HASH.test(publicKeyHex));
  const frame = record(canonicalJson(frameText), ["schema", "payload", "signature", "password"]);
  demand(frame.schema === "phone11-restored-custodian-private-frame/v1");
  const payload = base64(frame.payload), signature = base64(frame.signature, 64);
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
  demand(publicKey.asymmetricKeyType === "ed25519" && verify(null, Buffer.concat([DOMAIN, payload]), publicKey, signature));
  const body = record(canonicalJson(payload.toString("utf8")), ["schema", "purpose", "attemptId", "runId", "nonce", "issuedAtMs", "expiresAtMs", "action", "fixture", "software", "admissions", "baseline", "intentionalDelta", "restore", "passwordSha256"]);
  demand(body.schema === "phone11-restored-custodian-permit/v1" && body.purpose === "AUTHORIZE_ONE_RESTORED_HANDLER_ACTION" && body.nonce === state.nonce && body.action === state.action && typeof body.attemptId === "string" && ID.test(body.attemptId) && typeof body.runId === "string" && ID.test(body.runId));
  const now = Date.now(); demand(Number.isSafeInteger(body.issuedAtMs) && Number.isSafeInteger(body.expiresAtMs));
  const issued = body.issuedAtMs as number, expiry = body.expiresAtMs as number;
  if (issued < state.issuedAtMs || issued > now + 1000 || expiry <= now || expiry <= issued || expiry - issued > 15000 || expiry > state.issuedAtMs + 30000 || performance.now() >= state.deadline) refuse("PERMIT_EXPIRED");
  const fixture = record(body.fixture, ["lane", "actorUserId", "tenantId", "assigneeUserId", "extensionId", "extensionNumber"]);
  demand(fixture.lane === state.action && typeof fixture.extensionNumber === "string" && /^91[0-9]{6}(?![\s\S])/.test(fixture.extensionNumber));
  for (const k of ["actorUserId", "tenantId", "assigneeUserId", "extensionId"]) demand(Number.isSafeInteger(fixture[k]) && (fixture[k] as number) > 0 && (fixture[k] as number) <= 2147483647);
  const software = record(body.software, ["sourceContract", "workerImageId", "workerContainerId", "nodeVersion", "nodeRuntimeSha256", "driverBundleSha256", "buildManifestSha256"]);
  demand(canonical(software.sourceContract) === canonical(RESTORED_WORKER_SOURCE_CONTRACT));
  demand(typeof software.workerImageId === "string" && software.workerImageId.startsWith("sha256:")); hash(software.workerImageId.slice(7)); hash(software.workerContainerId); hash(software.nodeRuntimeSha256); hash(software.driverBundleSha256); hash(software.buildManifestSha256);
  demand(typeof software.nodeVersion === "string" && /^22\.[0-9]+\.[0-9]+(?![\s\S])/.test(software.nodeVersion));
  const admissions = record(body.admissions, ["buildReceiptSha256", "fixtureReceiptSha256", "restrictedRoleReceiptSha256", "supervisorLedgerReceiptSha256"]); Object.values(admissions).forEach(hash);
  const baseline = record(body.baseline, ["receiptSha256", "semanticsSha256"]); Object.values(baseline).forEach(hash);
  const delta = record(body.intentionalDelta, ["receiptSha256", "baselineReceiptSha256", "baselineSemanticsSha256", "postDeltaSemanticsSha256"]); Object.values(delta).forEach(hash);
  demand(delta.baselineReceiptSha256 === baseline.receiptSha256 && delta.baselineSemanticsSha256 === baseline.semanticsSha256 && delta.postDeltaSemanticsSha256 !== baseline.semanticsSha256);
  const restore = record(body.restore, ["claim", "observation", "expected"]);
  const checked = validateBootstrapRestoreCustodyV4(restore.claim, restore.observation, restore.expected);
  const expected = record(restore.expected, ["attemptId", "runId", "observationSha256", "pgImageId", "workerImageId", "pgContainerId", "workerContainerId", "pgUid", "pgGid", "backupSha256", "backupBytes", "rolesSha256", "rolesBytes", "sourceSemanticsSha256", "restrictedLoginSha256"]);
  demand(checked.consistencyOnly && checked.runtimeAuthority === false && expected.attemptId === body.attemptId && expected.runId === body.runId && expected.workerImageId === software.workerImageId && expected.workerContainerId === software.workerContainerId && expected.sourceSemanticsSha256 === baseline.semanticsSha256);
  const observation = record(restore.observation, ["schema", "attemptId", "runId", "purpose", "sourceSystemIdentifier", "cloneSystemIdentifier", "snapshotBacked", "freshSyntheticOnly", "rolePasswordsCopied", "credentialEquivalence", "runtimeAuthority", "productionAcceptance", "archives", "custody", "pg", "worker", "pristineSemantics", "pristineRestoreReceiptSha256", "pristineObservedAtMs", "currentObservedAtMs", "intentionalDeltaReceiptSha256", "intentionalDeltaSemanticsSha256", "sourceCensusRole", "restrictedLogin"]);
  demand(observation.pristineRestoreReceiptSha256 === baseline.receiptSha256 && observation.intentionalDeltaReceiptSha256 === delta.receiptSha256 && observation.intentionalDeltaSemanticsSha256 === delta.postDeltaSemanticsSha256);
  const currentObservedAt = observation.currentObservedAtMs as number;
  if (currentObservedAt > issued + 1000 || issued - currentObservedAt > 5000) refuse("PERMIT_EXPIRED");
  const login = `p11_clone_runtime_${body.attemptId}`;
  demand(typeof frame.password === "string" && HASH.test(frame.password) && !/^([a-f0-9])\1+$/.test(frame.password)); hash(body.passwordSha256);
  const actual = createHash("sha256").update(`PHONE11_RUNTIME_PASSWORD_V1\0${body.attemptId}\0${body.runId}\0${frame.password}`).digest();
  demand(timingSafeEqual(actual, Buffer.from(body.passwordSha256, "hex")));
  // Custody stays private; only independently signed execution scope creates this opaque handle.
  demand(typeof observation.cloneSystemIdentifier === "string"); checkSignal(signal);
  const token = Object.freeze({}) as CustodianPermit;
  permits.set(token, { fixture: Object.freeze(fixture) as CustodianFixture, attemptId: body.attemptId, runId: body.runId, login, password: frame.password, nodeVersion: software.nodeVersion, deadline: Math.min(state.deadline, performance.now() + expiry - now), consumed: false, mode: state.mode });
  return token;
}
function finite(error: unknown): never { if (error instanceof CustodianPermitRefusal) throw error; refuse("PERMIT_INVALID"); }
/** Fixed inherited private pipe FD0; bounded async read allows expiry/abort without pg import. */
export async function readCustodianPermitFromFd(challenge: CustodianChallenge, signal: AbortSignal): Promise<CustodianPermit> {
  productionAnchor();
  const state = activeChallenge(challenge, signal); demand(state.mode === "production"); state.used = true;
  assertCustodianEnvironment(Object.keys(process.env));
  try {
    if (!fstatSync(0).isFIFO()) refuse("PRIVATE_FD_REFUSED");
    const raw = await new Promise<Buffer>((resolve, reject) => {
      const stream = createReadStream("", { fd: 0, autoClose: true, highWaterMark: 4096 });
      const chunks: Buffer[] = []; let total = 0; let settled = false;
      const finish = (error?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort); stream.destroy(); if (error) reject(error); else resolve(Buffer.concat(chunks)); };
      const abort = () => finish(new CustodianPermitRefusal("PERMIT_CANCELLED"));
      const timer = setTimeout(() => finish(new CustodianPermitRefusal("PERMIT_EXPIRED")), Math.max(1, state.deadline - performance.now()));
      signal.addEventListener("abort", abort, { once: true });
      stream.on("data", chunk => { if (settled) return; const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += b.length; if (total > FRAME_MAX) finish(new CustodianPermitRefusal("PERMIT_INVALID")); else chunks.push(b); });
      stream.once("end", () => finish()); stream.once("error", () => finish(new CustodianPermitRefusal("PRIVATE_FD_REFUSED")));
      if (signal.aborted) abort();
    });
    return verifyFrame(raw.toString("utf8"), state, productionAnchor(), signal);
  } catch (error) { finite(error); }
}
function activePermit(token: CustodianPermit, signal: AbortSignal): PermitState {
  const state = permits.get(token);
  if (!(signal instanceof AbortSignal)) refuse("PERMIT_INVALID");
  if (signal.aborted) { if (state) state.consumed = true; refuse("PERMIT_CANCELLED"); }
  if (!state || state.consumed) refuse("PERMIT_REPLAY");
  if (performance.now() >= state.deadline) refuse("PERMIT_EXPIRED"); return state;
}
export function fixtureForCustodianPermit(token: CustodianPermit, signal: AbortSignal): CustodianFixture { return activePermit(token, signal).fixture; }
/** Opaque authenticated permit only. Test permits are barred from the real driver path. */
export function consumeCustodianPermitForAdapter(token: CustodianPermit, signal: AbortSignal, testOnly = false) {
  const state = activePermit(token, signal);
  if (testOnly ? process.env.NODE_ENV !== "test" || state.mode !== "test" : state.mode !== "production") refuse("PERMIT_TEST_ONLY");
  state.consumed = true;
  return { attemptId: state.attemptId, login: state.login, password: state.password, nodeVersion: state.nodeVersion, lifetimeMs: Math.max(1, state.deadline - performance.now()) };
}
export function isCustodianPermit(value: unknown): value is CustodianPermit { return value !== null && typeof value === "object" && !types.isProxy(value) && permits.has(value as CustodianPermit); }
/** Test-only cryptographic verifier. Never creates a production-mode permit or installs an anchor. */
export function createCustodianVerifierForTests(publicKeyHex: string, nonce: string, action: CustodianAction, now = Date.now()) {
  if (process.env.NODE_ENV !== "test") refuse("PERMIT_TEST_ONLY");
  const challenge = issueChallenge(action, nonce, "test", now);
  return Object.freeze({ challenge: Object.freeze({ nonce, action, issuedAtMs: challenge.issuedAtMs, expiresAtMs: challenge.expiresAtMs }), verify(frame: string, signal: AbortSignal): CustodianPermit {
    if (process.env.NODE_ENV !== "test") refuse("PERMIT_TEST_ONLY");
    const state = activeChallenge(challenge.token, signal); state.used = true;
    try { return verifyFrame(frame, state, publicKeyHex, signal); } catch (error) { finite(error); }
  } });
}
