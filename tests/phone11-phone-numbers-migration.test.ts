import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const migrationUrl = new URL("../server/pbx/phone-numbers-migration.sql", import.meta.url);
const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;

if (connectionString) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/phone11_pbx_test" || !url.port || url.search || url.hash
  ) {
    throw new Error(
      "Number migration tests require a dedicated loopback phone11_pbx_test database with explicit port",
    );
  }
}

describe("phone number inventory migration contract", () => {
  it("is additive, idempotent, and contains the columns consumed by the PBX", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/^-- Explicit reviewed migration/);
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("COMMIT;");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS phone_numbers");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS emergency_addresses");
    for (const column of [
      "number_e164", "number_display", "country", "number_type", "provider",
      "status", "assigned_route_type", "assigned_route_id", "e911_address_id",
      "deleted_at", "updated_at",
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const column of ["site_id", "street", "city", "state_province", "postal_code", "caller_name"]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(sql).toContain("RAISE EXCEPTION 'phone_numbers.% is missing; stop for review'");
    expect(sql).toContain("incompatible column types or nullability");
    expect(sql).toContain("status TEXT NOT NULL DEFAULT 'pending'");
  });

  it("reserves active and suspended numbers globally and guards cross-tenant references", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS phone11_number_owned_e164_unique\s+ON phone_numbers\(number_e164\)\s+WHERE status IN \('active', 'suspended'\) AND deleted_at IS NULL/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS phone11_number_tenant_live_e164_unique\s+ON phone_numbers\(tenant_id, number_e164\) WHERE deleted_at IS NULL/);
    expect(sql).toContain("FOREIGN KEY (e911_address_id, tenant_id)");
    expect(sql).toContain("REFERENCES emergency_addresses(id, tenant_id)");
    expect(sql).toContain("phone11_number_inventory_guard");
    expect(sql).toContain("tenant_id = $2%s FOR SHARE");
    expect(sql).toContain("site_id IS NULL");
  });

  it("does not grant broad access, seed numbers, or activate routes", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+phone_numbers\s+SET\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i);
  });
});

describe.skipIf(!connectionString)("phone number inventory on isolated PostgreSQL", () => {
  const schema = `pbx_numbers_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString, ssl: false });
  const database = new Pool({ connectionString, ssl: false, options: `-c search_path=${schema}` });

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await database.query(`
      CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE extensions (
        id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        status TEXT NOT NULL DEFAULT 'active', deleted_at TIMESTAMPTZ
      );
      INSERT INTO tenants VALUES (10, 'Tenant A'), (20, 'Tenant B');
      INSERT INTO extensions VALUES (101, 10, 'active', NULL), (201, 20, 'active', NULL);
    `);
    const migration = await readFile(migrationUrl, "utf8");
    await database.query(migration);
    await database.query(migration);
  });

  afterAll(async () => {
    await database.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("does not create numbers or emergency addresses during either migration run", async () => {
    expect((await database.query(`SELECT count(*)::int AS count FROM phone_numbers`)).rows[0].count).toBe(0);
    expect((await database.query(`SELECT count(*)::int AS count FROM emergency_addresses`)).rows[0].count).toBe(0);
  });

  it("allows competing drafts but one owned E.164 through suspension until soft deletion", async () => {
    const first = await database.query<{ id: number; status: string }>(`
      INSERT INTO phone_numbers(tenant_id,number_e164,number_display,provider)
      VALUES(10,'+66810001001','0810001001','1toall') RETURNING id,status
    `);
    expect(first.rows[0].status).toBe("pending");
    const second = await database.query<{ id: number; status: string }>(`
      INSERT INTO phone_numbers(tenant_id,number_e164,number_display,provider)
      VALUES(20,'+66810001001','0810001001','1toall') RETURNING id,status
    `);
    expect(second.rows[0].status).toBe("pending");
    await expect(database.query(`
      INSERT INTO phone_numbers(tenant_id,number_e164,number_display,provider)
      VALUES(10,'+66810001001','0810001001','1toall')
    `)).rejects.toMatchObject({ code: "23505" });
    await database.query(`UPDATE phone_numbers SET status='active' WHERE id=$1`, [first.rows[0].id]);
    await expect(database.query(`UPDATE phone_numbers SET status='active' WHERE id=$1`, [second.rows[0].id]))
      .rejects.toMatchObject({ code: "23505" });
    await database.query(`UPDATE phone_numbers SET status='suspended' WHERE id=$1`, [first.rows[0].id]);
    await expect(database.query(`UPDATE phone_numbers SET status='active' WHERE id=$1`, [second.rows[0].id]))
      .rejects.toMatchObject({ code: "23505" });
    await database.query(`UPDATE phone_numbers SET deleted_at=NOW() WHERE id=$1`, [first.rows[0].id]);
    await database.query(`UPDATE phone_numbers SET status='active' WHERE id=$1`, [second.rows[0].id]);
    expect((await database.query(`SELECT count(*)::int AS count FROM phone_numbers`)).rows[0].count).toBe(2);
  });

  it("rejects cross-tenant addresses and routes, unsupported sites, and tenant moves", async () => {
    const address = await database.query<{ id: number }>(`
      INSERT INTO emergency_addresses(tenant_id,street,city)
      VALUES(20,'One Road','Bangkok') RETURNING id
    `);
    await expect(database.query(`
      INSERT INTO emergency_addresses(tenant_id,site_id,street,city)
      VALUES(10,123,'Two Road','Bangkok')
    `)).rejects.toMatchObject({ code: "23514" });
    await expect(database.query(`
      INSERT INTO phone_numbers(tenant_id,number_e164,number_display,provider,e911_address_id)
      VALUES(10,'+66810001002','0810001002','1toall',$1)
    `, [address.rows[0].id])).rejects.toMatchObject({ code: "23503" });
    await expect(database.query(`
      INSERT INTO phone_numbers(tenant_id,number_e164,number_display,provider,
        assigned_route_type,assigned_route_id)
      VALUES(10,'+66810001003','0810001003','1toall','extension',201)
    `)).rejects.toMatchObject({ code: "23514" });
    const own = await database.query<{ id: number }>(`
      INSERT INTO phone_numbers(tenant_id,number_e164,number_display,provider,
        assigned_route_type,assigned_route_id)
      VALUES(10,'+66810001004','0810001004','1toall','extension',101) RETURNING id
    `);
    await expect(database.query(`UPDATE phone_numbers SET tenant_id=20 WHERE id=$1`, [own.rows[0].id]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(database.query(`UPDATE emergency_addresses SET tenant_id=10 WHERE id=$1`, [address.rows[0].id]))
      .rejects.toMatchObject({ code: "23514" });
  });
});
