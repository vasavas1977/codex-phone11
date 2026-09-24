import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/phone11_pbx_test" ||
    !url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Desktop provisioning tests require the dedicated loopback phone11_pbx_test database");
  }
}

const schema = `desktop_provisioning_${randomBytes(8).toString("hex")}`;
const admin = new Pool({ connectionString, max: 1, ssl: false });
const database = new Pool({
  connectionString,
  max: 4,
  ssl: false,
  options: `-c search_path=${schema}`,
});

// Exercise the real provisioning query and digest checks against isolated PostgreSQL.
// The application DB module is replaced only at the pool boundary so the suite can
// direct every query into its private schema on the dedicated test database.
import { vi } from "vitest";
vi.mock("../server/pbx/db", () => ({
  getPool: () => database,
  withTransaction: async (callback: (pool: Pool) => Promise<unknown>) => callback(database),
}));

import { computeHA1, computeHA1B } from "../server/pbx/sip-secrets";
import { getPhoneConfig } from "../server/phone-provisioning";

const TEST_PASSWORD = "synthetic-desktop-provisioning-only";
const SIP_DOMAIN = "sip.phone11.ai";
const USER_ID = 1020;
const EXTENSION_ID = 3001;
const OTHER_USER_ID = 1021;
const TENANT_ID = 11;

async function insertAuthorizedOwner() {
  const username = "3001";
  const ha1 = computeHA1(username, SIP_DOMAIN, TEST_PASSWORD);
  const ha1b = computeHA1B(username, SIP_DOMAIN, SIP_DOMAIN, TEST_PASSWORD);
  await database.query("INSERT INTO tenants (id, name, plan, status) VALUES ($1, 'Test workspace', 'business', 'active')", [TENANT_ID]);
  await database.query("INSERT INTO tenant_memberships (user_id, tenant_id, status) VALUES ($1, $2, 'active')", [USER_ID, TENANT_ID]);
  await database.query(`
    INSERT INTO extensions (id, org_id, tenant_id, user_id, extension_number, display_name, type, sip_username, sip_domain, sip_password, transport, status)
    VALUES ($1, $2, $2, $3, '3001', 'Test 3001', 'user', '3001', $4, $5, 'TLS', 'active')
  `, [EXTENSION_ID, TENANT_ID, USER_ID, SIP_DOMAIN, TEST_PASSWORD]);
  await database.query("INSERT INTO user_extensions (user_id, extension_id, is_primary) VALUES ($1, $2, true)", [USER_ID, EXTENSION_ID]);
  await database.query(`
    INSERT INTO sip_accounts (tenant_id, org_id, extension_id, user_id, sip_username, sip_domain, ha1, ha1b, transport_preference, status)
    VALUES ($1, $1, $2, $3, '3001', $4, $5, $6, 'TLS', 'active')
  `, [TENANT_ID, EXTENSION_ID, USER_ID, SIP_DOMAIN, ha1, ha1b]);
  await database.query("INSERT INTO subscriber (username, domain, password, ha1, ha1b) VALUES ('3001', $1, $2, $3, $4)", [SIP_DOMAIN, TEST_PASSWORD, ha1, ha1b]);
}

describe.skipIf(!connectionString)("desktop provisioning candidate against isolated PostgreSQL", () => {
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await database.query(`CREATE TABLE tenant_memberships (
      user_id INTEGER NOT NULL,
      tenant_id INTEGER NOT NULL,
      status VARCHAR(32) NOT NULL
    );`);
    // Run the module's real idempotent schema bootstrap before test cleanup.
    await getPhoneConfig(9999, "bootstrap-only");
  });

  beforeEach(async () => {
    await database.query(`
      TRUNCATE subscriber, did_numbers, sip_accounts, user_extensions, extensions, tenants, organizations, tenant_memberships RESTART IDENTITY CASCADE;
    `);
  });

  afterAll(async () => {
    await database.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("returns the authorized owner's extension ID and SIP configuration", async () => {
    await insertAuthorizedOwner();

    const config = await moduleApi.getPhoneConfig(USER_ID, "test-auth-user-1020");
    expect(config).toMatchObject({
      configured: true,
      tenantId: TENANT_ID,
      extension: { id: EXTENSION_ID, number: "3001", displayName: "Test 3001" },
      sip: { username: "3001", password: TEST_PASSWORD, domain: SIP_DOMAIN, transport: "TLS" },
    });
  });

  it("fails closed for a stale user-extension row", async () => {
    await insertAuthorizedOwner();
    await database.query("UPDATE extensions SET user_id = $1 WHERE id = $2", [OTHER_USER_ID, EXTENSION_ID]);
    await expect(moduleApi.getPhoneConfig(USER_ID, "test-auth-user-1020")).resolves.toEqual({ configured: false });
  });

  it.each([
    ["extension owner mismatch", "UPDATE extensions SET user_id = $1 WHERE id = $2"],
    ["SIP account owner mismatch", "UPDATE sip_accounts SET user_id = $1 WHERE extension_id = $2"],
  ])("fails closed for %s", async (_label, update) => {
    await insertAuthorizedOwner();
    await database.query(update, [OTHER_USER_ID, EXTENSION_ID]);
    await expect(moduleApi.getPhoneConfig(USER_ID, "test-auth-user-1020")).resolves.toEqual({ configured: false });
  });

  it("fails closed when a second account claims the same global SIP identity", async () => {
    await insertAuthorizedOwner();
    await database.query("INSERT INTO tenants (id, name, plan, status) VALUES (12, 'Other workspace', 'business', 'active')");
    await database.query(`
      INSERT INTO extensions (id, org_id, tenant_id, user_id, extension_number, display_name, type, sip_username, sip_domain, sip_password, status)
      VALUES (3002, 12, 12, 1022, '3002', 'Other extension', 'user', '3001', $1, $2, 'active')
    `, [SIP_DOMAIN, TEST_PASSWORD]);
    await database.query(`
      INSERT INTO sip_accounts (tenant_id, org_id, extension_id, user_id, sip_username, sip_domain, ha1, ha1b, status)
      VALUES (12, 12, 3002, 1022, '3001', $1, 'other-ha1', 'other-ha1b', 'active')
    `, [SIP_DOMAIN]);

    await expect(moduleApi.getPhoneConfig(USER_ID, "test-auth-user-1020")).resolves.toEqual({ configured: false });
  });

  it("fails closed when the selected extension has a second active SIP account", async () => {
    await insertAuthorizedOwner();
    await database.query(`
      INSERT INTO sip_accounts (tenant_id, org_id, extension_id, user_id, sip_username, sip_domain, ha1, ha1b, status)
      VALUES ($1, $1, $2, $3, '3001', $4, 'duplicate-ha1', 'duplicate-ha1b', 'active')
    `, [TENANT_ID, EXTENSION_ID, USER_ID, SIP_DOMAIN]);

    await expect(moduleApi.getPhoneConfig(USER_ID, "test-auth-user-1020")).resolves.toEqual({ configured: false });
  });

  it("fails closed when either stored digest has drifted", async () => {
    await insertAuthorizedOwner();
    await database.query("UPDATE subscriber SET ha1 = 'drifted-digest' WHERE username = '3001'");
    await expect(moduleApi.getPhoneConfig(USER_ID, "test-auth-user-1020")).resolves.toEqual({ configured: false });
  });

  it("fails closed when the user has no tenant membership", async () => {
    await insertAuthorizedOwner();
    await database.query("DELETE FROM tenant_memberships WHERE user_id = $1 AND tenant_id = $2", [USER_ID, TENANT_ID]);
    await expect(moduleApi.getPhoneConfig(USER_ID, "test-auth-user-1020")).resolves.toEqual({ configured: false });
  });
});

const moduleApi = { getPhoneConfig };
