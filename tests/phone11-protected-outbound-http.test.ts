import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";

const f = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn(), events: [] as string[] }));
// Only the isolated policy transaction is generated. Raw HTTP admission, actual
// resolver SQL/validation and actual protected core/XML remain real source.
vi.mock("../server/pbx/fraud-policy-db", () => ({ withFraudPolicyTransaction: f.transaction }));
import { createProtectedOutboundHttpOwner, PROTECTED_HTTP_MAX_WORK, type ReviewedProtectedHttpStartup,
  type DetachedProtectedHttpOwner } from "../server/pbx/protected-outbound-http";
import { evaluateProtectedOutbound, protectedOutboundDenyXml } from "../server/pbx/protected-outbound-routing";

const deny = protectedOutboundDenyXml(), secret = "B".repeat(64);
const path = "/api/freeswitch/protected-dialplan";
const fields = () => ({ section: "dialplan", "Caller-Context": "phone11_protected_outbound", "Caller-Destination-Number": "+12025550123",
  variable_phone11_authenticated_user: "digest-user", variable_phone11_authenticated_realm: "generated.invalid",
  variable_sip_received_ip: "192.0.2.1", variable_sofia_profile_name: "generated_private", variable_call_direction: "outbound" });
const form = () => new URLSearchParams(fields()).toString();
const identityRow = () => ({ account_id: 1, tenant_id: 7, extension_id: 10, account_user_id: 3, extension_tenant_id: 7, member_tenant_id: 7,
  extension_user_id: 3, assignment_user_id: 3, member_user_id: 3, user_id: 3, sip_username: "digest-user", sip_domain: "generated.invalid",
  extension_sip_username: "digest-user", extension_sip_domain: "generated.invalid", subscriber_username: "digest-user", subscriber_domain: "generated.invalid",
  account_status: "active", account_deleted_at: null, extension_status: "active", extension_deleted_at: null, tenant_status: "active", member_status: "active",
  single_effective_extension_identity: true, single_extension_account: true, single_extension_assignee: true, executor_matches: true });
const assignment = () => ({ tenant_id: 7, extension_tenant_id: 7, extension_id: 10, sip_username: "digest-user", sip_domain: "generated.invalid",
  account_status: "active", account_deleted_at: null, extension_status: "active", extension_deleted_at: null, tenant_status: "active" });
function startup(execute = vi.fn().mockResolvedValue({ rows: [identityRow()] })): ReviewedProtectedHttpStartup {
  return { ingress: { fsHttpPeerIps: ["127.0.0.1"], fsHeaderSecret: secret, kamSipPeerIps: ["192.0.2.1"], sofiaProfile: "generated_private" },
    routing: { status: "QUALIFIED", mode: "KAM_DIGEST_ASSERTED_ONLY", tenantId: 7, proxyIps: ["192.0.2.1"], sofiaProfile: "generated_private", gateway: "generated_gateway", callerIdNumber: "1996" },
    identity: { tenantId: 7, database: "generated_db", login: "generated_identity", roleOid: "71", schema: "generated_schema", schemaOid: "72" }, executeIdentityRead: execute };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const active: { owner: DetachedProtectedHttpOwner; server: Server }[] = [];
async function listen(selected: ReviewedProtectedHttpStartup | null = startup()) {
  const owner = createProtectedOutboundHttpOwner(selected), server = createServer(owner.handler);
  active.push({ owner, server }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw Error("GENERATED_LISTENER_REFUSED");
  return { owner, server, port: address.port };
}
type Reply = { status?: number; body: string; closed?: boolean };
function post(port: number, body = form(), headers: Record<string, string> = {}, endpoint = path): Promise<Reply> {
  return new Promise(resolve => {
    const req = httpRequest({ host: "127.0.0.1", port, path: endpoint, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(Buffer.byteLength(body)), "x-fs-secret": secret, ...headers } }, res => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      res.on("error", () => resolve({ closed: true, body: "" }));
    });
    req.on("error", () => resolve({ closed: true, body: "" })); req.end(body);
  });
}
function raw(port: number, wire: string): Promise<string> {
  return new Promise(resolve => {
    const socket = connect(port, "127.0.0.1"), chunks: Buffer[] = []; let bytes = 0;
    socket.setTimeout(2500, () => socket.destroy());
    socket.on("connect", () => socket.write(wire));
    socket.on("data", chunk => { bytes += chunk.length; if (bytes > 65536) socket.destroy(); else chunks.push(Buffer.from(chunk)); });
    socket.on("error", () => {}); socket.on("close", () => resolve(Buffer.concat(chunks).toString()));
  });
}
function isDenyOrClosed(reply: Reply) { expect(reply.closed || (reply.status === 200 && reply.body === deny)).toBe(true); }
beforeEach(() => {
  vi.clearAllMocks(); f.events = [];
  f.query.mockResolvedValue({ rows: [{ tenant_id: 7, international_enabled: true, premium_rate_enabled: true }] });
  f.transaction.mockImplementation(async (tenant: number, callback: (client: { query: typeof f.query }) => Promise<unknown>) => {
    expect(tenant).toBe(7); f.events.push("BEGIN"); const result = await callback({ query: f.query });
    f.events.push("COMMIT", "RELEASE"); return result;
  });
});
afterEach(async () => {
  for (const { owner, server } of active.splice(0)) {
    await owner.drain(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

describe("detached actual raw HTTP owner", () => {
  it("preserves actual core XML through native15-field HTTP bytes and waits for commit/release", async () => {
    const selected = startup(), expected = await evaluateProtectedOutbound(form(), selected.routing, { resolveCanonicalAssignments: async () => [assignment()] });
    f.transaction.mockClear(); f.query.mockClear(); f.events = [];
    const { port } = await listen(selected), selectedFields = fields();
    const { section: _section, ...events } = selectedFields;
    const body = "hostname=generated-switch&section=dialplan&tag_name=&key_name=&key_value=&" + new URLSearchParams({ ...events, "Caller-Caller-ID-Number": "1001", variable_sip_from_user: "presentation", variable_domain_name: "presentation.invalid" }).toString();
    const reply = await post(port, body);
    expect(reply).toEqual({ status: 200, body: expected }); expect(reply.body).not.toContain("lab_route");
    expect(f.events).toEqual(["BEGIN", "COMMIT", "RELEASE"]); expect(f.transaction).toHaveBeenCalledTimes(1);
    const [sql, parameters] = (selected.executeIdentityRead as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('"generated_schema"."subscriber"'); expect(sql).toContain("single_effective_extension_identity");
    expect(parameters).toEqual(["digest-user", "generated.invalid", "generated_db", "generated_identity", "71", "generated_schema", "72"]);
  });
  it("has a null UNBOUND deny-only owner without dependency access", async () => {
    const { port } = await listen(null); expect(await post(port)).toEqual({ status: 200, body: deny }); expect(f.transaction).not.toHaveBeenCalled();
  });
  it("rejects inconsistent startup bindings before any listener use", () => {
    for (const mutate of [
      (s: ReviewedProtectedHttpStartup) => { Object.assign(s, { ingress: { ...s.ingress, fsHttpPeerIps: [] } }); },
      (s: ReviewedProtectedHttpStartup) => { Object.assign(s, { ingress: { ...s.ingress, fsHeaderSecret: "short" } }); },
      (s: ReviewedProtectedHttpStartup) => { Object.assign(s, { identity: { ...s.identity, tenantId: 8 } }); },
      (s: ReviewedProtectedHttpStartup) => { Object.assign(s, { routing: { ...s.routing, proxyIps: ["192.0.2.2"] } }); },
      (s: ReviewedProtectedHttpStartup) => { Object.assign(s, { identity: { ...s.identity, roleOid: "0" } }); },
    ]) { const value = startup(); mutate(value); expect(() => createProtectedOutboundHttpOwner(value)).toThrow(); }
  });
  it("refuses unknown/duplicate forms and wrong paths without any registry/policy read", async () => {
    const execute = vi.fn(), { port } = await listen(startup(execute));
    for (const body of [form() + "&tenant_id=7", form() + "&Caller-Context=default", form() + "&hostname=one&hostname=two", form() + "&tag_name=%GG"])
      expect(await post(port, body)).toEqual({ status: 200, body: deny });
    expect(await post(port, form(), {}, path + "?x=1")).toEqual({ status: 200, body: deny });
    expect(execute).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });
  it("refuses bad service authentication, duplicate raw headers and smuggled framing", async () => {
    const execute = vi.fn(), { port } = await listen(startup(execute));
    expect(await post(port, form(), { "x-fs-secret": "X".repeat(64) })).toEqual({ status: 200, body: deny });
    const common = `POST ${path} HTTP/1.1\r\nHost: generated.invalid\r\nContent-Type: application/x-www-form-urlencoded\r\nx-fs-secret: ${secret}\r\nContent-Length: ${form().length}\r\n`;
    const duplicate = await raw(port, common + `X-FS-SECRET: ${secret}\r\n\r\n` + form()); expect(duplicate).toContain(deny);
    for (const extra of [`Content-Length: ${form().length}\r\n`, "Transfer-Encoding: chunked\r\n"]) {
      const reply = await raw(port, common + extra + "\r\n" + form()); expect(reply === "" || reply.includes("400") || reply.includes(deny)).toBe(true);
    }
    expect(execute).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });
  it("uses the actual IPv4 socket peer and ignores forwarded identity", async () => {
    const selected = startup(), execute = selected.executeIdentityRead as ReturnType<typeof vi.fn>;
    Object.assign(selected, { ingress: { ...selected.ingress, fsHttpPeerIps: ["192.0.2.88"] } });
    const { port } = await listen(selected);
    expect(await post(port, form(), { "X-Forwarded-For": "192.0.2.88" })).toEqual({ status: 200, body: deny }); expect(execute).not.toHaveBeenCalled();
  });
  it("closes a slow incomplete body within the response budget without dependency reads", async () => {
    const execute = vi.fn(), { port, owner } = await listen(startup(execute)), start = performance.now();
    const reply = await raw(port, `POST ${path} HTTP/1.1\r\nHost: generated.invalid\r\nContent-Type: application/x-www-form-urlencoded\r\nx-fs-secret: ${secret}\r\nContent-Length: ${form().length}\r\n\r\nx`);
    expect(reply === "" || reply.includes(deny)).toBe(true); expect(performance.now() - start).toBeLessThan(2000);
    expect(execute).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled(); expect(await owner.drain()).toEqual({ settled: true, pending: 0 });
  });
  it("retains timed-out identity work slots and refuses saturation until actual settlement", async () => {
    const release = deferred<{ rows: ReturnType<typeof identityRow>[] }>(), entered = deferred<void>();
    const execute = vi.fn().mockImplementation(() => { if (execute.mock.calls.length === PROTECTED_HTTP_MAX_WORK) entered.resolve(); return release.promise; });
    const { port, owner } = await listen(startup(execute));
    const pending = Array.from({ length: PROTECTED_HTTP_MAX_WORK }, () => post(port)); await entered.promise;
    isDenyOrClosed(await post(port)); expect(execute).toHaveBeenCalledTimes(PROTECTED_HTTP_MAX_WORK);
    for (const reply of await Promise.all(pending)) isDenyOrClosed(reply);
    isDenyOrClosed(await post(port)); expect(execute).toHaveBeenCalledTimes(PROTECTED_HTTP_MAX_WORK); expect(f.transaction).not.toHaveBeenCalled();
    release.resolve({ rows: [identityRow()] }); expect(await owner.drain()).toEqual({ settled: true, pending: 0 }); expect(f.transaction).not.toHaveBeenCalled();
  });
  it("does not start policy work after a client abort while identity lookup is pending", async () => {
    const release = deferred<{ rows: ReturnType<typeof identityRow>[] }>(), entered = deferred<void>();
    const execute = vi.fn().mockImplementation(() => { entered.resolve(); return release.promise; });
    const { port, owner } = await listen(startup(execute));
    const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path, headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": form().length, "x-fs-secret": secret } });
    req.on("error", () => {}); req.end(form()); await entered.promise; req.destroy(); await new Promise<void>(resolve => req.once("close", () => resolve()));
    release.resolve({ rows: [identityRow()] }); expect(await owner.drain()).toEqual({ settled: true, pending: 0 }); expect(f.transaction).not.toHaveBeenCalled();
  });
  it("lets already-started transaction settle/release after abort without a late response write", async () => {
    const release = deferred<void>(), entered = deferred<void>();
    f.transaction.mockImplementation(async (_tenant, callback) => { const value = await callback({ query: f.query }); entered.resolve(); await release.promise; f.events.push("COMMIT", "RELEASE"); return value; });
    const { port, owner, server } = await listen(); let completedResponses = 0;
    server.on("request", (_request, response) => response.on("finish", () => completedResponses++));
    const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path, headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": form().length, "x-fs-secret": secret } });
    req.on("error", () => {}); req.end(form()); await entered.promise; req.destroy(); await new Promise<void>(resolve => req.once("close", () => resolve()));
    release.resolve(); expect(await owner.drain()).toEqual({ settled: true, pending: 0 });
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.events).toEqual(["COMMIT", "RELEASE"]); expect(completedResponses).toBe(0);
  });
  it("bounds drain while dependency remains pending and keeps admission closed", async () => {
    const release = deferred<{ rows: ReturnType<typeof identityRow>[] }>(), entered = deferred<void>();
    const execute = vi.fn().mockImplementation(() => { entered.resolve(); return release.promise; });
    const { port, owner } = await listen(startup(execute)), pending = post(port); await entered.promise;
    expect(await owner.drain()).toEqual({ settled: false, pending: 1 }); isDenyOrClosed(await pending);
    isDenyOrClosed(await post(port)); expect(execute).toHaveBeenCalledTimes(1);
    release.resolve({ rows: [identityRow()] }); expect(await owner.drain()).toEqual({ settled: true, pending: 0 }); expect(f.transaction).not.toHaveBeenCalled();
  });
  it("refuses oversized bodies and content encoding over actual HTTP without registry access", async () => {
    const execute = vi.fn(), { port } = await listen(startup(execute));
    expect(await post(port, "x".repeat(8193))).toEqual({ status: 200, body: deny });
    expect(await post(port, form(), { "Content-Encoding": "identity" })).toEqual({ status: 200, body: deny });
    expect(execute).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });
  it("snapshots startup pins, peer lists and routing before serving requests", async () => {
    const selected = startup(), { port } = await listen(selected);
    Object.assign(selected.identity, { tenantId: 8, login: "changed" });
    Object.assign(selected.routing, { tenantId: 8, gateway: "changed" });
    Object.assign(selected.ingress, { fsHeaderSecret: "X".repeat(64), fsHttpPeerIps: ["192.0.2.88"] });
    const reply = await post(port); expect(reply.status).toBe(200); expect(reply.body).toContain("sofia/gateway/generated_gateway/");
    expect(reply.body).not.toContain("changed");
  });
  it("keeps a timed-out policy transaction slot until release with only one HTTP completion", async () => {
    const release = deferred<void>(), entered = deferred<void>();
    f.transaction.mockImplementation(async (_tenant, callback) => { const value = await callback({ query: f.query }); entered.resolve(); await release.promise; f.events.push("COMMIT", "RELEASE"); return value; });
    const { port, owner, server } = await listen(); let completed = 0;
    server.on("request", (_request, response) => response.on("finish", () => completed++));
    const pending = post(port); await entered.promise; isDenyOrClosed(await pending);
    expect(f.query).toHaveBeenCalledTimes(1); expect(completed).toBeLessThanOrEqual(1);
    release.resolve(); expect(await owner.drain()).toEqual({ settled: true, pending: 0 });
    expect(f.events).toEqual(["COMMIT", "RELEASE"]); expect(f.query).toHaveBeenCalledTimes(1); expect(completed).toBeLessThanOrEqual(1);
  });
  it("sanitizes identity failure and policy commit failure as terminal denial", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("PRIVATE_GENERATED_EXECUTOR_DETAIL")); const first = await listen(startup(execute));
    expect(await post(first.port)).toEqual({ status: 200, body: deny }); expect(f.transaction).not.toHaveBeenCalled();
    f.transaction.mockRejectedValue(new Error("PRIVATE_GENERATED_COMMIT_DETAIL")); const second = await listen();
    expect(await post(second.port)).toEqual({ status: 200, body: deny });
  });
});
