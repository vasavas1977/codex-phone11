/**
 * PBX Database Connection
 * 
 * Shared PostgreSQL connection pool for all PBX operations.
 * Uses the same RDS instance as Kamailio.
 */
import pg from "pg";

let _pool: pg.Pool | null = null;

function getSslConfig(connectionString?: string): pg.PoolConfig["ssl"] {
  if (process.env.PG_SSL === "false" || connectionString?.includes("sslmode=disable")) {
    return false;
  }

  return {
    rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === "true",
  };
}

function buildPgConfig(): pg.PoolConfig {
  const connectionString = process.env.PG_CONNECTION_STRING ?? process.env.DATABASE_URL;
  const common: pg.PoolConfig = {
    ssl: getSslConfig(connectionString),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  if (connectionString) {
    return {
      ...common,
      connectionString,
    };
  }

  const requiredEnv = ["PG_HOST", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const;
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`[PBX DB] Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    ...common,
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT ?? "5432", 10),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
  };
}

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool(buildPgConfig());
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
