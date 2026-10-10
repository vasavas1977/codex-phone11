/** Minimal directory for a caller's explicitly selected Phone11 tenant. */
import { TRPCError } from "@trpc/server";
import { query } from "./db";

export type DirectoryEntry = Readonly<{ id: number; name: string; number: string }>;
export type DirectoryPage = Readonly<{
  tenantId: number;
  items: readonly DirectoryEntry[];
  nextOffset: number | null;
}>;

export async function listSelectedTenantDirectory(input: {
  userId: number;
  tenantId: number;
  search: string;
  limit: number;
  offset: number;
}): Promise<DirectoryPage> {
  const { userId, tenantId, search, limit, offset } = input;
  // Check the database on every request: cached membership resolution can outlive revocation.
  const eligible = await query(
    `SELECT 1 FROM tenant_memberships tm
       JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
       JOIN extensions caller ON caller.tenant_id = tm.tenant_id
         AND caller.user_id = tm.user_id AND caller.type = 'user'
         AND caller.status = 'active' AND caller.deleted_at IS NULL
       JOIN user_extensions cue ON cue.extension_id = caller.id AND cue.user_id = tm.user_id
      WHERE tm.user_id = $1 AND tm.tenant_id = $2 AND tm.status = 'active'
      LIMIT 1`,
    [userId, tenantId],
  );
  if (eligible.rows.length !== 1) throw new TRPCError({ code: "FORBIDDEN" });

  // Repeat authorization inside the listing statement to prevent a revocation
  // between the two reads from releasing directory rows. No SIP data is selected.
  const escaped = search.replace(/[\\%_]/g, "\\$&");
  const result = await query<{ id: number; name: string; number: string }>(
    `WITH authorized AS (
       SELECT 1 FROM tenant_memberships tm
         JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
         JOIN extensions caller ON caller.tenant_id = tm.tenant_id
           AND caller.user_id = tm.user_id AND caller.type = 'user'
           AND caller.status = 'active' AND caller.deleted_at IS NULL
         JOIN user_extensions cue ON cue.extension_id = caller.id AND cue.user_id = tm.user_id
        WHERE tm.user_id = $1 AND tm.tenant_id = $2 AND tm.status = 'active'
        LIMIT 1
     )
     SELECT e.id, COALESCE(NULLIF(BTRIM(e.display_name), ''), NULLIF(BTRIM(u.name), ''), e.extension_number) AS name,
            e.extension_number AS number
       FROM extensions e
       JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = e.user_id
       JOIN tenant_memberships member ON member.user_id = e.user_id
         AND member.tenant_id = e.tenant_id AND member.status = 'active'
       JOIN authorized ON TRUE
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.tenant_id = $2 AND e.type = 'user' AND e.status = 'active'
        AND e.deleted_at IS NULL AND e.extension_number ~ '^[0-9]{1,32}$'
        AND ($3 = '' OR COALESCE(NULLIF(BTRIM(e.display_name), ''), NULLIF(BTRIM(u.name), ''), e.extension_number)
             ILIKE $3 ESCAPE '\\' OR e.extension_number ILIKE $3 ESCAPE '\\')
      ORDER BY e.extension_number, e.id
      LIMIT $4 OFFSET $5`,
    [userId, tenantId, search ? `%${escaped}%` : "", limit + 1, offset],
  );
  const hasMore = result.rows.length > limit;
  return {
    tenantId,
    items: result.rows.slice(0, limit).map(row => ({ id: row.id, name: row.name, number: row.number })),
    nextOffset: hasMore ? offset + limit : null,
  };
}
