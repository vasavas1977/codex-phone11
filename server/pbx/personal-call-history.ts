import { TRPCError } from "@trpc/server";
import { query } from "./db";
import { SELF_SERVICE_CALL_OWNERSHIP_SQL } from "../../lib/pbx/self-service-usage";

export type PersonalCallCursor = { startedAt: string; id: number };

/** Completed PBX CDRs owned at call time, for the member's selected workspace. */
export async function listPersonalCallHistory(input: {
  tenantId: number;
  userId: number;
  limit: number;
  cursor?: PersonalCallCursor;
}) {
  const { tenantId, userId, limit, cursor } = input;
  // Memberships are cached elsewhere. A lost assignment or membership must
  // stop access immediately, including when no CDRs match the requested page.
  const eligible = await query(
    `SELECT 1 FROM tenant_memberships tm
       JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
       JOIN extensions e ON e.tenant_id = tm.tenant_id
         AND e.user_id = tm.user_id AND e.type = 'user'
         AND e.status = 'active' AND e.deleted_at IS NULL
       JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = tm.user_id
      WHERE tm.user_id = $1 AND tm.tenant_id = $2 AND tm.status = 'active'
      LIMIT 1`,
    [userId, tenantId],
  );
  if (eligible.rows.length !== 1) throw new TRPCError({ code: "FORBIDDEN" });

  // Repeat the live gate in the CDR read so a revocation between statements
  // cannot release history. The CDR ownership predicate uses only immutable
  // call-time user IDs, never the current extension assignee or a phone number.
  const rows = await query<{
    id: number; call_uuid: string;
    direction: "inbound" | "outbound" | "internal" | "emergency";
    disposition: string;
    caller_number: string; callee_number: string; callback_number: string | null;
    total_duration_seconds: number; started_at: string;
  }>(
    `SELECT cr.id, cr.call_uuid, cr.direction, cr.disposition,
            cr.from_number AS caller_number, cr.to_number AS callee_number,
            CASE WHEN cr.caller_user_id = $2 THEN cr.to_number
                 WHEN cr.callee_user_id = $2 THEN cr.from_number
                 ELSE NULL END AS callback_number,
            cr.total_duration_seconds,
            to_char(cr.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at
       FROM call_records cr
      WHERE cr.tenant_id = $1
        AND cr.ended_at IS NOT NULL AND cr.disposition IS NOT NULL
        AND ${SELF_SERVICE_CALL_OWNERSHIP_SQL}
        AND ($3::timestamptz IS NULL OR (cr.started_at, cr.id) < ($3::timestamptz, $4::integer))
        AND EXISTS (
          SELECT 1 FROM tenant_memberships tm
          JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
          JOIN extensions e ON e.tenant_id = tm.tenant_id
            AND e.user_id = tm.user_id AND e.type = 'user'
            AND e.status = 'active' AND e.deleted_at IS NULL
          JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = tm.user_id
          WHERE tm.user_id = $2 AND tm.tenant_id = $1 AND tm.status = 'active'
        )
      ORDER BY cr.started_at DESC, cr.id DESC
      LIMIT $5`,
    [tenantId, userId, cursor?.startedAt ?? null, cursor?.id ?? null, limit + 1],
  );
  const items = rows.rows.slice(0, limit);
  const last = items.at(-1);
  return {
    tenantId,
    items,
    nextCursor: rows.rows.length > limit && last
      ? { startedAt: last.started_at, id: last.id }
      : null,
  };
}
