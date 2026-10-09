import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { build } from "esbuild";
import type { CloneAdapter, ClonePool } from "../scripts/phone11-pbx-clone/real-pg-adapter";
import { parseSelectedHandlerInput, runSelectedHandler, SELECTED_BUILD_CONTRACT, SELECTED_PRODUCT_PINS, SELECTED_LANES } from "../scripts/phone11-pbx-clone/selected-handler-entry";
vi.mock("pg", () => { throw new Error("OFFLINE_DRIVER_IMPORT_FORBIDDEN"); });
vi.mock("../server/pbx/ivr-router", () => { throw new Error("OFFLINE_PRODUCT_IMPORT_FORBIDDEN"); });
vi.mock("../server/phone-provisioning", () => { throw new Error("OFFLINE_PRODUCT_IMPORT_FORBIDDEN"); });
const H = "a1".repeat(32); // Synthetic offline shape only; cannot authenticate any execution admission.
function input() {
  return { schema: "phone11-pbx-selected-handler-input/v1", build: { ...SELECTED_BUILD_CONTRACT, admissionSha256: H }, fixtureAdmissionSha256: H,
    cloneAdmission: "{}", lane: "IVR_CREATE", actorUserId: 7, tenantId: 11, assigneeUserId: 8, extensionId: 3, extensionNumber: "91000001" };
}
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("selected entry pure refusal; no real product or pg imports", () => {
  it.each(SELECTED_LANES)("keeps %s execution unbound despite valid-shaped fake pins", async lane => {
    const value = { ...input(), lane };
    expect(() => parseSelectedHandlerInput(JSON.stringify(value))).toThrow("ENTRY_BINDING_UNBOUND");
    expect(await runSelectedHandler(JSON.stringify(value), new AbortController().signal)).toEqual({
      schema: "phone11-pbx-selected-handler-status/v1", outcome: "REFUSED", code: "ENTRY_BINDING_UNBOUND", adapterClosed: false,
      fixtureAssertionsProven: false, externalRedisProven: false, httpAuthenticationProven: false, runtimeAcceptance: false, productionAcceptance: false,
    });
  });
  it.each(["", "{", "null", "[]", " ".repeat(16385)])("denies invalid/oversized input without reflecting it", async text => {
    const value = await runSelectedHandler(text, new AbortController().signal);
    expect(value.code).toBe("INPUT_REFUSED"); expect(Object.values(value)).not.toContain(text);
  });
  it.each(["ACTORLESS_INITIALIZER", "PHONE_RPC", "PBX_ROUTER", "HTTP", "JWT", "sql", "createCaller"])("does not expose %s", lane => {
    expect(() => parseSelectedHandlerInput(JSON.stringify({ ...input(), lane }))).toThrow("INPUT_REFUSED");
  });
  it.each(["actorUserId", "tenantId", "assigneeUserId", "extensionId"])("requires positive explicit %s", key => {
    for (const bad of [null, -1, 0, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseSelectedHandlerInput(JSON.stringify({ ...input(), [key]: bad }))).toThrow("INPUT_REFUSED");
    }
  });
  it.each(["host", "ctx", "sql", "DATABASE_URL", "password", "__proto__"])("rejects extra private input key %s", key => {
    expect(() => parseSelectedHandlerInput(JSON.stringify({ ...input(), [key]: "DO_NOT_ECHO" }))).toThrow("INPUT_REFUSED");
  });
  it.each(Object.keys(SELECTED_BUILD_CONTRACT))("denies substituted build binding %s before imports", key => {
    expect(() => parseSelectedHandlerInput(JSON.stringify({ ...input(), build: { ...input().build, [key]: "DO_NOT_ECHO" } }))).toThrow("BUILD_BINDING_REFUSED");
  });
  it("rejects missing/unknown binding keys and oversized nested admission", () => {
    const value = input(); delete (value.build as Partial<typeof value.build>).databaseAlias;
    expect(() => parseSelectedHandlerInput(JSON.stringify(value))).toThrow("INPUT_REFUSED");
    expect(() => parseSelectedHandlerInput(JSON.stringify({ ...input(), build: { ...input().build, extra: true } }))).toThrow("INPUT_REFUSED");
    expect(() => parseSelectedHandlerInput(JSON.stringify({ ...input(), cloneAdmission: "a".repeat(8193) }))).toThrow("INPUT_REFUSED");
  });
  it("keeps console and ambient SIP/Redis untouched on refusal; emits no raw errors", async () => {
    const error = vi.spyOn(console, "error"); const warn = vi.spyOn(console, "warn"); const log = vi.spyOn(console, "log");
    const before = Object.keys(process.env).sort();
    const result = await runSelectedHandler(JSON.stringify({ ...input(), credential: "DO_NOT_ECHO" }), new AbortController().signal);
    expect(result.code).toBe("INPUT_REFUSED"); expect(JSON.stringify(result)).not.toContain("DO_NOT_ECHO");
    expect(Object.keys(process.env).sort()).toEqual(before); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
  });
});

async function bridgeFixture() {
  vi.resetModules();
  const bridge = await import("../scripts/phone11-pbx-clone/selected-resource-bridge");
  const row = { rows: [], fields: [], command: "SELECT", rowCount: 0, oid: 0 };
  const pool = { query: vi.fn(async () => row), connect: vi.fn() } as unknown as ClonePool;
  const query = vi.fn(async () => row);
  const withTransaction = vi.fn(async (fn: (client: unknown) => unknown) => fn(pool));
  const adapter = { getPool: vi.fn(() => pool), query, withTransaction, close: vi.fn() } as unknown as CloneAdapter;
  const abort = new AbortController();
  bridge.bindSelectedResources(adapter, abort.signal);
  return { bridge, adapter, query, pool, withTransaction, abort, redis: new bridge.default(bridge.LOCAL_REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true, retryStrategy: () => 1 }) };
}

describe("injected transport bridge only; not actual handler or driver execution", () => {
  it("refuses pool/cache before binding", async () => {
    vi.resetModules(); const b = await import("../scripts/phone11-pbx-clone/selected-resource-bridge");
    expect(() => b.getPool()).toThrow("RESOURCE_BRIDGE_REFUSED");
    expect(() => new b.default(b.LOCAL_REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true, retryStrategy: () => 1 })).toThrow("RESOURCE_BRIDGE_REFUSED");
  });
  it("forwards exact SQL/values/results and transaction callback unchanged", async () => {
    const { bridge, adapter, query, withTransaction, pool } = await bridgeFixture();
    const sql = "SYNTHETIC_OFFLINE_SQL"; const values = [7, null];
    expect(await bridge.query(sql, values)).toBe(await query.mock.results[0].value);
    expect(query).toHaveBeenCalledWith(sql, values); expect(bridge.getPool()).toBe(pool); expect(adapter.getPool).toHaveBeenCalled();
    const callback = vi.fn(async () => 9);
    expect(await bridge.withTransaction(callback)).toBe(9); expect(withTransaction).toHaveBeenCalledWith(callback);
  });
  it("preserves private driver errors in memory rather than fabricating a result", async () => {
    const { bridge, query } = await bridgeFixture(); const failure = Object.assign(new Error("PRIVATE_DETAIL"), { code: "42501" });
    query.mockRejectedValueOnce(failure);
    await expect(bridge.query("SYNTHETIC", [])).rejects.toBe(failure);
  });
  it("is single-use and clears private cache/calls after cancellation", async () => {
    const { bridge, adapter, abort, redis } = await bridgeFixture();
    await redis.setex("tenant:memberships:7", 300, "[]");
    expect(() => bridge.bindSelectedResources(adapter, abort.signal)).toThrow("RESOURCE_BRIDGE_REFUSED");
    abort.abort(); expect(() => bridge.getPool()).toThrow("RESOURCE_BRIDGE_REFUSED");
    await expect(redis.get("tenant:memberships:7")).rejects.toThrow("RESOURCE_BRIDGE_REFUSED");
    expect(() => bridge.bindSelectedResources(adapter, new AbortController().signal)).toThrow("RESOURCE_BRIDGE_REFUSED");
  });
  it.each(["redis://43.210.122.111:6379", "redis://secret@127.0.0.1:6379", "rediss://127.0.0.1:6379", "redis://127.0.0.1:6379/1"])("denies external/default substitution %s", async url => {
    const { bridge } = await bridgeFixture();
    expect(() => new bridge.default(url, { maxRetriesPerRequest: 3, lazyConnect: true, retryStrategy: () => 1 })).toThrow("RESOURCE_BRIDGE_REFUSED");
  });
  it("implements real wrapper cache miss/hit/TTL and bounded local invalidation, no external events", async () => {
    vi.useFakeTimers(); const { redis } = await bridgeFixture(); const listener = vi.fn();
    redis.on("connect", listener); await redis.connect(); expect(listener).not.toHaveBeenCalled();
    expect(await redis.get("tenant:memberships:7")).toBeNull();
    await redis.setex("tenant:memberships:7", 300, '[{"tenantId":11}]');
    expect(await redis.get("tenant:memberships:7")).toBe('[{"tenantId":11}]');
    await vi.advanceTimersByTimeAsync(300001); expect(await redis.get("tenant:memberships:7")).toBeNull();
    await redis.setex("dialplan:ivr:11", 300, "x");
    expect(await redis.keys("dialplan:ivr:*")).toEqual(["dialplan:ivr:11"]);
    expect(await redis.del("dialplan:ivr:11")).toBe(1); expect(await redis.keys("dialplan:ivr:*")).toEqual([]);
    expect("incr" in redis).toBe(false); expect("expire" in redis).toBe(false);
  });
  it("denies unsupported key/pattern/TTL/value capacity rather than using remote Redis", async () => {
    const { redis } = await bridgeFixture();
    await expect(redis.get("authorization:token")).rejects.toThrow("RESOURCE_BRIDGE_REFUSED");
    await expect(redis.keys("*")).rejects.toThrow("RESOURCE_BRIDGE_REFUSED");
    await expect(redis.setex("tenant:memberships:7", 86400, "x")).rejects.toThrow("RESOURCE_BRIDGE_REFUSED");
    await expect(redis.setex("tenant:memberships:7", 300, "x".repeat(16385))).rejects.toThrow("RESOURCE_BRIDGE_REFUSED");
    for (let id = 1; id <= 64; id++) await redis.setex(`tenant:memberships:${id}`, 300, "x");
    await expect(redis.setex("tenant:memberships:65", 300, "x")).rejects.toThrow("RESOURCE_BRIDGE_REFUSED");
    await expect(redis.del(...Array(65).fill("tenant:memberships:1"))).rejects.toThrow("RESOURCE_BRIDGE_REFUSED");
  });
});

describe("static build identities, never evaluate product modules or resulting bundle", () => {
  it("binds all ten inspected source files and real adapter bytes", () => {
    for (const pin of SELECTED_PRODUCT_PINS) expect(digest(readFileSync(pin.path))).toBe(pin.sha256);
    expect(digest(JSON.stringify(SELECTED_PRODUCT_PINS))).toBe(SELECTED_BUILD_CONTRACT.graphSha256);
    expect(digest(readFileSync("scripts/phone11-pbx-clone/real-pg-adapter.ts"))).toBe(SELECTED_BUILD_CONTRACT.adapterSha256);
  });
  it("compiles actual selected modules with only DB and ioredis transport aliases; excludes unrelated graph", async () => {
    const bridge = resolve(SELECTED_BUILD_CONTRACT.databaseAlias);
    const originalDb = resolve("server/pbx/db.ts");
    const aliases: string[] = [];
    const result = await build({ entryPoints: ["scripts/phone11-pbx-clone/selected-handler-entry.ts"], bundle: true, write: false, platform: "node", packages: "external", format: "esm", target: "node22", metafile: true, treeShaking: true,
      plugins: [{ name: "fixed-selected-resource-aliases", setup(builder) {
        builder.onResolve({ filter: /^(?:\.\/db|\.\/pbx\/db)$/ }, args => {
          if (resolve(dirname(args.importer), args.path + ".ts") !== originalDb) throw new Error("UNEXPECTED_DATABASE_IMPORT");
          aliases.push(args.importer); return { path: bridge };
        });
        builder.onResolve({ filter: /^ioredis$/ }, args => {
          if (args.importer !== resolve("server/pbx/redis.ts")) throw new Error("UNEXPECTED_REDIS_IMPORT");
          aliases.push(args.importer); return { path: bridge };
        });
      } }],
    });
    const inputs = Object.keys(result.metafile!.inputs).sort();
    const product = inputs.filter(path => path.startsWith("server/") || path.startsWith("shared/"));
    expect(product).toEqual(SELECTED_PRODUCT_PINS.map(pin => pin.path).filter(path => path !== "server/pbx/db.ts").sort());
    expect(new Set(aliases.map(path => path.slice(process.cwd().length + 1)))).toEqual(new Set(["server/pbx/ivr-router.ts", "server/pbx/audit.ts", "server/pbx/tenant-middleware.ts", "server/pbx/schema-capabilities.ts", "server/phone-provisioning.ts", "server/pbx/redis.ts"]));
    expect(inputs).not.toContain("server/pbx/db.ts"); expect(inputs).not.toContain("server/_core/context.ts");
    expect(inputs.some(path => /routers\.ts|pbx-router|profile\/|sdk\.ts|auth\/|cloud-record|gemini/i.test(path))).toBe(false);
    const externals = Object.values(result.metafile!.inputs).flatMap(value => value.imports.filter(item => item.external).map(item => item.path));
    expect([...new Set(externals)].sort()).toEqual(["@trpc/server", "crypto", "pg", "superjson", "zod"]);
    const code = result.outputFiles![0].text;
    expect(code).not.toContain("createCloneAdapterForTests"); expect(code).not.toContain("buildPgConfig"); expect(code).not.toContain("new Redis(");
    expect(code).toContain("ENTRY_BINDING_UNBOUND"); expect(code).toContain("EXECUTION_UNBOUND");
    // Only hashes, not source/rows/results, are emitted into the retained validation log.
    console.info(`SELECTED_COMPILE_ONLY bundleSha256=${digest(code)} metafileSha256=${digest(JSON.stringify(result.metafile))} localInputs=${inputs.length}`);
  });
  it("retains literal actual imports, middleware/helper calls and no test-factory/actorless lane", () => {
    const source = readFileSync("scripts/phone11-pbx-clone/selected-handler-entry.ts", "utf8");
    expect(source).toContain('await import("../../server/pbx/ivr-router")'); expect(source).toContain('await import("../../server/phone-provisioning")');
    expect(source).toContain("ivrRouter.createCaller(ctx)"); expect(source).toContain("actorUserId: input.actorUserId");
    expect(source).toContain("true, input.tenantId, input.actorUserId");
    expect(source).not.toContain("createCloneAdapterForTests"); expect(source).not.toContain("appRouter"); expect(source).not.toContain("ensurePhoneProvisioningSchema");
    expect(source.indexOf("adapter = await createRealPgAdapter")).toBeLessThan(source.indexOf('await import("../../server/pbx/ivr-router")'));
  });
});
