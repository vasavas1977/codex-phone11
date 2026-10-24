/**
 * PBX Database Connection
 * 
 * Shared PostgreSQL connection pool for all PBX operations.
 * Uses the same RDS instance as Kamailio.
 */
import pg from "pg";
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { createJsPostgresPool } from "./js-postgres-driver";

let _pool: pg.Pool | null = null;
let poolAccessAttempted = false;
let ownedConfig: (pg.PoolConfig & { replication: "false" }) | undefined;
let ownedClosed = false;
let ownedClosePromise: Promise<void> | undefined;

/** Explicit private startup input, never read from environment or returned. */
export interface OwnedPbxPoolBinding {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  tlsCaPem: string;
}

/**
 * Opt in before ANY getPool attempt, including a failed legacy initialization.
 * This configures transport only; caller must separately attest role/ACL/TLS
 * identity before listen. Existing unconfigured processes keep the legacy path.
 */
export function configureOwnedPbxPool(binding: OwnedPbxPoolBinding): void {
  if (poolAccessAttempted || ownedConfig || ownedClosed) throw new Error("PBX_OWNED_POOL_BINDING_REFUSED");
  try {
    const keys = ["host", "port", "database", "user", "password", "tlsCaPem"];
    if (!binding || ![Object.prototype, null].includes(Object.getPrototypeOf(binding))
      || Object.keys(binding).length !== keys.length
      || keys.some(key => !Object.hasOwn(binding, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(binding, key)!, "value"))) throw new Error();
    const { host, port, database, user, password, tlsCaPem } = binding;
    const dns = typeof host === "string" && host.length <= 253 && host.split(".").every(label =>
      /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
    if (!dns || (/^[0-9.]+$/.test(host) && isIP(host) !== 4)
      || !Number.isInteger(port) || port < 1 || port > 65535
      || typeof database !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(database)
      || typeof user !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(user)
      || typeof password !== "string" || !password.length || password.length > 1024 || password.includes("\0")
      || typeof tlsCaPem !== "string" || tlsCaPem.length > 65536 || tlsCaPem.includes("\0")) throw new Error();
    const certificates = tlsCaPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length || certificates.length > 16
      || certificates.join("").replace(/\s/g, "") !== tlsCaPem.replace(/\s/g, "")) throw new Error();
    for (const certificate of certificates) new X509Certificate(certificate);
    ownedConfig = {
      host, port, database, user, password,
      ssl: {
        ca: tlsCaPem, rejectUnauthorized: true,
        // Always bind SAN verification to the supplied host, including IPv4.
        checkServerIdentity: (_reportedHost, certificate) => checkServerIdentity(host, certificate),
      },
      max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15000,
      query_timeout: 10000, statement_timeout: 10000, lock_timeout: 3000,
      idle_in_transaction_session_timeout: 15000,
      // A truthy literal overrides pg's PGOPTIONS fallback; no ambient URLs,
      // SSL modes, application name or search_path enter this strict branch.
      options: "-c search_path=pg_catalog,public,pg_temp -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000",
      application_name: "phone11_retained_runtime", client_encoding: "UTF8",
      replication: "false",
    };
  } catch {
    // Do not attach input, certificate parser/driver details or a cause.
    throw new Error("PBX_OWNED_POOL_BINDING_REFUSED");
  }
}

/** Drain callers first. Once requested, closure is terminal even if end fails. */
export function closeOwnedPbxPool(): Promise<void> {
  if (!ownedConfig) return Promise.reject(new Error("PBX_OWNED_POOL_NOT_CONFIGURED"));
  if (ownedClosePromise) return ownedClosePromise;
  ownedClosed = true;
  // Capture this graph's pool once. Never clear it or permit resurrection.
  const captured = _pool;
  ownedClosePromise = Promise.resolve().then(() => captured?.end()).then(() => undefined, () => {
    throw new Error("PBX_OWNED_POOL_CLOSE_UNCONFIRMED");
  });
  return ownedClosePromise;
}

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
  poolAccessAttempted = true;
  if (ownedClosed) throw new Error("PBX_OWNED_POOL_UNAVAILABLE");
  if (!_pool) {
    if (ownedConfig) {
      try { _pool = createJsPostgresPool(ownedConfig); }
      catch {
        ownedClosed = true;
        throw new Error("PBX_OWNED_POOL_UNAVAILABLE");
      }
    } else {
      _pool = new pg.Pool(buildPgConfig());
    }
    _pool.on("error", () => {
      console.error("[PBX DB] Pool error");
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
      if (ownedConfig) console.warn(`[PBX DB] Slow query (${duration}ms)`);
      else console.warn(`[PBX DB] Slow query (${duration}ms):`, text.substring(0, 100));
    }
    return result;
  } catch (error: any) {
    console.error("[PBX DB] Query error");
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
