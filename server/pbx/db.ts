/**
 * PBX Database Connection
 * 
 * Shared PostgreSQL connection pool for all PBX operations.
 * Uses the same RDS instance as Kamailio.
 */
import pg from "pg";

let _pool: pg.Pool | null = null;

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function getSslConfig(connectionString?: string): pg.PoolConfig["ssl"] {
  const sslMode = firstEnv("PG_SSL", "DB_SSL", "POSTGRES_SSL", "DATABASE_SSL")?.toLowerCase();
  if (
    sslMode === "false" ||
    sslMode === "0" ||
    sslMode === "disable" ||
    connectionString?.includes("sslmode=disable")
  ) {
    return false;
  }

  return {
    rejectUnauthorized: firstEnv("PG_SSL_REJECT_UNAUTHORIZED", "DB_SSL_REJECT_UNAUTHORIZED") === "true",
  };
}

function buildPgConfig(): pg.PoolConfig {
  const discrete = {
    host: firstEnv("PG_HOST", "DB_HOST", "POSTGRES_HOST"),
    port: firstEnv("PG_PORT", "DB_PORT", "POSTGRES_PORT"),
    user: firstEnv("PG_USER", "DB_USER", "POSTGRES_USER"),
    password: firstEnv("PG_PASSWORD", "DB_PASSWORD", "POSTGRES_PASSWORD"),
    database: firstEnv("PG_DATABASE", "DB_NAME", "DB_DATABASE", "POSTGRES_DB"),
  };
  const missing = [
    ["host", discrete.host],
    ["user", discrete.user],
    ["password", discrete.password],
    ["database", discrete.database],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const hasDiscretePgConfig = missing.length === 0;

  // Prefer discrete settings when present. They avoid URL parsing bugs when
  // database passwords contain URL-sensitive characters such as @, /, :, or #.
  const connectionString = process.env.PG_CONNECTION_STRING ?? (hasDiscretePgConfig ? undefined : process.env.DATABASE_URL);
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

  if (missing.length > 0) {
    throw new Error(`[PBX DB] Missing required database settings: ${missing.join(", ")}`);
  }

  return {
    ...common,
    ssl: getSslConfig(),
    host: discrete.host,
    port: parseInt(discrete.port ?? "5432", 10),
    user: discrete.user,
    password: discrete.password,
    database: discrete.database,
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
