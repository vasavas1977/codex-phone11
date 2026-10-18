import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real database transaction wrapper and strict audit insertion;
// replace only transports and unrelated integrations. No database is contacted.
const f = vi.hoisted(() => ({
  events: [] as string[], audits: [] as unknown[][], pending: 0, committed: 0,
  releases: 0, role: "admin", ownership: true, missing: false, available: true, fraudRows: 1, fraudTenant: 7,
  failAudit: false, auditCode: "42501", failCommit: false, failRollback: false,
  failRelease: false, failDml: false, pooled: vi.fn(), client: vi.fn(),
  fraudAvailable: true, fraudReadRows: [] as Record<string, unknown>[], failFraudRead: false,
  fraudTransaction: vi.fn(), fraudBinding: vi.fn(),
}));
vi.mock("pg", () => ({ default: { Pool: class {
  on() {}
  query = f.pooled;
  async connect() {
    return { query: f.client, release() {
      f.releases++; f.events.push("RELEASE");
      if (f.failRelease) throw new Error("PRIVATE_RELEASE");
    } };
  }
} } }));
// Route fraud calls explicitly through the adapter seam while preserving the
// real db.ts transaction lifecycle and strict audit path with this fake pg client.
vi.mock("../server/pbx/fraud-policy-db", async () => {
  const { withTransaction } = await import("../server/pbx/db");
  return { getFraudPolicyBindingStatus: f.fraudBinding,
    withFraudPolicyTransaction: f.fraudTransaction.mockImplementation((tenantId, callback) => {
      expect(tenantId).toBe(7);
      return withTransaction(callback);
    }),
  };
});
const cache = vi.hoisted(() => ({ invalidateCache: vi.fn() }));
vi.mock("../server/pbx/redis", () => ({ ...cache, cacheGetOrSet: vi.fn() }));
vi.mock("../server/pbx/tenant-middleware", async importOriginal => ({
  ...await importOriginal<typeof import("../server/pbx/tenant-middleware")>(),
  resolveTenantContext: vi.fn(async (_user: number, tenant?: number) => {
    if (tenant !== undefined && tenant !== 7) throw new Error("Unexpected fixture tenant");
    return { tenantId: 7, role: "admin", memberships: [{ tenantId: 7, role: "admin" }] };
  }),
  requireLiveTenantAdminMembership: vi.fn(async () => "admin"),
  validateTenantOwnership: vi.fn(async (table, id, tenant) => {
    expect([table, id, tenant]).toEqual(["phone_numbers", 41, 7]);
    return f.ownership;
  }),
}));
vi.mock("../server/pbx/schema-capabilities", () => ({
  schemaHasRequiredColumns: async () => f.available,
  readManagementCapabilities: async () => ({ phoneNumbers: f.available }),
}));
vi.mock("../server/pbx/cdr-processor", () => ({ getCallStats: vi.fn(), getVoicemails: vi.fn() }));
vi.mock("../server/phone-provisioning", () => ({
  revokeExtensionSipAuth: vi.fn(async (client, extension, tenant) => {
    expect(client.query).toBe(f.client); expect([extension, tenant]).toEqual([41, 7]);
    await client.query("UPDATE subscriber SET password = 'PRIVATE_REVOKED'");
  }),
  rotateExtensionSipAuth: vi.fn(), reactivateExtensionSipAuth: vi.fn(),
}));
const credentials = {
  sipUsername: "4101", sipDomain: "sip.phone11.ai", plaintextPassword: "PRIVATE_PASSWORD",
  ha1: "PRIVATE_HA1", ha1b: "PRIVATE_HA1B", secretCiphertext: Buffer.from("PRIVATE_CIPHER"),
  secretIv: Buffer.from("PRIVATE_IV"), secretTag: Buffer.from("PRIVATE_TAG"), dekId: "PRIVATE_DEK",
};
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: () => credentials, regenerateSipCredentials: () => credentials,
}));
// eslint-disable-next-line import/first
import { pbxRouter } from "../server/pbx/pbx-router";

const context = { user: { id: 9 }, req: { ip: "127.0.0.1", headers: {} }, res: {} } as any;
const caller = () => pbxRouter.createCaller(context);
const cases = [
  ["tenant.updateSettings", "update", "tenant_settings", "7", false, () => caller().tenant.updateSettings({ tenantId: 7, businessHoursTimezone: "Asia/Bangkok" })],
  ["tenant.updateMember", "update", "tenant_membership", "33", true, () => caller().tenant.updateMember({ tenantId: 7, userId: 33, status: "inactive" })],
  ["extensions.create", "create", "extension", "41", false, () => caller().extensions.create({ tenantId: 7, extensionNumber: "4101" })],
  ["extensions.update", "update", "extension", "41", true, () => caller().extensions.update({ tenantId: 7, id: 41, displayName: "Synthetic" })],
  ["extensions.delete", "delete", "extension", "41", true, () => caller().extensions.delete({ tenantId: 7, id: 41 })],
  ["extensions.resetPassword", "reset_password", "sip_account", "51", true, () => caller().extensions.resetPassword({ tenantId: 7, extensionId: 41 })],
  ["phoneNumbers.create", "create", "phone_number", "41", false, () => caller().phoneNumbers.create({ tenantId: 7, number: "+6621234567" })],
  ["phoneNumbers.assignRoute", "assign_route", "phone_number", "41", true, () => caller().phoneNumbers.assignRoute({ tenantId: 7, id: 41, assignedRouteType: null, assignedRouteId: null })],
  ["fraudControls.update", "update", "fraud_controls", "7", false, () => caller().fraudControls.update({ internationalEnabled: false })],
] as const;

beforeEach(() => {
  vi.stubEnv("PG_CONNECTION_STRING", "postgres://offline:synthetic@invalid.invalid/offline");
  Object.assign(f, { events: [], audits: [], pending: 0, committed: 0, releases: 0,
    role: "admin", ownership: true, missing: false, available: true, fraudRows: 1, fraudTenant: 7, failAudit: false,
    fraudAvailable: true, fraudReadRows: [], failFraudRead: false,
    auditCode: "42501", failCommit: false, failRollback: false, failRelease: false, failDml: false });
  f.fraudBinding.mockReset().mockImplementation(() => ({ available: f.fraudAvailable }));
  f.fraudTransaction.mockClear();
  f.pooled.mockReset().mockImplementation(() => { throw new Error("POOLED_QUERY_FORBIDDEN"); });
  cache.invalidateCache.mockReset().mockImplementation(async () => { f.events.push("CACHE"); });
  f.client.mockReset().mockImplementation(async (sql: string, parameters: unknown[] = []) => {
    const text = sql.trim().replace(/\s+/g, " ");
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) {
      f.events.push(text);
      if (text === "ROLLBACK" && f.failRollback) throw new Error("PRIVATE_ROLLBACK");
      if (text === "COMMIT") {
        if (f.failCommit) throw Object.assign(new Error("PRIVATE_DEFERRED_AUDIT"), { code: "23503", detail: "PRIVATE_ROW" });
        f.committed += f.pending;
      }
      f.pending = 0;
      return { rows: [] };
    }
    if (text.includes("INSERT INTO audit_logs")) {
      f.events.push("AUDIT"); f.audits.push(parameters);
      if (f.failAudit) throw Object.assign(new Error("PRIVATE_AUDIT"), { code: f.auditCode, detail: "PRIVATE_ROW" });
      return { rows: [] };
    }
    if (text === "SELECT phone11_lock_fixed_fraud_admin($1) AS role") {
      expect(parameters).toEqual([9]);
      return { rows: f.role === "admin" ? [{ role: "admin" }] : [] };
    }
    if (text.startsWith("SELECT tenant_id,") && text.includes("FROM fraud_controls")) {
      expect(parameters).toEqual([7]);
      if (f.failFraudRead) throw new Error("PRIVATE_FRAUD_STORAGE");
      return { rows: f.fraudReadRows };
    }
    if (text.includes("tm.role::text AS role")) {
      expect(parameters).toEqual([9, 7]);
      return { rows: f.role === "admin" ? [{ role: "admin" }] : [] };
    }
    if (text.startsWith("INSERT INTO tenant_settings")) {
      expect(parameters).toEqual([7, "Asia/Bangkok", 9]);
      expect(text).toContain("FOR UPDATE OF tm, t ON CONFLICT (tenant_id)");
      if (f.role !== "admin") return { rows: [] };
    } else if (text.includes("SELECT tm.user_id, tm.role, tm.status")) {
      expect(parameters).toEqual([7, 33]);
      return { rows: f.missing ? [] : [{ user_id: 33, role: "user", status: "active" }] };
    } else if (text.includes("AS old_value")) {
      expect(parameters).toEqual([41, 7]);
      return { rows: f.missing ? [] : [{ user_id: 33, status: "active", type: "user",
        old_value: { id: 41, sip_password: "PRIVATE_LEGACY", nested: { ha1: "PRIVATE_OLD_HA1", authorization: "PRIVATE_AUTH" } } }] };
    } else if (text.includes("FROM sip_accounts sa") && text.includes("FOR UPDATE OF e, sa")) {
      expect(parameters).toEqual([41, 7]);
      return { rows: f.missing ? [] : [{ id: 51, sip_username: "4101", sip_domain: "sip.phone11.ai",
        extension_sip_username: "4101", extension_sip_domain: "sip.phone11.ai", ha1: "OLD_HA1", ha1b: "OLD_HA1B" }] };
    } else if (text.startsWith("SELECT ha1, ha1b FROM subscriber")) {
      return { rows: [{ ha1: "OLD_HA1", ha1b: "OLD_HA1B" }] };
    } else if (text.includes("AS has_conflict")) return { rows: [{ has_conflict: false }] };
    else if (text.startsWith("SELECT")) return { rows: [] };
    if (/^(INSERT|UPDATE|DELETE)/.test(text)) {
      f.events.push("DML");
      if (f.failDml) throw Object.assign(new Error("PRIVATE_DML"), { detail: "PRIVATE_ROW" });
      // Missing tenant-owned target must not be fabricated by RETURNING.
      if (f.missing && text.startsWith("UPDATE extensions SET deleted_at")) return { rows: [] };
      if (text.startsWith("INSERT INTO fraud_controls")) {
        expect(text).toMatch(/ON CONFLICT \(tenant_id\) DO UPDATE SET .+, updated_at = NOW\(\) RETURNING tenant_id$/);
        expect(parameters.at(-1)).toBe(7);
        f.pending += f.fraudRows;
        return { rows: Array.from({ length: f.fraudRows }, () => ({ tenant_id: f.fraudTenant })) };
      }
      f.pending++;
      if (text.startsWith("INSERT INTO tenant_settings")) return { rows: [{ business_hours_timezone: "Asia/Bangkok" }] };
      if (text.startsWith("UPDATE tenant_memberships")) return { rows: [{ id: 33, role: "user", status: "inactive" }] };
      if (text.startsWith("INSERT INTO extensions")) return { rows: [{ id: 41, sip_password: "PRIVATE_LEGACY", password: "PRIVATE_LEGACY_2" }] };
      return { rows: [{ id: 41, username: "4101" }] };
    }
    throw new Error(`Unexpected fixture query: ${text}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

function expectPrivateError(error: any, message: string) {
  expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message });
  expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain("PRIVATE_");
}

describe("fraud storage API contract", () => {
  it("first flag configuration supplies only the requested field and tenant, relying on false storage defaults", async () => {
    await caller().fraudControls.update({ internationalEnabled: false });
    const [sql, values] = f.client.mock.calls.find(([sql]) => sql.includes("INSERT INTO fraud_controls"))!;
    expect(sql.replace(/\s+/g, " ")).toContain("(international_enabled, tenant_id) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET international_enabled = EXCLUDED.international_enabled, updated_at = NOW()");
    expect(values).toEqual([false, 7]);
    expect(sql).not.toMatch(/premium_rate_enabled|daily_cost_ceiling|alert_email/);
    expect(JSON.parse(f.audits[0]![6] as string)).toEqual({ internationalEnabled: false });
    expect(f.events).toEqual(["BEGIN", "DML", "AUDIT", "COMMIT", "RELEASE"]);
    expect(f.fraudTransaction).toHaveBeenCalledWith(7, expect.any(Function));
    expect(f.pooled).not.toHaveBeenCalled();
  });
  it.each([
    { maxConcurrentOutbound: 1.5 }, { callsPerMinuteLimit: 2.25 }, { dailyCostCeiling: 0.125 },
    { geoBlockList: ["TH", '\"quoted'] }, { geoAllowList: [] }, { alertEmail: "admin@example.invalid" },
    { alertOnDailyCeiling: false }, { autoDisableOnCeiling: true }, { unknownFlag: true },
  ])("rejects unsupported fields without silently discarding them: %j", async unsupported => {
    // Even an otherwise valid flag cannot hide unsupported input.
    await expect(caller().fraudControls.update({ internationalEnabled: false, ...unsupported } as any))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.events).toEqual([]); expect(f.audits).toEqual([]);
    expect(f.fraudTransaction).not.toHaveBeenCalled(); expect(f.pooled).not.toHaveBeenCalled();
  });
  it("rejects a legacy alert-only update before audit or policy configuration", async () => {
    await expect(caller().fraudControls.update({ alertEmail: "admin@example.invalid" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.events).toEqual([]); expect(f.audits).toEqual([]); expect(f.fraudTransaction).not.toHaveBeenCalled();
  });
  it.each([8, "7", null, undefined])("refuses malformed/foreign returned tenant %s before audit", async tenantId => {
    f.fraudTenant = tenantId as number;
    await expect(caller().fraudControls.update({ internationalEnabled: false })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.events).toEqual(["BEGIN", "DML", "ROLLBACK", "RELEASE"]);
    expect(f.audits).toEqual([]); expect(f.committed).toBe(0);
  });
  it("rolls back first flag configuration on strict audit rejection", async () => {
    f.failAudit = true;
    expectPrivateError(await caller().fraudControls.update({ internationalEnabled: false }).catch(error => error), "Could not record PBX change");
    expect(f.events).toEqual(["BEGIN", "DML", "AUDIT", "ROLLBACK", "RELEASE"]);
    expect(f.pending).toBe(0); expect(f.committed).toBe(0);
  });
  it.each([8, "7", null, undefined])("GET refuses malformed/foreign returned tenant identity %s", async tenantId => {
    f.fraudReadRows = [{ tenant_id: tenantId, international_enabled: true, premium_rate_enabled: true }];
    await expect(caller().fraudControls.get({ tenantId: 7 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.events).toEqual(["BEGIN", "ROLLBACK", "RELEASE"]); expect(f.audits).toEqual([]);
    expect(f.pooled).not.toHaveBeenCalled();
  });
  it("sanitizes storage failure without configuring a policy or reporting defaults as observed", async () => {
    f.failFraudRead = true;
    const error = await caller().fraudControls.get({ tenantId: 7 }).catch(error => error);
    expect(error).toMatchObject({ code: "PRECONDITION_FAILED", message: "Fraud controls are unavailable" });
    expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain("PRIVATE_");
    expect(f.events).toEqual(["BEGIN", "ROLLBACK", "RELEASE"]); expect(f.audits).toEqual([]);
  });
  it.each(["read", "write"])("refuses %s without a dedicated binding and never falls back to the shared pool", async operation => {
    f.fraudAvailable = false;
    await expect(operation === "read" ? caller().fraudControls.get({ tenantId: 7 })
      : caller().fraudControls.update({ internationalEnabled: false })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.events).toEqual([]); expect(f.audits).toEqual([]);
    expect(f.fraudTransaction).not.toHaveBeenCalled(); expect(f.pooled).not.toHaveBeenCalled();
  });
  it("writes explicit flags for a selected tenant and audits on the same transaction", async () => {
    const input = { tenantId: 7, internationalEnabled: true, premiumRateEnabled: false };
    await caller().fraudControls.update(input);
    const [sql, values] = f.client.mock.calls.find(([sql]) => sql.includes("INSERT INTO fraud_controls"))!;
    expect(values).toEqual([true, false, 7]);
    expect(sql).toContain("international_enabled = EXCLUDED.international_enabled");
    expect(sql).toContain("premium_rate_enabled = EXCLUDED.premium_rate_enabled");
    expect(sql).not.toMatch(/daily_cost_ceiling|max_concurrent_outbound/);
    expect(f.audits[0]!.slice(0, 5)).toEqual([7, 9, "update", "fraud_controls", "7"]);
    expect(JSON.parse(f.audits[0]![6] as string)).toEqual(input);
    expect(f.events).toEqual(["BEGIN", "DML", "AUDIT", "COMMIT", "RELEASE"]);
  });
  it.each([0, 1, 2])("GET is read-only and refuses duplicate policy rows (%i)", async count => {
    const row = { tenant_id: 7, max_concurrent_outbound: 1.5, calls_per_minute_limit: null, daily_cost_ceiling: null,
      international_enabled: false, premium_rate_enabled: false, geo_block_list: ["TH"], geo_allow_list: [],
      alert_email: null, alert_on_daily_ceiling: null, auto_disable_on_ceiling: null, updated_at: new Date(0) };
    f.fraudReadRows = Array.from({ length: count }, () => row);
    if (count === 2) await expect(caller().fraudControls.get()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    else expect(await caller().fraudControls.get()).toEqual(count ? row : null);
    const policyCalls = f.client.mock.calls.filter(([sql]) => sql.includes("FROM fraud_controls"));
    expect(policyCalls).toHaveLength(1);
    const [sql, values] = policyCalls[0]!;
    expect(sql).toMatch(/^SELECT tenant_id,/); expect(sql).not.toMatch(/SELECT \*|INSERT|UPDATE/);
    expect(values).toEqual([7]); expect(f.audits).toEqual([]); expect(f.pooled).not.toHaveBeenCalled();
    expect(f.events).toEqual(["BEGIN", count === 2 ? "ROLLBACK" : "COMMIT", "RELEASE"]);
  });
  it("GET refuses authority revoked after the shared membership check before reading policy rows", async () => {
    f.role = "user";
    await expect(caller().fraudControls.get({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.client.mock.calls.some(([sql]) => sql.includes("FROM fraud_controls"))).toBe(false);
    expect(f.events).toEqual(["BEGIN", "ROLLBACK", "RELEASE"]); expect(f.audits).toEqual([]);
  });
});

describe("all nine core PBX audits on the real withTransaction and insertAuditLog path", () => {
  it.each([0, 2])("refuses a fraud update affecting %i rows before audit and rolls back", async rows => {
    f.fraudRows = rows;
    await expect(caller().fraudControls.update({ internationalEnabled: false }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Fraud controls are unavailable" });
    expect(f.events).toEqual(["BEGIN", "DML", "ROLLBACK", "RELEASE"]);
    expect(f.audits).toHaveLength(0); expect(f.pending).toBe(0); expect(f.committed).toBe(0);
    expect(f.releases).toBe(1); expect(f.pooled).not.toHaveBeenCalled();
    expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it.each(cases)("%s inserts one tenant-scoped audit on the leased client before commit", async (_name, action, resource, id, cached, invoke) => {
    const result = await invoke();
    expect(f.audits).toHaveLength(1); expect(f.audits[0].slice(0, 5)).toEqual([7, 9, action, resource, id]);
    expect(JSON.stringify(f.audits)).not.toContain("PRIVATE_");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    expect(f.events.indexOf("DML")).toBeLessThan(f.events.indexOf("AUDIT"));
    expect(f.events.indexOf("AUDIT")).toBeLessThan(f.events.indexOf("COMMIT"));
    if (cached) expect(f.events.indexOf("COMMIT")).toBeLessThan(f.events.indexOf("CACHE"));
    else expect(cache.invalidateCache).not.toHaveBeenCalled();
    expect(f.events.filter(event => event === "BEGIN")).toHaveLength(1);
    expect(f.events).not.toContain("ROLLBACK"); expect(f.committed).toBeGreaterThan(0);
    expect(f.releases).toBe(1); expect(f.pooled).not.toHaveBeenCalled();
  });
  it.each(cases)("%s rolls back its business writes and withholds result/cache on audit rejection", async (_name, _action, _resource, _id, _cached, invoke) => {
    f.failAudit = true;
    expectPrivateError(await invoke().catch(error => error), "Could not record PBX change");
    expect(f.events).toContain("DML"); expect(f.audits).toHaveLength(1);
    expect(f.events).toContain("ROLLBACK"); expect(f.events).not.toContain("COMMIT");
    expect(f.pending).toBe(0); expect(f.committed).toBe(0); expect(f.releases).toBe(1);
    expect(cache.invalidateCache).not.toHaveBeenCalled(); expect(f.pooled).not.toHaveBeenCalled();
  });
  it.each(cases)("%s rechecks revoked authority before DML/audit", async (_name, _action, _resource, _id, _cached, invoke) => {
    f.role = "user";
    await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events).not.toContain("DML"); expect(f.audits).toHaveLength(0);
    expect(f.events).toContain("ROLLBACK"); expect(f.releases).toBe(1);
  });
  it.each(cases)("%s sanitizes business statement errors before audit", async (_name, _action, _resource, _id, _cached, invoke) => {
    f.failDml = true;
    expectPrivateError(await invoke().catch(error => error), "Could not complete PBX change");
    expect(f.audits).toHaveLength(0); expect(f.events).toContain("ROLLBACK");
    expect(f.events).not.toContain("COMMIT"); expect(f.committed).toBe(0); expect(f.releases).toBe(1);
    expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it.each(["42P01", "23502", "23503", "23505", "23514", "22001"])("sanitizes strict audit SQL rejection %s", async code => {
    f.failAudit = true; f.auditCode = code;
    expectPrivateError(await caller().extensions.update({ id: 41, displayName: "Synthetic" }).catch(error => error), "Could not record PBX change");
    expect(f.events).toContain("ROLLBACK"); expect(f.events).not.toContain("COMMIT"); expect(f.releases).toBe(1);
  });
  it.each(["rollback", "release", "rollback-and-release"].flatMap(phase =>
    ["extension", "fraud"].map(kind => [phase, kind] as const)))("keeps audit failure private when %s also fails for %s", async (phase, kind) => {
    f.failAudit = true; f.failRollback = phase.includes("rollback"); f.failRelease = phase.includes("release");
    const invoke = kind === "fraud" ? () => caller().fraudControls.update({ internationalEnabled: false })
      : () => caller().extensions.update({ id: 41, displayName: "Synthetic" });
    expectPrivateError(await invoke().catch(error => error), "Could not record PBX change");
    expect(f.events).toContain("ROLLBACK"); expect(f.events).not.toContain("COMMIT");
    expect(f.releases).toBe(1); expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it.each(["commit", "commit-and-rollback", "commit-and-release", "release-after-commit"].flatMap(phase =>
    ["extension", "fraud"].map(kind => [phase, kind] as const)))("sanitizes %s after %s audit without promising rollback", async (phase, kind) => {
    f.failCommit = phase.startsWith("commit"); f.failRollback = phase === "commit-and-rollback";
    f.failRelease = phase === "commit-and-release" || phase === "release-after-commit";
    const error = await (kind === "fraud" ? caller().fraudControls.update({ internationalEnabled: false })
      : caller().extensions.update({ id: 41, displayName: "Synthetic" })).catch(error => error);
    expectPrivateError(error, "Could not complete PBX change");
    expect(error.message).not.toMatch(/roll.?back|not committed|nothing committed/i);
    expect(f.audits).toHaveLength(1); expect(f.events).toContain("COMMIT"); expect(f.releases).toBe(1);
    expect(cache.invalidateCache).not.toHaveBeenCalled();
    if (phase === "release-after-commit") {
      expect(f.committed).toBeGreaterThan(0); expect(f.events).not.toContain("ROLLBACK");
    } else { expect(f.committed).toBe(0); expect(f.events).toContain("ROLLBACK"); }
  });
  it("keeps postcommit cache failure outside transaction error handling", async () => {
    cache.invalidateCache.mockRejectedValueOnce(new Error("synthetic cache failure"));
    await expect(caller().extensions.update({ id: 41, displayName: "Synthetic" })).rejects.toThrow("synthetic cache failure");
    expect(f.committed).toBeGreaterThan(0); expect(f.audits).toHaveLength(1);
    expect(f.events).not.toContain("ROLLBACK"); expect(f.releases).toBe(1);
  });
  it.each(["settings", "extension", "fraud"])("does not fabricate a %s audit for an id-only/no-op input", async kind => {
    if (kind === "settings") await caller().tenant.updateSettings({ tenantId: 7 });
    else if (kind === "extension") await caller().extensions.update({ id: 41 });
    else await expect(caller().fraudControls.update({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.events).toEqual([]); expect(f.audits).toHaveLength(0); expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it.each(["extension update", "extension reset", "membership"])("rejects missing tenant-owned %s before DML/audit", async kind => {
    f.missing = true;
    const invoke = kind === "membership" ? () => caller().tenant.updateMember({ userId: 33, status: "inactive" })
      : kind === "extension reset" ? () => caller().extensions.resetPassword({ extensionId: 41 })
      : () => caller().extensions.update({ id: 41, displayName: "Synthetic" });
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.events).not.toContain("DML"); expect(f.audits).toHaveLength(0); expect(f.events).toContain("ROLLBACK");
  });
  it("rejects a foreign DID before leasing a transaction", async () => {
    f.ownership = false;
    await expect(caller().phoneNumbers.assignRoute({ id: 41, assignedRouteType: null, assignedRouteId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.events).toEqual([]); expect(f.audits).toHaveLength(0);
  });
  it.each(["settings", "DID"])("rejects unavailable %s schema before transaction/audit", async kind => {
    f.available = false;
    const invoke = kind === "settings" ? () => caller().tenant.updateSettings({ businessHoursTimezone: "Asia/Bangkok" })
      : () => caller().phoneNumbers.create({ number: "+6621234567" });
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.events).toEqual([]); expect(f.audits).toHaveLength(0);
  });
});
