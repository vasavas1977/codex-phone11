import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  txQuery: vi.fn(),
  withTransaction: vi.fn(),
  createCredentials: vi.fn(),
  resetCredentials: vi.fn(),
  audit: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock("../server/pbx/db", () => ({ query: state.query, withTransaction: state.withTransaction }));
vi.mock("../server/pbx/tenant-middleware", () => ({
  resolveTenantContext: vi.fn(async () => ({
    tenantId: 7, role: "admin", memberships: [{ tenantId: 7, role: "admin" }],
  })),
  hasRole: vi.fn((role: string) => role === "admin" || role === "owner"),
  requireLiveTenantAdminMembership: vi.fn(async () => "admin"),
  validateTenantOwnership: vi.fn(async () => true),
}));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: state.createCredentials,
  regenerateSipCredentials: state.resetCredentials,
}));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: state.audit, queryAuditLogs: vi.fn() }));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
  invalidateCache: state.invalidateCache,
}));
vi.mock("../server/pbx/cdr-processor", () => ({
  getCallStats: vi.fn(), getVoicemails: vi.fn(),
}));
vi.mock("../server/pbx/schema-capabilities", () => ({
  readManagementCapabilities: vi.fn(async () => ({ phoneNumbers: false })),
  schemaHasRequiredColumns: vi.fn(),
}));
vi.mock("../server/phone-provisioning", () => ({
  rotateExtensionSipAuth: vi.fn(), revokeExtensionSipAuth: vi.fn(), reactivateExtensionSipAuth: vi.fn(),
}));

import { pbxRouter } from "../server/pbx/pbx-router";
import { resolveTenantContext } from "../server/pbx/tenant-middleware";

const context = { user: { id: 9, role: "admin" }, req: { ip: "127.0.0.1", headers: {} }, res: {} } as any;
const credentials = {
  sipUsername: "4101", sipDomain: "sip.phone11.ai", plaintextPassword: "fixture-password",
  ha1: "fixture-ha1", ha1b: "fixture-ha1b",
  secretCiphertext: Buffer.from("ciphertext"), secretIv: Buffer.from("iv"),
  secretTag: Buffer.from("tag"), dekId: "fixture-dek",
};
const ownedAccount = {
  id: 51, tenant_id: 7, ha1: "old-ha1", ha1b: "old-ha1b",
  extension_sip_username: "4101", extension_sip_domain: "sip.phone11.ai", extension_number: "4101",
  extension_id: 41, extension_username: "4101", extension_domain: "sip.phone11.ai",
  extension_user_id: 33, account_id: 51, sip_username: "4101",
  sip_domain: "sip.phone11.ai", account_user_id: 33,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.createCredentials.mockReturnValue(credentials);
  state.resetCredentials.mockReturnValue(credentials);
  state.withTransaction.mockImplementation(async (callback) => callback({ query: state.txQuery }));
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("FROM extensions e") && sql.includes("JOIN sip_accounts sa")
      ? [ownedAccount] : [],
  }));
  state.txQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("tm.role::text AS role")) return { rows: [{ role: "admin" }] };
    if (sql.includes("FROM tenant_memberships")) return { rows: [{ one: 1 }] };
    if (sql.includes("AS has_conflict")) return { rows: [{ has_conflict: false }] };
    if (sql.includes("FROM extensions e") && sql.includes("JOIN sip_accounts sa")) {
      return { rows: [ownedAccount] };
    }
    if (sql.includes("FROM sip_accounts sa") && sql.includes("FOR UPDATE OF e, sa")) return { rows: [ownedAccount] };
    if (sql.includes("FROM subscriber") && sql.includes("FOR UPDATE")) return { rows: [{ ha1: "old-ha1", ha1b: "old-ha1b" }] };
    if (sql.includes("INSERT INTO subscriber")) return { rows: [{ username: "4101" }] };
    if (sql.includes("UPDATE subscriber")) return { rows: [{ username: "4101" }] };
    if (sql.includes("INSERT INTO extensions")) return { rows: [{ id: 41, sip_password: "legacy-secret" }] };
    if (sql.includes("SELECT EXISTS")) return { rows: [{ has_primary: false }] };
    if (sql.includes("RETURNING id")) return { rows: [{ id: 1 }] };
    return { rows: [] };
  });
});

describe("PBX SIP credential consistency", () => {
  it("creates the unique subscriber, extension, account, and user grant in one transaction", async () => {
    const result = await pbxRouter.createCaller(context).extensions.create({
      extensionNumber: "4101", userId: 33,
    });
    expect(result.sipCredentials).toEqual({ username: "4101", domain: "sip.phone11.ai", transport: "UDP" });
    expect(JSON.stringify(result)).not.toContain("fixture-password");
    expect(state.query).not.toHaveBeenCalled();
    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    const sql = state.txQuery.mock.calls.map(([statement]) => String(statement));
    const lock = sql.findIndex((statement) => statement.includes("pg_advisory_xact_lock(hashtext"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(sql.findIndex((statement) => statement.includes("FROM subscriber")));
    expect(sql.some((statement) => statement.includes("INSERT INTO subscriber") && statement.includes("ON CONFLICT"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO extensions") && statement.includes("sip_password"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO sip_accounts"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO user_extensions"))).toBe(true);
    const subscriberInsert = state.txQuery.mock.calls.find(([statement]) => String(statement).includes("INSERT INTO subscriber"));
    const extensionInsert = state.txQuery.mock.calls.find(([statement]) => String(statement).includes("INSERT INTO extensions"));
    expect(subscriberInsert?.[1]).toContain("fixture-password");
    expect(extensionInsert?.[0]).toContain("NULL");
    expect(extensionInsert?.[1]).not.toContain("fixture-password");
    expect(result).not.toHaveProperty("sip_password");
  });

  it("rejects a pre-existing global subscriber before generating credentials", async () => {
    const original = state.txQuery.getMockImplementation();
    state.txQuery.mockImplementation(async (sql: string, parameters: unknown[]) =>
      sql.includes("SELECT id FROM subscriber") ? { rows: [{ id: 99 }] } : original!(sql, parameters),
    );
    await expect(pbxRouter.createCaller(context).extensions.create({ extensionNumber: "4101" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.createCredentials).not.toHaveBeenCalled();
    expect(state.txQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO subscriber"))).toBe(false);
  });

  it("does not audit or return credentials when account creation fails", async () => {
    const original = state.txQuery.getMockImplementation();
    state.txQuery.mockImplementation(async (sql: string, parameters: unknown[]) => {
      if (sql.includes("INSERT INTO sip_accounts")) throw new Error("fixture account insert failure");
      return original!(sql, parameters);
    });
    await expect(pbxRouter.createCaller(context).extensions.create({ extensionNumber: "4101" }))
      .rejects.toThrow("fixture account insert failure");
    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.invalidateCache).not.toHaveBeenCalled();
  });

  it("resets the exact tenant account and subscriber together", async () => {
    const result = await pbxRouter.createCaller(context).extensions.resetPassword({ extensionId: 41 });
    expect(result.sipCredentials).toEqual({ username: "4101", domain: "sip.phone11.ai" });
    expect(JSON.stringify(result)).not.toContain("fixture-password");
    const sql = state.txQuery.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => statement.includes("pg_advisory_xact_lock(hashtext"))).toBe(true);
    expect(sql.some((statement) => statement.includes("FOR UPDATE OF e, sa"))).toBe(true);
    expect(sql.some((statement) => statement.includes("UPDATE subscriber") && statement.includes("RETURNING username"))).toBe(true);
    expect(sql.some((statement) => statement.includes("UPDATE sip_accounts") && statement.includes("tenant_id = $8"))).toBe(true);
    expect(sql.some((statement) => statement.includes("UPDATE extensions SET sip_password = NULL"))).toBe(true);
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ resourceId: "51" }));
  });

  it("denies password reset to a global admin without tenant admin role", async () => {
    vi.mocked(resolveTenantContext).mockResolvedValueOnce({
      tenantId: 7, role: "member", memberships: [{ tenantId: 7, role: "member" }],
    } as any);
    await expect(pbxRouter.createCaller(context).extensions.resetPassword({ extensionId: 41 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.query).not.toHaveBeenCalled();
    expect(state.withTransaction).not.toHaveBeenCalled();
  });

  it("reassigns extension, account, and user grant in one transaction", async () => {
    state.txQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("tm.role::text AS role")) return { rows: [{ role: "admin" }] };
      if (sql.includes("AS old_value")) return { rows: [{ old_value: { id: 41 }, user_id: 33, status: "active", type: "user" }] };
      if (sql.includes("FROM tenant_memberships")) return { rows: [{ one: 1 }] };
      if (sql.includes("SELECT EXISTS")) return { rows: [{ has_primary: false }] };
      if (sql.includes("RETURNING id")) return { rows: [{ id: 41 }] };
      return { rows: [] };
    });
    await expect(pbxRouter.createCaller(context).extensions.update({ id: 41, userId: 44 }))
      .resolves.toEqual({ success: true });
    const sql = state.txQuery.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => statement.includes("UPDATE extensions SET") && statement.includes("tenant_id"))).toBe(true);
    expect(sql.some((statement) => /UPDATE sip_accounts\s+SET user_id/.test(statement))).toBe(true);
    expect(sql.some((statement) => statement.includes("DELETE FROM user_extensions"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO user_extensions"))).toBe(true);
    const accountUpdate = state.txQuery.mock.calls.find(([statement]) => /UPDATE sip_accounts\s+SET user_id/.test(String(statement)));
    expect(accountUpdate?.[1]).toContain(44);
    expect(state.query.mock.calls.some(([statement]) => String(statement).includes("UPDATE extensions"))).toBe(false);
  });

  it("fails closed for another tenant or ambiguous accounts", async () => {
    const original = state.txQuery.getMockImplementation();
    state.txQuery.mockImplementation(async (sql: string, parameters: unknown[]) =>
      sql.includes("FROM sip_accounts sa") ? { rows: [] } : original!(sql, parameters));
    await expect(pbxRouter.createCaller(context).extensions.resetPassword({ extensionId: 41 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    state.txQuery.mockImplementation(async (sql: string, parameters: unknown[]) =>
      sql.includes("FROM sip_accounts sa") ? { rows: [ownedAccount, ownedAccount] } : original!(sql, parameters));
    await expect(pbxRouter.createCaller(context).extensions.resetPassword({ extensionId: 41 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.withTransaction).toHaveBeenCalledTimes(2);
  });

  it("rejects an absent subscriber without rotating an orphaned account", async () => {
    const original = state.txQuery.getMockImplementation();
    state.txQuery.mockImplementation(async (sql: string, parameters: unknown[]) => {
      if (sql.includes("FROM subscriber") && sql.includes("FOR UPDATE")) return { rows: [] };
      return original!(sql, parameters);
    });
    await expect(pbxRouter.createCaller(context).extensions.resetPassword({ extensionId: 41 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.resetCredentials).not.toHaveBeenCalled();
    expect(state.txQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE sip_accounts"))).toBe(false);
  });

  it("does not return a new password or audit a partial credential write", async () => {
    const original = state.txQuery.getMockImplementation();
    state.txQuery.mockImplementation(async (sql: string, parameters: unknown[]) => {
      if (sql.includes("UPDATE sip_accounts")) throw new Error("fixture write failure");
      return original!(sql, parameters);
    });
    await expect(pbxRouter.createCaller(context).extensions.resetPassword({ extensionId: 41 }))
      .rejects.toThrow("fixture write failure");
    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.invalidateCache).not.toHaveBeenCalled();
  });

  it("redacts stored legacy passwords from extension list and detail", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*) as total")) return { rows: [{ total: "1" }] };
      return { rows: [{ extension: { id: 41, extension_number: "4101", sip_password: "legacy-secret" } }] };
    });
    const caller = pbxRouter.createCaller(context);
    const listed = await caller.extensions.list();
    const detail = await caller.extensions.get({ id: 41 });
    expect(listed.data[0]).not.toHaveProperty("sip_password");
    expect(detail).not.toHaveProperty("sip_password");
  });
});
