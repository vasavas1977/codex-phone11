/**
 * PBX Database Connection
 *
 * Shared PostgreSQL connection pool for all PBX operations.
 * Uses the same database connection details as Kamailio.
 */
import pg from "pg";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the PBX database connection`);
  }
  return value;
}

const PG_CONFIG: pg.PoolConfig = {
  host: requiredEnv("PG_HOST"),
  port: parseInt(process.env.PG_PORT || "5432", 10),
  user: requiredEnv("PG_USER"),
  password: requiredEnv("PG_PASSWORD"),
  database: requiredEnv("PG_DATABASE"),
  ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool(PG_CONFIG);
    _pool.on("error", (err) => {
      console.error("[PBX DB] Unexpected pool error:", err.message);
    });
  }
  return _pool;
}

/**
 * Execute a query with automatic pool management.
 */
export async function query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`[PBX DB] Slow query (${duration}ms):`, text.substring(0, 100));
    }
    return result;
  } catch (error: any) {
    console.error("[PBX DB] Query error:", error.message, "SQL:", text.substring(0, 200));
    throw error;
  }
}

/**
 * Execute within a transaction.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
