/**
 * PBX Database Connection
 * 
 * Shared PostgreSQL connection pool for all PBX operations.
 * Uses the same RDS instance as Kamailio.
 */
import pg from "pg";

const PG_CONFIG: pg.PoolConfig = {
  host: process.env.PG_HOST || "phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com",
  port: parseInt(process.env.PG_PORT || "5432"),
  user: process.env.PG_USER || "phone11ai",
  password: process.env.PG_PASSWORD || "Xk9mPv2wRtN7qYhL4bJc",
  database: process.env.PG_DATABASE || "phone11ai",
  ssl: { rejectUnauthorized: false },
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
 * Execute a query with automatic pool management
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
 * Execute within a transaction
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
