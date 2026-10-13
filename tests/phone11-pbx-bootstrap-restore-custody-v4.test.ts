import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validateBootstrapRestoreCustodyV4 } from "../scripts/phone11-pbx-clone/bootstrap-restore-custody-v4";
import { bootstrapRestoreFixture } from "./fixtures/phone11-pbx-bootstrap-restore-custody-v4";
export function canonical(v: unknown): string {
  const sort = (x: unknown): unknown => Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, y]) => [k, sort(y)])) : x;
  return JSON.stringify(sort(v));
}
const digest = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
function repin(v: ReturnType<typeof bootstrapRestoreFixture>) { v.expected.restrictedLoginSha256 = digest(v.observation.restrictedLogin); v.expected.observationSha256 = digest(v.observation); v.claim.observationSha256 = v.expected.observationSha256; }
describe("original-bootstrap V4 pure consistency; mock observations only", () => {
  it("separates historical pristine equality from current intentional delta without authority", () => {
    const v = bootstrapRestoreFixture(); const result = validateBootstrapRestoreCustodyV4(v.claim, v.observation, v.expected);
    expect(result).toMatchObject({ consistencyOnly: true, observerAuthority: false, runtimeAuthority: false, productionAcceptance: false, credentialMaterialMayBePresent: true });
    expect(v.observation.intentionalDeltaSemanticsSha256).not.toBe(v.expected.sourceSemanticsSha256);
  });
  it.each([
    ["old PG name", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.pg.name = `phone11-protected-baseline-${v.expected.attemptId}`; }],
    ["old root", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.custody.runDirectory.path = `/var/lib/phone11-pbx-protected-baseline/${v.expected.attemptId}`; }],
    ["source SID", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.cloneSystemIdentifier = v.observation.sourceSystemIdentifier; }],
    ["production mount", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.pg.mounts[0].source = "/var/run/docker.sock"; }],
    ["network", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.worker.network = "host"; }],
    ["role elevated", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.restrictedLogin.attributes.superuser = true; }],
    ["old canonicalization", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.pristineSemantics.canonicalization = "phone11-catalog-semantics-without-oids/v1"; }],
    ["drifted historical source", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.pristineSemantics.restored.roles.records++; }],
    ["delta relabeled pristine", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.intentionalDeltaSemanticsSha256 = v.expected.sourceSemanticsSha256; }],
    ["historical future", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.pristineObservedAtMs = v.observation.currentObservedAtMs + 1; }],
    ["private custody", (v: ReturnType<typeof bootstrapRestoreFixture>) => { v.observation.custody.socket.mode = 0o777; }],
  ])("rejects %s even after observation repinning", (_name, mutate) => {
    const v = bootstrapRestoreFixture(); mutate(v); repin(v); expect(() => validateBootstrapRestoreCustodyV4(v.claim, v.observation, v.expected)).toThrow("RESTORE_CUSTODY_REFUSED");
  });
  it("never executes getters/proxy or echoes secret errors", () => {
    const v = bootstrapRestoreFixture(); let touched = false;
    const getter = Object.defineProperty({}, "schema", { enumerable: true, get() { touched = true; throw Error("SECRET"); } });
    for (const x of [getter, new Proxy({}, { get() { touched = true; throw Error("SECRET"); } })]) expect(() => validateBootstrapRestoreCustodyV4(v.claim, x, v.expected)).toThrow(/^RESTORE_CUSTODY_REFUSED$/);
    expect(touched).toBe(false);
  });
});
