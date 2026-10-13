import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { bootstrapRestoreFixture } from "./fixtures/phone11-pbx-bootstrap-restore-custody-v4";
import { beginCustodianChallenge, consumeCustodianPermitForAdapter, createCustodianVerifierForTests, fixtureForCustodianPermit, readCustodianPermitFromFd, type CustodianChallenge } from "../scripts/phone11-pbx-clone/custodian-permit-v1";
import { issueCustodianPermitFromPrivateFds } from "../scripts/phone11-pbx-clone/custodian-supervisor-v1";
import { RESTORED_WORKER_SOURCE_CONTRACT } from "../scripts/phone11-pbx-clone/restored-worker-source-contract-v1";
import { createCustodianAdapterForTests, createRealPgAdapter, LIMITS, type TestTransportClient, type TestTransportPool } from "../scripts/phone11-pbx-clone/real-pg-adapter";
import { runCustodianSelectedHandler } from "../scripts/phone11-pbx-clone/selected-handler-entry";
import { runFixedRestoredWorker } from "../scripts/phone11-pbx-clone/restored-worker-main-v1";
vi.mock("pg", () => { throw Error("PG_IMPORT_FORBIDDEN"); });
vi.mock("../server/pbx/ivr-router", () => { throw Error("PRODUCT_IMPORT_FORBIDDEN"); });
vi.mock("../server/phone-provisioning", () => { throw Error("PRODUCT_IMPORT_FORBIDDEN"); });
// Published RFC 8032 vector, not a generated or production credential. Test-mode permits cannot import pg.
const PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const KEY = createPrivateKey({ key: Buffer.from("302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"), format: "der", type: "pkcs8" });
const NONCE = "81".repeat(32), H = "82".repeat(32), PASSWORD = "abcdef01".repeat(8);
function canonical(v: unknown): string {
  const sort = (x: unknown): unknown => Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, y]) => [k, sort(y)])) : x;
  return JSON.stringify(sort(v));
}
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
function body() {
  const restore = bootstrapRestoreFixture(), now = Date.now();
  return { schema: "phone11-restored-custodian-permit/v1", purpose: "AUTHORIZE_ONE_RESTORED_HANDLER_ACTION", attemptId: restore.expected.attemptId, runId: restore.expected.runId, nonce: NONCE, issuedAtMs: now, expiresAtMs: now + 10000, action: "IVR_LIST", fixture: { lane: "IVR_LIST", actorUserId: 7, tenantId: 11, assigneeUserId: 8, extensionId: 3, extensionNumber: "91000001" }, software: { sourceContract: { ...RESTORED_WORKER_SOURCE_CONTRACT }, workerImageId: restore.expected.workerImageId, workerContainerId: restore.expected.workerContainerId, nodeVersion: "22.14.0", nodeRuntimeSha256: H, driverBundleSha256: H, buildManifestSha256: H }, admissions: { buildReceiptSha256: H, fixtureReceiptSha256: H, restrictedRoleReceiptSha256: H, supervisorLedgerReceiptSha256: H }, baseline: { receiptSha256: restore.observation.pristineRestoreReceiptSha256, semanticsSha256: restore.expected.sourceSemanticsSha256 }, intentionalDelta: { receiptSha256: restore.observation.intentionalDeltaReceiptSha256, baselineReceiptSha256: restore.observation.pristineRestoreReceiptSha256, baselineSemanticsSha256: restore.expected.sourceSemanticsSha256, postDeltaSemanticsSha256: restore.observation.intentionalDeltaSemanticsSha256 }, restore, passwordSha256: digest(`PHONE11_RUNTIME_PASSWORD_V1\0${restore.expected.attemptId}\0${restore.expected.runId}\0${PASSWORD}`) };
}
function frame(v = body(), password = PASSWORD) { const payload = Buffer.from(canonical(v)); return canonical({ schema: "phone11-restored-custodian-private-frame/v1", payload: payload.toString("base64url"), signature: sign(null, Buffer.concat([Buffer.from("PHONE11_RESTORED_CUSTODIAN_PERMIT_V1\0"), payload]), KEY).toString("base64url"), password }); }
function verifier() { return createCustodianVerifierForTests(PUBLIC, NONCE, "IVR_LIST"); }
const signal = () => new AbortController().signal;
// Isolate TEST-mode refusal from launcher-injected connection keys. The actual
// environment guard is exercised separately and remains active in production.
function clearFixtureConnectionEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (/^(?:PG|POSTGRES|DATABASE|DB_|NODE_PG_|NODE_OPTIONS|NODE_PATH|SIP_|REDIS)/i.test(key)) vi.stubEnv(key, undefined);
  }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("authenticated noncircular restored-worker seam; RFC vector mocks only", () => {
  it("accepts cryptographic test scope only as opaque one-use token", () => {
    const v = verifier(), token = v.verify(frame(), signal()); expect(JSON.stringify(token)).toBe("{}"); expect(fixtureForCustodianPermit(token, signal()).lane).toBe("IVR_LIST");
    expect(() => v.verify(frame(), signal())).toThrow("PERMIT_REPLAY");
    expect(() => consumeCustodianPermitForAdapter(token, signal())).toThrow("PERMIT_TEST_ONLY");
    const config = consumeCustodianPermitForAdapter(token, signal(), true); expect(config.login).toBe(`p11_clone_runtime_${body().attemptId}`);
    expect(() => consumeCustodianPermitForAdapter(token, signal(), true)).toThrow("PERMIT_REPLAY");
  });
  it.each([
    ["nonce", (v: ReturnType<typeof body>) => { v.nonce = H; }],
    ["action", (v: ReturnType<typeof body>) => { v.action = "IVR_CREATE"; }],
    ["run", (v: ReturnType<typeof body>) => { v.runId = "91".repeat(16); }],
    ["software", (v: ReturnType<typeof body>) => { Object.assign(v.software.sourceContract, { adapterSha256: H }); }],
    ["fixture", (v: ReturnType<typeof body>) => { v.fixture.tenantId = 0; }],
    ["baseline mismatch", (v: ReturnType<typeof body>) => { v.baseline.receiptSha256 = H; }],
    ["delta relabel", (v: ReturnType<typeof body>) => { v.intentionalDelta.postDeltaSemanticsSha256 = v.baseline.semanticsSha256; }],
    ["worker mismatch", (v: ReturnType<typeof body>) => { v.software.workerContainerId = H; }],
    ["zero receipt", (v: ReturnType<typeof body>) => { v.admissions.restrictedRoleReceiptSha256 = "0".repeat(64); }],
  ])("rejects signed %s substitution", (_name, mutate) => { const r = verifier(), v = body(); mutate(v); expect(() => r.verify(frame(v), signal())).toThrow("PERMIT_INVALID"); });
  it("rejects forged signatures and password substitutions, consuming challenge on failure", () => {
    const r = verifier(), f = JSON.parse(frame()); f.signature = Buffer.alloc(64).toString("base64url"); expect(() => r.verify(canonical(f), signal())).toThrow("PERMIT_INVALID"); expect(() => r.verify(frame(), signal())).toThrow("PERMIT_REPLAY");
    expect(() => verifier().verify(frame(body(), "123456ab".repeat(8)), signal())).toThrow("PERMIT_INVALID");
  });
  it.each(["duplicate", "noncanonical", "oversized"])("rejects %s transport bytes", kind => {
    const text = frame(); const altered = kind === "duplicate" ? text.replace('{', '{"schema":"ignored",') : kind === "noncanonical" ? text + "\n" : "x".repeat(131073);
    expect(() => verifier().verify(altered, signal())).toThrow("PERMIT_INVALID");
  });
  it.each(["expired", "ttl", "future", "stale-current"])("rejects %s despite authentic test signature", kind => {
    const r = verifier(), v = body(); if (kind === "expired") v.expiresAtMs = v.issuedAtMs; if (kind === "ttl") v.expiresAtMs = v.issuedAtMs + 15001; if (kind === "future") { v.issuedAtMs += 5000; v.expiresAtMs += 5000; }
    if (kind === "stale-current") { v.restore.observation.currentObservedAtMs -= 6000; v.restore.observation.pristineObservedAtMs -= 6000; v.restore.expected.observationSha256 = digest(canonical(v.restore.observation)); v.restore.claim.observationSha256 = v.restore.expected.observationSha256; }
    expect(() => r.verify(frame(v), signal())).toThrow("PERMIT_EXPIRED");
  });
  it("does not permit clock rewind or delayed reuse beyond monotonic challenge expiry", () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] }); const r = verifier(), v = body(); vi.advanceTimersByTime(30001); vi.setSystemTime(v.issuedAtMs); expect(() => r.verify(frame(v), signal())).toThrow("PERMIT_EXPIRED");
  });
  it("preabort burns challenge without allowing retry on a replacement signal", () => {
    const r = verifier(), abort = new AbortController(); abort.abort(); expect(() => r.verify(frame(), abort.signal)).toThrow("PERMIT_CANCELLED"); expect(() => r.verify(frame(), signal())).toThrow("PERMIT_REPLAY");
  });
  it("preabort burns accepted permit and never calls test transport factory", () => {
    const token = verifier().verify(frame(), signal()), abort = new AbortController(), factory = vi.fn(); abort.abort(); expect(() => createCustodianAdapterForTests(token, factory, abort.signal)).toThrow("PERMIT_CANCELLED"); expect(factory).not.toHaveBeenCalled(); expect(() => consumeCustodianPermitForAdapter(token, signal(), true)).toThrow("PERMIT_REPLAY");
  });
  it("test tokens cannot authorize the real adapter even outside test mode", async () => {
    clearFixtureConnectionEnvironment();
    const token = verifier().verify(frame(), signal()); vi.stubEnv("NODE_ENV", "production"); await expect(createRealPgAdapter(token, signal())).rejects.toMatchObject({ code: "PERMIT_TEST_ONLY" }); expect(() => verifier()).toThrow("PERMIT_TEST_ONLY");
  });
  it("launcher connection keys refuse before TEST-mode consumption or real driver imports", async () => {
    clearFixtureConnectionEnvironment();
    const token = verifier().verify(frame(), signal());
    vi.stubEnv("NODE_PATH", "TEST_LAUNCHER_SCOPE_ONLY");
    await expect(createRealPgAdapter(token, signal())).rejects.toMatchObject({ code: "PERMIT_ENVIRONMENT" });
    expect(await runCustodianSelectedHandler(token, signal())).toMatchObject({ code: "PERMIT_ENVIRONMENT", outcome: "REFUSED", adapterClosed: false, productionAcceptance: false });
    expect(consumeCustodianPermitForAdapter(token, signal(), true).login).toBe(`p11_clone_runtime_${body().attemptId}`);
  });
  it("entry rejects forged handles and TEST permits before real imports without exposing custody", async () => {
    clearFixtureConnectionEnvironment();
    const forged = await runCustodianSelectedHandler({} as Parameters<typeof runCustodianSelectedHandler>[0], signal()); expect(forged).toMatchObject({ code: "PERMIT_REPLAY", outcome: "REFUSED", runtimeAcceptance: false });
    const token = verifier().verify(frame(), signal()); const result = await runCustodianSelectedHandler(token, signal()); expect(result).toMatchObject({ code: "PERMIT_TEST_ONLY", outcome: "REFUSED", adapterClosed: false, productionAcceptance: false }); expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });
  it("NULL anchor/producer refuses before FD/RNG/driver effects", async () => {
    expect(() => beginCustodianChallenge("IVR_LIST", signal())).toThrow("PERMIT_UNBOUND"); await expect(readCustodianPermitFromFd({} as CustodianChallenge, signal())).rejects.toThrow("PERMIT_UNBOUND"); expect(() => issueCustodianPermitFromPrivateFds("{}", PASSWORD)).toThrow("PERMIT_UNBOUND"); expect(await runFixedRestoredWorker("IVR_LIST", signal())).toMatchObject({ code: "PERMIT_UNBOUND", runtimeAcceptance: false, productionAcceptance: false });
  });
  it("bounded adapter expires at signed permit deadline and closes transport", async () => {
    vi.useFakeTimers(); const token = verifier().verify(frame(), signal()); const release = vi.fn(), end = vi.fn(async () => {});
    const client: TestTransportClient = { query: vi.fn(async () => ({ rows: [], command: "SELECT", rowCount: 0, oid: 0, fields: [] })), release, on: vi.fn(), removeListener: vi.fn() };
    const pool: TestTransportPool = { connect: vi.fn(async () => client), end, on: vi.fn() }; const adapter = createCustodianAdapterForTests(token, () => pool, signal());
    await adapter.query("SELECT 1"); expect(release).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(10001); await expect(adapter.query("SELECT 1")).rejects.toThrow("LIFETIME_TIMEOUT"); await adapter.close(); expect(end).toHaveBeenCalledTimes(1);
  });
  it("aborts pending connect and destroys a late client after close", async () => {
    vi.useFakeTimers(); const token = verifier().verify(frame(), signal()), abort = new AbortController();
    let deliver!: (value: TestTransportClient) => void;
    const pending = new Promise<TestTransportClient>(resolve => { deliver = resolve; });
    const release = vi.fn(), end = vi.fn(async () => {}), query = vi.fn();
    const client: TestTransportClient = { query, release, on: vi.fn(), removeListener: vi.fn() };
    const pool: TestTransportPool = { connect: vi.fn(() => pending), end, on: vi.fn() };
    const adapter = createCustodianAdapterForTests(token, () => pool, abort.signal);
    const work = adapter.query("SELECT 1"); const rejection = expect(work).rejects.toThrow("CANCELLED");
    abort.abort(); await rejection; const closed = adapter.close(); await vi.advanceTimersByTimeAsync(LIMITS.close + 1); expect(await closed).toEqual({ ended: false, code: "CLOSE_TIMEOUT" }); deliver(client); await Promise.resolve(); await Promise.resolve();
    expect(query).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledWith(true); expect(end).toHaveBeenCalledTimes(1);
  });
  it("source contract pins software bytes without embedding dynamic image/observation receipts", () => {
    const paths = { adapterSha256: "real-pg-adapter.ts", selectedEntrySha256: "selected-handler-entry.ts", permitSha256: "custodian-permit-v1.ts", custodySha256: "bootstrap-restore-custody-v4.ts", supervisorSha256: "custodian-supervisor-v1.ts", workerMainSha256: "restored-worker-main-v1.ts" };
    for (const [key, path] of Object.entries(paths)) expect(digest(readFileSync(`scripts/phone11-pbx-clone/${path}`, "utf8"))).toBe(RESTORED_WORKER_SOURCE_CONTRACT[key as keyof typeof RESTORED_WORKER_SOURCE_CONTRACT]);
    expect(Object.keys(RESTORED_WORKER_SOURCE_CONTRACT).some(k => /image|observation|execution|receipt/i.test(k))).toBe(false);
  });
});
