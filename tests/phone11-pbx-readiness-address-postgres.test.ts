import { isIP } from "node:net";
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

type AddressCase = "match" | "different" | "hostMask" | "subnet";
function backendAddress(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== "address,port_match" ||
      !("address" in value) || typeof value.address !== "string" || isIP(value.address) !== 4 ||
      !("port_match" in value) || value.port_match !== true) {
    // Never include unknown driver metadata or the observed address in errors.
    throw new Error("Test backend address metadata invalid");
  }
  return value.address;
}
function addressInput(address: string, kind: AddressCase): string {
  if (kind === "match") return address;
  if (kind === "different") return address === "127.0.0.1" ? "127.0.0.2" : "127.0.0.1";
  return address + (kind === "hostMask" ? "/32" : "/8");
}

async function observe(kind: AddressCase, inspectOldCast = false) {
  const client: PoolClient = await pool!.connect();
  try {
    const startupUser = (client as PoolClient & { user?: unknown }).user;
    if (typeof startupUser !== "string" || !startupUser) throw new Error("Test connection startup identity unavailable");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='30s'");
    // A Docker-published loopback connection can terminate on a bridge address.
    // Keep the measured backend address private and use this SAME RR RO client.
    const metadata = await client.query(`SELECT
      pg_catalog.host(pg_catalog.inet_server_addr()) AS address,
      pg_catalog.inet_server_port()=5432 AS port_match`);
    if (metadata.rows.length !== 1) throw new Error("Test backend address metadata invalid");
    const address = addressInput(backendAddress(metadata.rows[0]), kind);
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
    expect((await observe("match", true)).serverMatch).toBe(true);
  });
  it("does not match a different IPv4 host", async () => {
    expect((await observe("different")).serverMatch).toBe(false);
  });
  it.each(["hostMask", "subnet"] as const)("does not interpret derived %s input as a wildcard", async kind => {
    expect((await observe(kind)).serverMatch).toBe(false);
  });
});


describe("readiness address fixture metadata privacy and derived cases", () => {
  it("accepts a validated backend IPv4, including a bridge address", () => {
    expect(backendAddress({ address: "172.17.0.2", port_match: true })).toBe("172.17.0.2");
  });
  it.each([null, { address: null, port_match: true },
    { address: "::1", port_match: true }, { address: "172.17.0.2/32", port_match: true },
    { address: "172.17.0.2", port_match: false }, { address: "172.17.0.2", port_match: "true" },
    { address: "SYNTHETIC_UNKNOWN_DO_NOT_LOG", port_match: true, extra: "SYNTHETIC_UNKNOWN_DO_NOT_LOG" }])(
    "refuses invalid metadata with a fixed error", value => {
      let error: unknown;
      try { backendAddress(value); } catch (caught) { error = caught; }
      expect(error instanceof Error && error.message === "Test backend address metadata invalid").toBe(true);
    });
  it.each(["127.0.0.1", "172.17.0.2"])("derives genuinely different and contained-mask test inputs", address => {
    expect(addressInput(address, "match") === address).toBe(true);
    expect(addressInput(address, "different") !== address).toBe(true);
    expect(isIP(addressInput(address, "different"))).toBe(4);
    expect(addressInput(address, "hostMask") === address + "/32").toBe(true);
    expect(addressInput(address, "subnet") === address + "/8").toBe(true);
  });
});
