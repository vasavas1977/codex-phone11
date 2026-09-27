import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../server/pbx/tenant-middleware", () => ({
  resolveTenantContext: vi.fn(async (userId: number) => ({
    tenantId: userId === 10 ? 8 : 7,
    role: "admin",
    memberships: [],
  })),
  hasRole: vi.fn(() => true),
  validateTenantOwnership: vi.fn(async () => true),
}));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: vi.fn(), queryAuditLogs: vi.fn() }));
vi.mock("../server/pbx/redis", () => ({ invalidateCache: vi.fn(), cacheGetOrSet: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({ getCallStats: vi.fn(), getVoicemails: vi.fn() }));

import { pbxRouter } from "../server/pbx/pbx-router";
import { getPool } from "../server/pbx/db";
import { computeHA1, computeHA1B, decryptSecret } from "../server/pbx/sip-secrets";
import { getPhoneConfig } from "../server/phone-provisioning";

const context = (userId: number) => ({
  user: { id: userId, role: "admin" }, req: { ip: "127.0.0.1", headers: {} }, res: {},
}) as any;

describe.skipIf(process.env.PHONE11_SIP_PG_TEST !== "1")("PBX SIP consistency on isolated PostgreSQL", () => {
  let db: ReturnType<typeof getPool>;

  beforeAll(async () => {
    const database = process.env.PHONE11_SIP_PG_DISPOSABLE_DATABASE;
    if (!database || !/^phone11_sip_isolated_[a-z0-9]+$/.test(database) ||
        process.env.PG_DATABASE !== database ||
        !["127.0.0.1", "localhost", "::1"].includes(process.env.PG_HOST || "")) {
      throw new Error("SIP PostgreSQL test requires a named disposable loopback database");
    }
    db = getPool();
    const identity = await db.query(`
      SELECT current_database() AS database, host(inet_server_addr()) AS server_address,
             (SELECT COUNT(*)::integer FROM pg_tables
               WHERE schemaname = current_schema()
                 AND tablename IN ('subscriber', 'extensions', 'sip_accounts', 'user_extensions', 'tenant_memberships'))
               AS existing_fixture_tables
    `);
    const actual = identity.rows[0];
    if (actual?.database !== database ||
        !["127.0.0.1", "::1"].includes(actual?.server_address) ||
        actual?.existing_fixture_tables !== 0) {
      throw new Error("SIP PostgreSQL test refuses non-disposable or reused database");
    }
    await db.query(`
      CREATE TABLE subscriber (
        id SERIAL PRIMARY KEY, username TEXT NOT NULL, domain TEXT NOT NULL,
        password TEXT NOT NULL, ha1 TEXT NOT NULL, ha1b TEXT NOT NULL,
        UNIQUE (username, domain)
      );
      CREATE TABLE extensions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, org_id INTEGER,
        user_id INTEGER, extension_number TEXT NOT NULL, display_name TEXT,
        type TEXT, sip_username TEXT, sip_domain TEXT, sip_password TEXT,
        caller_id_name TEXT, caller_id_number TEXT, transport TEXT,
        status TEXT, deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
      );
      CREATE TABLE sip_accounts (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, org_id INTEGER,
        extension_id INTEGER NOT NULL, user_id INTEGER, sip_username TEXT,
        sip_domain TEXT, ha1 TEXT, ha1b TEXT, secret_ciphertext BYTEA,
        secret_iv BYTEA, secret_tag BYTEA, dek_id TEXT, transport_preference TEXT,
        status TEXT, deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
      );
      CREATE TABLE user_extensions (
        user_id INTEGER NOT NULL, extension_id INTEGER NOT NULL, is_primary BOOLEAN NOT NULL
      );
      CREATE TABLE tenant_memberships (
        user_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE organizations (
        id INTEGER PRIMARY KEY, name TEXT, plan TEXT
      );
      CREATE TABLE tenants (
        id INTEGER PRIMARY KEY, name TEXT, plan TEXT, status TEXT
      );
      INSERT INTO organizations VALUES (7, 'Workspace 7', 'business'), (8, 'Workspace 8', 'business');
      INSERT INTO tenants VALUES (7, 'Workspace 7', 'business', 'active'),
        (8, 'Workspace 8', 'business', 'active');
      INSERT INTO tenant_memberships VALUES (33, 7, 'active'), (55, 7, 'active'), (44, 8, 'active');
      CREATE FUNCTION reject_4102() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.sip_username = '4102' THEN RAISE EXCEPTION 'fixture account failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_account BEFORE INSERT ON sip_accounts
        FOR EACH ROW EXECUTE FUNCTION reject_4102();
    `);
  });

  afterAll(async () => { await db?.end(); });

  it("creates matching subscriber/account and rolls back a failed account insert", async () => {
    const caller = pbxRouter.createCaller(context(9));
    const created = await caller.extensions.create({ extensionNumber: "4101", userId: 33 });
    const rows = await db.query(`
      SELECT sub.password, sub.ha1 AS subscriber_ha1, sub.ha1b AS subscriber_ha1b,
             sa.ha1 AS account_ha1, sa.ha1b AS account_ha1b,
             sa.secret_ciphertext, sa.secret_iv, sa.secret_tag, e.sip_password,
             ue.user_id AS granted_user
      FROM subscriber sub JOIN extensions e ON e.sip_username = sub.username
        AND e.sip_domain = sub.domain
      JOIN sip_accounts sa ON sa.extension_id = e.id
      JOIN user_extensions ue ON ue.extension_id = e.id
      WHERE sub.username = '4101'
    `);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0];
    expect(row.password).toBe(created.sipCredentials.password);
    expect(row.subscriber_ha1).toBe(computeHA1("4101", "sip.phone11.ai", row.password));
    expect(row.subscriber_ha1b).toBe(computeHA1B("4101", "sip.phone11.ai", "sip.phone11.ai", row.password));
    expect(row.account_ha1).toBe(row.subscriber_ha1);
    expect(row.account_ha1b).toBe(row.subscriber_ha1b);
    expect(decryptSecret(row.secret_ciphertext, row.secret_iv, row.secret_tag)).toBe(row.password);
    expect(row.sip_password).toBeNull();
    expect(row.granted_user).toBe(33);

    await expect(caller.extensions.create({ extensionNumber: "4102" }))
      .rejects.toThrow("fixture account failure");
    for (const table of ["subscriber", "extensions", "sip_accounts"]) {
      const count = await db.query(`SELECT COUNT(*)::integer AS count FROM ${table} WHERE ${
        table === "extensions" ? "extension_number" : table === "subscriber" ? "username" : "sip_username"
      } = '4102'`);
      expect(count.rows[0].count).toBe(0);
    }
  });

  it("rotates the exact tenant subscriber and account together", async () => {
    const before = await db.query("SELECT password FROM subscriber WHERE username = '4101'");
    const ext = await db.query("SELECT id FROM extensions WHERE extension_number = '4101'");
    const result = await pbxRouter.createCaller(context(9)).extensions.resetPassword({ extensionId: ext.rows[0].id });
    const after = await db.query(`
      SELECT sub.password, sub.ha1 AS subscriber_ha1, sa.ha1 AS account_ha1,
             sa.secret_ciphertext, sa.secret_iv, sa.secret_tag
      FROM subscriber sub JOIN sip_accounts sa ON sa.sip_username = sub.username
      WHERE sub.username = '4101'
    `);
    expect(after.rows[0].password).not.toBe(before.rows[0].password);
    expect(after.rows[0].password).toBe(result.sipCredentials.password);
    expect(after.rows[0].subscriber_ha1).toBe(after.rows[0].account_ha1);
    expect(decryptSecret(after.rows[0].secret_ciphertext, after.rows[0].secret_iv, after.rows[0].secret_tag))
      .toBe(after.rows[0].password);
    await expect(pbxRouter.createCaller(context(10)).extensions.resetPassword({ extensionId: ext.rows[0].id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reassigns all owner records and only the new user receives phone configuration", async () => {
    const ext = await db.query("SELECT id FROM extensions WHERE extension_number = '4101'");
    await expect(pbxRouter.createCaller(context(9)).extensions.update({
      id: ext.rows[0].id, userId: 55,
    })).resolves.toEqual({ success: true });
    const owners = await db.query(`
      SELECT e.user_id AS extension_user, sa.user_id AS account_user,
             ue.user_id AS grant_user
      FROM extensions e JOIN sip_accounts sa ON sa.extension_id = e.id
      JOIN user_extensions ue ON ue.extension_id = e.id
      WHERE e.id = $1
    `, [ext.rows[0].id]);
    expect(owners.rows).toEqual([{ extension_user: 55, account_user: 55, grant_user: 55 }]);
    await expect(getPhoneConfig(33, "member-open-id")).resolves.toEqual({ configured: false });
    await expect(getPhoneConfig(55, "member-open-id")).resolves.toMatchObject({
      configured: true, sip: { username: "4101" },
    });
    await expect(pbxRouter.createCaller(context(9)).extensions.update({
      id: ext.rows[0].id, userId: 66,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const unchanged = await db.query("SELECT user_id FROM extensions WHERE id = $1", [ext.rows[0].id]);
    expect(unchanged.rows[0].user_id).toBe(55);
  });

  it("serializes a cross-tenant race for one global SIP URI", async () => {
    const outcomes = await Promise.allSettled([
      pbxRouter.createCaller(context(9)).extensions.create({ extensionNumber: "4103", userId: 33 }),
      pbxRouter.createCaller(context(10)).extensions.create({ extensionNumber: "4103", userId: 44 }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const counts = await db.query("SELECT COUNT(*)::integer AS count FROM subscriber WHERE username = '4103'");
    expect(counts.rows[0].count).toBe(1);
  });
});
