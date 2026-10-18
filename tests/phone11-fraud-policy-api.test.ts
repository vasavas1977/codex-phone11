import { beforeEach, describe, expect, it, vi } from "vitest";

// Actual tRPC handler and membership admission; only database/transport edges
// are mocked. These assertions do not establish PostgreSQL role enforcement.
const f = vi.hoisted(() => ({
  query: vi.fn(), sharedTransaction: vi.fn(), transaction: vi.fn(), client: vi.fn(), binding: vi.fn(),
  memberships: [7, 8], cachedRole: "admin", liveRole: "admin", lockRows: [{ role: "admin" }] as any[],
  readRows: [] as any[], updateRows: [{ tenant_id: 7 }] as any[],
  failAudit: false, failStorage: false, pending: 0, committed: 0, audits: [] as unknown[][], events: [] as string[],
}));
vi.mock("../server/pbx/db", () => ({ query: f.query, withTransaction: f.sharedTransaction }));
vi.mock("../server/pbx/fraud-policy-db", () => ({
  getFraudPolicyBindingStatus: f.binding, withFraudPolicyTransaction: f.transaction,
}));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: async (_key: string, _ttl: number, callback: () => unknown) => callback(),
  invalidateCache: vi.fn(),
}));
vi.mock("../server/pbx/schema-capabilities", () => ({
  readManagementCapabilities: async () => ({ phoneNumbers: true }), schemaHasRequiredColumns: vi.fn(),
}));
vi.mock("../server/pbx/sip-secrets", () => ({ createSipCredentials: vi.fn(), regenerateSipCredentials: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({
  getCallStats: vi.fn(), getVoicemails: vi.fn(), requireVoicemailStorage: vi.fn(), VoicemailStorageUnavailableError: class extends Error {},
}));
vi.mock("../server/pbx/voicemail-access", () => ({ countVoicemails: vi.fn(), deleteVoicemail: vi.fn(), markVoicemailRead: vi.fn(), voicemailStorageStatus: vi.fn() }));
vi.mock("../server/profile/photo", () => ({ profilePhotoDescriptors: vi.fn() }));
vi.mock("../server/phone-provisioning", () => ({ reactivateExtensionSipAuth: vi.fn(), revokeExtensionSipAuth: vi.fn(), rotateExtensionSipAuth: vi.fn() }));
import { pbxRouter } from "../server/pbx/pbx-router";

const caller = (user: any = { id: 9 }) => pbxRouter.createCaller({ user, req: { ip: "127.0.0.1", headers: {} }, res: {} } as any);
const change = () => caller().fraudControls.update({ tenantId: 7, internationalEnabled: true });
const safeError = (error: any, code: string, message?: string) => {
  expect(error).toMatchObject({ code, ...(message ? { message } : {}) });
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify(error)).not.toMatch(/PRIVATE_|42501|FRAUD_POLICY_UNAVAILABLE/);
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(f, { memberships: [7, 8], cachedRole: "admin", liveRole: "admin", lockRows: [{ role: "admin" }],
    readRows: [], updateRows: [{ tenant_id: 7 }], failAudit: false, failStorage: false,
    pending: 0, committed: 0, audits: [], events: [] });
  f.binding.mockImplementation((tenantId: number) => ({ available: tenantId === 7 }));
  f.sharedTransaction.mockImplementation(() => { throw new Error("PRIVATE_PRIVILEGED_FALLBACK"); });
  f.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
    if (sql.includes("ORDER BY tm.created_at ASC")) return { rows: f.memberships.map(tenant_id => ({
      tenant_id, user_id: 9, role: f.cachedRole, tenant_name: "Synthetic", tenant_status: "active",
    })) };
    if (sql.includes("SELECT tm.role FROM tenant_memberships tm")) {
      expect(parameters).toEqual([9, expect.any(Number)]);
      return { rows: ["admin", "owner"].includes(f.liveRole) ? [{ role: f.liveRole }] : [] };
    }
    throw new Error("PRIVATE_SHARED_STORAGE_QUERY");
  });
  f.client.mockImplementation(async (sql: string, parameters: unknown[] = []) => {
    if (f.failStorage) throw Object.assign(new Error("PRIVATE_DB_ROW"), { code: "42501" });
    if (sql.includes("phone11_lock_fixed_fraud_admin")) {
      f.events.push("LOCK"); expect(parameters).toEqual([9]); return { rows: f.lockRows };
    }
    if (sql.includes("FROM fraud_controls")) { f.events.push("READ"); expect(parameters).toEqual([7]); return { rows: f.readRows }; }
    if (sql.includes("INSERT INTO fraud_controls")) { f.events.push("WRITE"); f.pending++; return { rows: f.updateRows }; }
    if (sql.includes("INSERT INTO audit_logs")) {
      f.events.push("AUDIT"); f.audits.push(parameters);
      if (f.failAudit) throw Object.assign(new Error("PRIVATE_AUDIT_ROW"), { code: "42501" });
      return { rows: [] };
    }
    throw new Error("PRIVATE_UNEXPECTED_SQL");
  });
  f.transaction.mockImplementation(async (tenantId: number, callback: (client: any) => Promise<unknown>) => {
    expect(tenantId).toBe(7); f.events.push("BEGIN");
    try {
      const result = await callback({ query: f.client });
      f.events.push("COMMIT"); f.committed += f.pending; f.pending = 0; return result;
    } catch (error) { f.events.push("ROLLBACK"); f.pending = 0; throw error; }
    finally { f.events.push("RELEASE"); }
  });
});

describe("dedicated fraud-policy API dispatch", () => {
  it.each(["get", "update"])("retains selected tenant, cached admin and live admin admission for %s", async operation => {
    const run = (tenantId?: number) => operation === "get" ? caller().fraudControls.get(tenantId ? { tenantId } : undefined)
      : caller().fraudControls.update({ tenantId, internationalEnabled: false });
    await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(99)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.cachedRole = "user"; await expect(run(7)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.cachedRole = "admin"; f.liveRole = "user"; await expect(run(7)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.transaction).not.toHaveBeenCalled(); expect(f.client).not.toHaveBeenCalled();
  });

  it("refuses anonymous callers and invalid tenant input before touching transports", async () => {
    await expect(caller(null).fraudControls.get({ tenantId: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const tenantId of [0, -1, 1.5]) await expect(caller().fraudControls.get({ tenantId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.query).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });

  it.each(["absent", "different fixed tenant"])("fails closed when binding is %s without privileged fallback", async reason => {
    if (reason === "absent") f.binding.mockReturnValue({ available: false });
    const tenantId = reason === "absent" ? 7 : 8;
    await expect(caller().fraudControls.get({ tenantId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller().fraudControls.update({ tenantId, internationalEnabled: false })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.transaction).not.toHaveBeenCalled(); expect(f.sharedTransaction).not.toHaveBeenCalled();
    expect(f.query.mock.calls.every(([sql]) => !sql.includes("fraud_controls"))).toBe(true);
  });

  it("uses the dedicated client for exact tenant reads, preserving absent and existing policy", async () => {
    await expect(caller().fraudControls.get({ tenantId: 7 })).resolves.toBeNull();
    const row = { tenant_id: 7, international_enabled: false, premium_rate_enabled: true };
    f.readRows = [row]; await expect(caller().fraudControls.get({ tenantId: 7 })).resolves.toEqual(row);
    expect(f.transaction).toHaveBeenCalledTimes(2); expect(f.sharedTransaction).not.toHaveBeenCalled();
    expect(f.events).toEqual(["BEGIN", "LOCK", "READ", "COMMIT", "RELEASE", "BEGIN", "LOCK", "READ", "COMMIT", "RELEASE"]);
  });

  it.each([{ rows: [{ tenant_id: 8 }] }, { rows: [{ tenant_id: "7" }] }, { rows: [{ tenant_id: 7 }, { tenant_id: 7 }] }])("rejects mismatched or nonunique read rows %j", async ({ rows }) => {
    f.readRows = rows;
    safeError(await caller().fraudControls.get({ tenantId: 7 }).catch(error => error), "PRECONDITION_FAILED", "Fraud controls are unavailable");
    expect(f.events).toEqual(["BEGIN", "LOCK", "READ", "ROLLBACK", "RELEASE"]);
  });

  it("pins the actor helper lock before the two-flag upsert and strict audit on one leased client", async () => {
    const input = { tenantId: 7, internationalEnabled: true, premiumRateEnabled: false };
    await expect(caller().fraudControls.update(input)).resolves.toEqual({ success: true });
    expect(f.events).toEqual(["BEGIN", "LOCK", "WRITE", "AUDIT", "COMMIT", "RELEASE"]);
    const [sql, values] = f.client.mock.calls[1];
    expect(sql).toContain("INSERT INTO fraud_controls (international_enabled, premium_rate_enabled, tenant_id)");
    expect(sql).toContain("international_enabled = EXCLUDED.international_enabled, premium_rate_enabled = EXCLUDED.premium_rate_enabled");
    expect(values).toEqual([true, false, 7]);
    expect(f.client.mock.calls[0][0]).toBe("SELECT phone11_lock_fixed_fraud_admin($1) AS role");
    expect(f.client.mock.calls.every(([sql]) => !/FOR UPDATE OF|FROM tenant_memberships/.test(sql))).toBe(true);
    expect(f.audits[0].slice(0, 7)).toEqual([7, 9, "update", "fraud_controls", "7", null, JSON.stringify(input)]);
    expect(f.sharedTransaction).not.toHaveBeenCalled(); expect(f.committed).toBe(1);
  });

  it("updates only the supplied flag and admits a single-workspace legacy request", async () => {
    f.memberships = [7];
    await caller().fraudControls.update({ premiumRateEnabled: false });
    expect(f.client.mock.calls[1][0]).toContain("INSERT INTO fraud_controls (premium_rate_enabled, tenant_id)");
    expect(f.client.mock.calls[1][1]).toEqual([false, 7]);
  });

  it.each([
    { maxConcurrentOutbound: 1 }, { callsPerMinuteLimit: 2 }, { dailyCostCeiling: 0 },
    { geoBlockList: [] }, { geoAllowList: [] }, { alertEmail: "admin@example.invalid" },
    { alertOnDailyCeiling: false }, { autoDisableOnCeiling: false }, { unexpected: true }, {},
  ])("rejects unsupported/no-edit input %j before leasing the fraud client", async fields => {
    await expect(caller().fraudControls.update({ tenantId: 7, ...fields } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.transaction).not.toHaveBeenCalled(); expect(f.sharedTransaction).not.toHaveBeenCalled();
  });

  it("rejects mixed flags and unsupported policy fields rather than silently discarding them", async () => {
    await expect(caller().fraudControls.update({ tenantId: 7, internationalEnabled: true, dailyCostCeiling: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.transaction).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{ role: "user" }] }, { rows: [{ role: "admin" }, { role: "owner" }] }])("refuses invalid helper authority before DML %j", async ({ rows }) => {
    f.lockRows = rows;
    await expect(change()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events).toEqual(["BEGIN", "LOCK", "ROLLBACK", "RELEASE"]); expect(f.committed).toBe(0);
  });

  it("holds current actor authority on reads and refuses revocation before returning policy", async () => {
    f.lockRows = [];
    f.readRows = [{ tenant_id: 7, international_enabled: true }];
    await expect(caller().fraudControls.get({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events).toEqual(["BEGIN", "LOCK", "ROLLBACK", "RELEASE"]);
  });

  it.each([{ rows: [] }, { rows: [{ tenant_id: 8 }] }, { rows: [{ tenant_id: "7" }] }, { rows: [{ tenant_id: 7 }, { tenant_id: 7 }] }])("rejects unexpected upsert identity/count before audit %j", async ({ rows }) => {
    f.updateRows = rows;
    await expect(change()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.audits).toEqual([]); expect(f.events).toEqual(["BEGIN", "LOCK", "WRITE", "ROLLBACK", "RELEASE"]);
    expect(f.pending).toBe(0); expect(f.committed).toBe(0);
  });

  it("lets strict audit failure abort the same transaction and sanitizes its details", async () => {
    f.failAudit = true;
    safeError(await change().catch(error => error), "INTERNAL_SERVER_ERROR", "Could not record PBX change");
    expect(f.events).toEqual(["BEGIN", "LOCK", "WRITE", "AUDIT", "ROLLBACK", "RELEASE"]);
    expect(f.pending).toBe(0); expect(f.committed).toBe(0); expect(f.sharedTransaction).not.toHaveBeenCalled();
  });

  it("sanitizes storage/adapter failures on both endpoints without privileged retry", async () => {
    f.transaction.mockRejectedValueOnce(new Error("PRIVATE_LOGIN_MISMATCH"));
    safeError(await caller().fraudControls.get({ tenantId: 7 }).catch(error => error), "PRECONDITION_FAILED");
    f.transaction.mockRejectedValueOnce(new Error("PRIVATE_COMMIT_FAILED"));
    safeError(await change().catch(error => error), "INTERNAL_SERVER_ERROR", "Could not complete PBX change");
    f.failStorage = true;
    safeError(await caller().fraudControls.get({ tenantId: 7 }).catch(error => error), "PRECONDITION_FAILED");
    safeError(await change().catch(error => error), "INTERNAL_SERVER_ERROR");
    expect(f.sharedTransaction).not.toHaveBeenCalled();
  });
});

describe("fraud capability reflects dedicated selected binding", () => {
  it("requires explicit selected tenant even when generic explicitTenantReads is true", async () => {
    await expect(caller().capabilities()).resolves.toMatchObject({ explicitTenantReads: true, explicitFraudControls: false });
    expect(f.binding).not.toHaveBeenCalled();
    await expect(caller().capabilities({ tenantId: 7 })).resolves.toMatchObject({ explicitFraudControls: true });
    await expect(caller().capabilities({ tenantId: 8 })).resolves.toMatchObject({ explicitFraudControls: false });
    f.binding.mockReturnValue({ available: false });
    await expect(caller().capabilities({ tenantId: 7 })).resolves.toMatchObject({ explicitTenantReads: true, explicitFraudControls: false });
    expect(f.transaction).not.toHaveBeenCalled();
  });

  it("retains current administrator admission before reporting a binding", async () => {
    f.liveRole = "user";
    await expect(caller().capabilities({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.binding).not.toHaveBeenCalled();
  });
});
