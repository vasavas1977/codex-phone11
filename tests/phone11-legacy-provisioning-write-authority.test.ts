import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  transaction: vi.fn(),
  credentials: vi.fn(),
  actor: [] as { role: string }[],
  assignee: [{ user_id: 33 }] as { user_id: number }[],
  extension: [{ id: 41, user_id: 33 }] as { id: number; user_id: number }[],
  committed: false,
  rolledBack: false,
}));

vi.mock("../server/pbx/db", () => ({
  getPool: () => ({ query: state.poolQuery }),
  withTransaction: state.transaction,
}));
vi.mock("../server/pbx/sip-secrets", () => ({ createSipCredentials: state.credentials }));

type Provisioning = typeof import("../server/phone-provisioning");
let provisioning: Provisioning;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  state.actor = [];
  state.assignee = [{ user_id: 33 }];
  state.extension = [{ id: 41, user_id: 33 }];
  state.committed = false;
  state.rolledBack = false;
  state.poolQuery.mockResolvedValue({ rows: [] });
  state.clientQuery.mockImplementation(async (sql: string) => ({ rows:
    sql.includes("SELECT tm.role") ? state.actor :
    sql.includes("SELECT tm.user_id") ? state.assignee :
    sql.includes("SELECT e.id, e.user_id") ? state.extension :
    sql.includes("INSERT INTO subscriber") ? [{ username: "4101" }] :
    sql.includes("INSERT INTO extensions") ? [{ id: 41, sip_password: "redact", password: "redact" }] :
    sql.includes("INSERT INTO did_numbers") ? [{ id: 73 }] : [],
  }));
  state.transaction.mockImplementation(async (callback) => {
    try {
      const result = await callback({ query: state.clientQuery });
      state.committed = true;
      return result;
    } catch (error) {
      state.rolledBack = true;
      throw error;
    }
  });
  state.credentials.mockReturnValue({
    sipUsername: "4101", sipDomain: "sip.phone11.ai", plaintextPassword: "fixture-only-secret",
    ha1: "fixture-ha1", ha1b: "fixture-ha1b", secretCiphertext: Buffer.from("cipher"),
    secretIv: Buffer.from("iv"), secretTag: Buffer.from("tag"), dekId: "fixture-dek",
  });
  provisioning = await import("../server/phone-provisioning");
});

const operations = {
  extension: () => provisioning.createExtension({ orgId: 7, extensionNumber: "4101", actorUserId: 9 }),
  assignment: () => provisioning.assignExtensionToUser(33, 41, true, 7, 9),
  did: () => provisioning.createDidNumber({ orgId: 7, number: "+6620000000", destinationType: "extension", actorUserId: 9 }),
};

describe("legacy provisioning initialization authority", () => {
  it.each(Object.entries(operations))("denies a revoked %s writer before cold initialization effects", async (_name, invoke) => {
    await expect(invoke()).rejects.toThrow("Workspace administrator access is required.");
    // The transaction rejects the live membership. No global initializer or
    // customer mutation may already have run on the pool before that decision.
    expect(state.poolQuery.mock.calls.length).toBe(0);
    expect(state.clientQuery).toHaveBeenCalledTimes(1);
    expect(state.clientQuery.mock.calls[0][0]).toContain("FOR UPDATE OF tm, t");
    expect(state.clientQuery.mock.calls[0][1]).toEqual([9, 7]);
    expect(state.clientQuery.mock.calls[0][0]).toContain("tm.status = 'active'");
    expect(state.clientQuery.mock.calls[0][0]).toContain("tm.role::text IN ('owner', 'admin')");
    expect(state.clientQuery.mock.calls[0][0]).toContain("t.status = 'active'");
    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
  });

  for (const role of ["admin", "owner"]) {
    it.each(Object.entries(operations))(`admits a current ${role} %s writer without schema effects`, async (_name, invoke) => {
      state.actor = [{ role }];
      const result = await invoke();
      expect(result).toEqual(_name === "extension" ? { id: 41 } : _name === "did" ? { id: 73 } : { success: true });
      expect(state.committed).toBe(true);
      expect(state.poolQuery.mock.calls.length).toBe(0);
      expect(state.transaction).toHaveBeenCalledTimes(1);
      expect(state.clientQuery.mock.calls[0][0]).toContain("FOR UPDATE OF tm, t");
      expect(state.clientQuery.mock.calls[0][1]).toEqual([9, 7]);
      expect(state.clientQuery.mock.calls.every(([sql]) => !/\b(?:CREATE|ALTER)\b/.test(String(sql)))).toBe(true);
    });
  }

  it.each(Object.entries(operations))("rechecks a warm %s writer after authority revocation", async (_name, invoke) => {
    state.actor = [{ role: "admin" }];
    await invoke();
    vi.clearAllMocks();
    state.actor = [];
    await expect(invoke()).rejects.toThrow("administrator access");
    expect(state.poolQuery.mock.calls.length).toBe(0);
    expect(state.clientQuery).toHaveBeenCalledTimes(1);
  });

  it.each(Object.entries(operations))("rejects a foreign-tenant %s administrator on exact authority inputs", async (_name, invoke) => {
    state.clientQuery.mockImplementation(async (_sql: string, params: unknown[]) => ({
      rows: params[0] === 9 && params[1] === 8 ? [{ role: "admin" }] : [],
    }));
    await expect(invoke()).rejects.toThrow("administrator access");
    expect(state.poolQuery.mock.calls.length).toBe(0);
    expect(state.clientQuery).toHaveBeenCalledTimes(1);
    expect(state.clientQuery.mock.calls[0][1]).toEqual([9, 7]);
  });

  for (const code of ["42P01", "42703", "XX000"]) {
    it.each(Object.entries(operations))(`propagates ${code} for %s without attempting schema repair`, async (_name, invoke) => {
      const failure = Object.assign(new Error("fixture schema/query error"), { code });
      state.clientQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT tm.role")) return { rows: [{ role: "admin" }] };
        throw failure;
      });
      await expect(invoke()).rejects.toBe(failure);
      expect(state.poolQuery.mock.calls.length).toBe(0);
      expect(state.committed).toBe(false);
      expect(state.rolledBack).toBe(true);
      expect(state.clientQuery.mock.calls.every(([sql]) => !/\b(?:CREATE|ALTER)\b/.test(String(sql)))).toBe(true);
    });
  }

  it("does not initialize missing authority tables even for a claimed administrator", async () => {
    const failure = Object.assign(new Error("tenant_memberships absent"), { code: "42P01" });
    state.clientQuery.mockRejectedValue(failure);
    await expect(operations.extension()).rejects.toBe(failure);
    expect(state.poolQuery.mock.calls.length).toBe(0);
    expect(state.clientQuery).toHaveBeenCalledTimes(1);
    expect(state.rolledBack).toBe(true);
  });

  it.each(["assignee", "extension"] as const)("refuses assignment with an invalid %s before owner mutations", async invalid => {
    state.actor = [{ role: "admin" }];
    state[invalid] = [];
    await expect(operations.assignment()).rejects.toThrow("active member");
    expect(state.poolQuery.mock.calls.length).toBe(0);
    expect(state.clientQuery.mock.calls.some(([sql]) => /\b(?:INSERT|DELETE|UPDATE)\b/.test(String(sql).replace(/FOR UPDATE[^\n]*/g, "")))).toBe(false);
    expect(state.rolledBack).toBe(true);
  });

  it("locks actor, assignee, and extension on one client before assignment changes", async () => {
    state.actor = [{ role: "admin" }];
    await operations.assignment();
    const queries = state.clientQuery.mock.calls;
    expect(queries[0][0]).toContain("FOR UPDATE OF tm, t");
    expect(queries[1][0]).toContain("FOR UPDATE OF tm, t");
    expect(queries[1][1]).toEqual([33, 7]);
    expect(queries[2][0]).toContain("FOR UPDATE OF e");
    expect(queries[2][1]).toEqual([33, 41, 7]);
    expect(queries.find(([sql]) => String(sql).includes("UPDATE extensions"))?.[1]).toEqual([33, 41, 7]);
    expect(queries.find(([sql]) => String(sql).includes("UPDATE sip_accounts"))?.[1]).toEqual([33, 41, 7]);
  });

  it("rejects a failed account insert without returning provisioning success", async () => {
    state.actor = [{ role: "admin" }];
    const query = state.clientQuery.getMockImplementation()!;
    state.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO sip_accounts")) throw new Error("fixture account insert failed");
      return query(sql);
    });
    await expect(operations.extension()).rejects.toThrow("account insert failed");
    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(state.poolQuery.mock.calls.length).toBe(0);
  });

  it("waits for transaction completion before returning extension creation", async () => {
    state.actor = [{ role: "admin" }];
    let release!: () => void;
    const commit = new Promise<void>(resolve => { release = resolve; });
    state.transaction.mockImplementation(async callback => {
      const result = await callback({ query: state.clientQuery });
      await commit;
      state.committed = true;
      return result;
    });
    let returned = false;
    const operation = operations.extension().then(result => { returned = true; return result; });
    await vi.waitFor(() => expect(state.clientQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO sip_accounts"))).toBe(true));
    expect(returned).toBe(false);
    release();
    await expect(operation).resolves.toEqual({ id: 41 });
    expect(state.committed).toBe(true);
  });

  it("does not publish schema readiness after an authenticated success", async () => {
    state.actor = [{ role: "admin" }];
    await operations.extension();
    // The separate compatibility/operator path must still do its old cold
    // initialization; the authenticated transaction never set schemaReady.
    await provisioning.createExtension({ orgId: 7, extensionNumber: "4101" });
    expect(state.poolQuery.mock.calls.length).toBeGreaterThan(0);
    expect(state.poolQuery.mock.calls.some(([sql]) => String(sql).includes("tenant_id INTEGER DEFAULT 1"))).toBe(true);
  });

  it.each(["extension", "assignment", "did"] as const)("retains the actorless %s compatibility initializer", async operation => {
    if (operation === "extension") await provisioning.createExtension({ orgId: 7, extensionNumber: "4101" });
    else if (operation === "assignment") await provisioning.assignExtensionToUser(33, 41, true, 7);
    else await provisioning.createDidNumber({ orgId: 7, number: "+6620000000", destinationType: "extension" });
    expect(state.poolQuery.mock.calls.length).toBeGreaterThan(0);
    expect(state.poolQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO tenants"))).toBe(true);
    expect(state.clientQuery.mock.calls.some(([sql]) => String(sql).includes("SELECT tm.role"))).toBe(false);
  });
});
