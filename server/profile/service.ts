import type { Pool } from "pg";
import {
  getWorkspaceProfileStatuses,
  type ManualAvailability,
  type ProfileStatusDb,
  type WorkLocation,
  type WorkspaceProfileStatus,
} from "./status";
import { profilePhotoDescriptors } from "./photo";

export const dndDurationMinutes = [20, 60, 240, 480, 1440] as const;
export type DndDurationMinutes = (typeof dndDurationMinutes)[number];
export const statusExpiryPresets = ["1h", "4h", "today", "week", "always"] as const;
export type StatusExpiryPreset = (typeof statusExpiryPresets)[number];

export type ProfileUpdate = {
  availability?: { value: ManualAvailability | null; expiresInMinutes?: DndDurationMinutes };
  status?: { text: string | null; expiry?: StatusExpiryPreset };
  workLocation?: WorkLocation | null;
};

export class ProfileStatusUnavailableError extends Error {}
export class ProfileWorkspaceAccessError extends Error {}

function supportedTimeZone(value: unknown): string {
  const timeZone = typeof value === "string" && value.trim() ? value.trim() : "Asia/Bangkok";
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); return timeZone; }
  catch { return "Asia/Bangkok"; }
}

function nextDayInTimeZone(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const read = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const target = Date.UTC(read("year"), read("month") - 1, read("day") + 1);
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  // A local midnight can have a different UTC offset than UTC midnight on a
  // daylight-saving transition. Resolve the local wall time iteratively.
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const localParts = local.formatToParts(new Date(candidate));
    const localPart = (type: string) => Number(localParts.find(part => part.type === type)?.value);
    const observed = Date.UTC(localPart("year"), localPart("month") - 1, localPart("day"), localPart("hour"), localPart("minute"), localPart("second"));
    const correction = target - observed;
    if (correction === 0) break;
    candidate += correction;
  }
  return new Date(candidate);
}

function nextStatusExpiry(now: Date, preset: StatusExpiryPreset, timeZone: string): Date | null {
  if (preset === "always") return null;
  if (preset === "1h") return new Date(now.getTime() + 60 * 60_000);
  if (preset === "4h") return new Date(now.getTime() + 4 * 60 * 60_000);
  if (preset === "week") return new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  return nextDayInTimeZone(now, timeZone);
}

function normalizeStatusText(value: string | null): string | null {
  const text = value?.trim() ?? "";
  return text || null;
}

export type ProfileServiceDb = ProfileStatusDb & Pick<Pool, "query">;

export function createProfileService(db: ProfileServiceDb, now: () => Date = () => new Date()) {
  async function requireWorkspaceMember(userId: number, tenantId: number): Promise<{ timeZone: string }> {
    const result = await db.query(
      `SELECT COALESCE(NULLIF(settings.business_hours_timezone, ''), 'Asia/Bangkok') AS time_zone
         FROM tenant_memberships membership
         JOIN tenants tenant ON tenant.id = membership.tenant_id AND tenant.status = 'active'
         LEFT JOIN tenant_settings settings ON settings.tenant_id = tenant.id
        WHERE membership.user_id = $1
          AND membership.tenant_id = $2
          AND membership.status = 'active'
        LIMIT 1`,
      [userId, tenantId],
    );
    if (!result.rows[0]) throw new ProfileWorkspaceAccessError("Workspace access is unavailable.");
    return { timeZone: supportedTimeZone(result.rows[0].time_zone) };
  }

  async function lookup(userId: number, tenantId: number, userIds: readonly number[]) {
    const result = await getWorkspaceProfileStatuses(db, userId, tenantId, userIds);
    if (result.capability === "unavailable") throw new ProfileStatusUnavailableError("Profile status is unavailable.");
    return result.rows;
  }

  const self = async (userId: number, tenantId: number): Promise<WorkspaceProfileStatus & { photoUrl: string | null; photoVersion: string | null }> => {
    await requireWorkspaceMember(userId, tenantId);
    const row = (await lookup(userId, tenantId, [userId]))[0];
    if (!row) throw new ProfileWorkspaceAccessError("Workspace access is unavailable.");
    const photo = (await profilePhotoDescriptors(db, tenantId, [userId])).get(userId);
    return { ...row, photoUrl: photo?.photoUrl ?? null, photoVersion: photo?.photoVersion ?? null };
  };

  return {
    self,

    async colleagues(userId: number, tenantId: number, userIds: readonly number[]): Promise<Array<WorkspaceProfileStatus & { photoUrl: string | null; photoVersion: string | null }>> {
      await requireWorkspaceMember(userId, tenantId);
      const rows = await lookup(userId, tenantId, userIds);
      const photos = await profilePhotoDescriptors(db, tenantId, rows.map(row => row.userId));
      return rows.map(row => ({ ...row, photoUrl: photos.get(row.userId)?.photoUrl ?? null,
        photoVersion: photos.get(row.userId)?.photoVersion ?? null }));
    },

    async update(userId: number, tenantId: number, input: ProfileUpdate): Promise<WorkspaceProfileStatus> {
      const workspace = await requireWorkspaceMember(userId, tenantId);
      const current = (await lookup(userId, tenantId, [userId]))[0];
      if (!current) throw new ProfileWorkspaceAccessError("Workspace access is unavailable.");
      const writtenAt = now();
      const availability = input.availability
        ? input.availability.value
        : current.manualAvailability;
      const availabilityExpiresAt = input.availability
        ? input.availability.value === "dnd"
          ? new Date(writtenAt.getTime() + Number(input.availability.expiresInMinutes) * 60_000)
          : input.availability.value === "busy"
            ? new Date(writtenAt.getTime() + 24 * 60 * 60_000)
          : null
        : current.manualAvailabilityExpiresAt;
      const statusText = input.status
        ? normalizeStatusText(input.status.text)
        : current.statusText;
      const statusExpiresAt = input.status
        ? !statusText
          ? null
          : input.status.expiry === undefined
            ? current.statusExpiresAt
            : nextStatusExpiry(writtenAt, input.status.expiry, workspace.timeZone)
        : current.statusExpiresAt;
      const workLocation = input.workLocation === undefined ? current.workLocation : input.workLocation;

      try {
        const written = await db.query(
          `INSERT INTO phone11_workspace_profile_status
             (tenant_id, user_id, manual_availability, manual_availability_expires_at,
              status_text, status_expires_at, work_location, updated_at)
           SELECT $1, $2, $3, $4, $5, $6, $7, clock_timestamp()
             FROM tenant_memberships membership
             JOIN tenants tenant ON tenant.id = membership.tenant_id AND tenant.status = 'active'
            WHERE membership.tenant_id = $1
              AND membership.user_id = $2
              AND membership.status = 'active'
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET
             manual_availability = CASE WHEN $8 THEN EXCLUDED.manual_availability ELSE phone11_workspace_profile_status.manual_availability END,
             manual_availability_expires_at = CASE WHEN $8 THEN EXCLUDED.manual_availability_expires_at ELSE phone11_workspace_profile_status.manual_availability_expires_at END,
             status_text = CASE WHEN $9 THEN EXCLUDED.status_text ELSE phone11_workspace_profile_status.status_text END,
             status_expires_at = CASE
               WHEN NOT $9 THEN phone11_workspace_profile_status.status_expires_at
               WHEN EXCLUDED.status_text IS NULL THEN NULL
               WHEN $11 THEN EXCLUDED.status_expires_at
               ELSE phone11_workspace_profile_status.status_expires_at
             END,
             work_location = CASE WHEN $10 THEN EXCLUDED.work_location ELSE phone11_workspace_profile_status.work_location END,
             updated_at = clock_timestamp()
           WHERE EXISTS (
             SELECT 1 FROM tenant_memberships membership
              JOIN tenants tenant ON tenant.id = membership.tenant_id AND tenant.status = 'active'
              WHERE membership.tenant_id = $1 AND membership.user_id = $2 AND membership.status = 'active'
           )
           RETURNING user_id`,
          [tenantId, userId, availability, availabilityExpiresAt, statusText, statusExpiresAt, workLocation,
            input.availability !== undefined, input.status !== undefined, input.workLocation !== undefined,
            input.status?.expiry !== undefined],
        );
        if (!written.rows[0]) throw new ProfileWorkspaceAccessError("Workspace access is unavailable.");
      } catch (error) {
        if (error && typeof error === "object" && (error as { code?: unknown }).code === "42P01") {
          throw new ProfileStatusUnavailableError("Profile status is unavailable.");
        }
        throw error;
      }
      return self(userId, tenantId);
    },
  };
}
