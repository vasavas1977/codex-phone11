import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Invoke the real mounted handlers in process; no listener, DB, Redis or SIP.
const db = vi.hoisted(() => ({ query: vi.fn() }));
const integrations = vi.hoisted(() => ({ rateLimitCheck: vi.fn(), bindAuthenticatedOutbound: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
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
const auth = layer!.route.stack[0].handle;
const handler = layer!.route.stack[1].handle;

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
  if (admitted) await handler(req as any, res as any);
  return res;
}

beforeEach(() => {
  vi.stubEnv("FS_SHARED_SECRET", secret);
  db.query.mockReset().mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] });
  integrations.rateLimitCheck.mockReset().mockResolvedValue(true);
  integrations.bindAuthenticatedOutbound.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("explicit tenant fraud policy on protected outbound modes", () => {
  it.each([
    [], [{ international_enabled: false }], [{ international_enabled: null }], [{}],
    [null], [{ international_enabled: "true" }], [{ international_enabled: 1 }],
    [{ international_enabled: true }, { international_enabled: true }],
    [{ international_enabled: false }, { international_enabled: true }],
  ].map(rows => ({ rows })))("blocks international when policy rows are absent, ambiguous or not boolean true: $rows", async ({ rows }) => {
    db.query.mockResolvedValueOnce({ rows });
    const res = await dial("+12025550123");
    expect(res.body).toContain("International calls disabled");
    expect(res.body).not.toContain('application="bridge"');
    expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
    expect(db.query.mock.calls[1][1]).toEqual([7]);
  });

  it("keeps a single explicit international allow tenant-scoped", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ international_enabled: true }] });
    const res = await dial("+12025550123");
    expect(res.body).toContain('data="sofia/gateway/pstn_gateway/+12025550123"');
    expect(db.query.mock.calls[0][1]).toEqual(["1996", "sip.example.test"]);
    expect(db.query.mock.calls[1][1]).toEqual([7]);
    expect(integrations.bindAuthenticatedOutbound).toHaveBeenCalledOnce();
  });

  it.each([
    [], [{ premium_rate_enabled: false }], [{ premium_rate_enabled: null }], [{}],
    [null], [{ premium_rate_enabled: "true" }], [{ premium_rate_enabled: 1 }],
    [{ premium_rate_enabled: true }, { premium_rate_enabled: true }],
  ].map(rows => ({ rows })))("blocks premium without exactly one boolean allow after international admission: $rows", async ({ rows }) => {
    db.query.mockResolvedValueOnce({ rows: [{ international_enabled: true }] }).mockResolvedValueOnce({ rows });
    const res = await dial("+19005550123");
    expect(res.body).toContain("Premium rate calls disabled");
    expect(res.body).not.toContain('application="bridge"');
    expect(db.query.mock.calls[2][1]).toEqual([7]);
    expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it("keeps premium routing when both required policies explicitly allow it", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ international_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ premium_rate_enabled: true }] });
    expect((await dial("+19005550123")).body).toContain('data="sofia/gateway/pstn_gateway/+19005550123"');
    expect(integrations.bindAuthenticatedOutbound).toHaveBeenCalledOnce();
  });

  it.each(["international", "premium"])("does not bridge when the %s policy query fails", async mode => {
    if (mode === "premium") db.query.mockResolvedValueOnce({ rows: [{ international_enabled: true }] });
    db.query.mockRejectedValueOnce(new Error("PRIVATE_POLICY_FAILURE"));
    const res = await dial(mode === "premium" ? "+19005550123" : "+12025550123");
    expect(res.body).not.toContain('application="bridge"'); expect(res.body).not.toContain("PRIVATE_");
    expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it.each([[], [{ tenant_id: 7 }, { tenant_id: 8 }]].map(rows => ({ rows })))("rejects a missing or ambiguous current caller before policy lookup: $rows", async ({ rows }) => {
    db.query.mockReset().mockResolvedValue({ rows });
    expect((await dial("+12025550123")).body).not.toContain('application="bridge"');
    expect(db.query).toHaveBeenCalledOnce(); expect(integrations.rateLimitCheck).not.toHaveBeenCalled();
  });

  it("retains rate-limit refusal before policy or recording work", async () => {
    integrations.rateLimitCheck.mockResolvedValue(false);
    expect((await dial("+12025550123")).body).toContain("Rate limit exceeded");
    expect(db.query).toHaveBeenCalledOnce(); expect(integrations.bindAuthenticatedOutbound).not.toHaveBeenCalled();
  });

  it("retains callback authentication before database access", async () => {
    expect((await dial("+12025550123", "wrong")).code).toBe(403);
    expect(db.query).not.toHaveBeenCalled(); expect(integrations.rateLimitCheck).not.toHaveBeenCalled();
  });

  it("preserves internal SIP extension routing without a fraud query", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ type: "user", user_id: 17, tenant_id: 7,
      extension_number: "3001", sip_username: "3001", sip_domain: "sip.example.test", voicemail_enabled: false }] });
    const res = await dial("3001");
    expect(res.body).toContain('data="user/3001@sip.example.test"');
    expect(db.query).toHaveBeenCalledTimes(2); expect(db.query.mock.calls[1][1]).toEqual(["3001", 7]);
    expect(integrations.rateLimitCheck).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("fraud_controls"))).toBe(false);
  });

  it("preserves emergency precedence without tenant or policy access", async () => {
    const res = await dial("191");
    expect(res.body).toContain('data="sofia/gateway/pstn_gateway/191"');
    expect(db.query).not.toHaveBeenCalled(); expect(integrations.rateLimitCheck).not.toHaveBeenCalled();
  });

  it("preserves ordinary domestic routing without imposing a new policy requirement", async () => {
    const res = await dial("0812345678");
    expect(res.body).toContain('data="sofia/gateway/pstn_gateway/+66812345678"');
    expect(db.query).toHaveBeenCalledOnce(); expect(integrations.rateLimitCheck).toHaveBeenCalledOnce();
  });
});
