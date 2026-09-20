import type { Pool } from "pg";

export const manualAvailabilityValues = [
  "available",
  "away",
  "busy",
  "out_of_office",
  "dnd",
] as const;
export type ManualAvailability = (typeof manualAvailabilityValues)[number];
export const workLocationValues = ["office", "remote"] as const;
export type WorkLocation = (typeof workLocationValues)[number];

export type WorkspaceProfileStatus = {
  userId: number;
  manualAvailability: ManualAvailability | null;
  manualAvailabilityExpiresAt: Date | null;
  statusText: string | null;
  statusExpiresAt: Date | null;
  workLocation: WorkLocation | null;
};

export type WorkspaceProfileStatusLookup =
  | { capability: "available"; rows: WorkspaceProfileStatus[] }
  | { capability: "unavailable"; rows: [] };

export type ProfileStatusDb = Pick<Pool, "query">;

function date(value: unknown): Date | null {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

function manualAvailability(value: unknown): ManualAvailability | null {
  return typeof value === "string" && (manualAvailabilityValues as readonly string[]).includes(value)
    ? value as ManualAvailability
    : null;
}

function workLocation(value: unknown): WorkLocation | null {
  return typeof value === "string" && (workLocationValues as readonly string[]).includes(value)
    ? value as WorkLocation
    : null;
}

export function workspaceProfileStatusFromRow(row: Record<string, unknown>): WorkspaceProfileStatus | null {
  const userId = Number(row.user_id);
  if (!Number.isSafeInteger(userId) || userId < 1) return null;
  return {
    userId,
    manualAvailability: manualAvailability(row.manual_availability),
    manualAvailabilityExpiresAt: date(row.manual_availability_expires_at),
    statusText: typeof row.status_text === "string" && row.status_text.trim() ? row.status_text : null,
    statusExpiresAt: date(row.status_expires_at),
    workLocation: workLocation(row.work_location),
  };
}

/**
 * Reads only the profile fields that an active workspace colleague may see.
 * `capability: unavailable` is deliberate: older servers without the separate
 * migration must fall back to automatic presence rather than fail heartbeats.
 */
export async function getWorkspaceProfileStatuses(
  db: ProfileStatusDb,
  viewerUserId: number,
  tenantId: number,
  userIds: readonly number[],
): Promise<WorkspaceProfileStatusLookup> {
  const ids = [...new Set(userIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!Number.isSafeInteger(viewerUserId) || viewerUserId < 1 || !Number.isSafeInteger(tenantId) || tenantId < 1 || ids.length === 0) {
    return { capability: "available", rows: [] };
  }
  // Querying a missing relation inside the caller's existing transaction would
  // abort that transaction even if we caught 42P01. Preflight first instead;
  // no cached negative result means a just-applied migration is picked up.
  const capability = await db.query(
    "SELECT to_regclass('public.phone11_workspace_profile_status') AS relation",
  );
  if (!capability.rows[0]?.relation) return { capability: "unavailable", rows: [] };
  const result = await db.query(
      `WITH authorized_viewer AS (
         SELECT 1
           FROM tenant_memberships membership
           JOIN tenants tenant ON tenant.id = membership.tenant_id AND tenant.status = 'active'
          WHERE membership.tenant_id = $2
            AND membership.user_id = $1
            AND membership.status = 'active'
       ), requested AS (
         SELECT DISTINCT requested_user_id AS user_id
           FROM unnest($3::integer[]) AS requested_user_id
       )
       SELECT requested.user_id,
              CASE WHEN profile.manual_availability_expires_at IS NOT NULL
                          AND profile.manual_availability_expires_at <= clock_timestamp()
                   THEN NULL ELSE profile.manual_availability END AS manual_availability,
              CASE WHEN profile.manual_availability_expires_at IS NOT NULL
                          AND profile.manual_availability_expires_at <= clock_timestamp()
                   THEN NULL ELSE profile.manual_availability_expires_at END AS manual_availability_expires_at,
              CASE WHEN profile.status_expires_at IS NOT NULL
                          AND profile.status_expires_at <= clock_timestamp()
                   THEN NULL ELSE profile.status_text END AS status_text,
              CASE WHEN profile.status_expires_at IS NOT NULL
                          AND profile.status_expires_at <= clock_timestamp()
                   THEN NULL ELSE profile.status_expires_at END AS status_expires_at,
              profile.work_location
         FROM requested
         CROSS JOIN authorized_viewer
         JOIN tenant_memberships colleague
           ON colleague.tenant_id = $2
          AND colleague.user_id = requested.user_id
          AND colleague.status = 'active'
         LEFT JOIN phone11_workspace_profile_status profile
           ON profile.tenant_id = colleague.tenant_id
          AND profile.user_id = colleague.user_id
        ORDER BY requested.user_id`,
      [viewerUserId, tenantId, ids],
    );
  return {
    capability: "available",
    rows: result.rows
      .map((row) => workspaceProfileStatusFromRow(row as Record<string, unknown>))
      .filter((row): row is WorkspaceProfileStatus => row !== null),
  };
}

export async function getWorkspaceProfileStatus(
  db: ProfileStatusDb,
  viewerUserId: number,
  tenantId: number,
  userId: number,
): Promise<WorkspaceProfileStatusLookup> {
  return getWorkspaceProfileStatuses(db, viewerUserId, tenantId, [userId]);
}
