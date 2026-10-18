import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { validateCloneCustodyV2 } from "../scripts/phone11-pbx-clone/custody-v2";
import { admitCloneConnectionInput, CLONE_SOURCE, CLONE_SOCKET, createRealPgAdapter } from "../scripts/phone11-pbx-clone/real-pg-adapter";
import { runSelectedHandler, SELECTED_BUILD_CONTRACT, SELECTED_LANES } from "../scripts/phone11-pbx-clone/selected-handler-entry";
import { custodyClaim, custodyDigest, custodyObservation } from "./fixtures/phone11-pbx-clone-custody-v2";
vi.mock("pg", () => { throw new Error("OFFLINE_PG_IMPORT_FORBIDDEN"); });
vi.mock("../server/pbx/ivr-router", () => { throw new Error("OFFLINE_PRODUCT_IMPORT_FORBIDDEN"); });
vi.mock("../server/phone-provisioning", () => { throw new Error("OFFLINE_PRODUCT_IMPORT_FORBIDDEN"); });
const H = "a1".repeat(32), ATTEMPT = "a1".repeat(16);
const expected = { attemptId: ATTEMPT, workerImageId: `sha256:${H}` };
function input() {
  return { schema: "phone11-pbx-clone-real-pg-admission/v2", purpose: "CLONE_HANDLER_REHEARSAL", attemptId: ATTEMPT,
    target: { socketDirectory: CLONE_SOCKET, database: "phone11ai", port: 5432, sourceSystemIdentifier: "7638134557377753122", cloneSystemIdentifier: "7638134557377753123" },
    source: { candidateCommit: CLONE_SOURCE, rollbackArtifactSha256: H },
    software: { workerImageId: `sha256:${H}`, selectedManifest: `sha256:${H}`, nodeRuntimeSha256: H, nodeVersion: "22.14.0", driverBundleSha256: H }, custody: custodyClaim(),
    role: { login: `p11_clone_runtime_${ATTEMPT}`, password: H, restrictedLoginObservationSha256: H, restricted: true, nonOwner: true, noSchemaCreate: true, noDatabaseCreate: true, noPrivilegedMembership: true } };
}
function validate(observation = custodyObservation()) { validateCloneCustodyV2(custodyClaim(observation), observation, expected); }

describe("custody v2 pure consistency only; runtime admission stays NULL", () => {
  it("admits exact synthetic observation shape and emits no authority/metadata", () => {
    expect(validate()).toBeUndefined();
    const token = admitCloneConnectionInput(JSON.stringify(input()), custodyObservation());
    expect(Object.isFrozen(token)).toBe(true); expect(JSON.stringify(token)).toBe("{}");
  });
  it.each([undefined, null, {}, { noExternalMounts: true }, { mounts: [], tmpfs: [] }])("refuses absent or Boolean-only observations %j", observation => {
    expect(() => admitCloneConnectionInput(JSON.stringify(input()), observation)).toThrow("ADMISSION_REFUSED");
  });
  it("refuses legacy v1/noMounts even with valid new observations", () => {
    const value = input(); value.schema = "phone11-pbx-clone-real-pg-admission/v1";
    expect(() => admitCloneConnectionInput(JSON.stringify(value), custodyObservation())).toThrow("ADMISSION_REFUSED");
    const withOldFlag = { ...input(), custody: { observationSha256: H, privateSocket: true, networkNone: true, noMounts: true, ownedFreshClone: true } };
    expect(() => admitCloneConnectionInput(JSON.stringify(withOldFlag), custodyObservation())).toThrow("ADMISSION_REFUSED");
  });
  it.each([
    ["wrong observation schema", (o: ReturnType<typeof custodyObservation>) => { o.schema = "phone11-pbx-clone-custody-observation/v1"; }],
    ["wrong attempt", o => { o.attemptId = "b2".repeat(16); }],
    ["worker id", o => { o.worker.id = "c3".repeat(32); }],
    ["worker name", o => { o.worker.name = "not-owned"; }],
    ["worker image", o => { o.worker.imageId = `sha256:${"c3".repeat(32)}`; }],
    ["engine id", o => { o.engine.workerId = "c3".repeat(32); }],
    ["engine image", o => { o.engine.imageId = `sha256:${"c3".repeat(32)}`; }],
    ["image-config image", o => { o.imageConfig.imageId = `sha256:${"c3".repeat(32)}`; }],
    ["image user", o => { o.imageConfig.user = "10002:10001"; }],
    ["writable root", o => { o.engine.readOnlyRoot = false; }],
    ["network", o => { o.engine.network = "bridge"; }],
    ["published port", o => { (o.engine.publishedPorts as unknown[]).push(5432); }],
    ["privileged", o => { o.engine.privileged = true; }],
    ["capabilities", o => { o.engine.capDrop = []; }],
    ["extra capability", o => { o.engine.capDrop.push("NET_ADMIN"); }],
    ["new privileges", o => { o.engine.noNewPrivileges = false; }],
    ["image implicit volume", o => { (o.imageConfig.volumes as string[]).push("/var/lib/postgresql/data"); }],
    ["empty engine mounts", o => { o.engine.mounts = []; }],
    ["extra mount", o => { o.engine.mounts.push({ ...o.engine.mounts[0] }); }],
    ["host bind", o => { o.engine.mounts[0].type = "bind"; }],
    ["named volume", o => { o.engine.mounts[0].type = "volume"; }],
    ["external source", o => { o.engine.mounts[0].source = "/private/host"; }],
    ["engine mount target", o => { o.engine.mounts[0].target += "/other"; }],
    ["engine read-only mount", o => { o.engine.mounts[0].rw = false; }],
    ["empty tmpfs config", o => { o.engine.tmpfs = []; }],
    ["extra tmpfs", o => { o.engine.tmpfs.push({ ...o.engine.tmpfs[0] }); }],
    ["tmpfs target", o => { o.engine.tmpfs[0].target = "/tmp"; }],
    ["tmpfs size", o => { o.engine.tmpfs[0].bytes++; }],
    ["tmpfs mode", o => { o.engine.tmpfs[0].mode = 0o777; }],
    ["tmpfs readonly", o => { o.engine.tmpfs[0].rw = false; }],
    ["tmpfs suid", o => { o.engine.tmpfs[0].nosuid = false; }],
    ["tmpfs devices", o => { o.engine.tmpfs[0].nodev = false; }],
    ["tmpfs execution", o => { o.engine.tmpfs[0].noexec = false; }],
    ["tmpfs root owner", o => { o.engine.tmpfs[0].uid = 0; }],
    ["tmpfs root group", o => { o.engine.tmpfs[0].gid = 0; }],
    ["tmpfs wrong owner", o => { o.engine.tmpfs[0].uid++; }],
    ["root observed mode", o => { o.ephemeralRoot.mode = 0o755; }],
    ["root observed owner", o => { o.ephemeralRoot.uid = 0; }],
    ["root observed group", o => { o.ephemeralRoot.gid = 10002; }],
    ["root observed path", o => { o.ephemeralRoot.path += "/../other"; }],
    ["data child", o => { o.storage.data = "/var/lib/postgresql/data"; }],
    ["socket child", o => { o.storage.socket += "/../socket"; }],
    ["temporary child", o => { o.storage.temporary = "/tmp"; }],
    ["database", o => { o.storage.database = "postgres"; }],
    ["foreign fixture", o => { o.storage.freshSyntheticOnly = false; }],
    ["trust login", o => { o.storage.passwordAuthenticatedLoginRequired = false; }],
  ] as [string, (o: ReturnType<typeof custodyObservation>) => void][])("refuses %s even with recomputed consistent hash", (_label, mutate) => {
    const observation = custodyObservation(); mutate(observation);
    expect(() => validate(observation)).toThrow("ADMISSION_REFUSED");
  });
  it.each(["0:10001", "10001:0", "0:0", "postgres", "root:root", "010001:10001", "10001:010001", "10001", "10001:10001\n", "10001:10001\r", "10001:10001\u2028", "4294967295:10001"])("requires canonical numeric nonzero user and group %j", user => {
    const o = custodyObservation(); o.engine.user = user; o.imageConfig.user = user;
    expect(() => validate(o)).toThrow("ADMISSION_REFUSED");
  });
  it("refuses observation/hash/source/image substitution independently", () => {
    const observation = custodyObservation(), claim = custodyClaim(observation);
    expect(() => validateCloneCustodyV2({ ...claim, observationSha256: H }, observation, expected)).toThrow("ADMISSION_REFUSED");
    expect(() => validateCloneCustodyV2(claim, observation, { ...expected, workerImageId: `sha256:${"c3".repeat(32)}` })).toThrow("ADMISSION_REFUSED");
    for (const source of ["cd2b317c01d27ee472dca969a097133bd8968464", "ba9091530e88adda16bbf9eb6aec33c674fa501a", "f2fa504dbad22d0966b9f1d43dae86865ef80158"]) {
      const value = input(); value.source.candidateCommit = source;
      expect(() => admitCloneConnectionInput(JSON.stringify(value), observation)).toThrow("ADMISSION_REFUSED");
    }
  });
  it("refuses unknown/private/accessor observations without evaluating accessors or echoing values", () => {
    const observation = custodyObservation(); const getter = vi.fn(() => "PRIVATE_DETAIL");
    Object.defineProperty(observation.engine, "network", { get: getter, enumerable: true });
    expect(() => validateCloneCustodyV2(custodyClaim(), observation, expected)).toThrow("ADMISSION_REFUSED"); expect(getter).not.toHaveBeenCalled();
    const unknown = { ...custodyObservation(), connectionString: "PRIVATE_DETAIL" };
    expect(() => validateCloneCustodyV2(custodyClaim(), unknown, expected)).toThrow("ADMISSION_REFUSED");
    const proxy = new Proxy({}, { getPrototypeOf() { throw new Error("PRIVATE_DETAIL"); } });
    expect(() => validateCloneCustodyV2(custodyClaim(), proxy, expected)).toThrow(/^ADMISSION_REFUSED$/);
  });
  it("uses a canonical observation digest independent of input key order", () => {
    const observation = custodyObservation();
    const reordered = Object.fromEntries(Object.entries(observation).reverse());
    expect(custodyDigest(reordered)).toBe(custodyDigest(observation));
    expect(() => validateCloneCustodyV2(custodyClaim(), reordered, expected)).not.toThrow();
  });
  it("preserves execution NULL refusal before pg import", async () => {
    const token = admitCloneConnectionInput(JSON.stringify(input()), custodyObservation());
    await expect(createRealPgAdapter(token, new AbortController().signal)).rejects.toThrow("EXECUTION_UNBOUND");
  });
  it.each(SELECTED_LANES)("preserves build/fixture NULL refusal before %s product import", async lane => {
    const entry = { schema: "phone11-pbx-selected-handler-input/v1", build: { ...SELECTED_BUILD_CONTRACT, admissionSha256: H }, fixtureAdmissionSha256: H,
      cloneAdmission: JSON.stringify(input()), lane, actorUserId: 7, tenantId: 11, assigneeUserId: 8, extensionId: 3, extensionNumber: "91000001" };
    const result = await runSelectedHandler(JSON.stringify(entry), new AbortController().signal);
    expect(result.code).toBe("ENTRY_BINDING_UNBOUND"); expect(result.runtimeAcceptance).toBe(false); expect(result.productionAcceptance).toBe(false);
  });
  it("keeps all three source admission constants literally NULL", () => {
    const adapter = readFileSync(new URL("../scripts/phone11-pbx-clone/real-pg-adapter.ts", import.meta.url), "utf8");
    const entry = readFileSync(new URL("../scripts/phone11-pbx-clone/selected-handler-entry.ts", import.meta.url), "utf8");
    expect(adapter).toContain("const EXECUTION_ADMISSION_SHA256: string | null = null;");
    expect(entry).toContain("const BUILD_ADMISSION_SHA256: string | null = null;"); expect(entry).toContain("const FIXTURE_ADMISSION_SHA256: string | null = null;");
  });
});
