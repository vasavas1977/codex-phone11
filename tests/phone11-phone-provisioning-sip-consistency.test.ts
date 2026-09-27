import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  txQuery: vi.fn(),
  withTransaction: vi.fn(),
  createCredentials: vi.fn(),
  computeHA1: vi.fn(),
  computeHA1B: vi.fn(),
  decryptSecret: vi.fn(),
}));

vi.mock("../server/pbx/db", () => ({
  getPool: () => ({ query: state.poolQuery }),
  withTransaction: state.withTransaction,
}));
vi.mock("../server/pbx/sip-secrets", () => ({
  createSipCredentials: state.createCredentials,
  computeHA1: state.computeHA1,
  computeHA1B: state.computeHA1B,
  decryptSecret: state.decryptSecret,
}));

import { createExtension, getPhoneConfig, listExtensions } from "../server/phone-provisioning";

const credentials = {
  sipUsername: "4101", sipDomain: "sip.phone11.ai", plaintextPassword: "fixture-secret",
  ha1: "fixture-ha1", ha1b: "fixture-ha1b", secretCiphertext: Buffer.from("cipher"),
  secretIv: Buffer.from("iv"), secretTag: Buffer.from("tag"), dekId: "fixture-dek",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.poolQuery.mockResolvedValue({ rows: [] });
  state.txQuery.mockImplementation(async (sql: string) => ({
    rows: sql.includes("INSERT INTO extensions") ? [{ id: 41, sip_password: null }] : [],
  }));
  state.withTransaction.mockImplementation(async (callback) => callback({ query: state.txQuery }));
  state.createCredentials.mockReturnValue(credentials);
  state.computeHA1.mockImplementation((username, domain, password) => `ha1:${username}:${domain}:${password}`);
  state.computeHA1B.mockImplementation((username, domain, realm, password) => `ha1b:${username}:${domain}:${realm}:${password}`);
  state.decryptSecret.mockReturnValue("fixture-secret");
});

describe("legacy Phone11 SIP provisioning", () => {
  it("locks the global SIP URI and writes the same credentials atomically", async () => {
    await expect(createExtension({ orgId: 7, extensionNumber: "4101" }))
      .resolves.toEqual({ id: 41 });
    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    const sql = state.txQuery.mock.calls.map(([statement]) => String(statement));
    expect(sql.findIndex((statement) => statement.includes("pg_advisory_xact_lock")))
      .toBeLessThan(sql.findIndex((statement) => statement.includes("SELECT id FROM subscriber")));
    expect(sql.some((statement) => statement.includes("INSERT INTO subscriber") && !statement.includes("ON CONFLICT"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO sip_accounts"))).toBe(true);
    const subscriberInsert = state.txQuery.mock.calls.find(([statement]) => String(statement).includes("INSERT INTO subscriber"));
    expect(subscriberInsert?.[1]).toContain("fixture-secret");
    const extensionInsert = state.txQuery.mock.calls.find(([statement]) => String(statement).includes("INSERT INTO extensions"));
    expect(extensionInsert?.[0]).toContain("NULL");
    expect(extensionInsert?.[1]).not.toContain("fixture-secret");
  });

  it("rejects an existing subscriber before generating or changing credentials", async () => {
    state.txQuery.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT id FROM subscriber") ? [{ id: 1 }] : [],
    }));
    await expect(createExtension({ orgId: 7, extensionNumber: "4101" }))
      .rejects.toThrow("already in use");
    expect(state.createCredentials).not.toHaveBeenCalled();
    expect(state.txQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO subscriber"))).toBe(false);
  });

  it("does not return credentials when the account insert fails", async () => {
    state.txQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO sip_accounts")) throw new Error("account insert failed");
      return { rows: sql.includes("INSERT INTO extensions") ? [{ id: 41 }] : [] };
    });
    await expect(createExtension({ orgId: 7, extensionNumber: "4101" }))
      .rejects.toThrow("account insert failed");
    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    expect(state.txQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO subscriber"))).toBe(true);
  });

  it("redacts legacy stored SIP passwords from extension listings", async () => {
    state.poolQuery.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT e.*, ue.user_id as assigned_user_id")
        ? [{ id: 41, sip_password: "old-secret" }] : [],
    }));
    await expect(listExtensions(7)).resolves.toEqual([{ id: 41 }]);
  });

  it("withholds a mismatched account and admits it only after subscriber parity", async () => {
    const assigned = {
      id: 41, tenant_id: 7, extension_number: "4101", type: "user",
      sip_username: "4101", sip_domain: "sip.phone11.ai",
      sip_password: "fixture-secret", account_id: 51,
      account_sip_username: "4101", account_sip_domain: "sip.phone11.ai",
      account_ha1: "ha1:4101:sip.phone11.ai:fixture-secret",
      account_ha1b: "ha1b:4101:sip.phone11.ai:sip.phone11.ai:fixture-secret",
      subscriber_password: "fixture-secret",
      subscriber_ha1: "ha1:4101:sip.phone11.ai:fixture-secret",
      subscriber_ha1b: "ha1b:4101:sip.phone11.ai:sip.phone11.ai:fixture-secret",
      secret_ciphertext: Buffer.from("cipher"), secret_iv: Buffer.from("iv"),
      secret_tag: Buffer.from("tag"),
    };
    state.poolQuery.mockImplementation(async (sql: string) => ({
      rows: sql.includes("ue.is_primary") ? [assigned] : [],
    }));
    state.decryptSecret.mockReturnValue("different-secret");
    await expect(getPhoneConfig(33, "member-open-id")).resolves.toEqual({ configured: false });
    state.decryptSecret.mockReturnValue("fixture-secret");
    await expect(getPhoneConfig(33, "member-open-id")).resolves.toMatchObject({
      configured: true, sip: { username: "4101", password: "fixture-secret" },
    });
    expect(state.poolQuery.mock.calls.some(([sql]) => String(sql).includes("sa.user_id = $1 AND ue.user_id = $1"))).toBe(true);
    expect(state.poolQuery.mock.calls.some(([sql]) => String(sql).includes("tm.tenant_id = e.tenant_id"))).toBe(true);
  });
});
