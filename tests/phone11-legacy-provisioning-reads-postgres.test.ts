import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const state = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), statements: [] as string[] }));
vi.mock("../server/pbx/db", () => ({ getPool: () => ({ query: state.query }), withTransaction: state.transaction }));

const databaseUrl = process.env.PHONE11_LEGACY_PROVISIONING_TEST_DATABASE_URL;
if (process.env.PHONE11_LEGACY_PROVISIONING_REQUIRE_POSTGRES === "1" && !databaseUrl) {
  throw Error("Required owned legacy provisioning PostgreSQL read fixture is missing");
}
const prepared = "p11_legacy_prov_test";
type Provisioning = typeof import("../server/phone-provisioning");

describe.skipIf(!databaseUrl)("actual legacy list exports under a DML-only PostgreSQL role", () => {
  let pool: Pool;
  let provisioning: Provisioning;
  let selectedSchema = prepared;
  const reads = [
    ["extensions", (tenant: number) => provisioning.listExtensions(tenant), 41, 42],
    ["organizations", (tenant: number) => provisioning.listOrganizations([tenant]), 7, 8],
    ["DIDs", (tenant: number) => provisioning.listDidNumbers(tenant), 71, 72],
  ] as const;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.protocol !== "postgres:" || url.hostname !== "127.0.0.1" || url.pathname !== "/phone11_legacy_prov_test" || url.username !== "p11_legacy_prov_runtime" || !url.port || !url.password || url.search || url.hash)
      throw Error("Use only the admitted loopback legacy provisioning read fixture");
    pool = new Pool({ host: "127.0.0.1", port: Number(url.port), user: "p11_legacy_prov_runtime", password: decodeURIComponent(url.password), database: "phone11_legacy_prov_test", ssl: false, max: 1, connectionTimeoutMillis: 3000, query_timeout: 5000, options: `-c search_path=${prepared},pg_catalog -c statement_timeout=5000 -c lock_timeout=4000` });
    const identity = await pool.query(`SELECT current_database() db,current_schema() schema,current_user role,
      current_setting('server_version_num') version,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,
      has_database_privilege(current_database(),'CREATE') database_create,
      has_schema_privilege('public','CREATE') public_create FROM pg_roles WHERE rolname=current_user`);
    expect(identity.rows[0]).toMatchObject({ db: "phone11_legacy_prov_test", schema: prepared, role: "p11_legacy_prov_runtime", rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, database_create: false, public_create: false });
    expect(Number(identity.rows[0].version)).toBeGreaterThanOrEqual(170000); expect(Number(identity.rows[0].version)).toBeLessThan(180000);
    for (const schema of [prepared, "p11_legacy_prov_missing", "p11_legacy_prov_partial"]) {
      expect((await pool.query("SELECT has_schema_privilege($1,'CREATE') allowed", [schema])).rows[0].allowed).toBe(false);
    }
    expect((await pool.query("SELECT pin FROM fixture_identity")).rows).toEqual([{ pin: "c9f3c2-legacy-provisioning-disposable-v1" }]);
  });
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); state.statements = []; selectedSchema = prepared;
    await pool.query(`SET search_path=${prepared},pg_catalog;
      DELETE FROM user_extensions; DELETE FROM sip_accounts; DELETE FROM extensions; DELETE FROM subscriber; DELETE FROM did_numbers;
      INSERT INTO extensions(id,tenant_id,user_id,extension_number,display_name,sip_password,status,deleted_at)
        VALUES(41,7,33,'5101','Fixture7','private-fixture-sip','active',NULL),
              (42,8,44,'5108','Fixture8','other-private-fixture-sip','active',NULL),
              (43,7,33,'5103','Deleted fixture','deleted-private-fixture-sip','deleted',now());
      INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES(33,41,true),(44,42,true),(33,43,false);
      INSERT INTO did_numbers(id,org_id,tenant_id,number,description,destination_type,destination_value,status)
        VALUES(71,7,7,'+6620000071','Fixture7','extension','5101','active'),
              (72,8,8,'+6620000072','Fixture8','extension','5108','active');
      DELETE FROM p11_legacy_prov_partial.did_numbers;
      INSERT INTO p11_legacy_prov_partial.did_numbers(id,org_id,tenant_id,number,description,destination_type,status)
        VALUES(81,7,7,'+6620000081','Reduced fixture','extension','active');`);
    state.query.mockImplementation(async (sql: string, parameters?: unknown[]) => {
      state.statements.push(sql);
      const client = await pool.connect();
      try { await client.query(`SET search_path=${selectedSchema},pg_catalog`); return await client.query(sql, parameters); }
      finally { client.release(); }
    });
    provisioning = await import("../server/phone-provisioning");
  });
  afterAll(async () => { await pool?.end(); });
  const noEffects = async () => {
    expect(state.statements.some(sql => /\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|GRANT)\b/i.test(sql))).toBe(false);
    expect(state.transaction).not.toHaveBeenCalled();
    expect((await pool.query(`SELECT id FROM ${prepared}.tenants WHERE id=1`)).rows).toEqual([]);
    expect((await pool.query(`SELECT id FROM ${prepared}.organizations WHERE id=1`)).rows).toEqual([]);
  };
  it.each(reads)("cold prepared %s export succeeds without initializer authority", async (name, invoke, expectedId) => {
    const rows = await invoke(7);
    expect(rows.map((row: { id: number }) => row.id)).toEqual([expectedId]);
    if (name === "extensions") {
      expect(rows[0]).toMatchObject({ tenant_id: 7, assigned_user_id: 33 });
      expect(rows[0]).not.toHaveProperty("sip_password"); expect(rows[0]).not.toHaveProperty("password");
      expect(JSON.stringify(rows)).not.toContain("private-fixture-sip");
    }
    expect(state.statements).toHaveLength(1); await noEffects();
  });
  it.each(reads)("%s export preserves the selected second-tenant result", async (_name, invoke, _firstId, expectedId) => {
    expect((await invoke(8)).map((row: { id: number }) => row.id)).toEqual([expectedId]);
    expect(state.statements).toHaveLength(1); await noEffects();
  });
  it.each(reads)("missing %s table fails with original SQL error and no repair", async (_name, invoke) => {
    selectedSchema = "p11_legacy_prov_missing";
    const before = (await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,column_name", [selectedSchema])).rows;
    await expect(invoke(7)).rejects.toMatchObject({ code: "42P01" });
    expect(state.statements).toHaveLength(1); await noEffects();
    expect((await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,column_name", [selectedSchema])).rows).toEqual(before);
  });
  it.each(reads.slice(0, 2))("partial schema without required %s table remains unchanged", async (_name, invoke) => {
    selectedSchema = "p11_legacy_prov_partial";
    await expect(invoke(7)).rejects.toMatchObject({ code: "42P01" });
    expect(state.statements).toHaveLength(1); await noEffects();
  });
  it("reads a harmless missing unused DID column without repairing it", async () => {
    selectedSchema = "p11_legacy_prov_partial";
    const before = (await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,column_name", [selectedSchema])).rows;
    const rows = await provisioning.listDidNumbers(7);
    expect(rows).toMatchObject([{ id: 81, tenant_id: 7, number: "+6620000081" }]);
    expect(rows[0]).not.toHaveProperty("destination_value");
    expect(state.statements).toHaveLength(1); await noEffects();
    expect((await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,column_name", [selectedSchema])).rows).toEqual(before);
  });
});
