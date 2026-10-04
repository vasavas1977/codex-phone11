import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";

const state = vi.hoisted(() => ({ poolQuery: vi.fn(), transaction: vi.fn(), statements: [] as string[] }));
vi.mock("../server/pbx/db", () => ({
  getPool: () => ({ query: state.poolQuery }),
  withTransaction: state.transaction,
}));

const databaseUrl = process.env.PHONE11_LEGACY_PROVISIONING_TEST_DATABASE_URL;
const required = process.env.PHONE11_LEGACY_PROVISIONING_REQUIRE_POSTGRES === "1";
const schema = "p11_legacy_prov_test";
type Provisioning = typeof import("../server/phone-provisioning");

it("requires an explicit owned fixture when PostgreSQL proof is mandatory", () => {
  if (required) expect(databaseUrl, "Owned PostgreSQL fixture URL is required").toBeTruthy();
});

describe.skipIf(!databaseUrl)("legacy authenticated provisioning on owned PostgreSQL", () => {
  let pool: Pool;
  let provisioning: Provisioning;
  let selectedSchema = schema;
  let beforeCommit: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    expect(["postgres:", "postgresql:"]).toContain(target.protocol);
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(target.hostname);
    expect(target.pathname).toBe("/phone11_legacy_prov_test");
    expect(decodeURIComponent(target.username)).toBe("p11_legacy_prov_runtime");
    expect(decodeURIComponent(target.password).length).toBeGreaterThan(0);
    expect(target.search).toBe("");
    pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1,
      options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    const identity = await pool.query(`SELECT current_database() AS db, current_schema() AS schema,
      current_user AS role, current_setting('server_version_num')::integer / 10000 AS major,
      rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
      has_database_privilege(current_database(), 'CREATE') AS database_create,
      has_schema_privilege('public', 'CREATE') AS public_create
      FROM pg_roles WHERE rolname=current_user`);
    expect(identity.rows[0]).toMatchObject({ db: "phone11_legacy_prov_test", schema,
      role: "p11_legacy_prov_runtime", major: 17, rolsuper: false, rolbypassrls: false,
      rolcreatedb: false, rolcreaterole: false, database_create: false, public_create: false });
    for (const name of [schema, "p11_legacy_prov_missing", "p11_legacy_prov_partial"]) {
      expect((await pool.query("SELECT has_schema_privilege($1, 'CREATE') AS allowed", [name])).rows[0].allowed).toBe(false);
    }
    expect((await pool.query("SELECT pin FROM fixture_identity")).rows).toEqual([
      { pin: "c9f3c2-legacy-provisioning-disposable-v1" },
    ]);
  });

  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    state.statements = []; selectedSchema = schema; beforeCommit = undefined;
    await pool.query(`DELETE FROM user_extensions; DELETE FROM sip_accounts;
      DELETE FROM extensions; DELETE FROM subscriber; DELETE FROM did_numbers;
      UPDATE tenants SET status='active';
      UPDATE tenant_memberships SET status='active', role='admin' WHERE user_id=9`);
    vi.stubEnv("SIP_DOMAIN", "sip.phone11.ai");
    vi.stubEnv("SIP_DEK_SECRET", "owned-fixture-synthetic-dek-only");
    state.poolQuery.mockRejectedValue(new Error("Authenticated writer attempted a global pool query"));
    state.transaction.mockImplementation(async callback => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path=${selectedSchema}`);
        const tracked = { query: async (sql: string, params?: unknown[]) => {
          state.statements.push(sql);
          return client.query(sql, params);
        } } as PoolClient;
        const result = await callback(tracked);
        await beforeCommit?.();
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK"); throw error;
      } finally { client.release(); }
    });
    provisioning = await import("../server/phone-provisioning");
  });

  afterAll(async () => { vi.unstubAllEnvs(); await pool?.end(); });

  const noInitializer = () => {
    expect(state.poolQuery.mock.calls.length).toBe(0);
    expect(state.statements.some(sql => /\b(?:CREATE|ALTER)\b/.test(sql) || /INSERT INTO (?:tenants|organizations)/.test(sql))).toBe(false);
    expect(pool.totalCount).toBe(1);
  };
  const create = (actorUserId = 9, orgId = 7, extensionNumber = "4101") =>
    provisioning.createExtension({ orgId, extensionNumber, actorUserId });

  it.each(["extension", "assignment", "did"] as const)("denies a revoked cold %s actor with no initializer effects", async operation => {
    await pool.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9");
    const invoke = operation === "extension" ? create() : operation === "assignment"
      ? provisioning.assignExtensionToUser(33, 41, true, 7, 9)
      : provisioning.createDidNumber({ orgId: 7, number: "+6620000000", destinationType: "extension", actorUserId: 9 });
    await expect(invoke).rejects.toThrow("administrator access");
    noInitializer(); expect(state.statements).toHaveLength(1);
    expect((await pool.query("SELECT id FROM tenants WHERE id=1")).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM extensions")).rows).toHaveLength(0);
  });

  it.each([9, 10])("admits current admin/owner %s on prepared schema with real atomic provisioning", async actor => {
    const created = await create(actor);
    await expect(provisioning.assignExtensionToUser(33, created.id, true, 7, actor)).resolves.toEqual({ success: true });
    await provisioning.createDidNumber({ orgId: 7, number: "+6620000000", destinationType: "extension", destinationValue: "4101", actorUserId: actor });
    const account = (await pool.query(`SELECT e.user_id, sa.user_id AS account_user,
      sub.ha1=sa.ha1 AND sub.ha1b=sa.ha1b AS consistent FROM extensions e
      JOIN sip_accounts sa ON sa.extension_id=e.id
      JOIN subscriber sub ON sub.username=sa.sip_username AND sub.domain=sa.sip_domain`)).rows;
    expect(account).toEqual([{ user_id: 33, account_user: 33, consistent: true }]);
    noInitializer();
  });

  it("rejects another tenant, a demoted actor, and an inactive tenant", async () => {
    await expect(create(9, 8)).rejects.toThrow("administrator access");
    await pool.query("UPDATE tenant_memberships SET role='member' WHERE user_id=9");
    await expect(create()).rejects.toThrow("administrator access");
    await pool.query("UPDATE tenant_memberships SET role='admin' WHERE user_id=9; UPDATE tenants SET status='inactive' WHERE id=7");
    await expect(create()).rejects.toThrow("administrator access");
    noInitializer(); expect((await pool.query("SELECT id FROM subscriber")).rows).toHaveLength(0);
  });

  it.each([["p11_legacy_prov_missing", "42P01"], ["p11_legacy_prov_partial", "42703"]])(
    "fails closed on %s instead of initializing or repairing it", async (name, code) => {
      selectedSchema = name;
      await expect(provisioning.createDidNumber({ orgId: 7, number: "+6620000000", destinationType: "extension", actorUserId: 9 })).rejects.toMatchObject({ code });
      noInitializer();
      expect((await pool.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema=$1", [name])).rows[0].count).toBe(name.endsWith("missing") ? 2 : 3);
    },
  );

  it("rolls back subscriber and extension when the account constraint rejects creation", async () => {
    await expect(create(9, 7, "4102")).rejects.toMatchObject({ code: "23514" });
    expect((await pool.query("SELECT id FROM subscriber")).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM extensions")).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM sip_accounts")).rows).toHaveLength(0);
    noInitializer();
  });

  it("holds actor authority until commit and denies the subsequent revoked request", async () => {
    let release!: () => void; let entered!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; });
    const commit = new Promise<void>(resolve => { release = resolve; });
    beforeCommit = async () => { entered(); await commit; };
    const pending = create();
    await held;
    const revoker = new Pool({ connectionString: databaseUrl, ssl: false, max: 1,
      options: `-c search_path=${schema} -c lock_timeout=500ms`, connectionTimeoutMillis: 5000 });
    try {
      await expect(revoker.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9")).rejects.toMatchObject({ code: "55P03" });
      release(); await pending;
      await revoker.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9");
      beforeCommit = undefined;
      await expect(create(9, 7, "4103")).rejects.toThrow("administrator access");
      noInitializer();
    } finally { release(); await pending; await revoker.end(); }
  }, 15000);
});
