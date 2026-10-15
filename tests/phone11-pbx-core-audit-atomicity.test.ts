import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real database transaction wrapper and strict audit insertion;
// replace only transports and unrelated integrations. No database is contacted.
const f = vi.hoisted(() => ({
  events: [] as string[], audits: [] as unknown[][], pending: 0, committed: 0,
  releases: 0, role: "admin", ownership: true, missing: false, available: true,
  failAudit: false, auditCode: "42501", failCommit: false, failRollback: false,
  failRelease: false, failDml: false, pooled: vi.fn(), client: vi.fn(),
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
    role: "admin", ownership: true, missing: false, available: true, failAudit: false,
    auditCode: "42501", failCommit: false, failRollback: false, failRelease: false, failDml: false });
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

describe("all nine core PBX audits on the real withTransaction and insertAuditLog path", () => {
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
  it.each(["rollback", "release", "rollback-and-release"])("keeps audit failure private when %s also fails", async phase => {
    f.failAudit = true; f.failRollback = phase.includes("rollback"); f.failRelease = phase.includes("release");
    expectPrivateError(await caller().extensions.update({ id: 41, displayName: "Synthetic" }).catch(error => error), "Could not record PBX change");
    expect(f.events).toContain("ROLLBACK"); expect(f.events).not.toContain("COMMIT");
    expect(f.releases).toBe(1); expect(cache.invalidateCache).not.toHaveBeenCalled();
  });
  it.each(["commit", "commit-and-rollback", "commit-and-release", "release-after-commit"])("sanitizes %s after audit without promising rollback", async phase => {
    f.failCommit = phase.startsWith("commit"); f.failRollback = phase === "commit-and-rollback";
    f.failRelease = phase === "commit-and-release" || phase === "release-after-commit";
    const error = await caller().extensions.update({ id: 41, displayName: "Synthetic" }).catch(error => error);
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
    else await caller().fraudControls.update({});
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
