import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

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
  decryptSecret: vi.fn(),
}));

import { createSipCredentials } from "../server/pbx/sip-secrets";
import { assignExtensionToUser, createExtension, ensurePilotExtensionForUser, getPhoneConfig } from "../server/phone-provisioning";

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
      extension: { number: "3001", displayName: "Primary" },
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

  it("revokes the former extension link in the reassignment transaction", async () => {
    state.pool.query.mockImplementation(async (sql: string) =>
      sql.includes("JOIN tenant_memberships tm")
        ? { rows: [{ id: 3001 }] }
        : { rows: [] },
    );

    await expect(assignExtensionToUser(18, 3001, true, 7)).resolves.toEqual({ success: true });

    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    const sql = state.pool.query.mock.calls.map(([statement]) => String(statement));
    const revoke = sql.findIndex((statement) => statement.includes("DELETE FROM user_extensions WHERE extension_id"));
    const assign = sql.findIndex((statement) => statement.includes("UPDATE extensions SET user_id"));
    expect(revoke).toBeGreaterThan(-1);
    expect(assign).toBeGreaterThan(revoke);
    expect(state.pool.query.mock.calls[revoke][1]).toEqual([3001, 18]);
  });

  it("does not overwrite a global SIP subscriber for an extension owned by another workspace", async () => {
    state.pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE extension_number = $1 AND deleted_at IS NULL")) {
        return { rows: [{ id: 3001, tenant_id: 8 }] };
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

  it("does not rotate an existing extension's SIP subscriber within the same workspace", async () => {
    state.pool.query.mockImplementation(async (sql: string) =>
      sql.includes("WHERE extension_number = $1 AND deleted_at IS NULL")
        ? { rows: [{ id: 4101, tenant_id: 7 }] }
        : { rows: [] },
    );

    await expect(createExtension({ orgId: 7, extensionNumber: "4101" })).rejects.toThrow(
      "already in use by this workspace",
    );
    expect(createSipCredentials).not.toHaveBeenCalled();
    expect(state.pool.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO subscriber")))
      .toBe(false);
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
      if (sql.includes("WHERE extension_number = $1 AND deleted_at IS NULL")) return { rows: [] };
      if (sql.includes("INSERT INTO extensions")) return { rows: [{ id: 4101 }] };
      return { rows: [] };
    });

    await expect(createExtension({ orgId: 7, extensionNumber: "4101" })).resolves.toEqual({ id: 4101 });

    expect(state.withTransaction).toHaveBeenCalledTimes(1);
    const sql = state.pool.query.mock.calls.map(([statement]) => String(statement));
    expect(sql).toContain("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))");
    expect(sql.findIndex((statement) => statement.includes("pg_advisory_xact_lock")))
      .toBeLessThan(sql.findIndex((statement) => statement.includes("WHERE extension_number = $1 AND deleted_at IS NULL")));
    expect(sql.some((statement) => statement.includes("INSERT INTO subscriber"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO extensions"))).toBe(true);
    expect(sql.some((statement) => statement.includes("INSERT INTO sip_accounts"))).toBe(true);
  });
});

const ownershipDatabaseUrl = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (ownershipDatabaseUrl) {
  const url = new URL(ownershipDatabaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/phone11_pbx_test" || !url.port || url.search || url.hash) {
    throw new Error("Phone config ownership test requires dedicated loopback phone11_pbx_test database");
  }
}

describe.skipIf(!ownershipDatabaseUrl)("Phone11 SIP config ownership on isolated PostgreSQL", () => {
  const schema = `pbx_ownership_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: ownershipDatabaseUrl, ssl: false });
  const database = new Pool({ connectionString: ownershipDatabaseUrl, ssl: false, options: `-c search_path=${schema}` });

  it("never returns the new owner's SIP password through a stale old-user link", async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    try {
      await database.query(`
        CREATE TABLE tenants(id integer PRIMARY KEY, name text, plan text, status text);
        CREATE TABLE organizations(id integer PRIMARY KEY, name text, plan text);
        CREATE TABLE extensions(
          id integer PRIMARY KEY, tenant_id integer, org_id integer, user_id integer,
          extension_number text, display_name text, type text, sip_username text,
          sip_domain text, status text, deleted_at timestamptz
        );
        CREATE TABLE user_extensions(user_id integer, extension_id integer, is_primary boolean);
        CREATE TABLE tenant_memberships(user_id integer, tenant_id integer, status text);
        CREATE TABLE sip_accounts(
          id integer PRIMARY KEY, extension_id integer, tenant_id integer, user_id integer,
          sip_username text, sip_domain text, secret_ciphertext bytea,
          secret_iv bytea, secret_tag bytea, transport_preference text,
          status text, deleted_at timestamptz
        );
        CREATE TABLE subscriber(username text, domain text, password text);
        INSERT INTO tenants VALUES (1,'Phone11','business','active');
        INSERT INTO organizations VALUES (1,'Phone11','business');
        INSERT INTO tenant_memberships VALUES (17,1,'active'), (18,1,'active');
        INSERT INTO extensions VALUES
          (3001,1,1,18,'3001','Current owner','user','3001','sip.phone11.ai','active',NULL);
        INSERT INTO user_extensions VALUES (17,3001,true), (18,3001,true);
        INSERT INTO sip_accounts VALUES
          (1,3001,1,18,'3001','sip.phone11.ai',NULL,NULL,NULL,'TLS','active',NULL);
        INSERT INTO subscriber VALUES ('3001','sip.phone11.ai','new-owner-secret');
      `);
      state.pool.query.mockReset();
      state.pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes("ue.is_primary")) return database.query(sql, params);
        if (sql.includes("SELECT number, description FROM did_numbers")) return { rows: [] };
        return { rows: [] };
      });

      await expect(getPhoneConfig(17, "old-owner")).resolves.toEqual({ configured: false });
      await expect(getPhoneConfig(18, "new-owner")).resolves.toMatchObject({
        configured: true,
        sip: { username: "3001", password: "new-owner-secret" },
      });

      await database.query("DELETE FROM user_extensions WHERE user_id = 18 AND extension_id = 3001");
      await expect(getPhoneConfig(18, "revoked-owner")).resolves.toEqual({ configured: false });

      await database.query("INSERT INTO user_extensions VALUES (18,3001,true)");
      await database.query("UPDATE sip_accounts SET user_id = 17 WHERE id = 1");
      await expect(getPhoneConfig(17, "stale-account-owner")).resolves.toEqual({ configured: false });
      await expect(getPhoneConfig(18, "mismatched-account-owner")).resolves.toEqual({ configured: false });

      await database.query("DELETE FROM sip_accounts WHERE id = 1");
      await database.query("DELETE FROM user_extensions WHERE user_id = 18 AND extension_id = 3001");
      await expect(getPhoneConfig(17, "conflicting-legacy-grant")).resolves.toEqual({ configured: false });
      await expect(getPhoneConfig(18, "missing-legacy-grant")).resolves.toEqual({ configured: false });
      await database.query("INSERT INTO user_extensions VALUES (18,3001,true)");
      await expect(getPhoneConfig(18, "current-legacy-owner")).resolves.toMatchObject({
        configured: true,
        sip: { password: "new-owner-secret" },
      });
    } finally {
      await database.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
});
