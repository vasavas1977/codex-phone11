import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ getPool: () => ({ query: state.query }), withTransaction: state.transaction }));

type Provisioning = typeof import("../server/phone-provisioning");
let provisioning: Provisioning;
const reads = [
  ["extensions", () => provisioning.listExtensions(7), [7]],
  ["organizations", () => provisioning.listOrganizations([7, 8]), [[7, 8]]],
  ["DIDs", () => provisioning.listDidNumbers(7), [7]],
] as const;
const mutation = (sql: unknown) => /\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|GRANT)\b/i.test(String(sql));

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  state.query.mockImplementation(async sql => {
    if (mutation(sql)) throw Object.assign(Error("Read attempted schema or seed mutation"), { code: "42501" });
    return { rows: [{ id: 41, tenant_id: 7, number: "+6620000000", name: "Workspace7" }] };
  });
  provisioning = await import("../server/phone-provisioning");
});

describe("legacy administrative reads do not initialize schema", () => {
  it.each(reads)("cold %s read preserves results and exact tenant selection without DDL", async (_name, invoke, params) => {
    await expect(invoke()).resolves.toMatchObject([{ id: 41 }]);
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls[0][1]).toEqual(params);
    expect(String(state.query.mock.calls[0][0])).toMatch(/^\s*SELECT\b/);
    expect(state.query.mock.calls.some(([sql]) => mutation(sql))).toBe(false);
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it.each(reads)("cold %s read returns an empty selection without seeding defaults", async (_name, invoke) => {
    state.query.mockResolvedValue({ rows: [] });
    await expect(invoke()).resolves.toEqual([]);
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls.some(([sql]) => mutation(sql))).toBe(false);
  });
  for (const code of ["42P01", "42703", "XX000"]) {
    it.each(reads)(`%s preserves the original ${code} SELECT error without attempting repair`, async (_name, invoke) => {
      const failure = Object.assign(Error("Fixture SELECT failure"), { code });
      state.query.mockRejectedValue(failure);
      await expect(invoke()).rejects.toBe(failure);
      expect(state.query).toHaveBeenCalledTimes(1);
      expect(String(state.query.mock.calls[0][0])).toMatch(/^\s*SELECT\b/);
      expect(state.query.mock.calls.some(([sql]) => mutation(sql))).toBe(false);
    });
  }
  it("keeps extension password redaction and the active-record tenant filter", async () => {
    state.query.mockResolvedValue({ rows: [{ id: 41, tenant_id: 7, assigned_user_id: 33, sip_password: "private-sip", password: "private-password", display_name: "Member" }] });
    await expect(provisioning.listExtensions(7)).resolves.toEqual([{ id: 41, tenant_id: 7, assigned_user_id: 33, display_name: "Member" }]);
    expect(state.query.mock.calls[0][0]).toContain("e.tenant_id = $1");
    expect(state.query.mock.calls[0][0]).toContain("e.deleted_at IS NULL");
  });
  it("keeps an empty organization selection empty", async () => {
    state.query.mockResolvedValue({ rows: [] });
    await expect(provisioning.listOrganizations([])).resolves.toEqual([]);
    expect(state.query.mock.calls).toHaveLength(1);
    expect(state.query.mock.calls[0][1]).toEqual([[]]);
  });
  it("concurrent cold list requests have no shared initializer side effects", async () => {
    await Promise.all(reads.map(([, invoke]) => invoke()));
    expect(state.query.mock.calls).toHaveLength(3);
    expect(state.query.mock.calls.some(([sql]) => mutation(sql))).toBe(false);
  });
});
