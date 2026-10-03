import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/phone11_pbx_test" || !url.port || url.search || url.hash) {
    throw new Error("Extension prerequisite tests require the dedicated loopback phone11_pbx_test database and explicit port");
  }
}

const pool = connectionString ? new Pool({ connectionString, ssl: false }) : null;
const schema = `phone11_extension_tenant_${randomBytes(8).toString("hex")}`;
let migration: string;

async function fixture(options: { tenantType?: string; extensionPk?: boolean; tenantDefault?: string } = {}) {
  await pool!.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool!.query(`CREATE SCHEMA ${schema}`);
  await pool!.query(`CREATE TABLE ${schema}.tenants(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
  await pool!.query(`CREATE TABLE ${schema}.extensions(
    id INTEGER ${options.extensionPk === false ? "" : "PRIMARY KEY"},
    tenant_id ${options.tenantType ?? "INTEGER"}${options.tenantDefault ? ` DEFAULT ${options.tenantDefault}` : ""},
    extension_number TEXT NOT NULL)`);
  await pool!.query(`INSERT INTO ${schema}.tenants VALUES (10,'A'),(20,'B')`);
  await pool!.query(`INSERT INTO ${schema}.extensions VALUES (101,10,'1001'),(201,20,'2001')`);
}

async function clientForTarget(expectedDatabase = "phone11_pbx_test", expectedSchema = schema) {
  const client = await pool!.connect();
  await client.query(`SET search_path TO ${schema}`);
  await client.query("SELECT set_config('phone11.expected_database', $1, false)", [expectedDatabase]);
  await client.query("SELECT set_config('phone11.expected_schema', $1, false)", [expectedSchema]);
  return client;
}

async function apply(client: PoolClient) {
  try { await client.query(migration); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function catalog() {
  const result = await pool!.query(`
    SELECT a.attnotnull, c.conname, c.convalidated, pg_get_constraintdef(c.oid) AS definition
      FROM pg_attribute a
      JOIN pg_class e ON e.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=e.relnamespace
      LEFT JOIN pg_constraint c ON c.conrelid=e.oid AND c.conname='phone11_extensions_tenant_fk'
     WHERE n.nspname=$1 AND e.relname='extensions' AND a.attname='tenant_id'`, [schema]);
  return result.rows[0];
}

describe.skipIf(!connectionString)("Phone11 extension tenant prerequisite on isolated PostgreSQL", () => {
  beforeAll(async () => {
    migration = await readFile(new URL("../server/pbx/extension-tenant-prerequisites.sql", import.meta.url), "utf8");
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    }
  });

  it("repairs the nullable/no-FK target while preserving rows, and replays without changes", async () => {
    await fixture();
    const before = (await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows;
    const client = await clientForTarget();
    try {
      await apply(client);
      expect(await catalog()).toMatchObject({ attnotnull: true,
        conname: "phone11_extensions_tenant_fk", convalidated: true });
      expect((await catalog()).definition).toBe("FOREIGN KEY (tenant_id) REFERENCES " + schema + ".tenants(id)");
      expect((await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows).toEqual(before);
      await apply(client);
      expect((await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows).toEqual(before);
      expect((await pool!.query(`SELECT count(*)::int AS n FROM pg_constraint c
        JOIN pg_class e ON e.oid=c.conrelid JOIN pg_namespace n ON n.oid=e.relnamespace
        WHERE n.nspname=$1 AND e.relname='extensions' AND c.conname='phone11_extensions_tenant_fk'`, [schema])).rows[0].n).toBe(1);
    } finally { client.release(); }
  });

  for (const invalid of ["NULL", "orphan"] as const) {
    it(`refuses ${invalid} tenant rows with the catalog and rows unchanged`, async () => {
      await fixture();
      await pool!.query(`INSERT INTO ${schema}.extensions VALUES (301,${invalid === "NULL" ? "NULL" : "99"},'3001')`);
      const before = (await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows;
      const client = await clientForTarget();
      try { await expect(apply(client)).rejects.toMatchObject({ code: "23514" }); }
      finally { client.release(); }
      expect(await catalog()).toMatchObject({ attnotnull: false, conname: null });
      expect((await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows).toEqual(before);
    });
  }

  it("refuses mismatched database and schema pins before DDL", async () => {
    await fixture();
    for (const [databaseName, schemaName] of [["wrong_database", schema], ["phone11_pbx_test", "wrong_schema"]]) {
      const client = await clientForTarget(databaseName, schemaName);
      try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
      finally { client.release(); }
    }
    expect(await catalog()).toMatchObject({ attnotnull: false, conname: null });
  });

  it("checks the captured target pin with catalog operators despite a hostile schema path", async () => {
    await fixture();
    await pool!.query(`CREATE FUNCTION ${schema}.phone11_false_text_comparison(text,text)
      RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'`);
    await pool!.query(`CREATE OPERATOR ${schema}.<> (
      LEFTARG = text, RIGHTARG = text, PROCEDURE = ${schema}.phone11_false_text_comparison)`);
    const client = await clientForTarget();
    try {
      await client.query(`SET search_path TO ${schema}, pg_catalog`);
      await apply(client);
    } finally { client.release(); }
    expect(await catalog()).toMatchObject({ attnotnull: true, convalidated: true });
  });

  for (const base of ["extensions", "tenants"] as const) {
    it(`refuses an inheritance child of ${base} without changing the catalog`, async () => {
      await fixture();
      await pool!.query(`CREATE TABLE ${schema}.${base}_child() INHERITS (${schema}.${base})`);
      const before = await catalog();
      const client = await clientForTarget();
      try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
      finally { client.release(); }
      expect(await catalog()).toEqual(before);
    });
  }

  it("refuses an extensions inheritance child without changing the catalog", async () => {
    await fixture();
    await pool!.query(`CREATE TABLE ${schema}.extensions_parent(
      id INTEGER, tenant_id INTEGER, extension_number TEXT NOT NULL)`);
    await pool!.query(`ALTER TABLE ${schema}.extensions INHERIT ${schema}.extensions_parent`);
    const before = await catalog();
    const client = await clientForTarget();
    try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
    finally { client.release(); }
    expect(await catalog()).toEqual(before);
  });

  it("refuses an extensions partition leaf without changing the catalog", async () => {
    await fixture();
    await pool!.query(`CREATE TABLE ${schema}.extensions_root(
      id INTEGER PRIMARY KEY, tenant_id INTEGER, extension_number TEXT NOT NULL)
      PARTITION BY RANGE(id)`);
    await pool!.query(`ALTER TABLE ${schema}.extensions_root ATTACH PARTITION ${schema}.extensions
      FOR VALUES FROM (0) TO (1000)`);
    const before = await catalog();
    const client = await clientForTarget();
    try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
    finally { client.release(); }
    expect(await catalog()).toEqual(before);
  });

  it("refuses replay with disabled internal FK triggers", async () => {
    await fixture();
    const client = await clientForTarget();
    try { await apply(client); }
    finally { client.release(); }
    await pool!.query(`ALTER TABLE ${schema}.extensions DISABLE TRIGGER ALL`);
    const before = await catalog();
    const replay = await clientForTarget();
    try { await expect(apply(replay)).rejects.toMatchObject({ code: "55000" }); }
    finally { replay.release(); }
    expect(await catalog()).toEqual(before);
  });

  it("refuses replay under replica session behavior", async () => {
    await fixture();
    const client = await clientForTarget();
    try {
      await apply(client);
      await client.query("SET session_replication_role = replica");
      await expect(apply(client)).rejects.toMatchObject({ code: "55000" });
    } finally {
      await client.query("SET session_replication_role = origin");
      client.release();
    }
  });

  it("refuses replay after a replica-mode orphan insert with catalog and rows unchanged", async () => {
    await fixture();
    const client = await clientForTarget();
    try {
      await apply(client);
      await client.query("SET session_replication_role = replica");
      await client.query(`INSERT INTO ${schema}.extensions VALUES (301,99,'3001')`);
      await client.query("SET session_replication_role = origin");
      const beforeCatalog = await catalog();
      const beforeRows = (await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows;
      await expect(apply(client)).rejects.toMatchObject({ code: "23514" });
      expect(await catalog()).toEqual(beforeCatalog);
      expect((await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows).toEqual(beforeRows);
    } finally {
      await client.query("SET session_replication_role = origin");
      client.release();
    }
  });

  for (const isolation of ["REPEATABLE READ", "SERIALIZABLE"] as const) {
    it(`refuses a stale ${isolation} transaction before catalog changes`, async () => {
      await fixture();
      const client = await clientForTarget();
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await client.query(`SELECT count(*) FROM ${schema}.extensions`);
        await expect(apply(client)).rejects.toMatchObject({ code: "55000" });
      } finally { client.release(); }
      expect(await catalog()).toMatchObject({ attnotnull: false, conname: null });
    });
  }

  it("refuses an unexpected primary key and a partially applied constraint", async () => {
    await fixture({ extensionPk: false });
    let client = await clientForTarget();
    try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
    finally { client.release(); }
    await fixture();
    await pool!.query(`ALTER TABLE ${schema}.extensions ALTER COLUMN tenant_id SET NOT NULL`);
    client = await clientForTarget();
    try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
    finally { client.release(); }
    expect(await catalog()).toMatchObject({ attnotnull: true, conname: null });
  });

  it("refuses an incompatible tenant column type before DDL", async () => {
    await fixture({ tenantType: "BIGINT" });
    const client = await clientForTarget();
    try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
    finally { client.release(); }
    expect(await catalog()).toMatchObject({ attnotnull: false, conname: null });
  });

  it("refuses an incompatible existing named FK without altering it", async () => {
    await fixture();
    await pool!.query(`ALTER TABLE ${schema}.extensions ADD CONSTRAINT phone11_extensions_tenant_fk
      FOREIGN KEY (tenant_id) REFERENCES ${schema}.tenants(id) ON DELETE CASCADE`);
    const client = await clientForTarget();
    try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
    finally { client.release(); }
    expect(await catalog()).toMatchObject({ attnotnull: false,
      conname: "phone11_extensions_tenant_fk", convalidated: true });
  });

  it("refuses the actual-target implicit tenant-1 default until predecessor compatibility is proven", async () => {
    await fixture({ tenantDefault: "1" });
    const before = (await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows;
    const client = await clientForTarget();
    try { await expect(apply(client)).rejects.toMatchObject({ code: "55000" }); }
    finally { client.release(); }
    expect(await catalog()).toMatchObject({ attnotnull: false, conname: null });
    expect((await pool!.query(`SELECT * FROM ${schema}.extensions ORDER BY id`)).rows).toEqual(before);
    expect((await pool!.query(`SELECT column_default FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='extensions' AND column_name='tenant_id'`, [schema])).rows[0].column_default).toBe("1");
  });

  it("times out behind an extension reader and rolls back without partial DDL", async () => {
    await fixture();
    const blocker = await pool!.connect();
    const client = await clientForTarget();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT id FROM ${schema}.extensions LIMIT 1`);
      await expect(apply(client)).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      client.release();
    }
    expect(await catalog()).toMatchObject({ attnotnull: false, conname: null });
  }, 15000);
});
