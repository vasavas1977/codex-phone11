import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ query: vi.fn(), cache: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: f.query }));
vi.mock("../server/pbx/fraud-policy-db", () => ({ withFraudPolicyTransaction: vi.fn() }));
vi.mock("../server/pbx/redis", () => ({
  rateLimitCheck: vi.fn(), invalidateCache: vi.fn(), cacheGetOrSet: f.cache,
}));
vi.mock("../server/cloud-recordings/correlation", () => ({ bindAuthenticatedOutbound: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({ processCdr: vi.fn() }));
vi.mock("../server/pbx/dialplan-generators", () => ({
  generateIvrDialplan: vi.fn(), generateRingGroupDialplan: vi.fn(),
  generateQueueDialplan: vi.fn(), evaluateTimeCondition: vi.fn(),
}));
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

const route = freeswitchRouter.stack.find(item => item.route?.path === "/directory")!.route!;
const secret = "synthetic-directory-secret-0123456789012345";
const account = {
  sip_username: "3001", sip_domain: "sip.example.test", ha1: "a".repeat(32), tenant_id: 7,
  extension_number: "3001", display_name: "Fixture User", voicemail_enabled: true, tenant_slug: "fixture",
};
async function lookup(body: unknown = { user: "3001", domain: "sip.example.test" }, suppliedSecret = secret) {
  const res = {
    code: 200, body: "", status(n: number) { this.code = n; return this; }, type() { return this; },
    send(value: string) { this.body = value; return this; }, json(value: unknown) { this.body = JSON.stringify(value); return this; },
  };
  const req = { headers: { "x-fs-secret": suppliedSecret }, body };
  let admitted = false;
  route.stack[0].handle(req as any, res as any, () => { admitted = true; });
  if (admitted) await route.stack[1].handle(req as any, res as any, () => undefined);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("FS_SHARED_SECRET", secret);
  f.query.mockResolvedValue({ rows: [account] });
  f.cache.mockImplementation((_key, _ttl, load) => load());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("FreeSWITCH directory restricted read contract", () => {
  it("returns digest and routing fields from the narrow active-tenant lookup", async () => {
    const res = await lookup();
    expect(res.body).toContain(`<param name="a1-hash" value="${account.ha1}"/>`);
    expect(res.body).toContain('<variable name="tenant_id" value="7"/>');
    expect(res.body).toContain('<param name="vm-enabled" value="true"/>');
    const [sql, params] = f.query.mock.calls[0];
    expect(params).toEqual(["3001", "sip.example.test"]);
    expect(sql).not.toMatch(/sa\.\*|call_forwarding|cfu_destination|cfb_destination|dnd_enabled/);
    expect(sql).toContain("e.tenant_id = sa.tenant_id");
    for (const clause of ["sa.status = 'active'", "sa.deleted_at IS NULL", "e.status = 'active'", "e.deleted_at IS NULL", "t.status = 'active'", "LIMIT 2"]) expect(sql).toContain(clause);
    expect(f.cache).toHaveBeenCalledWith("directory:sip.example.test:3001", 30, expect.any(Function));
  });
  it.each([[], [account, { ...account, tenant_id: 8 }]].map(rows => ({ rows })))("returns no identity for missing or ambiguous assignment", async ({ rows }) => {
    f.query.mockResolvedValue({ rows });
    const res = await lookup();
    expect(res.body).toContain('<section name="directory">');
    expect(res.body).not.toContain('<user'); expect(res.body).not.toContain(account.ha1);
  });
  it("does not consult the cache or database without authentication", async () => {
    const res = await lookup(undefined, "wrong");
    expect(res.code).not.toBe(200); expect(f.cache).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled();
  });
  it("does not query incomplete directory requests", async () => {
    expect((await lookup({ user: "3001" })).body).not.toContain('<user');
    expect(f.query).not.toHaveBeenCalled();
  });
  it("returns empty directory after a database failure without exposing its message", async () => {
    f.query.mockRejectedValue(new Error("PRIVATE_DATABASE_ERROR"));
    const res = await lookup(); expect(res.body).not.toContain('<user'); expect(res.body).not.toContain("PRIVATE_DATABASE_ERROR");
  });
});
