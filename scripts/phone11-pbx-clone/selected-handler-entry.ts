/** Selected clone entry: source preparation only; all execution admissions remain unbound. */
import type { TrpcContext } from "../../server/_core/context";
import { admitCloneConnectionInput, createRealPgAdapter, safeCloneError, type CloneAdapter } from "./real-pg-adapter";
import { bindSelectedResources, retireSelectedResources, LOCAL_REDIS_URL } from "./selected-resource-bridge";

export const SELECTED_PRODUCT_SOURCE = "f2fa504dbad22d0966b9f1d43dae86865ef80158";
export const SELECTED_PRODUCT_PINS = Object.freeze([
  {
    "path": "server/pbx/ivr-router.ts",
    "sha256": "94f414fcfe8c9c6b3ef96789a7e4f3fe60d112e27a3346510c40317d77c7cb3c"
  },
  {
    "path": "server/_core/trpc.ts",
    "sha256": "0fd486ef9810a38b1d9f90df512846fc874553c8a17decf4a26fed006cd4c92b"
  },
  {
    "path": "shared/const.ts",
    "sha256": "d9fedf20dc67e22f79ee6c624e613fdbc16e2cc7db872201f89ffbad7f5c163b"
  },
  {
    "path": "server/pbx/db.ts",
    "sha256": "73c37d847f23b5a6d33507c62dc666dbc8e601a09f306ba539d1de333b5b3709"
  },
  {
    "path": "server/pbx/audit.ts",
    "sha256": "0b58fa8a75c534c6900140414af2f8e960b0f7ae6a4a25618a0f0788dfd8e94d"
  },
  {
    "path": "server/pbx/redis.ts",
    "sha256": "4717c592961c5065fdc8cd933897110c5ee9537850a791e15291bf26b1ddbf49"
  },
  {
    "path": "server/pbx/tenant-middleware.ts",
    "sha256": "d148fcd4425e09cbc04143f8dd853e162b6b65cb548aecd685ffb30d26fcd879"
  },
  {
    "path": "server/pbx/schema-capabilities.ts",
    "sha256": "508b38df0398f83fe6200f301d59db6c5f3a0939ea258cc3e864e4a47936fb29"
  },
  {
    "path": "server/phone-provisioning.ts",
    "sha256": "18513fafedae1e85baa07b386e55eb3f329ed5ecb4b620cc34cd947c63617ac0"
  },
  {
    "path": "server/pbx/sip-secrets.ts",
    "sha256": "dd848b73dfc8b566e2dc4d5cd32167be5b352a58ca6280c8cfe91053c6324859"
  }
].map(pin => Object.freeze(pin)));
export const SELECTED_BUILD_CONTRACT = Object.freeze({
  schema: "phone11-pbx-selected-build/v1",
  sourceCommit: SELECTED_PRODUCT_SOURCE,
  graphSha256: "b0ecf11d87b2f96e6efd57fbc1339415564a1c0edbfb19ce5f982983b7318cf6",
  adapterSha256: "3a82401460aa46622b1a155f9b073b0e8ddbb1719ddcc7de665b358a548d8a08",
  databaseAlias: "scripts/phone11-pbx-clone/selected-resource-bridge.ts",
  redisTransportAlias: "scripts/phone11-pbx-clone/selected-resource-bridge.ts",
});
// A reviewed bundle/metafile + fixture custodian must bind these in a later revision.
// JSON shape or a caller-supplied hash is not authenticated software/fixture admission.
const BUILD_ADMISSION_SHA256: string | null = null;
const FIXTURE_ADMISSION_SHA256: string | null = null;
export const SELECTED_LANES = Object.freeze(["IVR_CREATE", "IVR_LIST", "PROVISION_CREATE", "PROVISION_ASSIGN"] as const);
type Lane = typeof SELECTED_LANES[number];
type EntryCode = "INPUT_REFUSED" | "BUILD_BINDING_REFUSED" | "ENTRY_BINDING_UNBOUND" | "FIXTURE_BINDING_REFUSED" | "ENVIRONMENT_REFUSED" | "CANCELLED" | "ENTRY_USED" | "CALL_COMPLETED" | "CLOSE_FAILED" | "CLOSE_TIMEOUT";
class EntryRefusal extends Error { constructor(readonly code: EntryCode) { super(code); } }
function refuse(code: EntryCode): never { throw new EntryRefusal(code); }
const HASH = /^[a-f0-9]{64}$/;
interface Input {
  lane: Lane; cloneAdmission: string; fixtureAdmissionSha256: string;
  actorUserId: number; tenantId: number; assigneeUserId: number; extensionId: number; extensionNumber: string;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) refuse("INPUT_REFUSED");
  return value as Record<string, unknown>;
}
/** Pure private input parser. No target defaults, SQL, external context, generic handler names or result payloads. */
export function parseSelectedHandlerInput(text: string): Input {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 16384) refuse("INPUT_REFUSED");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { refuse("INPUT_REFUSED"); }
  const input = exact(raw, ["schema", "build", "fixtureAdmissionSha256", "cloneAdmission", "lane", "actorUserId", "tenantId", "assigneeUserId", "extensionId", "extensionNumber"]);
  if (input.schema !== "phone11-pbx-selected-handler-input/v1" || !SELECTED_LANES.includes(input.lane as Lane) ||
      typeof input.cloneAdmission !== "string" || Buffer.byteLength(input.cloneAdmission, "utf8") > 8192 ||
      typeof input.fixtureAdmissionSha256 !== "string" || !HASH.test(input.fixtureAdmissionSha256) || /^0+$/.test(input.fixtureAdmissionSha256) ||
      typeof input.extensionNumber !== "string" || !/^91[0-9]{6}$/.test(input.extensionNumber)) refuse("INPUT_REFUSED");
  for (const key of ["actorUserId", "tenantId", "assigneeUserId", "extensionId"]) {
    if (!Number.isSafeInteger(input[key]) || ((input[key] as number) <= 0 || (input[key] as number) > 2147483647)) refuse("INPUT_REFUSED");
  }
  const binding = exact(input.build, [...Object.keys(SELECTED_BUILD_CONTRACT), "admissionSha256"]);
  if (Object.entries(SELECTED_BUILD_CONTRACT).some(([key, value]) => binding[key] !== value) ||
      typeof binding.admissionSha256 !== "string" || !HASH.test(binding.admissionSha256) || /^0+$/.test(binding.admissionSha256)) refuse("BUILD_BINDING_REFUSED");
  // Do not erase the distinct adapter admission: it still validates private target/software/role pins.
  if (BUILD_ADMISSION_SHA256 === null || FIXTURE_ADMISSION_SHA256 === null) refuse("ENTRY_BINDING_UNBOUND");
  if (binding.admissionSha256 !== BUILD_ADMISSION_SHA256) refuse("BUILD_BINDING_REFUSED");
  if (input.fixtureAdmissionSha256 !== FIXTURE_ADMISSION_SHA256) refuse("FIXTURE_BINDING_REFUSED");
  return input as unknown as Input;
}
const SYNTHETIC_ENV = Object.freeze({
  SIP_DOMAIN: "clone.phone11.invalid", SIP_STUN_SERVER: "stun:clone.invalid:3478",
  SIP_PORT: "5060", SIP_DEK_SECRET: "phone11-clone-only-synthetic-dek-v1", REDIS_URL: LOCAL_REDIS_URL,
});
let used = false;
/** No CLI/stdout startup. One call per future isolated process; safe statuses only. */
export async function runSelectedHandler(text: string, signal: AbortSignal): Promise<Readonly<Record<string, string | boolean>>> {
  let adapter: CloneAdapter | undefined;
  let envSet = false;
  let code: string = "UNCLASSIFIED";
  let completed = false;
  let ended = false;
  const savedConsole = { error: console.error, warn: console.warn, log: console.log };
  let quiet = false;
  try {
    const input = parseSelectedHandlerInput(text);
    if (!(signal instanceof AbortSignal) || signal.aborted) refuse("CANCELLED");
    if (used) refuse("ENTRY_USED");
    // Presence only: never read ambient SIP/Redis values or permit them to affect these selected lanes.
    if (Object.keys(process.env).some(key => /^(?:SIP_|REDIS)/i.test(key))) refuse("ENVIRONMENT_REFUSED");
    used = true;
    adapter = await createRealPgAdapter(admitCloneConnectionInput(input.cloneAdmission), signal);
    bindSelectedResources(adapter, signal);
    for (const [key, value] of Object.entries(SYNTHETIC_ENV)) process.env[key] = value;
    envSet = true;
    // This single-use isolated worker suppresses the selected wrappers' diagnostic console calls.
    // The transport does not emit artificial network events or business results.
    console.error = console.warn = console.log = () => undefined;
    quiet = true;
    if (signal.aborted) refuse("CANCELLED");
    if (input.lane === "IVR_CREATE" || input.lane === "IVR_LIST") {
      const { ivrRouter } = await import("../../server/pbx/ivr-router");
      // Synthetic internal caller identity, not HTTP/JWT authentication. Held SQL checks remain authentic.
      const ctx = { user: { id: input.actorUserId }, req: { ip: "127.0.0.1" }, res: {} } as TrpcContext;
      const caller = ivrRouter.createCaller(ctx);
      if (input.lane === "IVR_CREATE") await caller.ivr.create({ tenant_id: input.tenantId, name: "clone-rehearsal" });
      else await caller.ivr.list({ tenant_id: input.tenantId });
    } else {
      const { createExtension, assignExtensionToUser } = await import("../../server/phone-provisioning");
      if (input.lane === "PROVISION_CREATE") await createExtension({ orgId: input.tenantId, extensionNumber: input.extensionNumber, displayName: "clone-rehearsal", actorUserId: input.actorUserId });
      else await assignExtensionToUser(input.assigneeUserId, input.extensionId, true, input.tenantId, input.actorUserId);
    }
    // Plaintext SIP material, rows and errors stay inside the private process and are never returned.
    if (signal.aborted) refuse("CANCELLED");
    completed = true;
    code = "CALL_COMPLETED";
  } catch (error) {
    code = error instanceof EntryRefusal ? error.code : safeCloneError(error).code;
  } finally {
    if (adapter) retireSelectedResources();
    if (adapter) {
      try {
        const result = await adapter.close();
        ended = result.ended;
        if (!result.ended) { completed = false; code = result.code; }
      } catch { completed = false; code = "CLOSE_FAILED"; }
    }
    if (envSet) for (const key of Object.keys(SYNTHETIC_ENV)) delete process.env[key];
    if (quiet) Object.assign(console, savedConsole);
  }
  return Object.freeze({ schema: "phone11-pbx-selected-handler-status/v1", outcome: completed ? "CALL_COMPLETED" : "REFUSED", code, adapterClosed: ended,
    fixtureAssertionsProven: false, externalRedisProven: false, httpAuthenticationProven: false, runtimeAcceptance: false, productionAcceptance: false });
}
