import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock("../server/pbx/db", () => ({
  getPool: () => ({ query: state.query }),
  withTransaction: state.transaction,
}));
vi.mock("../server/pbx/sip-secrets", () => ({
  computeHA1: vi.fn(), computeHA1B: vi.fn(), createSipCredentials: vi.fn(),
  decryptSecret: vi.fn(), regenerateSipCredentials: vi.fn(),
}));
type Provisioning = typeof import("../server/phone-provisioning");
const guardSql = (sql: string) => sql.includes("DO $phone11_extension_tenant$");
// Exercise the real actorless initializer callsite, stopping at the existing
// transaction seam: these tests do not claim handler/SIP write acceptance.
const initialize = (provisioning: Provisioning) =>
  provisioning.createExtension({ orgId: 7, extensionNumber: "owned-synthetic-initializer" });

// Never supply or discover a local DB connection for these offline lifecycle checks.
describe("extension tenancy initializer lifecycle", () => {
  let provisioning: Provisioning;
  beforeEach(async () => {
    vi.resetModules(); state.query.mockReset(); state.transaction.mockReset();
    state.query.mockResolvedValue({ rows: [] });
    provisioning = await import("../server/phone-provisioning");
  });

  it("creates mandatory explicit tenancy and a same-schema tenant FK without a default", async () => {
    await initialize(provisioning);
    const statements = state.query.mock.calls.map(([sql]) => String(sql));
    const create = statements.find(sql => /CREATE TABLE IF NOT EXISTS extensions/.test(sql))!;
    expect(create).toContain("tenant_id INTEGER NOT NULL REFERENCES tenants(id)");
    expect(create).not.toMatch(/tenant_id INTEGER DEFAULT/);
    const guard = statements.find(guardSql)!;
    expect(guard).toContain("LOCK TABLE extensions IN ACCESS EXCLUSIVE MODE NOWAIT");
    expect(guard.indexOf("LOCK TABLE")).toBeLessThan(guard.indexOf("IF EXISTS (SELECT 1 FROM extensions)"));
    expect(guard.indexOf("IF EXISTS (SELECT 1 FROM extensions)")).toBeLessThan(guard.indexOf("ALTER TABLE extensions ADD COLUMN tenant_id"));
    expect(guard.match(/attname = 'tenant_id'/g)).toHaveLength(2);
    expect(guard).toContain("ERRCODE = '55000'");
    expect(statements.some(sql => /ALTER TABLE extensions ADD COLUMN IF NOT EXISTS tenant_id/.test(sql))).toBe(false);
    // Other tenant-table definitions remain outside this repair's scope.
    expect(statements.find(sql => /CREATE TABLE IF NOT EXISTS sip_accounts/.test(sql))).toContain("tenant_id INTEGER DEFAULT 1");
  });

  it("does not issue an implicit tenant assignment, drop default, or alter existing nullability", async () => {
    await initialize(provisioning);
    const sql = state.query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).not.toMatch(/UPDATE\s+extensions\s+SET\s+tenant_id/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN\s+tenant_id|DROP\s+DEFAULT/i);
    expect(sql).not.toMatch(/ALTER TABLE extensions ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1/);
  });

  it("caches completed initialization rather than replaying DDL for every actorless write", async () => {
    await initialize(provisioning); await initialize(provisioning);
    expect(state.query.mock.calls.filter(([sql]) => guardSql(String(sql)))).toHaveLength(1);
    expect(state.transaction).toHaveBeenCalledTimes(2);
  });

  it("propagates populated-partial refusal, stops dependent initialization, and clears the failed cache", async () => {
    let refuse = true;
    state.query.mockImplementation(async (sql: string) => {
      if (guardSql(sql) && refuse) throw Object.assign(new Error("Reviewed tenant migration required"), { code: "55000" });
      return { rows: [] };
    });
    await expect(initialize(provisioning)).rejects.toMatchObject({ code: "55000" });
    expect(state.query.mock.calls.some(([sql]) => String(sql).includes("CREATE TABLE IF NOT EXISTS user_extensions"))).toBe(false);
    refuse = false; await expect(initialize(provisioning)).resolves.toBeUndefined();
    expect(state.query.mock.calls.filter(([sql]) => guardSql(String(sql)))).toHaveLength(2);
  });

  it("does not retry or bypass a contended missing-column table lock", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (guardSql(sql)) throw Object.assign(new Error("Owned synthetic lock refused"), { code: "55P03" });
      return { rows: [] };
    });
    await expect(initialize(provisioning)).rejects.toMatchObject({ code: "55P03" });
    expect(state.query.mock.calls.filter(([sql]) => guardSql(String(sql)))).toHaveLength(1);
    expect(state.transaction).not.toHaveBeenCalled();
  });
});

// Same established fixture contract as the prerequisite PostgreSQL suite. The
// worker runs with this variable absent; the required CI job supplies it.
const databaseUrl = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
      target.pathname !== "/phone11_pbx_test" || !target.port || target.search || target.hash) {
    throw new Error("Extension initializer tests require the dedicated loopback phone11_pbx_test database and explicit port");
  }
}

describe.skipIf(!databaseUrl)("extension initializer on the owned PostgreSQL fixture", () => {
  let pool: Pool;
  let client: PoolClient;
  let schema: string;
  let provisioning: Provisioning;
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 2,
      connectionTimeoutMillis: 5000, query_timeout: 10000 });
    expect((await pool.query("SELECT current_database() AS database")).rows[0].database).toBe("phone11_pbx_test");
  });
  beforeEach(async () => {
    vi.resetModules(); state.query.mockReset(); state.transaction.mockReset();
    schema = `p11_ext_init_${randomBytes(8).toString("hex")}`;
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    state.query.mockImplementation((sql: string, values?: unknown[]) => client.query(sql, values));
    provisioning = await import("../server/phone-provisioning");
  });
  afterEach(async () => {
    if (client) {
      try { await client.query(`RESET search_path; DROP SCHEMA ${schema} CASCADE`); }
      finally { client.release(); }
    }
  });
  afterAll(async () => { await pool?.end(); });

  async function tenantShape() {
    return (await client.query(`SELECT a.attnotnull AS mandatory,
      pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_sql,
      (SELECT count(*)::integer FROM pg_catalog.pg_constraint c
        WHERE c.conrelid=a.attrelid AND c.contype='f' AND c.conkey=ARRAY[a.attnum]::smallint[]
          AND c.confrelid=pg_catalog.to_regclass('tenants') AND c.convalidated AND NOT c.condeferrable) AS foreign_keys
      FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d
        ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='extensions'::regclass AND a.attname='tenant_id' AND NOT a.attisdropped`)).rows[0];
  }
  async function hardenedWrites() {
    expect(await tenantShape()).toEqual({ mandatory: true, default_sql: null, foreign_keys: 1 });
    await client.query("INSERT INTO tenants(id,name,plan,status) VALUES(2,'Owned synthetic B','business','active')");
    for (const [sql, code] of [
      ["INSERT INTO extensions(extension_number) VALUES('omitted')", "23502"],
      ["INSERT INTO extensions(tenant_id,extension_number) VALUES(NULL,'null')", "23502"],
      ["INSERT INTO extensions(tenant_id,extension_number) VALUES(999999,'orphan')", "23503"],
    ]) await expect(client.query(sql)).rejects.toMatchObject({ code });
    await client.query("INSERT INTO extensions(tenant_id,extension_number) VALUES(1,'valid-a'),(2,'valid-b')");
    expect((await client.query("SELECT tenant_id FROM extensions ORDER BY tenant_id")).rows).toEqual([{ tenant_id: 1 }, { tenant_id: 2 }]);
  }

  it("hardens new empty bootstrap and refuses omitted, NULL and orphan tenants", async () => {
    await initialize(provisioning); await hardenedWrites();
  });
  it("adds a hardened tenant column to an empty partial extension table", async () => {
    await client.query("CREATE TABLE extensions(id SERIAL PRIMARY KEY, extension_number VARCHAR(32) NOT NULL)");
    await initialize(provisioning); await hardenedWrites();
  });
  it("preserves an existing hardened column and tenant FK", async () => {
    await client.query(`CREATE TABLE tenants(id INTEGER PRIMARY KEY, name VARCHAR(128) NOT NULL,
      plan VARCHAR(64) DEFAULT 'business', status VARCHAR(32) DEFAULT 'active');
      INSERT INTO tenants(id,name) VALUES(1,'Owned synthetic A');
      CREATE TABLE extensions(id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        extension_number VARCHAR(32) NOT NULL); INSERT INTO extensions(tenant_id,extension_number) VALUES(1,'retained')`);
    const before = await tenantShape();
    await initialize(provisioning);
    expect(await tenantShape()).toEqual(before);
    expect((await client.query("SELECT tenant_id FROM extensions WHERE extension_number='retained'")).rows).toEqual([{ tenant_id: 1 }]);
    await client.query("DELETE FROM extensions"); await hardenedWrites();
  });
  it("leaves existing legacy default, nullable tenancy and rows for reviewed migration", async () => {
    await client.query(`CREATE TABLE extensions(id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT 1,
      extension_number VARCHAR(32) NOT NULL); INSERT INTO extensions(tenant_id,extension_number) VALUES(NULL,'legacy-null'),(777,'legacy-orphan')`);
    const before = await tenantShape();
    const rows = (await client.query("SELECT id,tenant_id,extension_number FROM extensions ORDER BY id")).rows;
    await initialize(provisioning);
    expect(await tenantShape()).toEqual(before);
    expect(before).toEqual({ mandatory: false, default_sql: "1", foreign_keys: 0 });
    expect((await client.query("SELECT id,tenant_id,extension_number FROM extensions ORDER BY id")).rows).toEqual(rows);
  });
  it("refuses populated missing-column state without adding or assigning tenancy", async () => {
    await client.query(`CREATE TABLE extensions(id SERIAL PRIMARY KEY, extension_number VARCHAR(32) NOT NULL);
      INSERT INTO extensions(extension_number) VALUES('unassigned')`);
    await expect(initialize(provisioning)).rejects.toMatchObject({ code: "55000" });
    expect((await client.query("SELECT count(*)::integer AS count FROM pg_attribute WHERE attrelid='extensions'::regclass AND attname='tenant_id' AND NOT attisdropped")).rows[0].count).toBe(0);
    expect((await client.query("SELECT id,extension_number FROM extensions")).rows).toEqual([{ id: 1, extension_number: "unassigned" }]);
    expect((await client.query("SELECT to_regclass('user_extensions') AS relation")).rows[0].relation).toBeNull();
  });
  it("refuses a concurrent missing-column writer lock without partial DDL", async () => {
    await client.query("CREATE TABLE extensions(id SERIAL PRIMARY KEY, extension_number VARCHAR(32) NOT NULL)");
    const other = await pool.connect();
    try {
      await other.query(`BEGIN; LOCK TABLE ${schema}.extensions IN ROW EXCLUSIVE MODE`);
      await expect(initialize(provisioning)).rejects.toMatchObject({ code: "55P03" });
      expect((await client.query("SELECT count(*)::integer AS count FROM pg_attribute WHERE attrelid='extensions'::regclass AND attname='tenant_id' AND NOT attisdropped")).rows[0].count).toBe(0);
    } finally { await other.query("ROLLBACK"); other.release(); }
  });
});
