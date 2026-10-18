import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Invoke the real mounted handlers in process; no listener, DB, Redis or SIP.
const db = vi.hoisted(() => ({ query: vi.fn() }));
const policy = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
const integrations = vi.hoisted(() => ({ rateLimitCheck: vi.fn(), bindAuthenticatedOutbound: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/fraud-policy-db", () => ({ withFraudPolicyTransaction: policy.transaction }));
vi.mock("../server/pbx/redis", () => ({
  rateLimitCheck: integrations.rateLimitCheck, invalidateCache: vi.fn(),
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
}));
vi.mock("../server/cloud-recordings/correlation", () => ({ bindAuthenticatedOutbound: integrations.bindAuthenticatedOutbound }));
vi.mock("../server/pbx/cdr-processor", () => ({ processCdr: vi.fn() }));
vi.mock("../server/pbx/dialplan-generators", () => ({
  generateIvrDialplan: vi.fn(), generateRingGroupDialplan: vi.fn(),
  generateQueueDialplan: vi.fn(), evaluateTimeCondition: vi.fn(),
}));
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

const secret = "synthetic-freeswitch-secret-0123456789";
const layer = freeswitchRouter.stack.find(item => item.route?.path === "/dialplan");
const route = layer!.route!;
const auth = route.stack[0]!.handle;
const handler = route.stack[1]!.handle;

async function dial(destination: string, suppliedSecret = secret) {
  let admitted = false;
  const res = {
    code: 200, body: "",
    status(value: number) { this.code = value; return this; },
    type() { return this; },
    send(value: string) { this.body = value; return this; },
    json(value: unknown) { this.body = JSON.stringify(value); return this; },
  };
  const req = { headers: { "x-fs-secret": suppliedSecret }, body: {
    "Caller-Destination-Number": destination, "Caller-Caller-ID-Number": "1996",
    "variable_sip_from_user": "1996", "variable_domain_name": "sip.example.test",
  } };
  auth(req as any, res as any, () => { admitted = true; });
  if (admitted) await handler(req as any, res as any, () => undefined);
  return res;
}

beforeEach(() => {
  vi.stubEnv("FS_SHARED_SECRET", secret);
  db.query.mockReset().mockImplementation(() => { throw new Error("UNEXPECTED_SHARED_PBX_QUERY"); })
    .mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] });
  policy.query.mockReset().mockResolvedValue({ rows: [] });
  policy.transaction.mockReset().mockImplementation(async (_tenantId, callback) => callback({ query: policy.query }));
  integrations.rateLimitCheck.mockReset().mockResolvedValue(true);
  integrations.bindAuthenticatedOutbound.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const policyRow = (overrides: Record<string, unknown> = {}) => ({
  tenant_id: 7, international_enabled: true, premium_rate_enabled: true, ...overrides,
});

function expectDedicatedPolicyRead() {
  expect(db.query).toHaveBeenCalledOnce();
  expect(db.query.mock.calls[0][1]).toEqual(["1996", "sip.example.test"]);
  expect(policy.transaction).toHaveBeenCalledWith(7, expect.any(Function));
  expect(policy.query).toHaveBeenCalledOnce();
  const [sql, values] = policy.query.mock.calls[0]!;
  expect(sql.replace(/\s+/g, " ")).toBe("SELECT tenant_id, international_enabled, premium_rate_enabled FROM fraud_controls WHERE tenant_id = $1");
  expect(values).toEqual([7]);
}

describe("explicit tenant fraud policy on protected outbound modes", () => {
  it.each([
    [], [policyRow({ international_enabled: false })], [policyRow({ international_enabled: null })], [{}],
    [null], [policyRow({ international_enabled: "true" })], [policyRow({ international_enabled: 1 })],
    [policyRow(), policyRow()], [policyRow({ international_enabled: false }), policyRow()],
    [policyRow({ premium_rate_enabled: undefined })], [policyRow({ premium_rate_enabled: null })],
    [policyRow({ premium_rate_enabled: "true" })], [policyRow({ premium_rate_enabled: 1 })],
  ].map(rows => ({ rows })))("blocks international when policy rows are absent, ambiguous or malformed: $rows", async ({ rows }) => {
    policy.query.mockResolvedValueOnce({ rows });
    const res = await dial("+12025550123");
    expect(res.body).toContain("International calls disabled");
    expect(res.body).not.toContain('application="bridge"');
    expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
    expectDedicatedPolicyRead();
  });

  it("keeps a single explicit international allow tenant-scoped without requiring premium admission", async () => {
    policy.query.mockResolvedValueOnce({ rows: [policyRow({ premium_rate_enabled: false })] });
    const res = await dial("+12025550123");
    expect(res.body).toContain('data="sofia/gateway/pstn_gateway/+12025550123"');
    expectDedicatedPolicyRead();
    expect(integrations.bindAuthenticatedOutbound).toHaveBeenCalledOnce();
  });

  it.each([
    [], [policyRow({ premium_rate_enabled: false })], [policyRow({ premium_rate_enabled: null })], [{}],
    [null], [policyRow({ premium_rate_enabled: "true" })], [policyRow({ premium_rate_enabled: 1 })],
    [policyRow(), policyRow()], [policyRow({ premium_rate_enabled: false }), policyRow()],
  ].map(rows => ({ rows })))("blocks premium without exactly one boolean allow after international admission: $rows", async ({ rows }) => {
    policy.query.mockResolvedValueOnce({ rows });
    const res = await dial("+19005550123");
    // Malformed combined policy cannot authorize international admission either.
    expect(res.body).toContain(rows.length === 1 && (rows[0] as { premium_rate_enabled?: unknown } | null)?.premium_rate_enabled === false
      ? "Premium rate calls disabled" : "International calls disabled");
    expect(res.body).not.toContain('application="bridge"');
    expectDedicatedPolicyRead();
    expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it("keeps premium routing when both required policies explicitly allow it", async () => {
    policy.query.mockResolvedValueOnce({ rows: [policyRow()] });
    expect((await dial("+19005550123")).body).toContain('data="sofia/gateway/pstn_gateway/+19005550123"');
    expectDedicatedPolicyRead();
    expect(integrations.bindAuthenticatedOutbound).toHaveBeenCalledOnce();
  });

  it.each([8, "7", null, undefined])("refuses a foreign or malformed policy tenant identity %s", async tenantId => {
    policy.query.mockResolvedValueOnce({ rows: [policyRow({ tenant_id: tenantId })] });
    const res = await dial("+12025550123");
    expect(res.body).toContain("International calls disabled"); expect(res.body).not.toContain('application="bridge"');
    expectDedicatedPolicyRead(); expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it.each(["international", "premium"])("does not bridge when the %s policy query fails", async mode => {
    policy.query.mockRejectedValueOnce(new Error("PRIVATE_POLICY_FAILURE"));
    const res = await dial(mode === "premium" ? "+19005550123" : "+12025550123");
    expect(res.body).not.toContain('application="bridge"'); expect(res.body).not.toContain("PRIVATE_");
    expectDedicatedPolicyRead(); expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it.each(["+12025550123", "+19005550123", "1900123456"])("fails closed without shared-pool fallback when the restricted transaction rejects: %s", async destination => {
    policy.transaction.mockRejectedValueOnce(new Error("PRIVATE_RESTRICTED_BINDING_FAILURE"));
    const res = await dial(destination);
    expect(res.body).not.toContain('application="bridge"'); expect(res.body).not.toContain("PRIVATE_");
    expect(policy.transaction).toHaveBeenCalledWith(7, expect.any(Function));
    expect(policy.query).not.toHaveBeenCalled(); expect(db.query).toHaveBeenCalledOnce();
    expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it("guards local Thai 1900 premium routing independently of the international flag", async () => {
    policy.query.mockResolvedValueOnce({ rows: [policyRow({ international_enabled: false })] });
    const res = await dial("1900123456");
    expect(res.body).toContain('data="sofia/gateway/pstn_gateway/+661900123456"');
    expectDedicatedPolicyRead(); expect(integrations.bindAuthenticatedOutbound).toHaveBeenCalledOnce();
  });

  it.each([
    [], [policyRow({ international_enabled: false, premium_rate_enabled: false })],
    [policyRow({ international_enabled: null })], [policyRow({ premium_rate_enabled: "true" })],
    [policyRow({ tenant_id: 8 })], [policyRow(), policyRow()],
  ].map(rows => ({ rows })))("blocks local Thai 1900 without a complete matching premium allow: $rows", async ({ rows }) => {
    policy.query.mockResolvedValueOnce({ rows });
    const res = await dial("1900123456");
    expect(res.body).toContain("Premium rate calls disabled"); expect(res.body).not.toContain('application="bridge"');
    expectDedicatedPolicyRead(); expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it("keeps ordinary local Thai toll-free numbers unsupported", async () => {
    const res = await dial("1800123456");
    expect(res.body).not.toContain('application="bridge"');
    expect(db.query).not.toHaveBeenCalled(); expect(policy.transaction).not.toHaveBeenCalled();
    expect(integrations.rateLimitCheck).not.toHaveBeenCalled(); expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it.each([[], [{ tenant_id: 7 }, { tenant_id: 8 }]].map(rows => ({ rows })))("rejects a missing or ambiguous current caller before policy lookup: $rows", async ({ rows }) => {
    db.query.mockReset().mockResolvedValue({ rows });
    expect((await dial("+12025550123")).body).not.toContain('application="bridge"');
    expect(db.query).toHaveBeenCalledOnce(); expect(integrations.rateLimitCheck).not.toHaveBeenCalled();
    expect(policy.transaction).not.toHaveBeenCalled(); expect(policy.query).not.toHaveBeenCalled();
  });

  it("retains rate-limit refusal before policy or recording work", async () => {
    integrations.rateLimitCheck.mockResolvedValue(false);
    expect((await dial("+12025550123")).body).toContain("Rate limit exceeded");
    expect(db.query).toHaveBeenCalledOnce(); expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
    expect(policy.transaction).not.toHaveBeenCalled(); expect(policy.query).not.toHaveBeenCalled();
  });

  it("retains callback authentication before database access", async () => {
    expect((await dial("+12025550123", "wrong")).code).toBe(403);
    expect(db.query).not.toHaveBeenCalled(); expect(integrations.rateLimitCheck).not.toHaveBeenCalled();
    expect(policy.transaction).not.toHaveBeenCalled(); expect(policy.query).not.toHaveBeenCalled();
  });

  it("preserves internal SIP extension routing without a fraud query", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ type: "user", user_id: 17, tenant_id: 7,
      extension_number: "3001", sip_username: "3001", sip_domain: "sip.example.test", voicemail_enabled: false }] });
    const res = await dial("3001");
    expect(res.body).toContain('data="user/3001@sip.example.test"');
    expect(db.query).toHaveBeenCalledTimes(2); expect(db.query.mock.calls[1][1]).toEqual(["3001", 7]);
    expect(integrations.rateLimitCheck).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("fraud_controls"))).toBe(false);
    expect(policy.transaction).not.toHaveBeenCalled(); expect(policy.query).not.toHaveBeenCalled();
  });

  it("preserves emergency precedence without tenant or policy access", async () => {
    const res = await dial("191");
    expect(res.body).toContain('data="sofia/gateway/pstn_gateway/191"');
    expect(db.query).not.toHaveBeenCalled(); expect(integrations.rateLimitCheck).not.toHaveBeenCalled();
    expect(policy.transaction).not.toHaveBeenCalled(); expect(policy.query).not.toHaveBeenCalled();
  });

  it("preserves ordinary domestic routing without imposing a new policy requirement", async () => {
    const res = await dial("0812345678");
    expect(res.body).toContain('data="sofia/gateway/pstn_gateway/+66812345678"');
    expect(db.query).toHaveBeenCalledOnce(); expect(integrations.rateLimitCheck).toHaveBeenCalledOnce();
    expect(policy.transaction).not.toHaveBeenCalled(); expect(policy.query).not.toHaveBeenCalled();
  });
});
