import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { URLSearchParams } from "node:url";
import { SaxesParser } from "saxes";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { URL } from "node:url";

// Actual Express auth/handler calls and pure core, no socket/SQL/Redis/SIP.
// The qualified resolver is explicitly generated; production has no factory.
const f = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn(), shared: vi.fn(), recording: vi.fn(), rate: vi.fn(), events: [] as string[] }));
vi.mock("../server/pbx/fraud-policy-db", () => ({ withFraudPolicyTransaction: f.transaction }));
vi.mock("../server/pbx/db", () => ({ query: f.shared }));
vi.mock("../server/pbx/redis", () => ({ rateLimitCheck: f.rate, invalidateCache: vi.fn(), cacheGetOrSet: vi.fn() }));
vi.mock("../server/cloud-recordings/correlation", () => ({ bindAuthenticatedOutbound: f.recording }));
vi.mock("../server/pbx/cdr-processor", () => ({ processCdr: vi.fn() }));
vi.mock("../server/pbx/dialplan-generators", () => ({ generateIvrDialplan: vi.fn(), generateRingGroupDialplan: vi.fn(), generateQueueDialplan: vi.fn(), evaluateTimeCondition: vi.fn() }));
import { evaluateProtectedOutbound, parseProtectedOutboundForm, productionProtectedOutboundXml, protectedOutboundDenyXml,
  PROTECTED_OUTBOUND_CONTEXT as CONTEXT, selectsProtectedOutbound, isProtectedDialString, type ProtectedBinding } from "../server/pbx/protected-outbound-routing";
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

const secret = "generated-only-freeswitch-secret-0123456789";
const binding = (): Extract<ProtectedBinding, { status: "QUALIFIED" }> => ({ status: "QUALIFIED", mode: "KAM_DIGEST_ASSERTED_ONLY",
  tenantId: 7, proxyIps: ["192.0.2.1"], sofiaProfile: "generated_private", gateway: "generated_gateway", callerIdNumber: "1996" });
const fields = (destination = "+12025550123") => ({ section: "dialplan", "Caller-Context": CONTEXT, "Caller-Destination-Number": destination,
  variable_phone11_authenticated_user: "digest-user", variable_phone11_authenticated_realm: "generated.invalid",
  variable_sip_received_ip: "192.0.2.1", variable_sofia_profile_name: "generated_private", variable_call_direction: "outbound" });
const form = (values: Record<string, string> = fields()) => new URLSearchParams(values).toString();
const row = () => ({ tenant_id: 7, extension_tenant_id: 7, extension_id: 10, sip_username: "digest-user", sip_domain: "generated.invalid",
  account_status: "active", account_deleted_at: null, extension_status: "active", extension_deleted_at: null, tenant_status: "active" });
const policy = (intl = true, premium = true) => ({ tenant_id: 7, international_enabled: intl, premium_rate_enabled: premium });
let resolve: ReturnType<typeof vi.fn>;
const run = (raw: unknown = form(), selected: ProtectedBinding = binding()) => evaluateProtectedOutbound(raw, selected, { resolveCanonicalAssignments: resolve });
function denied(xml: string) { expect(xml).toBe(protectedOutboundDenyXml()); expect(xml).not.toMatch(/bridge|PRIVATE|default|not.found/); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("FS_SHARED_SECRET", secret); f.events = [];
  resolve = vi.fn().mockResolvedValue([row()]);
  f.query.mockResolvedValue({ rows: [policy()] });
  f.transaction.mockImplementation(async (tenant: number, callback: (client: any) => Promise<unknown>) => {
    expect(tenant).toBe(7); f.events.push("BEGIN");
    const value = await callback({ query: f.query }); f.events.push("COMMIT"); return value;
  });
  f.shared.mockResolvedValue({ rows: [{ tenant_id: 7 }] }); f.rate.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("linear protected dial grammar", () => {
  it.each(["+12025550123", "0012025550123", "+1 (202) 555-0123", "+1(202)5550123", "+1.202.555.0123", "1900123456", "+661900123456"])("accepts known bounded format %s", value => expect(isProtectedDialString(value)).toBe(true));
  it.each(["+"+"1".repeat(30)+"!", "+"+"1".repeat(30)+"-", "+"+"1".repeat(29)+"()", "+"+"1".repeat(29)+"))", "+"+"1".repeat(28)+"---"])("rejects 32-byte adversarial near-match %s", value => {
    expect(value).toHaveLength(32); expect(isProtectedDialString(value)).toBe(false);
  });
  it("has no backtracking engine and a monotonic shared scanner index", () => {
    const source = ts.createSourceFile("routing.ts", readFileSync(new URL("../server/pbx/protected-outbound-routing.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const scanner = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "isProtectedDialString")!;
    const loops: ts.IterationStatement[] = [], updates: ts.PostfixUnaryExpression[] = [], unsafe: ts.Node[] = [];
    // Prefix !/- expressions and immutable initial ternary are permitted; all
    // scanner index mutations must be postfix increment, never reset/decrement.
    const walk = (node: ts.Node) => {
      if (ts.isRegularExpressionLiteral(node) || ts.isNewExpression(node) || ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) unsafe.push(node);
      if (ts.isWhileStatement(node) || ts.isForStatement(node)) loops.push(node);
      if (ts.isPostfixUnaryExpression(node)) updates.push(node);
      if (ts.isCallExpression(node)) expect(node.expression.getText(source)).toMatch(/^(digit|raw\.startsWith)$/);
      ts.forEachChild(node, walk);
    };
    walk(scanner); expect(unsafe).toEqual([]); expect(loops).toHaveLength(4);
    expect(loops.every(loop => loop.getText(source).includes("index < raw.length"))).toBe(true);
    expect(updates).toHaveLength(6);
    expect(updates.every(node => node.operand.getText(source) === "index" && node.operator === ts.SyntaxKind.PlusPlusToken)).toBe(true);
  });
});

describe("protected raw boundary and canonical binding", () => {
  it.each(["generated-fs", "fs.generated.invalid", "a".repeat(255)])("accepts native XML-curl hostname metadata %s without using it as identity", async hostname => {
    const raw = form({ hostname, ...fields() });
    expect(parseProtectedOutboundForm(raw)?.hostname).toBe(hostname);
    expect(await run(raw)).toContain('application="bridge"');
    expect(resolve).toHaveBeenCalledWith("digest-user", "generated.invalid");
    expect(f.shared).not.toHaveBeenCalled();
  });
  it.each(["", " spaced", "spaced ", "a".repeat(256), "bad\nname", "é"])("rejects malformed native hostname %j before resolution", async hostname => {
    const raw = form({ hostname, ...fields() });
    expect(parseProtectedOutboundForm(raw)).toBeNull();
    denied(await run(raw)); expect(resolve).not.toHaveBeenCalled();
  });
  it("rejects duplicate and encoded duplicate hostname metadata", async () => {
    for (const key of ["hostname", "%68ostname"]) {
      const raw = form({ hostname: "generated-fs", ...fields() }) + `&${key}=other`;
      expect(parseProtectedOutboundForm(raw)).toBeNull(); denied(await run(raw));
    }
    expect(resolve).not.toHaveBeenCalled();
  });
  it("does not replace a missing canonical caller with hostname metadata", async () => {
    const values: Record<string, string> = { hostname: "digest-user", ...fields() };
    delete values.variable_phone11_authenticated_user;
    denied(await run(form(values))); expect(resolve).not.toHaveBeenCalled();
  });
  it("denies all UNBOUND input without resolving or leasing, regardless of enabled flags/env", async () => {
    vi.stubEnv("PHONE11_PROTECTED_ROUTING_QUALIFIED", "1");
    denied(await run(form(), { status: "UNBOUND" })); denied(productionProtectedOutboundXml());
    expect(resolve).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });
  it.each([null, {}, [], "", "x=".repeat(9000), form()+"&section=dialplan", form()+"&%73ection=dialplan", form()+"&tenant_id=7",
    form()+"&section%5B%5D=dialplan", form()+"&key_name=%", form()+"&key_name=%GG", form()+"&key_name=%C0%AF", form()+"&key_name=%0A",
    form()+"&key_name=%7F", form()+"&key_name=%C3%A9", form()+"&", form()+"&x", form()+"&key_name="+"a".repeat(513)].map(raw => ({ raw })))("refuses malformed/duplicate/unknown raw input $raw", async ({ raw }) => {
    expect(parseProtectedOutboundForm(raw)).toBeNull(); denied(await run(raw)); expect(resolve).not.toHaveBeenCalled();
  });
  it.each(Object.keys(fields()))("requires field %s", async key => {
    const values: Record<string,string> = fields(); delete values[key]; denied(await run(form(values))); expect(resolve).not.toHaveBeenCalled();
  });
  it.each([
    ["section", "directory"], ["Caller-Context", "default"], ["variable_phone11_authenticated_user", "user,other"],
    ["variable_phone11_authenticated_user", " user"], ["variable_phone11_authenticated_realm", "realm "],
    ["variable_phone11_authenticated_realm", "a".repeat(256)], ["variable_sip_received_ip", "192.0.2.2"],
    ["variable_sip_received_ip", "not-ip"], ["variable_sofia_profile_name", "public"], ["variable_call_direction", "inbound"],
  ])("denies invalid canonical field %s", async (key, value) => {
    denied(await run(form({ ...fields(), [key]: value }))); expect(resolve).not.toHaveBeenCalled();
  });
  it.each([{ tenantId: 8.5 }, { mode: "FROM_HEADER" }, { proxyIps: [] }, { proxyIps: ["192.0.2.1", "192.0.2.1"] },
    { proxyIps: ["bad"] }, { sofiaProfile: "public/profile" }, { gateway: "x/${danger}" }, { callerIdNumber: '"/><action' }])("rejects malformed qualified binding %j", async delta => {
    denied(await run(form(), { ...binding(), ...delta } as any)); expect(resolve).not.toHaveBeenCalled();
  });
  it("uses only canonical tuple even with spoofed optional From/domain/caller presentation", async () => {
    const xml = await run(form({ ...fields(), variable_sip_from_user: "victim", variable_domain_name: "victim.invalid", "Caller-Caller-ID-Number": '"/><action application="bridge"/>' }));
    expect(resolve).toHaveBeenCalledWith("digest-user", "generated.invalid");
    expect(xml).toContain('effective_caller_id_number=1996'); expect(xml).not.toContain("victim");
    expect(f.shared).not.toHaveBeenCalled(); expect(f.recording).not.toHaveBeenCalled();
  });
  it("does not substitute From/domain for missing canonical authentication", async () => {
    const values: Record<string,string> = { ...fields(), variable_sip_from_user: "digest-user", variable_domain_name: "generated.invalid" };
    delete values.variable_phone11_authenticated_user;
    denied(await run(form(values))); expect(resolve).not.toHaveBeenCalled();
  });
});

describe("qualified generated account/policy and exact XML", () => {
  it.each([[], [row(), row()], [null], [{ ...row(), tenant_id: 8 }], [{ ...row(), extension_tenant_id: 8 }],
    [{ ...row(), extension_id: "10" }], [{ ...row(), sip_username: "other" }], [{ ...row(), sip_domain: "other" }],
    [{ ...row(), account_status: "revoked" }], [{ ...row(), account_deleted_at: "deleted" }], [{ ...row(), extension_status: "inactive" }],
    [{ ...row(), extension_deleted_at: "deleted" }], [{ ...row(), tenant_status: "inactive" }], [{ tenant_id: 7 }]].map(rows => ({ rows })))("denies absent/ambiguous/revoked/cross-tenant rows $rows", async ({ rows }) => {
    resolve.mockResolvedValue(rows); denied(await run()); expect(f.transaction).not.toHaveBeenCalled();
  });
  it.each([[], [null], [policy(), policy()], [{ ...policy(), tenant_id: 8 }], [{ ...policy(), international_enabled: "true" }],
    [{ ...policy(), premium_rate_enabled: undefined }]].map(rows => ({ rows })))("denies malformed policy rows $rows", async ({ rows }) => {
    f.query.mockResolvedValue({ rows }); denied(await run());
  });
  it.each(["resolve", "query", "commit"])("sanitizes %s failure and never returns allow before commit", async phase => {
    const error = new Error("PRIVATE_CREDENTIAL_SQL_DETAIL");
    if (phase === "resolve") resolve.mockRejectedValue(error);
    if (phase === "query") f.query.mockRejectedValue(error);
    if (phase === "commit") f.transaction.mockImplementation(async (_tenant, callback) => { await callback({ query: f.query }); throw error; });
    denied(await run());
  });
  it.each([
    ["+12025550123", true, false, true], ["+12025550123", false, true, false],
    ["+19005550123", true, false, false], ["+19005550123", false, true, false], ["+19005550123", true, true, true],
    ["1900123456", false, true, true], ["+661900123456", false, true, true],
    ["1900123456", true, false, false], ["+661900123456", true, false, false],
  ])("preserves policy destination matrix %s intl=%s premium=%s", async (dest, intl, premium, allow) => {
    f.query.mockResolvedValue({ rows: [policy(intl, premium)] }); const xml = await run(form(fields(dest)));
    if (allow) { expect(xml).toContain('application="bridge"'); expect(f.events).toEqual(["BEGIN", "COMMIT"]); } else denied(xml);
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("FROM fraud_controls WHERE tenant_id = $1"), [7]);
    expect(f.query.mock.calls[0][0]).not.toMatch(/phone11_lock|INSERT|UPDATE|sip_accounts/);
  });
  it.each(["191", "199", "1669", "3001", "*9001", "1800123456", "0812345678", "021234567", "+66812345678", "+6621234567", "+661800123456", "+66123456789", "+669999999999", "00661800123456",
    "bad", "<action/>", "+12", "a".repeat(33), "+1abc2025550123", "+1/2025550123", "++12025550123", "+1+2025550123",
    "+12025550123-", "+1--2025550123", "+1  2025550123", "+1(2025550123", "+1)202(5550123", "+1((202))5550123",
    "+1()2025550123", "+1 (202) .5550123", "+012025550123", "00012025550123", "+12025550123\n"])("denies unsupported protected destination %s", async dest => {
    denied(await run(form(fields(dest)))); expect(resolve).not.toHaveBeenCalled();
  });
  it.each(["+661800123456", "+66123456789", "+669999999999", "00661800123456"])("keeps unsupported normalized Thai shape %s out of protected policy even when both flags enabled", async destination => {
    f.query.mockResolvedValue({ rows: [policy(true, true)] });
    denied(await run(form(fields(destination))));
    expect(resolve).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled();
  });
  it("anchors escaped RAW destination while bridging only E164 in the fixed context", async () => {
    const xml = await run(form(fields("+1 (202) 555-0123")));
    expect(xml).toContain(`context name="${CONTEXT}"`);
    expect(xml).toContain('expression="^\\+1 \\(202\\) 555-0123$"');
    expect(xml).toContain('data="sofia/gateway/generated_gateway/+12025550123"');
    expect((xml.match(/application="bridge"/g) ?? [])).toHaveLength(1); expect(xml).not.toMatch(/transfer|continue|default/);
  });
  it("emits well-formed XML with exactly the reviewed context/actions and no raw optional values", async () => {
    const xml = await run(form({ ...fields(), key_value: '<x & " \'>', "Caller-Caller-ID-Number": '<attack/>' }));
    const nodes: Array<{ name: string; attrs: Record<string,string> }> = [];
    const parser = new SaxesParser({ xmlns: false });
    parser.on("opentag", tag => nodes.push({ name: tag.name, attrs: tag.attributes as Record<string,string> }));
    parser.write(xml).close();
    expect(nodes.filter(n => n.name === "context").map(n => n.attrs.name)).toEqual([CONTEXT]);
    expect(nodes.filter(n => n.name === "action").map(n => n.attrs.application)).toEqual(["set", "set", "set", "bridge"]);
    expect(nodes.find(n => n.name === "condition")?.attrs.expression).toBe("^\\+12025550123$");
    expect(xml).not.toMatch(/attack|&lt;x/);
  });
  it("waits for committed policy transaction before allowing", async () => {
    let finishCommit!: () => void;
    const commit = new Promise<void>(accept => { finishCommit = accept; });
    f.transaction.mockImplementation(async (_tenant, callback) => { const result = await callback({ query: f.query }); await commit; return result; });
    let settled = false;
    const result = run().then(xml => { settled = true; return xml; });
    await vi.waitFor(() => expect(f.query).toHaveBeenCalledOnce());
    expect(settled).toBe(false); finishCommit(); expect(await result).toContain('application="bridge"');
  });
  it("snapshots binding before asynchronous resolver mutation", async () => {
    const selected = binding(); resolve.mockImplementation(async () => { selected.gateway = "unsafe/${x}"; selected.tenantId = 8; return [row()]; });
    const xml = await run(form(), selected); expect(xml).toContain("sofia/gateway/generated_gateway/"); expect(xml).not.toContain("unsafe");
  });
});

const route = freeswitchRouter.stack.find(item => item.route?.path === "/dialplan")!.route!;
async function dispatch(body: unknown, suppliedSecret = secret) {
  let authorized = false;
  const req = { headers: { "x-fs-secret": suppliedSecret }, body };
  const res = { code: 200, body: "", status(code: number) { this.code = code; return this; }, type() { return this; }, send(xml: string) { this.body = xml; return this; }, json(value: unknown) { this.body = JSON.stringify(value); return this; } };
  route.stack[0]!.handle(req as any, res as any, () => { authorized = true; });
  if (authorized) await route.stack[1]!.handle(req as any, res as any, () => undefined);
  return res;
}
describe("mounted production dispatch is UNBOUND; legacy compatibility", () => {
  it.each([CONTEXT, [], [CONTEXT, "default"], {}, null, 12, "", " default", "default ", "def ault", "default\n"].map(context => ({ context })))("terminally denies protected/malformed supplied context $context before legacy", async ({ context }) => {
    expect(selectsProtectedOutbound({ "Caller-Context": context })).toBe(true);
    denied((await dispatch({ ...fields("191"), "Caller-Context": context })).body);
    expect(f.shared).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled(); expect(f.rate).not.toHaveBeenCalled(); expect(f.recording).not.toHaveBeenCalled();
  });
  it("keeps service auth before protected dispatch", async () => { expect((await dispatch(fields(), "wrong")).code).toBe(403); expect(f.shared).not.toHaveBeenCalled(); });
  it.each([undefined, "default", "public", "บริบท", "x".repeat(100)])("preserves emergency when context is missing/nonprotected %s", async context => {
    const body: Record<string, unknown> = { "Caller-Destination-Number": "191", "Caller-Caller-ID-Number": "1996" };
    if (context !== undefined) body["Caller-Context"] = context;
    expect(selectsProtectedOutbound(body)).toBe(false); expect((await dispatch(body)).body).toContain("sofia/gateway/pstn_gateway/191");
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it("preserves legacy domestic default routing without a policy read", async () => {
    const xml = (await dispatch({ "Caller-Context": "default", "Caller-Destination-Number": "0812345678", variable_sip_from_user: "legacy", variable_domain_name: "legacy.invalid" })).body;
    expect(xml).toContain("sofia/gateway/pstn_gateway/+66812345678"); expect(f.transaction).not.toHaveBeenCalled();
  });
  it("preserves legacy internal tenant-scoped routing", async () => {
    f.shared.mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] }).mockResolvedValueOnce({ rows: [{ type: "user", sip_username: "3001", sip_domain: "legacy.invalid" }] });
    expect((await dispatch({ "Caller-Destination-Number": "3001", variable_sip_from_user: "legacy", variable_domain_name: "legacy.invalid" })).body).toContain("user/3001@legacy.invalid");
    expect(f.transaction).not.toHaveBeenCalled();
  });
});
