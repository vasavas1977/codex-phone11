import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise actual Express route/auth handlers without opening a listener or
// contacting a DB, Redis or carrier. Dedicated LOGIN attestation is tested by
// its adapter suite; these cases establish telephony dispatch and guard order.
const f = vi.hoisted(() => ({
  query: vi.fn(), transaction: vi.fn(), client: vi.fn(), rate: vi.fn(), recording: vi.fn(),
  tenantRows: [{ tenant_id: 7 }] as any[], rows: [] as any[], boundTenant: 7,
  failPolicy: false, failCommit: false, events: [] as string[],
}));
vi.mock("../server/pbx/db", () => ({ query: f.query }));
vi.mock("../server/pbx/fraud-policy-db", () => ({ withFraudPolicyTransaction: f.transaction }));
vi.mock("../server/pbx/redis", () => ({
  rateLimitCheck: f.rate, invalidateCache: vi.fn(),
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
}));
vi.mock("../server/cloud-recordings/correlation", () => ({ bindAuthenticatedOutbound: f.recording }));
vi.mock("../server/pbx/cdr-processor", () => ({ processCdr: vi.fn() }));
vi.mock("../server/pbx/dialplan-generators", () => ({
  generateIvrDialplan: vi.fn(), generateRingGroupDialplan: vi.fn(), generateQueueDialplan: vi.fn(), evaluateTimeCondition: vi.fn(),
}));
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

const secret = "synthetic-freeswitch-policy-secret-0123456789";
const route = freeswitchRouter.stack.find(item => item.route?.path === "/dialplan")!.route!;
const auth = route.stack[0]!.handle;
const handler = route.stack[1]!.handle;
const policy = (international = false, premium = false, tenantId = 7) => ({
  tenant_id: tenantId, international_enabled: international, premium_rate_enabled: premium,
});
async function dial(destination: string, suppliedSecret = secret) {
  let admitted = false;
  const res = {
    code: 200, body: "", status(value: number) { this.code = value; return this; }, type() { return this; },
    send(value: string) { this.body = value; return this; }, json(value: unknown) { this.body = JSON.stringify(value); return this; },
  };
  const req = { headers: { "x-fs-secret": suppliedSecret }, body: {
    "Caller-Destination-Number": destination, "Caller-Caller-ID-Number": "1996",
    "variable_sip_from_user": "1996", "variable_domain_name": "sip.example.test",
  } };
  auth(req as any, res as any, () => { admitted = true; });
  if (admitted) await handler(req as any, res as any, () => undefined);
  return res;
}
function blocked(body: string) {
  expect(body).not.toContain('application="bridge"');
  expect(body).not.toContain("PRIVATE_");
  expect(f.recording).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FS_SHARED_SECRET", secret);
  Object.assign(f, { tenantRows: [{ tenant_id: 7 }], rows: [policy()], boundTenant: 7,
    failPolicy: false, failCommit: false, events: [] });
  f.query.mockImplementation(async (sql: string, values: unknown[]) => {
    // The only ordinary outbound shared query must resolve the current active
    // SIP account/extension. A shared policy query is an immediate test failure.
    if (sql.includes("fraud_controls")) throw new Error("PRIVATE_SHARED_POLICY_QUERY_FORBIDDEN");
    expect(sql).toContain("SELECT sa.tenant_id FROM sip_accounts sa JOIN extensions e");
    expect(sql).toContain("e.tenant_id = sa.tenant_id");
    expect(sql).toContain("sa.status = 'active'"); expect(sql).toContain("t.status = 'active'");
    expect(values).toEqual(["1996", "sip.example.test"]);
    return { rows: f.tenantRows };
  });
  f.client.mockImplementation(async (sql: string, values: unknown[]) => {
    expect(sql).toContain("SELECT tenant_id, international_enabled, premium_rate_enabled");
    expect(sql).toContain("FROM fraud_controls WHERE tenant_id = $1");
    expect(sql).not.toMatch(/phone11_lock_fixed_fraud_admin|INSERT|UPDATE/);
    expect(values).toEqual([f.boundTenant]);
    f.events.push("READ");
    if (f.failPolicy) throw new Error("PRIVATE_POLICY_FAILURE");
    return { rows: f.rows };
  });
  f.transaction.mockImplementation(async (tenantId: number, callback: (client: any) => Promise<unknown>) => {
    f.events.push("BIND");
    if (tenantId !== f.boundTenant) throw new Error("PRIVATE_FIXED_TENANT_MISMATCH");
    f.events.push("BEGIN");
    try {
      const result = await callback({ query: f.client });
      if (f.failCommit) throw new Error("PRIVATE_COMMIT_FAILURE");
      f.events.push("COMMIT"); return result;
    } catch (error) { f.events.push("ROLLBACK"); throw error; }
    finally { f.events.push("RELEASE"); }
  });
  f.rate.mockResolvedValue(true);
  f.recording.mockImplementation(async () => { f.events.push("RECORDING"); });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("restricted fixed-tenant telephony policy reader", () => {
  it.each([
    [], [null], [{}], [policy(true, false, 8)], [{ ...policy(true), tenant_id: "7" }],
    [{ ...policy(true), international_enabled: "true" }], [{ ...policy(true), premium_rate_enabled: null }],
    [policy(true), policy(true)], [{ ...policy(true), international_enabled: 1 }],
  ].map(rows => ({ rows })))("fails closed on missing/ambiguous/malformed policy $rows", async ({ rows }) => {
    f.rows = rows;
    const response = await dial("+12025550123"); blocked(response.body);
    expect(response.body).toContain("International calls disabled");
    expect(f.transaction).toHaveBeenCalledWith(7, expect.any(Function));
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.query.mock.calls[0][0]).not.toContain("fraud_controls");
  });

  it("reads both flags once on the dedicated tenant lease before any bridge metadata", async () => {
    f.rows = [policy(true)];
    expect((await dial("+12025550123")).body).toContain('data="sofia/gateway/pstn_gateway/+12025550123"');
    expect(f.query).toHaveBeenCalledOnce(); expect(f.transaction).toHaveBeenCalledOnce(); expect(f.client).toHaveBeenCalledOnce();
    expect(f.events).toEqual(["BIND", "BEGIN", "READ", "COMMIT", "RELEASE", "RECORDING"]);
  });

  it.each(["missing binding", "tenant mismatch", "query failure", "commit failure"])("never bridges or uses shared fallback after %s", async reason => {
    f.rows = [policy(true, true)];
    if (reason === "missing binding") f.transaction.mockRejectedValue(new Error("PRIVATE_MISSING_BINDING"));
    if (reason === "tenant mismatch") f.tenantRows = [{ tenant_id: 8 }];
    if (reason === "query failure") f.failPolicy = true;
    if (reason === "commit failure") f.failCommit = true;
    blocked((await dial("+19005550123")).body);
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.transaction).toHaveBeenCalledOnce();
    if (reason === "tenant mismatch") {
      expect(f.transaction).toHaveBeenCalledWith(8, expect.any(Function)); expect(f.client).not.toHaveBeenCalled();
    }
  });

  it.each([
    { international: false, premium: false }, { international: false, premium: true }, { international: true, premium: false },
  ])("requires both flags for an international premium destination: $international/$premium", async ({ international, premium }) => {
    f.rows = [policy(international, premium)];
    const response = await dial("+19005550123"); blocked(response.body);
    expect(response.body).toContain(international ? "Premium rate calls disabled" : "International calls disabled");
    expect(f.client).toHaveBeenCalledOnce();
  });

  it("permits international premium only when both booleans are true", async () => {
    f.rows = [policy(true, true)];
    expect((await dial("+19005550123")).body).toContain('data="sofia/gateway/pstn_gateway/+19005550123"');
    expect(f.client).toHaveBeenCalledOnce();
  });

  it.each([
    { destination: "1900123456", premium: false }, { destination: "1900123456", premium: true },
    { destination: "+661900123456", premium: false }, { destination: "+661900123456", premium: true },
  ])("routes Thai premium format $destination only through its premium flag: $premium", async ({ destination, premium }) => {
    // Both Thai formats require premium permission while international stays off.
    f.rows = [policy(false, premium)];
    const response = await dial(destination);
    if (premium) expect(response.body).toContain('data="sofia/gateway/pstn_gateway/+661900123456"');
    else { blocked(response.body); expect(response.body).toContain("Premium rate calls disabled"); }
    expect(f.transaction).toHaveBeenCalledOnce(); expect(f.client).toHaveBeenCalledOnce();
  });

  it.each([
    [], [null], [policy(false, true, 8)], [{ ...policy(false, true), premium_rate_enabled: "true" }],
    [{ ...policy(false, true), international_enabled: undefined }], [policy(false, true), policy(false, true)],
  ].map(rows => ({ rows })))("denies local premium when its policy is absent/ambiguous/malformed $rows", async ({ rows }) => {
    f.rows = rows;
    const response = await dial("1900123456"); blocked(response.body);
    expect(response.body).toContain("Premium rate calls disabled");
  });

  it("leaves ordinary Thai tollfree routing unsupported without borrowing premium authority", async () => {
    f.rows = [policy(true, true)];
    blocked((await dial("1800123456")).body);
    expect(f.transaction).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled();
  });

  it.each([[], [{ tenant_id: 7 }, { tenant_id: 8 }]].map(rows => ({ rows })))("refuses unresolved/ambiguous active caller before policy work $rows", async ({ rows }) => {
    f.tenantRows = rows;
    blocked((await dial("+12025550123")).body);
    expect(f.transaction).not.toHaveBeenCalled(); expect(f.rate).not.toHaveBeenCalled();
  });

  it("preserves callback authentication before all database work", async () => {
    expect((await dial("+12025550123", "wrong")).code).toBe(403);
    expect(f.query).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });

  it("preserves rate limiting before policy reads and recording work", async () => {
    f.rate.mockResolvedValue(false);
    const response = await dial("+12025550123"); blocked(response.body);
    expect(response.body).toContain("Rate limit exceeded"); expect(f.transaction).not.toHaveBeenCalled();
  });

  it("preserves emergency routing without tenant or policy access", async () => {
    expect((await dial("191")).body).toContain('data="sofia/gateway/pstn_gateway/191"');
    expect(f.query).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled(); expect(f.rate).not.toHaveBeenCalled();
  });

  it("preserves ordinary domestic routing when policy is unavailable", async () => {
    f.transaction.mockRejectedValue(new Error("PRIVATE_BINDING_ABSENT"));
    expect((await dial("0812345678")).body).toContain('data="sofia/gateway/pstn_gateway/+66812345678"');
    expect(f.query).toHaveBeenCalledOnce(); expect(f.transaction).not.toHaveBeenCalled(); expect(f.rate).toHaveBeenCalledOnce();
  });

  it("preserves tenant-scoped internal extension routing without a policy lease", async () => {
    f.query.mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] }).mockResolvedValueOnce({ rows: [{
      type: "user", user_id: 17, tenant_id: 7, extension_number: "3001", sip_username: "3001",
      sip_domain: "sip.example.test", voicemail_enabled: false,
    }] });
    expect((await dial("3001")).body).toContain('data="user/3001@sip.example.test"');
    expect(f.query.mock.calls[1][1]).toEqual(["3001", 7]);
    expect(f.transaction).not.toHaveBeenCalled(); expect(f.rate).not.toHaveBeenCalled();
  });
});
