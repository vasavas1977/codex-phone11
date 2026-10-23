import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readManagementCapabilities } from "../server/pbx/schema-capabilities";

const sqlFile = new URL("../server/pbx/sites-migration.sql", import.meta.url);
const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const u = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(u.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
      u.pathname !== "/phone11_pbx_test" || !u.port || u.search || u.hash)
    throw new Error("Sites tests require dedicated loopback phone11_pbx_test with explicit port");
}

describe("sites migration source contract", () => {
  it("requires explicit target pins and contains no data seeding or privileges", async () => {
    const sql = await readFile(sqlFile, "utf8");
    expect(sql).toContain("phone11.expected_database");
    expect(sql).toContain("phone11.expected_schema");
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE|INSERT\s+INTO|DELETE\s+FROM)\b/i);
  });
});

describe.skipIf(!connectionString)("sites migration isolated PostgreSQL qualification", () => {
  const schema = `pbx_sites_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString, ssl: false });
  const db = new Pool({ connectionString, ssl: false,
    options: `-c search_path=${schema} -c phone11.expected_database=phone11_pbx_test -c phone11.expected_schema=${schema}` });
  let migration: string;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE tenants(id INTEGER PRIMARY KEY); INSERT INTO tenants VALUES(10),(20);
      CREATE TABLE extensions(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        extension_number TEXT NOT NULL,display_name TEXT,type TEXT,user_id TEXT,status TEXT,deleted_at TIMESTAMPTZ);
      CREATE TABLE sip_accounts(extension_id INTEGER,tenant_id INTEGER,user_id TEXT,status TEXT,deleted_at TIMESTAMPTZ);`);
    const advanced = await readFile(new URL("../server/pbx/advanced-routing-migration.sql", import.meta.url), "utf8");
    await db.query(advanced);
    await db.query(advanced);
    await db.query(await readFile(new URL("../server/pbx/phone-numbers-migration.sql", import.meta.url), "utf8"));
    migration = await readFile(sqlFile, "utf8");
    await db.query(migration);
    await db.query(migration);
  });
  afterAll(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });
  it("is idempotent and creates no configuration", async () => {
    expect((await db.query("SELECT count(*)::int AS count FROM sites")).rows[0].count).toBe(0);
    expect((await db.query("SELECT count(*)::int AS count FROM emergency_addresses")).rows[0].count).toBe(0);
  });
  it("covers every management capability after advanced, numbers and sites in order", async () => {
    // The runtime probe uses public. Redirect that literal to this dedicated
    // synthetic schema; the catalog query and capability requirements are real.
    const capabilities = await readManagementCapabilities((sql, params) =>
      db.query(sql.replace("table_schema = 'public'", "table_schema = current_schema()"), params));
    expect(capabilities).toEqual({ phoneNumbers: true, sites: true, ringGroups: true,
      queues: true, ivr: true, businessHours: true });
  });
  it("matches existing site create/list SQL and isolates address references", async () => {
    const result = await db.query(`INSERT INTO sites(tenant_id,name,address_line1,city,state_province,postal_code,country,timezone,is_main)
      VALUES(10,'Office','Street','Bangkok','Bangkok','10110','TH','Asia/Bangkok',true) RETURNING *`);
    const site = result.rows[0];
    expect(site.status).toBe("active");
    expect((await db.query("SELECT * FROM sites WHERE tenant_id=$1 AND status='active' ORDER BY is_main DESC,name", [10])).rows).toHaveLength(1);
    expect((await db.query("SELECT * FROM sites WHERE tenant_id=$1", [20])).rows).toHaveLength(0);
    await db.query("INSERT INTO emergency_addresses(tenant_id,site_id,street,city) VALUES(10,$1,'Street','Bangkok')", [site.id]);
    await expect(db.query("INSERT INTO emergency_addresses(tenant_id,site_id,street,city) VALUES(20,$1,'Street','Bangkok')", [site.id]))
      .rejects.toMatchObject({ code: "23503" });
    await expect(db.query("DELETE FROM sites WHERE id=$1", [site.id])).rejects.toMatchObject({ code: "23503" });
    await expect(db.query("UPDATE sites SET tenant_id=20 WHERE id=$1", [site.id])).rejects.toMatchObject({ code: "23514" });
    await db.query("INSERT INTO emergency_addresses(tenant_id,street,city) VALUES(20,'Street','Bangkok')");
    await db.query(migration);
    expect((await db.query("SELECT count(*)::int AS count FROM emergency_addresses")).rows[0].count).toBe(2);
  });
  it("allows phone-numbers replay after linking without reinstating null-only guard", async () => {
    await db.query(await readFile(new URL("../server/pbx/phone-numbers-migration.sql", import.meta.url), "utf8"));
    await db.query(migration);
    expect((await db.query("SELECT count(*)::int AS count FROM emergency_addresses WHERE site_id IS NOT NULL")).rows[0].count).toBe(1);
  });
  it.each([
    ["reordered wrong tenant FK", `DROP TABLE sites CASCADE; CREATE TABLE sites (
      tenant_id INTEGER NOT NULL,id SERIAL PRIMARY KEY,name TEXT NOT NULL,address_line1 TEXT,city TEXT,state_province TEXT,postal_code TEXT,
      country TEXT NOT NULL DEFAULT 'TH',timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',is_main BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'active',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT phone11_site_tenant_key UNIQUE(id,tenant_id),
      CONSTRAINT phone11_site_fields CHECK(btrim(name)<>'' AND country~'^[A-Z]{2}$' AND btrim(timezone)<>'' AND status IN ('active','inactive')),
      CONSTRAINT phone11_site_tenant_fk FOREIGN KEY(id) REFERENCES tenants(id) ON DELETE CASCADE)`],
    ["inherited relation", "CREATE TABLE sites_child() INHERITS(sites)"],
    ["wrong type", "ALTER TABLE sites ALTER COLUMN city TYPE VARCHAR(20)"],
    ["wrong id default", "ALTER TABLE sites ALTER COLUMN id SET DEFAULT 999"],
    ["wrong default", "ALTER TABLE sites ALTER COLUMN status SET DEFAULT 'inactive'"],
    ["weakened fields", "ALTER TABLE sites DROP CONSTRAINT phone11_site_fields; ALTER TABLE sites ADD CONSTRAINT phone11_site_fields CHECK(true)"],
    ["disabled site FK", `DO $$ DECLARE t record; BEGIN FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid='sites'::regclass AND tgisinternal LOOP EXECUTE format('ALTER TABLE sites DISABLE TRIGGER %I',t.tgname); END LOOP; END $$`],
    ["disabled address FK", `DO $$ DECLARE t record; BEGIN FOR t IN SELECT tgname FROM pg_trigger WHERE tgconstraint=(SELECT oid FROM pg_constraint WHERE conrelid='emergency_addresses'::regclass AND conname='phone11_emergency_site_tenant_fk') AND tgrelid='emergency_addresses'::regclass LOOP EXECUTE format('ALTER TABLE emergency_addresses DISABLE TRIGGER %I',t.tgname); END LOOP; END $$`],
    ["wrong site FK", "ALTER TABLE emergency_addresses DROP CONSTRAINT phone11_emergency_site_tenant_fk; ALTER TABLE emergency_addresses ADD CONSTRAINT phone11_emergency_site_tenant_fk FOREIGN KEY(site_id) REFERENCES sites(id)"],
    ["weakened address fields", "ALTER TABLE emergency_addresses DROP CONSTRAINT phone11_emergency_address_fields; ALTER TABLE emergency_addresses ADD CONSTRAINT phone11_emergency_address_fields CHECK(true)"],
  ])("refuses %s and rolls back its own DDL", async (_label, damage) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(damage);
      // The migration owns COMMIT. Remove only its transaction envelope for
      // this savepoint test; normal execution above uses its exact source.
      await client.query("SAVEPOINT damaged");
      await expect(client.query(migration.replace("BEGIN ISOLATION LEVEL READ COMMITTED;", "").replace(/COMMIT;\s*$/, "")))
        .rejects.toMatchObject({ code: "55000" });
      await client.query("ROLLBACK TO damaged");
    } finally { await client.query("ROLLBACK"); client.release(); }
    await db.query(migration);
  });
  it("refuses wrong target pins before creating relations", async () => {
    const client = await db.connect();
    try {
      await client.query("SET phone11.expected_database='wrong_target'");
      await expect(client.query(migration)).rejects.toMatchObject({ code: "55000" });
    } finally { await client.query("ROLLBACK"); await client.query("SET phone11.expected_database='phone11_pbx_test'"); client.release(); }
  });
});
