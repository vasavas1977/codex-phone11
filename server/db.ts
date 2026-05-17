import { Pool, type PoolConfig } from "pg";
import type { InsertUser, User } from "../drizzle/schema";
import { ENV } from "./_core/env";

let pool: Pool | null = null;

const isTruthy = (value: string | undefined) =>
  value !== undefined && value.length > 0 && value.toLowerCase() !== "false";

function buildPoolConfig(): PoolConfig | null {
  const connectionString = process.env.DATABASE_URL;
  const ssl = isTruthy(process.env.DB_SSL ?? "true")
    ? { rejectUnauthorized: false }
    : undefined;

  if (connectionString) {
    return { connectionString, ssl };
  }

  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const port = Number.parseInt(process.env.DB_PORT ?? "5432", 10);

  if (!host || !database || !user || !password) {
    return null;
  }

  return {
    host,
    database,
    user,
    password,
    port: Number.isFinite(port) ? port : 5432,
    ssl,
  };
}

// Lazily create the PostgreSQL pool so local tooling can run without a DB.
export async function getDb() {
  if (!pool) {
    const config = buildPoolConfig();
    if (!config) return null;

    pool = new Pool(config);
    pool.on("error", (error) => {
      console.warn("[Database] PostgreSQL pool error:", error.message);
    });
  }

  return pool;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not configured");
    return;
  }

  const values: unknown[] = [user.openId];
  const columns = ['"openId"'];
  const placeholders = ["$1"];
  const updates: string[] = [];

  const addValue = (column: string, value: unknown, update = true) => {
    values.push(value);
    columns.push(column);
    placeholders.push(`$${values.length}`);
    if (update) updates.push(`${column} = EXCLUDED.${column}`);
  };

  if (user.name !== undefined) addValue("name", user.name ?? null);
  if (user.email !== undefined) addValue("email", user.email ?? null);
  if (user.loginMethod !== undefined) addValue('"loginMethod"', user.loginMethod ?? null);

  if (user.role !== undefined) {
    addValue("role", user.role);
  } else if (user.openId === ENV.ownerOpenId) {
    addValue("role", "admin");
  }

  addValue('"lastSignedIn"', user.lastSignedIn ?? new Date());

  const updateSet = updates.length > 0 ? updates.join(", ") : '"lastSignedIn" = NOW()';

  try {
    await db.query(
      `INSERT INTO users (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       ON CONFLICT ("openId") DO UPDATE SET ${updateSet}`,
      values,
    );
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not configured");
    return undefined;
  }

  const { rows } = await db.query<User>(
    `SELECT id, "openId", name, email, "loginMethod", role, "createdAt", "updatedAt", "lastSignedIn"
     FROM users
     WHERE "openId" = $1
     LIMIT 1`,
    [openId],
  );

  return rows[0];
}

// TODO: add feature queries here as your schema grows.
