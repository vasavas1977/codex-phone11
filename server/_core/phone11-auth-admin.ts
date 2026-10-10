import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { getMigrations } from "better-auth/db/migration";
import type { Pool } from "pg";
import { z } from "zod";
import { phone11AuthOptions, type Phone11AuthConfig } from "./phone11-auth";

const identitySchema = `
  CREATE TABLE IF NOT EXISTS phone11_auth_identity (
    auth_user_id TEXT PRIMARY KEY REFERENCES phone11_auth_user(id) ON DELETE CASCADE,
    legacy_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disabled_at TIMESTAMPTZ
  );`;

export async function planAuthMigration(database: Pool, config: Phone11AuthConfig) {
  // This must be the canonical provisioning database, never an automatically seeded user table.
  await database.query('SELECT id, "openId", email, role FROM users LIMIT 0');
  const plan = await getMigrations(phone11AuthOptions(database, config));
  const tables = [...plan.toBeCreated, ...plan.toBeAdded].map(t => t.table);
  if (plan.unsafeChanges.length || plan.schemaProblems.length || tables.some(t => !t.startsWith("phone11_auth_"))) {
    throw new Error("Auth migration requires manual schema review");
  }
  const sql = (plan.toBeCreated.length || plan.toBeAdded.length || plan.toBeAddedIndexes.length)
    ? await plan.compileMigrations() : "";
  return { sql: sql + "\n" + identitySchema, tables };
}

export async function applyAuthMigration(database: Pool, config: Phone11AuthConfig) {
  const plan = await planAuthMigration(database, config);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(plan.sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  return plan.tables;
}

const identityInput = z.object({
  userId: z.number().int().positive(),
  email: z.email().transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

export async function restoreEmptyCanonicalUser(
  database: Pool,
  input: { userId: number; email: string; extension: string; confirmEmptyUsers: boolean },
) {
  const { userId, email, extension } = z.object({
    userId: z.number().int().positive(),
    email: z.email().transform(value => value.toLowerCase()),
    extension: z.string().regex(/^\d{1,16}$/),
    confirmEmptyUsers: z.literal(true),
  }).parse(input);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Recovery requires an empty table and an existing, matching extension assignment.
    await client.query("LOCK TABLE users IN ACCESS EXCLUSIVE MODE");
    await client.query("LOCK TABLE extensions IN SHARE MODE");
    if ((await client.query("SELECT 1 FROM users LIMIT 1")).rows.length) {
      throw new Error("Canonical users table is not empty; refusing recovery");
    }
    const assignments = await client.query(
      "SELECT id FROM extensions WHERE user_id = $1 AND extension_number = $2 " +
      "AND status = 'active' AND deleted_at IS NULL", [userId, extension],
    );
    if (assignments.rows.length !== 1) throw new Error("Existing extension assignment must match exactly");
    await client.query(
      'INSERT INTO users (id, "openId", name, email, "loginMethod", role) ' +
      "VALUES ($1, $2, 'Phone11 User', $3, 'phone11', 'user')",
      [userId, "phone11:user:" + randomUUID(), email],
    );
    const sequence = (await client.query("SELECT pg_get_serial_sequence('users', 'id') AS name")).rows[0].name;
    if (!sequence) throw new Error("Canonical user ID sequence is missing");
    await client.query("SELECT setval($1::regclass, GREATEST($2::bigint, nextval($1::regclass)), true)", [sequence, userId]);
    await client.query("COMMIT");
    return { userId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function createExistingUserIdentity(
  database: Pool,
  input: { userId: number; email: string; password: string },
) {
  const { userId, email, password } = identityInput.parse(input);
  const passwordHash = await hashPassword(password);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      'SELECT id, name, email FROM users WHERE id = $1 FOR UPDATE', [userId],
    );
    if (!rows[0] || rows[0].email?.trim().toLowerCase() !== email) {
      throw new Error("Explicit user ID and canonical email must match");
    }
    const duplicates = await client.query("SELECT id FROM users WHERE lower(trim(email)) = $1", [email]);
    if (duplicates.rows.length !== 1) throw new Error("Ambiguous canonical email; manual review required");
    const existing = await client.query(
      "SELECT 1 FROM phone11_auth_identity WHERE legacy_user_id = $1", [userId],
    );
    if (existing.rows.length) throw new Error("Identity already exists; refusing to replace it or reset a password");
    const authUserId = randomUUID();
    await client.query(
      `INSERT INTO phone11_auth_user
       (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, false, NOW(), NOW())`,
      [authUserId, rows[0].name || "Phone11 User", email],
    );
    await client.query(
      `INSERT INTO phone11_auth_account
       (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())`,
      [randomUUID(), authUserId, passwordHash],
    );
    await client.query(
      "INSERT INTO phone11_auth_identity (auth_user_id, legacy_user_id) VALUES ($1, $2)",
      [authUserId, userId],
    );
    await client.query("COMMIT");
    return { userId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
