import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createCanonicalAssignmentResolver, DETACHED_PROTECTED_INGRESS_PATH,
  readDetachedProtectedCallerRequest, type IdentityReadPin, type RawProtectedCallerRequest,
  type DetachedCallerIngressBinding } from "../server/pbx/trusted-caller-identity";

const pin = (): IdentityReadPin => ({ tenantId: 7, database: "generated_phone11", login: "generated_identity_reader",
  roleOid: "701", schema: "generated_pbx", schemaOid: "702" });
const row = () => ({ account_id: 12, tenant_id: 7, extension_id: 14, sip_username: "User003", sip_domain: "Realm.invalid",
  account_status: "active", account_deleted_at: null, account_user_id: 15, extension_tenant_id: 7,
  extension_sip_username: "User003", extension_sip_domain: "Realm.invalid", extension_user_id: 15,
  extension_status: "active", extension_deleted_at: null, tenant_status: "active", subscriber_username: "User003",
  subscriber_domain: "Realm.invalid", assignment_user_id: 15, member_user_id: 15, member_tenant_id: 7,
  member_status: "active", user_id: 15, single_effective_extension_identity: true, single_extension_account: true, single_extension_assignee: true, executor_matches: true });
const fields = () => ({ section: "dialplan", "Caller-Context": "phone11_protected_outbound", "Caller-Destination-Number": "+12025550123",
  variable_phone11_authenticated_user: "User003", variable_phone11_authenticated_realm: "Realm.invalid",
  variable_sip_received_ip: "192.0.2.1", variable_sofia_profile_name: "generated_private", variable_call_direction: "outbound" });
const form = (values: Record<string,string> = fields()) => new URLSearchParams(values).toString();
const binding = (): DetachedCallerIngressBinding => ({ fsHttpPeerIps: ["127.0.0.1"],
  fsHeaderSecret: "generated_only_service_secret_0123456789", kamSipPeerIps: ["192.0.2.1"], sofiaProfile: "generated_private" });
async function* chunks(raw: string | Buffer) { yield Buffer.isBuffer(raw) ? raw : Buffer.from(raw); }
function request(raw: string | Buffer = form()): RawProtectedCallerRequest {
  return { method: "POST", url: DETACHED_PROTECTED_INGRESS_PATH, remoteAddress: "127.0.0.1",
    rawHeaders: ["Content-Type", "application/x-www-form-urlencoded", "Content-Length", String(Buffer.byteLength(raw)), "x-fs-secret", binding().fsHeaderSecret], body: chunks(raw) };
}

describe("detached canonical subscriber assignment", () => {
  it("uses explicit schema-qualified read SQL/pins and exact tuple without caller presentation or credentials", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ ...row(), password: "PRIVATE_NEVER_PROJECT" }] });
    const resolve = createCanonicalAssignmentResolver(pin(), execute);
    const result = await resolve("User003", "Realm.invalid");
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ tenant_id: 7, extension_id: 14, sip_username: "User003", sip_domain: "Realm.invalid" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|password|executor|member/);
    const [sql, values] = execute.mock.calls[0];
    expect(values).toEqual(["User003", "Realm.invalid", "generated_phone11", "generated_identity_reader", "701", "generated_pbx", "702"]);
    for (const table of ["subscriber", "sip_accounts", "extensions", "tenants", "tenant_memberships", "user_extensions", "users"]) expect(sql).toContain(`"generated_pbx"."${table}"`);
    expect(sql).toMatch(/WHERE sa.sip_username = \$1 AND sa.sip_domain = \$2 LIMIT 2$/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|SET|ha1|password|secret_ciphertext)\b/i);
    expect(sql).toContain("current_user = $4 AND session_user = $4");
  });
  it.each([null, {}, [], { rows: null }, { rows: [] }, { rows: [null] }, { rows: [row(), row()] }])("refuses malformed/absent/multiple assignment response %j", async result => {
    const execute = vi.fn().mockResolvedValue(result);
    expect(await createCanonicalAssignmentResolver(pin(), execute)("User003", "Realm.invalid")).toEqual([]);
  });
  const mutations = [
    { account_id: "12" }, { account_id: 0 }, { extension_id: 0 }, { account_user_id: null }, { account_user_id: "15" },
    { tenant_id: 8 }, { tenant_id: "7" }, { extension_tenant_id: 8 }, { member_tenant_id: 8 },
    { extension_user_id: 16 }, { assignment_user_id: 16 }, { member_user_id: 16 }, { user_id: null },
    { sip_username: "user003" }, { sip_domain: "realm.invalid" }, { extension_sip_username: "Other" },
    { extension_sip_domain: "other.invalid" }, { subscriber_username: null }, { subscriber_domain: null },
    { account_status: "suspended" }, { account_deleted_at: "deleted" }, { extension_status: "inactive" },
    { extension_deleted_at: "deleted" }, { tenant_status: "inactive" }, { member_status: "inactive" },
    { single_effective_extension_identity: false }, { single_effective_extension_identity: undefined },
    { single_extension_account: false }, { single_extension_assignee: false }, { executor_matches: false }, { executor_matches: "true" },
  ];
  it.each(mutations)("refuses revoked/foreign/stale/malformed projection %j", async change => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ ...row(), ...change }] });
    expect(await createCanonicalAssignmentResolver(pin(), execute)("User003", "Realm.invalid")).toEqual([]);
  });
  it.each(["", " user", "user ", "u,other", "u\n", "é", "a".repeat(65)])("refuses invalid tuple before SQL %s", async value => {
    const execute = vi.fn(); const resolve = createCanonicalAssignmentResolver(pin(), execute);
    expect(await resolve(value, "Realm.invalid")).toEqual([]); expect(await resolve("User003", value)).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not cache revocation and waits for executor completion/release", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({ rows: [{ ...row(), member_status: "inactive" }] });
    const resolve = createCanonicalAssignmentResolver(pin(), execute);
    expect(await resolve("User003", "Realm.invalid")).toHaveLength(1); expect(await resolve("User003", "Realm.invalid")).toEqual([]);
    execute.mockRejectedValueOnce(new Error("PRIVATE_CONNECT_QUERY_RELEASE"));
    expect(await resolve("User003", "Realm.invalid")).toEqual([]); expect(execute).toHaveBeenCalledTimes(3);
  });
  it("cannot return an assignment before the executor finishes releasing resources", async () => {
    let release!: (value: { rows: unknown[] }) => void;
    const executor = () => new Promise<{ rows: unknown[] }>(done => { release = done; });
    const resolve = createCanonicalAssignmentResolver(pin(), executor);
    let settled = false;
    const result = resolve("User003", "Realm.invalid").then(value => { settled = true; return value; });
    await Promise.resolve(); expect(settled).toBe(false);
    release({ rows: [row()] }); expect(await result).toHaveLength(1);
  });
  it("keeps an inactive or foreign duplicate visible instead of preselecting the configured tenant", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [row(), { ...row(), tenant_id: 8, account_status: "suspended" }] });
    expect(await createCanonicalAssignmentResolver(pin(), execute)("User003", "Realm.invalid")).toEqual([]);
    expect(execute.mock.calls[0][0]).not.toMatch(/WHERE sa\.tenant_id|AND sa\.status =/);
  });
  it("refuses a valid account/extension when a foreign legacy extension has the same effective SIP tuple", async () => {
    // Generated query projection: the sa-first result still has one valid row,
    // but the global extensions cardinality sees the second legacy extension,
    // which has no sip_accounts row and would be invisible to sa cardinality.
    const execute = vi.fn().mockResolvedValue({ rows: [{ ...row(), single_effective_extension_identity: false }] });
    expect(await createCanonicalAssignmentResolver(pin(), execute)("User003", "Realm.invalid")).toEqual([]);
    const sql = execute.mock.calls[0][0] as string;
    const guard = sql.slice(sql.indexOf('(SELECT count(*) = 1 FROM "generated_pbx"."extensions" identity_e'), sql.indexOf('AS single_effective_extension_identity'));
    expect(guard).toContain("COALESCE(NULLIF(identity_e.sip_username, ''), identity_e.extension_number) = $1");
    expect(guard).toContain("COALESCE(NULLIF(identity_e.sip_domain, ''), $2) = $2");
    expect(guard).not.toMatch(/tenant_id|\.status|deleted_at|JOIN|::int|lower\(/i);
  });
  it("passes hostile tuple text as parameters rather than interpolating SQL", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] }), tuple = "user'OR'1'='1";
    expect(await createCanonicalAssignmentResolver(pin(), execute)(tuple, "Realm.invalid")).toEqual([]);
    expect(execute.mock.calls[0][0]).not.toContain(tuple); expect(execute.mock.calls[0][1][0]).toBe(tuple);
  });
  it("snapshots operator pins and does not coerce IDs or realm case", async () => {
    const selected = pin(); const execute = vi.fn().mockResolvedValue({ rows: [row()] });
    const resolve = createCanonicalAssignmentResolver(selected, execute);
    Object.assign(selected, { tenantId: 8, schema: "changed", login: "changed" });
    expect(await resolve("User003", "Realm.invalid")).toHaveLength(1);
    expect(await resolve("user003", "realm.invalid")).toEqual([]);
    expect(execute.mock.calls[0][1]).toContain("generated_identity_reader");
  });
  it.each([{ tenantId: "7" }, { schema: "public;SET ROLE owner" }, { schema: "pg_catalog" }, { roleOid: "0" },
    { roleOid: "4294967296" }, { schemaOid: "702.0" }, { login: "" }, { database: "x/y" }])("rejects malformed startup pin %j", change => {
    expect(() => createCanonicalAssignmentResolver({ ...pin(), ...change } as IdentityReadPin, vi.fn())).toThrow("Identity resolver binding unavailable");
  });
});

describe("detached raw HTTP boundary", () => {
  it("preserves original percent-encoding/ordering exactly through byte chunks", async () => {
    const raw = form().replace("User003", "%55ser003");
    const input = { ...request(raw), body: (async function* () { yield Buffer.from(raw.slice(0, 19)); yield Buffer.from(raw.slice(19)); })() };
    expect(await readDetachedProtectedCallerRequest(input, binding())).toBe(raw);
  });
  it.each([{ method: "GET" }, { url: "/api/freeswitch/dialplan" }, { url: DETACHED_PROTECTED_INGRESS_PATH + "?x=1" },
    { remoteAddress: "192.0.2.88" }, { remoteAddress: "::ffff:127.0.0.1" }, { rawHeaders: {} }, { rawHeaders: ["odd"] }])("rejects unexpected HTTP transport %j", async change => {
    expect(await readDetachedProtectedCallerRequest({ ...request(), ...change }, binding())).toBeNull();
  });
  const headerCases: unknown[][] = [
    ["X-FS-Secret", binding().fsHeaderSecret], ["Content-Type", "application/json"], ["Content-Length", "1"],
    ["Transfer-Encoding", "chunked"], ["Content-Encoding", "identity"], ["Bad Header", "x"], ["X-Other", "line\nfeed"],
  ];
  it.each(headerCases.map(extra => ({ extra })))("rejects duplicate/invalid/encoded headers $extra", async ({ extra }) => {
    expect(await readDetachedProtectedCallerRequest({ ...request(), rawHeaders: [...request().rawHeaders as string[], ...extra] }, binding())).toBeNull();
  });
  it.each(["0", "01", "+1", " 1", "8193", "1,2", "1e3", "99999", ""])("rejects invalid framing length %s", async length => {
    const input = request(); (input.rawHeaders as string[])[3] = length;
    expect(await readDetachedProtectedCallerRequest(input, binding())).toBeNull();
  });
  it.each(["bad", "generated_only_service_secret_012345678X"])("refuses service-secret mismatch %s", async secret => {
    const input = request(); (input.rawHeaders as string[])[5] = secret;
    expect(await readDetachedProtectedCallerRequest(input, binding())).toBeNull();
  });
  it.each([form()+"&section=dialplan", form()+"&%73ection=dialplan", form()+"&tenant_id=7", form()+"&tag_name=%GG",
    form()+"&tag_name=%0A", form()+"&tag_name=%C3%A9", form()+"&", form()+"&tag_name="+"a".repeat(513)])("rejects raw duplicate/malformed/unknown form %s", async raw => {
    expect(await readDetachedProtectedCallerRequest(request(raw), binding())).toBeNull();
  });
  it.each(Object.keys(fields()))("rejects missing required raw field %s", async key => {
    const values: Record<string,string> = fields(); delete values[key];
    expect(await readDetachedProtectedCallerRequest(request(form(values)), binding())).toBeNull();
  });
  it.each([{ "Caller-Context": "default" }, { section: "directory" }, { variable_phone11_authenticated_user: "u,other" },
    { variable_phone11_authenticated_realm: "realm " }, { variable_sip_received_ip: "192.0.2.2" },
    { variable_sofia_profile_name: "public" }, { variable_call_direction: "inbound" }])("rejects canonical claim/peer/profile mismatch %j", async change => {
    expect(await readDetachedProtectedCallerRequest(request(form({ ...fields(), ...change })), binding())).toBeNull();
  });
  it("ignores spoofed From/domain/caller-ID and forwarded HTTP source as authority", async () => {
    const raw = form({ ...fields(), variable_sip_from_user: "victim", variable_domain_name: "victim.invalid", "Caller-Caller-ID-Number": "999" });
    expect(await readDetachedProtectedCallerRequest(request(raw), binding())).toBe(raw);
    const input = request(raw);
    expect(await readDetachedProtectedCallerRequest({ ...input, remoteAddress: "192.0.2.88", rawHeaders: [...input.rawHeaders as string[], "X-Forwarded-For", "127.0.0.1"] }, binding())).toBeNull();
  });
  it("refuses truncated/overflow/raw high bytes/reconstructed string/stream failures", async () => {
    const raw = form();
    for (const body of [chunks(raw.slice(0,-1)), chunks(raw+"x"), chunks(Buffer.concat([Buffer.from(raw.slice(0,-1)), Buffer.from([0xff])])),
      (async function* () { yield raw; })(), (async function* () { throw new Error("PRIVATE_STREAM_DETAIL"); yield Buffer.alloc(0); })()]) {
      expect(await readDetachedProtectedCallerRequest({ ...request(), body }, binding())).toBeNull();
    }
  });
  it("copies received byte chunks and startup binding across async boundaries", async () => {
    const selected = binding(), raw = form(), first = Buffer.from(raw.slice(0, 20));
    const body = (async function* () {
      yield first; first.fill(0); Object.assign(selected, { kamSipPeerIps: ["192.0.2.88"], sofiaProfile: "public" });
      yield Buffer.from(raw.slice(20));
    })();
    expect(await readDetachedProtectedCallerRequest({ ...request(), body }, selected)).toBe(raw);
  });
  it.each([{ fsHttpPeerIps: [] }, { kamSipPeerIps: ["bad"] }, { fsHeaderSecret: "short" },
    { sofiaProfile: "public/danger" }, { kamSipPeerIps: ["192.0.2.1", "192.0.2.1"] }])("rejects malformed startup binding %j", async change => {
    expect(await readDetachedProtectedCallerRequest(request(), { ...binding(), ...change })).toBeNull();
  });
  it("does not mount, configure env, import shared pool or provide a qualification factory", () => {
    const source = readFileSync(new URL("../server/pbx/trusted-caller-identity.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env|from ["']\.\/db["']|new pg\.|\.listen\(|\.use\(|SET ROLE|status: ["']QUALIFIED["']/);
  });
});
