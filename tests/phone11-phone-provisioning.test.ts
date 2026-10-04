import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPhoneConfig } from "../server/phone-provisioning";

const state = vi.hoisted(() => ({
  assignedRows: [] as Record<string, unknown>[],
  pool: { query: vi.fn() },
}));

vi.mock("../server/pbx/db", () => ({ getPool: () => state.pool }));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: vi.fn(),
  decryptSecret: vi.fn(),
}));

const assignedExtension = {
  id: 3001,
  tenant_id: 9,
  org_id: 9,
  extension_number: "3001",
  display_name: "Primary",
  account_sip_username: "3001",
  account_sip_domain: "sip.phone11.ai",
  subscriber_password: "test-password",
  transport_preference: "TLS",
  org_name: "Phone11",
  org_plan: "business",
  tenant_name: "Phone11",
  tenant_plan: "business",
};

describe("Phone11 phone provisioning ownership", () => {
  beforeEach(() => {
    state.assignedRows = [];
    state.pool.query.mockReset();
    state.pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("ue.is_primary")) return { rows: state.assignedRows };
      if (sql.includes("e.sip_username = '1020'")) {
        // A different account already owns this extension. It must never be read
        // or reassigned merely because the caller has the owner OpenID.
        return { rows: [{ ...assignedExtension, user_id: 42, extension_number: "1020" }] };
      }
      return { rows: [] };
    });
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["member-open-id", "owner-open-id"])(
    "returns only the existing assignment for %s, with its tenant-scoped DIDs",
    async (openId) => {
      state.assignedRows = [assignedExtension];
      await expect(getPhoneConfig(17, openId, { bootstrapSchema: false })).resolves.toMatchObject({
        configured: true,
        tenantId: 9,
        extension: { number: "3001", displayName: "Primary" },
        sip: { username: "3001", password: "test-password" },
      });
      expect(state.pool.query.mock.calls[0][1]).toEqual([17, "sip.phone11.ai"]);
      expect(state.pool.query.mock.calls[1][1]).toEqual([9, "3001"]);
      expect(state.pool.query.mock.calls).toHaveLength(2);
    },
  );

  it.each([undefined, false, true])(
    "never reclaims 1020 for the owner with legacy fallback option %s",
    async (allowOwnerFallback) => {
      await expect(getPhoneConfig(17, "owner-open-id", {
        bootstrapSchema: false,
        allowOwnerFallback,
      })).resolves.toEqual({ configured: false });
      expect(state.pool.query.mock.calls).toHaveLength(1);
      expect(state.pool.query.mock.calls[0][0]).toContain("ue.user_id = $1 OR e.user_id = $1 OR sa.user_id = $1");
    },
  );

  it("preserves the isolated staging read-only schema mode", async () => {
    await expect(getPhoneConfig(17, "member-open-id", {
      bootstrapSchema: false,
      allowOwnerFallback: false,
    })).resolves.toEqual({ configured: false });
    expect(state.pool.query.mock.calls).toHaveLength(1);
    expect(state.pool.query.mock.calls[0][0].trim()).toMatch(/^SELECT /);
  });

  it("preserves ordinary schema bootstrap without owner reassignment", async () => {
    await expect(getPhoneConfig(17, "owner-open-id")).resolves.toEqual({ configured: false });
    const statements = state.pool.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS subscriber"))).toBe(true);
    expect(statements.some((sql) => sql.includes("e.sip_username = '1020'"))).toBe(false);
    expect(statements.some((sql) => sql.includes("INSERT INTO user_extensions"))).toBe(false);
    expect(statements.some((sql) => sql.includes("UPDATE extensions SET user_id"))).toBe(false);
    expect(statements.some((sql) => sql.includes("UPDATE sip_accounts SET user_id"))).toBe(false);
  });
});
