import type { Pool } from "pg";
import { z } from "zod";
import type { Phone11Auth } from "./phone11-auth";

type IdentityColumn = { name: string; type: string; required: boolean };
type IdentityConstraint = {
  kind: string;
  columns: string[];
  targetColumns: string[];
  authTarget: boolean;
  canonicalTarget: boolean;
  deleteAction: string;
};

const singleColumn = (columns: string[], name: string) =>
  columns.length === 1 && columns[0] === name;

export async function isPhone11AuthReady(
  auth: Pick<Phone11Auth, "$context">,
  database: Pick<Pool, "query">,
): Promise<boolean> {
  try {
    const context = await auth.$context;
    if (typeof context.checkSchema !== "function") return false;
    // Initialization starts this check in the background; readiness must await its verdict.
    await context.checkSchema();

    const { rows: columns } = await database.query<IdentityColumn>(`
      SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
             attnotnull AS required
        FROM pg_attribute
       WHERE attrelid = 'phone11_auth_identity'::regclass
         AND attnum > 0 AND NOT attisdropped
    `);
    const requiredColumns: IdentityColumn[] = [
      { name: "auth_user_id", type: "text", required: true },
      { name: "legacy_user_id", type: "integer", required: true },
      { name: "created_at", type: "timestamp with time zone", required: true },
      { name: "disabled_at", type: "timestamp with time zone", required: false },
    ];
    if (!requiredColumns.every(expected => columns.some(column =>
      column.name === expected.name && column.type === expected.type &&
      column.required === expected.required,
    ))) return false;

    // Resolve relation OIDs and column numbers, not operator-chosen constraint names.
    const { rows: constraints } = await database.query<IdentityConstraint>(`
      SELECT c.contype AS kind, c.confdeltype AS "deleteAction",
             c.confrelid = 'phone11_auth_user'::regclass AS "authTarget",
             c.confrelid = 'users'::regclass AS "canonicalTarget",
             ARRAY(SELECT a.attname::text
                     FROM unnest(c.conkey) WITH ORDINALITY k(num, position)
                     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num
                    ORDER BY k.position) AS columns,
             ARRAY(SELECT a.attname::text
                     FROM unnest(c.confkey) WITH ORDINALITY k(num, position)
                     JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num
                    ORDER BY k.position) AS "targetColumns"
        FROM pg_constraint c
       WHERE c.conrelid = 'phone11_auth_identity'::regclass
         AND c.convalidated AND NOT c.condeferrable
         AND (c.conindid = 0 OR EXISTS (
           SELECT 1 FROM pg_index i WHERE i.indexrelid = c.conindid
             AND i.indisvalid AND i.indisready
         ))
    `);
    const primary = constraints.some(c => c.kind === "p" && singleColumn(c.columns, "auth_user_id"));
    const unique = constraints.some(c => c.kind === "u" && singleColumn(c.columns, "legacy_user_id"));
    const authForeignKey = constraints.some(c => c.kind === "f" && c.authTarget &&
      singleColumn(c.columns, "auth_user_id") && singleColumn(c.targetColumns, "id") && c.deleteAction === "c");
    const canonicalForeignKey = constraints.some(c => c.kind === "f" && c.canonicalTarget &&
      singleColumn(c.columns, "legacy_user_id") && singleColumn(c.targetColumns, "id") && c.deleteAction === "r");
    if (!primary || !unique || !authForeignKey || !canonicalForeignKey) return false;

    // Check columns consumed by the application even if Better Auth cached an earlier check.
    await database.query(`
      SELECT u.id, u."openId", u.name, u.email, u."loginMethod", u.role,
             u."createdAt", u."updatedAt", u."lastSignedIn",
             s.id, s.token, s."userId", s."expiresAt", s."updatedAt",
             r.key, r.count, r."lastRequest", v.identifier, v.value, v."expiresAt"
        FROM users u, phone11_auth_session s, phone11_auth_rate_limit r,
             phone11_auth_verification v LIMIT 0
    `);
    // The operator tool uses Better Auth's default scrypt format: 16-byte salt, 64-byte key.
    // Keep hashes inside PostgreSQL; this is structural readiness, not a password login.
    const { rows: candidates } = await database.query<{ email: string }>(`
      SELECT au.email
        FROM phone11_auth_identity i
        JOIN phone11_auth_user au ON au.id = i.auth_user_id
        JOIN users u ON u.id = i.legacy_user_id
        JOIN phone11_auth_account a ON a."userId" = au.id
       WHERE i.disabled_at IS NULL AND u.id > 0 AND length(trim(u."openId")) > 0
         AND u.role IN ('user', 'admin') AND u."lastSignedIn" IS NOT NULL
         AND au.email = lower(trim(au.email))
         AND a."providerId" = 'credential' AND a."accountId" = au.id
         AND a.password ~ '^[0-9a-f]{32}:[0-9a-f]{128}$'
         AND (SELECT count(*) FROM phone11_auth_account other
               WHERE other."userId" = au.id AND other."providerId" = 'credential') = 1
    `);
    return candidates.some(candidate => z.email().safeParse(candidate.email).success);
  } catch {
    // Missing migrations, unavailable schema checks and DB errors all fail closed.
    return false;
  }
}
