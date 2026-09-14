/**
 * PBX Database Connection
 * 
 * Shared PostgreSQL connection pool for all PBX operations.
 * Uses the same RDS instance as Kamailio.
 */
import pg from "pg";
import { GoogleAuth } from "google-auth-library";

let _pool: pg.Pool | null = null;

function firstEnv(source: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value) return value;
  }
  return undefined;
}

function getSslConfig(source: NodeJS.ProcessEnv, connectionString?: string): pg.PoolConfig["ssl"] {
  const sslMode = firstEnv(source, "PG_SSL", "DB_SSL", "POSTGRES_SSL", "DATABASE_SSL")?.toLowerCase();
  if (
    sslMode === "false" ||
    sslMode === "0" ||
    sslMode === "disable" ||
    connectionString?.includes("sslmode=disable")
  ) {
    return false;
  }

  return {
    rejectUnauthorized: firstEnv(source, "PG_SSL_REJECT_UNAUTHORIZED", "DB_SSL_REJECT_UNAUTHORIZED") === "true",
  };
}

type IamTokenProvider = () => Promise<string>;

async function defaultIamTokenProvider(): Promise<string> {
  const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/sqlservice.login"] }).getClient();
  const access = await client.getAccessToken();
  const token = typeof access === "string" ? access : access?.token;
  if (!token) throw new Error("[PBX DB] Cloud SQL IAM token is unavailable");
  return token;
}

/** Build a pool configuration without exposing a Cloud SQL IAM token in env or logs. */
export function buildPgConfig(
  source: NodeJS.ProcessEnv = process.env,
  iamTokenProvider: IamTokenProvider = defaultIamTokenProvider,
): pg.PoolConfig {
  const iamAuth = source.PHONE11_CLOUDSQL_IAM_DB_AUTH === "1";
  const discrete = {
    host: firstEnv(source, "PG_HOST", "DB_HOST", "POSTGRES_HOST"),
    port: firstEnv(source, "PG_PORT", "DB_PORT", "POSTGRES_PORT"),
    user: firstEnv(source, "PG_USER", "DB_USER", "POSTGRES_USER"),
    password: firstEnv(source, "PG_PASSWORD", "DB_PASSWORD", "POSTGRES_PASSWORD"),
    database: firstEnv(source, "PG_DATABASE", "DB_NAME", "DB_DATABASE", "POSTGRES_DB"),
  };
  const missing = [
    ["host", discrete.host],
    ["user", discrete.user],
    ...(iamAuth ? [] : [["password", discrete.password]]),
    ["database", discrete.database],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const hasDiscretePgConfig = missing.length === 0;

  // Prefer discrete settings when present. They avoid URL parsing bugs when
  // database passwords contain URL-sensitive characters such as @, /, :, or #.
  const connectionString = source.PG_CONNECTION_STRING ?? (hasDiscretePgConfig ? undefined : source.DATABASE_URL);
  if (iamAuth) {
    const instance = source.PHONE11_CLOUDSQL_INSTANCE;
    const expectedHost = instance ? `/cloudsql/${instance}` : "";
    if (!instance || discrete.host !== expectedHost || !discrete.user?.endsWith(".iam") || discrete.password || connectionString || source.DATABASE_URL) {
      throw new Error("[PBX DB] Cloud SQL IAM configuration is invalid");
    }
  }
  const common: pg.PoolConfig = {
    // The local Unix socket is plaintext; the managed Cloud SQL connector
    // authenticates both ends and encrypts the upstream hop.
    ssl: iamAuth ? false : getSslConfig(source, connectionString),
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
    ssl: iamAuth ? false : getSslConfig(source),
    host: discrete.host,
    port: parseInt(discrete.port ?? "5432", 10),
    user: discrete.user,
    password: iamAuth ? iamTokenProvider : discrete.password,
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
