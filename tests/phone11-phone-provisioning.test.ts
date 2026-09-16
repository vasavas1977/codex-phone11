import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  assignedRows: [] as Record<string, unknown>[],
  pool: { query: vi.fn() },
}));

vi.mock("../server/pbx/db", () => ({
  getPool: () => state.pool,
}));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: vi.fn(),
  decryptSecret: vi.fn(),
}));

import { getPhoneConfig } from "../server/phone-provisioning";

const assignedExtension = {
  id: 3001,
  tenant_id: 1,
  org_id: 1,
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
      extension: { number: "3001", displayName: "Primary" },
      sip: { username: "3001", password: "test-password" },
    });
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
});
