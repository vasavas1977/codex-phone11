import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../server/pbx/tenant-middleware", () => ({
  resolveTenantContext: vi.fn(), hasRole: vi.fn(), validateTenantOwnership: vi.fn(),
}));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: vi.fn(), queryAuditLogs: vi.fn() }));
vi.mock("../server/pbx/redis", () => ({ invalidateCache: vi.fn(), cacheGetOrSet: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({ getCallStats: vi.fn(), getVoicemails: vi.fn() }));

import { pbxRouter } from "../server/pbx/pbx-router";
import { getPool } from "../server/pbx/db";

const caller = (userId: number) => pbxRouter.createCaller({
  user: { id: userId, role: "user" }, req: { headers: {} }, res: {},
} as any);

describe.skipIf(process.env.PHONE11_DIRECTORY_PG_TEST !== "1")("selected directory on disposable PostgreSQL", () => {
  let db: ReturnType<typeof getPool>;

  beforeAll(async () => {
    const database = process.env.PHONE11_DIRECTORY_PG_DISPOSABLE_DATABASE;
    if (!database || !/^phone11_directory_isolated_[a-z0-9]+$/.test(database) ||
        process.env.PG_DATABASE !== database || process.env.PG_CONNECTION_STRING ||
        !["127.0.0.1", "localhost", "::1"].includes(process.env.PG_HOST || "")) {
      throw new Error("Directory PostgreSQL test requires a named disposable loopback database");
    }
    db = getPool();
    const identity = await db.query(`SELECT current_database() AS database,
      (SELECT COUNT(*)::integer FROM pg_tables WHERE schemaname = current_schema()
       AND tablename IN ('users', 'tenants', 'tenant_memberships', 'extensions', 'user_extensions')) AS fixture_tables`);
    if (identity.rows[0]?.database !== database ||
        identity.rows[0]?.fixture_tables !== 0) {
      throw new Error("Directory PostgreSQL test refuses non-disposable or reused database");
    }
    await db.query(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE tenants (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE tenant_memberships (user_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE extensions (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER,
        extension_number TEXT NOT NULL, display_name TEXT, type TEXT NOT NULL, status TEXT NOT NULL,
        deleted_at TIMESTAMPTZ);
      CREATE TABLE user_extensions (user_id INTEGER NOT NULL, extension_id INTEGER NOT NULL);
      INSERT INTO users VALUES (9, 'Caller'), (10, 'Jane'), (11, 'Hidden'), (12, 'Other'), (13, 'Bob');
      INSERT INTO tenants VALUES (7, 'active'), (8, 'active'), (99, 'suspended');
      INSERT INTO tenant_memberships VALUES (9, 7, 'active'), (10, 7, 'active'),
        (11, 7, 'active'), (12, 8, 'active'), (13, 7, 'active');
      INSERT INTO extensions VALUES
        (1, 7, 9, '3001', 'Caller', 'user', 'active', NULL),
        (2, 7, 10, '3002', 'Jane', 'user', 'active', NULL),
        (3, 7, 11, '3003', 'Hidden', 'user', 'suspended', NULL),
        (4, 8, 12, '4001', 'Other Tenant', 'user', 'active', NULL),
        (5, 7, 13, '3004', 'Bob', 'user', 'active', NULL);
      INSERT INTO user_extensions VALUES (9, 1), (10, 2), (11, 3), (12, 4), (13, 5);
    `);
  });

  afterAll(async () => { await db?.end(); });

  it("returns only active selected-tenant extensions with stable pagination and literal search", async () => {
    const first = await caller(9).directory.list({ tenantId: 7, limit: 2 });
    expect(first).toEqual({ tenantId: 7, items: [
      { id: 1, name: "Caller", number: "3001" }, { id: 2, name: "Jane", number: "3002" },
    ], nextOffset: 2 });
    expect(await caller(9).directory.list({ tenantId: 7, limit: 2, offset: 2 })).toEqual({
      tenantId: 7, items: [{ id: 5, name: "Bob", number: "3004" }], nextOffset: null,
    });
    expect((await caller(9).directory.list({ tenantId: 7, search: "%" })).items).toEqual([]);
  });

  it("denies another, missing or inactive tenant and revoked caller", async () => {
    for (const tenantId of [8, 99, 100]) {
      await expect(caller(9).directory.list({ tenantId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await db.query("UPDATE tenant_memberships SET status = 'revoked' WHERE user_id = 9 AND tenant_id = 7");
    await expect(caller(9).directory.list({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.query("UPDATE tenant_memberships SET status = 'active' WHERE user_id = 9 AND tenant_id = 7");
  });

  it("denies a suspended or unassigned caller and hides revoked recipients", async () => {
    await db.query("UPDATE extensions SET status = 'suspended' WHERE id = 1");
    await expect(caller(9).directory.list({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.query("UPDATE extensions SET status = 'active' WHERE id = 1");
    await db.query("DELETE FROM user_extensions WHERE user_id = 9 AND extension_id = 1");
    await expect(caller(9).directory.list({ tenantId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.query("INSERT INTO user_extensions VALUES (9, 1)");
    await db.query("UPDATE tenant_memberships SET status = 'revoked' WHERE user_id = 10 AND tenant_id = 7");
    expect((await caller(9).directory.list({ tenantId: 7 })).items.map(item => item.number))
      .toEqual(["3001", "3004"]);
  });
});
