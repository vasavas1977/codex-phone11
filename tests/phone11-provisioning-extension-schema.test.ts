import { randomBytes } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { URL } from "node:url";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertPhoneProvisioningSchema, phoneProvisioningColumns } from "../server/pbx/phone-provisioning-schema";

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
const catalogQuery = (sql: string) => sql.includes("pg_catalog.jsonb_to_recordset");
// Stop at the existing transaction seam: no handler/SIP mutation is claimed.
const initialize = (provisioning: Provisioning) =>
  provisioning.createExtension({ orgId: 7, extensionNumber: "owned-synthetic-readiness" });
const expectOnlyCatalogReads = () => {
  for (const [statement] of state.query.mock.calls) {
    expect(String(statement).trim()).toMatch(/^WITH expected AS/);
    expect(String(statement)).not.toMatch(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT)\b/i);
  }
};

describe("commissioned provisioning schema lifecycle", () => {
  let provisioning: Provisioning;
  beforeEach(async () => {
    vi.resetModules(); state.query.mockReset(); state.transaction.mockReset();
    state.query.mockResolvedValue({ rows: [] });
    provisioning = await import("../server/phone-provisioning");
  });
  it("validates the commissioned public catalog before actorless writes without DDL or seeds", async () => {
    await initialize(provisioning);
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(catalogQuery(String(state.query.mock.calls[0][0]))).toBe(true);
    expectOnlyCatalogReads();
    expect(state.transaction).toHaveBeenCalledTimes(1);
  });
  it("shares concurrent validation and caches success", async () => {
    let resolve!: (value: { rows: unknown[] }) => void;
    state.query.mockReturnValue(new Promise<{ rows: unknown[] }>(done => { resolve = done; }));
    const first = initialize(provisioning); const second = initialize(provisioning);
    expect(state.query).toHaveBeenCalledTimes(1); expect(state.transaction).not.toHaveBeenCalled();
    resolve({ rows: [] }); await Promise.all([first, second]); await initialize(provisioning);
    expect(state.query).toHaveBeenCalledTimes(1); expect(state.transaction).toHaveBeenCalledTimes(3);
    expectOnlyCatalogReads();
  });
  it("refuses missing commissioned columns before writes and clears the failed cache", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ table_name: "extensions", column_name: "tenant_id" }] });
    await expect(initialize(provisioning)).rejects.toMatchObject({ code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE" });
    expect(state.transaction).not.toHaveBeenCalled();
    await expect(initialize(provisioning)).resolves.toBeUndefined();
    expect(state.query).toHaveBeenCalledTimes(2); expect(state.transaction).toHaveBeenCalledTimes(1);
    expectOnlyCatalogReads();
  });
  it("preserves a database failure without retrying the request and allows later validation", async () => {
    const failure = Object.assign(new Error("Owned synthetic catalog unavailable"), { code: "08006" });
    state.query.mockRejectedValueOnce(failure);
    await expect(initialize(provisioning)).rejects.toBe(failure);
    expect(state.query).toHaveBeenCalledTimes(1); expect(state.transaction).not.toHaveBeenCalled();
    await initialize(provisioning);
    expect(state.query).toHaveBeenCalledTimes(2); expectOnlyCatalogReads();
  });
  it("retains the actor-bound transaction path without global initialization before authorization", async () => {
    await provisioning.createExtension({ orgId: 7, extensionNumber: "owned-actor-seam", actorUserId: 17 });
    expect(state.query).not.toHaveBeenCalled(); expect(state.transaction).toHaveBeenCalledTimes(1);
  });
});

// CI supplies the existing dedicated loopback database. This suite creates one
// separately named disposable database so its required public schema cannot
// collide with other suites using the shared prerequisite database.
const databaseUrl = process.env.PHONE11_PBX_TEST_DATABASE_URL;
const socketDirectory = process.env.PHONE11_PROVISIONING_TEST_SOCKET_DIR;
let base: URL | undefined;
if (databaseUrl) {
  base = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(base.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      base.pathname !== "/phone11_pbx_test" || !base.port || base.search || base.hash) {
    throw new Error("Provisioning schema tests require dedicated loopback phone11_pbx_test and an explicit port");
  }
}
if (socketDirectory) {
  // Optional Unix-socket-only local PG17 rehearsal. Never discover a socket or
  // redirect to an arbitrary existing cluster; both directories must be owned,
  // private, nonsymlink paths in a specifically named disposable fixture root.
  const parent = dirname(socketDirectory);
  if (!base || realpathSync(socketDirectory) !== socketDirectory || basename(socketDirectory) !== "socket" ||
      !/^phone11-provisioning-pg-[A-Za-z0-9_-]+$/.test(basename(parent)) ||
      ![parent, socketDirectory].every(path => {
        const info = lstatSync(path);
        return info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o700;
      })) throw new Error("Provisioning Unix socket must belong to the explicitly owned disposable fixture");
}
function connection(database: string): PoolConfig {
  if (!base) throw new Error("Dedicated fixture URL required");
  return { host: socketDirectory || base.hostname.replace(/^\[|\]$/g, ""), port: Number(base.port),
    user: decodeURIComponent(base.username), password: decodeURIComponent(base.password), database,
    ssl: false, max: 2, connectionTimeoutMillis: 5000, query_timeout: 10000 };
}
const sqlType: Record<number, string> = { 16: "boolean", 17: "bytea", 23: "integer", 25: "text", 1043: "varchar(128)", 1184: "timestamptz", 2950: "uuid" };
const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Unsafe synthetic fixture identifier");
  return `"${value}"`;
};
async function commission(client: PoolClient) {
  for (const [table, columns] of Object.entries(phoneProvisioningColumns)) {
    const definitions = Object.entries(columns).map(([column, oid]) => {
      if (!sqlType[oid]) throw new Error("Unmapped fixture type OID");
      return `${identifier(column)} ${sqlType[oid]}${column === "id" ? " PRIMARY KEY" : table === "extensions" && column === "tenant_id" ? " NOT NULL" : ""}`;
    });
    await client.query(`CREATE TABLE public.${identifier(table)} (${definitions.join(", ")})`);
  }
  await client.query(`ALTER TABLE public.extensions ADD CONSTRAINT fixture_extension_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
    INSERT INTO public.tenants(id,name,plan,status) VALUES(1,'Owned synthetic A','business','active'),(2,'Owned synthetic B','business','active');
    INSERT INTO public.organizations(id,name,plan) VALUES(1,'Owned synthetic','business')`);
}

describe.skipIf(!databaseUrl)("commissioned provisioning catalog on an isolated PostgreSQL fixture", () => {
  const ownedDatabase = `p11_provisioning_${randomBytes(12).toString("hex")}`;
  let admin: Pool; let pool: Pool; let client: PoolClient | undefined;
  let databaseCreated = false; let provisioning: Provisioning;
  beforeAll(async () => {
    admin = new Pool(connection("phone11_pbx_test"));
    expect((await admin.query("SELECT current_database() AS database")).rows[0].database).toBe("phone11_pbx_test");
    await admin.query(`CREATE DATABASE ${identifier(ownedDatabase)}`); databaseCreated = true;
    pool = new Pool(connection(ownedDatabase));
    expect((await pool.query("SELECT current_database() AS database")).rows[0].database).toBe(ownedDatabase);
  });
  beforeEach(async () => {
    vi.resetModules(); state.query.mockReset(); state.transaction.mockReset();
    client = await pool.connect();
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; SET search_path TO public");
    await commission(client);
    state.query.mockImplementation((sql: string, values?: unknown[]) => client!.query(sql, values));
    provisioning = await import("../server/phone-provisioning");
  });
  afterEach(async () => {
    if (client) {
      try { await client.query("ROLLBACK; RESET search_path"); }
      finally { client.release(); client = undefined; }
    }
  });
  afterAll(async () => {
    try {
      await pool?.end();
      // Drop only the exact generated database whose CREATE succeeded here.
      if (databaseCreated) await admin.query(`DROP DATABASE ${identifier(ownedDatabase)}`);
    } finally { await admin?.end(); }
  });
  async function tenantShape() {
    return (await client!.query(`SELECT a.attnotnull AS mandatory,
      pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_sql,
      (SELECT count(*)::integer FROM pg_catalog.pg_constraint c WHERE c.conrelid=a.attrelid
        AND c.contype='f' AND c.conkey=ARRAY[a.attnum]::smallint[]
        AND c.confrelid='public.tenants'::regclass AND c.convalidated AND NOT c.condeferrable) AS foreign_keys
      FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.extensions'::regclass AND a.attname='tenant_id' AND NOT a.attisdropped`)).rows[0];
  }
  it("validates inside READ ONLY and preserves precommissioned tenant constraints and rows", async () => {
    const before = await tenantShape();
    await client!.query("BEGIN READ ONLY");
    try { await initialize(provisioning); } finally { await client!.query("ROLLBACK"); }
    expectOnlyCatalogReads(); expect(await tenantShape()).toEqual(before);
    expect(before).toEqual({ mandatory: true, default_sql: null, foreign_keys: 1 });
    expect((await client!.query("SELECT count(*)::integer AS count FROM public.tenants")).rows[0].count).toBe(2);
    for (const [sql, code] of [
      ["INSERT INTO public.extensions(id,extension_number) VALUES(1,'omitted')", "23502"],
      ["INSERT INTO public.extensions(id,tenant_id,extension_number) VALUES(1,NULL,'null')", "23502"],
      ["INSERT INTO public.extensions(id,tenant_id,extension_number) VALUES(1,999999,'orphan')", "23503"],
    ]) await expect(client!.query(sql)).rejects.toMatchObject({ code });
    await client!.query("INSERT INTO public.extensions(id,tenant_id,extension_number) VALUES(1,1,'valid-a'),(2,2,'valid-b')");
    expect((await client!.query("SELECT tenant_id FROM public.extensions ORDER BY id")).rows).toEqual([{ tenant_id: 1 }, { tenant_id: 2 }]);
  });
  it("refuses an empty missing tenant column and retries only after explicit fixture commissioning", async () => {
    await client!.query("ALTER TABLE public.extensions DROP COLUMN tenant_id CASCADE");
    await expect(initialize(provisioning)).rejects.toMatchObject({ code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE" });
    expect(state.transaction).not.toHaveBeenCalled();
    expect((await client!.query("SELECT count(*)::integer AS count FROM pg_attribute WHERE attrelid='public.extensions'::regclass AND attname='tenant_id' AND NOT attisdropped")).rows[0].count).toBe(0);
    await client!.query("ALTER TABLE public.extensions ADD COLUMN tenant_id integer NOT NULL REFERENCES public.tenants(id)");
    await initialize(provisioning); expect(state.query).toHaveBeenCalledTimes(2); expectOnlyCatalogReads();
  });
  it("refuses populated missing tenancy without adding a column or assigning existing rows", async () => {
    await client!.query("ALTER TABLE public.extensions DROP COLUMN tenant_id CASCADE; INSERT INTO public.extensions(id,extension_number) VALUES(1,'owned-unassigned')");
    await expect(initialize(provisioning)).rejects.toMatchObject({ code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE" });
    expect((await client!.query("SELECT id,extension_number FROM public.extensions")).rows).toEqual([{ id: 1, extension_number: "owned-unassigned" }]);
    expect((await client!.query("SELECT count(*)::integer AS count FROM pg_attribute WHERE attrelid='public.extensions'::regclass AND attname='tenant_id' AND NOT attisdropped")).rows[0].count).toBe(0);
    expectOnlyCatalogReads(); expect(state.transaction).not.toHaveBeenCalled();
  });
  it("accepts the established text/varchar family without changing storage types", async () => {
    await client!.query("ALTER TABLE public.extensions ALTER COLUMN display_name TYPE text; ALTER TABLE public.subscriber ALTER COLUMN username TYPE text; ALTER TABLE public.did_numbers ALTER COLUMN description TYPE varchar(128)");
    await assertPhoneProvisioningSchema(client!);
    expect((await client!.query("SELECT atttypid::integer AS oid FROM pg_attribute WHERE attrelid='public.extensions'::regclass AND attname='display_name'")).rows[0].oid).toBe(25);
  });
  it.each([
    ["extensions", "user_id", "text"], ["extensions", "voicemail_owner_epoch", "text"],
    ["sip_accounts", "secret_ciphertext", "text"],
  ])("refuses changed non-string type %s.%s", async (table, column, type) => {
    await client!.query(`ALTER TABLE public.${identifier(table)} ALTER COLUMN ${identifier(column)} TYPE ${type} USING NULL`);
    await expect(assertPhoneProvisioningSchema(client!)).rejects.toMatchObject({ code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE" });
  });
  it("refuses dropped and generated required columns", async () => {
    await client!.query("ALTER TABLE public.extensions DROP COLUMN display_name");
    await expect(assertPhoneProvisioningSchema(client!)).rejects.toMatchObject({ code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE" });
    await client!.query("ALTER TABLE public.extensions ADD COLUMN display_name varchar(128) GENERATED ALWAYS AS ('owned-generated'::varchar(128)) STORED");
    await expect(assertPhoneProvisioningSchema(client!)).rejects.toMatchObject({ code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE" });
  });
  it("refuses search-path shadowing and recovers after restoring public resolution", async () => {
    await client!.query("CREATE SCHEMA owned_shadow; CREATE TABLE owned_shadow.extensions (LIKE public.extensions); SET search_path TO owned_shadow,public");
    await expect(initialize(provisioning)).rejects.toMatchObject({ code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE" });
    expect(state.transaction).not.toHaveBeenCalled();
    await client!.query("SET search_path TO public"); await initialize(provisioning);
    expect(state.query).toHaveBeenCalledTimes(2); expectOnlyCatalogReads();
  });
  it("refuses a same-named view instead of admitting a substitute relation", async () => {
    await client!.query("ALTER TABLE public.subscriber RENAME TO owned_subscriber_original; CREATE VIEW public.subscriber AS SELECT * FROM public.owned_subscriber_original");
    await expect(initialize(provisioning)).rejects.toMatchObject({ code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE" });
    expectOnlyCatalogReads(); expect(state.transaction).not.toHaveBeenCalled();
  });
});
