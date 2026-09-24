import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const pool = { query: vi.fn() };
  return {
    assignedRows: [] as Record<string, unknown>[],
    pool,
    withTransaction: vi.fn(async (callback) => callback(pool)),
  };
});

vi.mock("../server/pbx/db", () => ({
  getPool: () => state.pool,
  withTransaction: state.withTransaction,
}));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: vi.fn(),
  computeHA1: vi.fn(),
  computeHA1B: vi.fn(),
  decryptSecret: vi.fn(),
}));

import { computeHA1, computeHA1B, createSipCredentials } from "../server/pbx/sip-secrets";
import { assignExtensionToUser, createExtension, ensurePilotExtensionForUser, getPhoneConfig } from "../server/phone-provisioning";

const assignedExtension = {
  id: 3001,
  tenant_id: 1,
  org_id: 1,
  extension_number: "3001",
  display_name: "Primary",
  account_sip_username: "3001",
  account_sip_domain: "sip.phone11.ai",
  account_id: null,
  sip_password: "test-password",
  subscriber_password: "test-password",
  subscriber_ha1: "ha1:3001:sip.phone11.ai:test-password",
  subscriber_ha1b: "ha1b:3001:sip.phone11.ai:sip.phone11.ai:test-password",
  transport_preference: "TLS",
  org_name: "Phone11",
  org_plan: "business",
  tenant_name: "Phone11",
  tenant_plan: "business",
};

describe("Phone11 phone provisioning ownership", () => {
  beforeEach(() => {
    state.assignedRows = [];
    vi.mocked(computeHA1).mockImplementation((username, realm, password) => `ha1:${username}:${realm}:${password}`);
    vi.mocked(computeHA1B).mockImplementation((username, domain, realm, password) => `ha1b:${username}:${domain}:${realm}:${password}`);
    state.pool.query.mockReset();
    state.withTransaction.mockClear();
    state.pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("ue.is_primary")) {
        return { rows: state.assignedRows };
      }
      if (sql.includes("SELECT number, description FROM did_numbers")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    process.env.OWNER_OPEN_ID = "owner-open-id";
  });

  it("returns the extension already assigned to the authenticated user", async () => {
    state.assignedRows = [assignedExtension];

    await expect(getPhoneConfig(17, "member-open-id")).resolves.toMatchObject({
      configured: true,
      extension: { id: 3001, number: "3001", displayName: "Primary" },
      sip: { username: "3001", password: "test-password" },
    });
    const assignmentQuery = String(state.pool.query.mock.calls.find(([sql]) => String(sql).includes("ue.is_primary"))?.[0]);
    expect(assignmentQuery).toContain("tm.tenant_id = e.tenant_id AND tm.status = 'active'");
    expect(assignmentQuery).toContain("sa.tenant_id = e.tenant_id");
  });

  it("allows the legacy credential fallback only when no SIP account exists", async () => {
    state.assignedRows = [assignedExtension];

    await expect(getPhoneConfig(17, "member-open-id")).resolves.toMatchObject({
      configured: true,
      sip: { password: "test-password" },
    });

    const assignmentQuery = String(state.pool.query.mock.calls.find(([sql]) => String(sql).includes("ue.is_primary"))?.[0]);
    expect(assignmentQuery).toContain("sa.id IS NULL OR (sa.status = 'active' AND sa.deleted_at IS NULL)");
    expect(assignmentQuery).not.toContain("sa.status = 'active' AND sa.deleted_at IS NULL\n      LEFT JOIN subscriber");
  });

  it("withholds phone credentials if the subscriber digest no longer matches", async () => {
    state.assignedRows = [{ ...assignedExtension, subscriber_ha1: "other-account" }];
    await expect(getPhoneConfig(17, "member-open-id")).resolves.toEqual({ configured: false });
  });

  it("does not bootstrap another SIP account for an inactive pilot member", async () => {
    await expect(ensurePilotExtensionForUser(17, "member-open-id")).resolves.toEqual({ configured: false });
    expect(state.pool.query.mock.calls.some(([sql]) => String(sql).includes("tm.tenant_id=1 AND tm.status='active'"))).toBe(true);
    expect(state.pool.query.mock.calls.some(([sql]) => /INSERT INTO user_extensions|INSERT INTO extensions|UPDATE extensions SET user_id/.test(String(sql)))).toBe(false);
  });

  it("does not reclaim an unassigned extension for the owner", async () => {
    await expect(getPhoneConfig(17, "owner-open-id")).resolves.toEqual({ configured: false });

    expect(
      state.pool.query.mock.calls.some(([sql]) =>
        String(sql).includes("e.sip_username = '1020'") ||
        String(sql).includes("e.extension_number = '1020'"),
      ),
    ).toBe(false);
  });

  it("does not assign an extension or clear primary state for an inactive workspace member", async () => {
    state.pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM extensions e") && sql.includes("JOIN tenant_memberships tm")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(assignExtensionToUser(17, 3001, true, 7)).rejects.toThrow(
      "active member of this workspace",
    );

    expect(state.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("tm.user_id = $1 AND tm.tenant_id = e.tenant_id AND tm.status = 'active'"),
      [17, 3001, 7],
    );
    expect(
      state.pool.query.mock.calls.some(([sql]) =>
        /INSERT INTO user_extensions|UPDATE user_extensions ue SET is_primary|UPDATE extensions SET user_id/.test(String(sql)),
      ),
    ).toBe(false);
  });

  it("does not overwrite a global SIP subscriber for an extension owned by another workspace", async () => {
    state.pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE extension_number = $1 AND tenant_id <> $2")) {
        return { rows: [{ id: 3001 }] };
      }
      return { rows: [] };
    });

    await expect(createExtension({ orgId: 7, extensionNumber: "3001" })).rejects.toThrow(
      "already in use by another workspace",
    );

    expect(createSipCredentials).not.toHaveBeenCalled();
    expect(
      state.pool.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO subscriber")),
    ).toBe(false);
  });

  it("serializes the global SIP username ownership check with all provisioning writes", async () => {
    vi.mocked(createSipCredentials).mockReturnValue({
      plaintextPassword: "test-password",
      sipUsername: "4101",
      sipDomain: "sip.phone11.ai",
      ha1: "ha1",
      ha1b: "ha1b",
      secretCiphertext: Buffer.from("ciphertext"),
      secretIv: Buffer.from("iv"),
      secretTag: Buffer.from("tag"),
      dekId: "test-key",
    });
    state.pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE extension_number = $1 AND tenant_id <> $2")) return { rows: [] };
      if (sql.includes("INSERT INTO extensions")) return { rows: [{ id: 4101 }] };
      return { rows: [] };
    });

    await expect(createExtension({ orgId: 7, extensionNumber: "4101" })).resolves.toEqual({ id: 4101 });

    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    const sql = state.pool.query.mock.calls.map(([statement]) => String(statement));
    expect(sql).toContain("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))");
    expect(sql.findIndex((statement) => statement.includes("pg_advisory_xact_lock")))
      .toBeLessThan(sql.findIndex((statement) => statement.includes("WHERE extension_number = $1 AND tenant_id <> $2")));
    expect(sql.some((statement) => statement.includes("INSERT INTO subscriber"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO extensions"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO sip_accounts"))).toBe(true);
  });
});
