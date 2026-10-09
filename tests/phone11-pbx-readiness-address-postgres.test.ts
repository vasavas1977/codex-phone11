import { URL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
// Import the exact query/decoder without an ambient app pool or startup.
vi.mock("../server/pbx/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
// eslint-disable-next-line import/first
import { decodeReadiness, READINESS_SQL } from "../server/pbx/database-readiness";

const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" || url.pathname !== "/phone11_pbx_test" ||
      !url.port || url.search || url.hash) {
    throw new Error("Readiness address tests require the dedicated IPv4 loopback phone11_pbx_test database and explicit port");
  }
}
const pool = connectionString ? new Pool({ connectionString, ssl: false, max: 1,
  connectionTimeoutMillis: 5000, query_timeout: 35000 }) : null;

async function observe(address: string, inspectOldCast = false) {
  const client: PoolClient = await pool!.connect();
  try {
    const startupUser = (client as PoolClient & { user?: unknown }).user;
    if (typeof startupUser !== "string" || !startupUser) throw new Error("Test connection startup identity unavailable");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='30s'");
    // Do not replace the product's database/OID/version/role parameters to make
    // this different fixture database look commissioned.
    const result = await client.query(READINESS_SQL, [address, 16384, "160013", startupUser]);
    expect(result.rows).toHaveLength(1);
    expect(Object.keys(result.rows[0])).toEqual(["observation"]);
    const observation = decodeReadiness(result.rows[0].observation);
    expect(observation.databaseMatch).toBe(false);
    expect(observation.readOnly).toBe(true);
    expect(observation.repeatableRead).toBe(true);
    expect(observation.sessionMatchesConnectionUser).toBe(true);
    if (inspectOldCast) {
      const old = await client.query(`SELECT
        pg_catalog.inet_server_addr()::pg_catalog.text=$1 AS old_match,
        pg_catalog.host(pg_catalog.inet_server_addr())=$1 AS host_match,
        pg_catalog.inet_server_port()=5432 AS port_match`, [address]);
      expect(old.rows).toEqual([{ old_match: false, host_match: true, port_match: true }]);
    }
    return observation;
  } finally {
    // No DDL or data writes; rollback also runs when any assertion/query fails.
    try { await client.query("ROLLBACK"); }
    catch { client.release(true); throw new Error("Test read-only rollback failed"); }
    client.release();
  }
}

describe.skipIf(!connectionString)("PBX readiness address comparison on isolated PostgreSQL", () => {
  afterAll(async () => { await pool?.end(); });

  it("matches a bare IPv4 host while the previous inet text cast includes its mask", async () => {
    expect((await observe("127.0.0.1", true)).serverMatch).toBe(true);
  });
  it("does not match a different IPv4 host", async () => {
    expect((await observe("127.0.0.2")).serverMatch).toBe(false);
  });
  it.each(["127.0.0.1/32", "127.0.0.0/8"])("does not interpret subnet-form input %s as a wildcard", async address => {
    expect((await observe(address)).serverMatch).toBe(false);
  });
});
