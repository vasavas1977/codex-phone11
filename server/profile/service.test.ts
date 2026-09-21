import { expect, it, vi } from "vitest";
import { profileUpdateSchema } from "./router";
import { createProfileService, ProfileWorkspaceAccessError } from "./service";
import { getWorkspaceProfileStatuses } from "./status";

const profileRow = {
  user_id: 7,
  manual_availability: null,
  manual_availability_expires_at: null,
  status_text: null,
  status_expires_at: null,
  work_location: null,
};

it("validates timed DND and bounded profile status inputs", () => {
  expect(profileUpdateSchema.safeParse({ tenantId: 4, availability: { value: "dnd" } }).success).toBe(false);
  expect(profileUpdateSchema.safeParse({ tenantId: 4, availability: { value: "dnd", expiresInMinutes: 60 } }).success).toBe(true);
  expect(profileUpdateSchema.safeParse({ tenantId: 4, availability: { value: "busy", expiresInMinutes: 60 } }).success).toBe(false);
  expect(profileUpdateSchema.safeParse({ tenantId: 4, status: { text: "", expiry: "1h" } }).success).toBe(false);
  expect(profileUpdateSchema.safeParse({ tenantId: 4, status: { text: "Reviewing" } }).success).toBe(true);
  expect(profileUpdateSchema.safeParse({ tenantId: 4, status: { text: null } }).success).toBe(true);
  expect(profileUpdateSchema.safeParse({ tenantId: 4, status: { text: "Reviewing", expiry: "week" } }).success).toBe(true);
  expect(profileUpdateSchema.safeParse({ tenantId: 4, status: { text: "x".repeat(281), expiry: "always" } }).success).toBe(false);
});

it("authorizes profile reads through active membership for both caller and colleague", async () => {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: sql.includes("to_regclass") ? [{ relation: "phone11_workspace_profile_status" }] : [profileRow] }));
  const result = await getWorkspaceProfileStatuses({ query } as any, 7, 4, [7, 9]);
  expect(result).toEqual({ capability: "available", rows: [{ userId: 7, manualAvailability: null, manualAvailabilityExpiresAt: null, statusText: null, statusExpiresAt: null, workLocation: null }] });
  const [sql, values] = query.mock.calls[1];
  expect(sql).toContain("authorized_viewer");
  expect(sql).toContain("colleague.status = 'active'");
  expect(values).toEqual([7, 4, [7, 9]]);
});

it("fails closed when a pre-migration deployment has no profile table", async () => {
  const query = vi.fn(async (_sql: string) => ({ rows: [{ relation: null }] }));
  await expect(getWorkspaceProfileStatuses({ query } as any, 7, 4, [7])).resolves.toEqual({ capability: "unavailable", rows: [] });
  expect(query).toHaveBeenCalledOnce();
  expect(query.mock.calls[0][0]).toContain("to_regclass");
});

it("uses a 24-hour Busy expiry and the workspace-local next midnight for Today", async () => {
  const writes: unknown[][] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("membership.user_id") && sql.includes("LIMIT 1")) return { rows: [{ time_zone: "America/New_York" }] };
    if (sql.includes("to_regclass")) return { rows: [{ relation: "phone11_workspace_profile_status" }] };
    if (sql.includes("INSERT INTO phone11_workspace_profile_status")) { writes.push(values ?? []); return { rows: [{ user_id: 7 }] }; }
    return { rows: [profileRow] };
  });
  const busy = createProfileService({ query } as any, () => new Date("2026-09-20T10:00:00Z"));
  await busy.update(7, 4, { availability: { value: "busy" } });
  expect(writes[0][3]).toEqual(new Date("2026-09-21T10:00:00Z"));

  const today = createProfileService({ query } as any, () => new Date("2026-03-08T12:00:00Z"));
  await today.update(7, 4, { status: { text: "Reviewing", expiry: "today" } });
  expect(writes[1][5]).toEqual(new Date("2026-03-09T04:00:00Z"));
});

it("preserves an existing timed status when text changes without a new display time", async () => {
  const existingExpiry = new Date("2026-09-20T11:00:00Z");
  const writes: unknown[][] = [];
  const writeSql: string[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("membership.user_id") && sql.includes("LIMIT 1")) return { rows: [{ time_zone: "Asia/Bangkok" }] };
    if (sql.includes("to_regclass")) return { rows: [{ relation: "phone11_workspace_profile_status" }] };
    if (sql.includes("INSERT INTO phone11_workspace_profile_status")) { writeSql.push(sql); writes.push(values ?? []); return { rows: [{ user_id: 7 }] }; }
    return { rows: [{ ...profileRow, status_text: "In a meeting", status_expires_at: existingExpiry }] };
  });
  const service = createProfileService({ query } as any, () => new Date("2026-09-20T10:00:00Z"));
  await service.update(7, 4, { status: { text: "Meeting moved" } });
  expect(writes[0][4]).toBe("Meeting moved");
  expect(writes[0][5]).toEqual(existingExpiry);
  expect(writes[0][10]).toBe(false);
  expect(writeSql[0]).toContain("ELSE phone11_workspace_profile_status.status_expires_at");

  await service.update(7, 4, { status: { text: null } });
  expect(writes[1][4]).toBeNull();
  expect(writes[1][5]).toBeNull();
  expect(writes[1][10]).toBe(false);
  expect(writeSql[1]).toContain("WHEN EXCLUDED.status_text IS NULL THEN NULL");
});

it("does not write after membership is revoked between the early guard and conflict write", async () => {
  let writeSql = "";
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("membership.user_id") && sql.includes("LIMIT 1")) return { rows: [{ time_zone: "Asia/Bangkok" }] };
    if (sql.includes("to_regclass")) return { rows: [{ relation: "phone11_workspace_profile_status" }] };
    if (sql.includes("INSERT INTO phone11_workspace_profile_status")) { writeSql = sql; return { rows: [] }; }
    return { rows: [profileRow] };
  });
  const service = createProfileService({ query } as any);
  await expect(service.update(7, 4, { workLocation: "office" })).rejects.toBeInstanceOf(ProfileWorkspaceAccessError);
  expect(writeSql).toContain("INSERT INTO phone11_workspace_profile_status");
  expect(writeSql).toContain("SELECT $1, $2");
  expect(writeSql).toContain("WHERE EXISTS");
  expect(writeSql).toContain("membership.status = 'active'");
});

it("writes only the authenticated self in the selected active workspace", async () => {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes("membership.user_id") && sql.includes("LIMIT 1")) return { rows: [{ exists: 1 }] };
    if (sql.includes("to_regclass")) return { rows: [{ relation: "phone11_workspace_profile_status" }] };
    if (sql.includes("INSERT INTO phone11_workspace_profile_status")) return { rows: [{ user_id: 7 }] };
    return { rows: [profileRow] };
  });
  const service = createProfileService({ query } as any, () => new Date("2026-09-20T10:00:00Z"));
  await service.update(7, 4, { availability: { value: "dnd", expiresInMinutes: 60 }, workLocation: "remote" });
  const write = query.mock.calls.find((call) => call[0].includes("INSERT INTO phone11_workspace_profile_status"));
  expect(write?.[1]?.slice(0, 2)).toEqual([4, 7]);
  expect(write?.[1]).not.toContain(9);
});

it("refuses a self update after membership is removed", async () => {
  const service = createProfileService({ query: vi.fn(async () => ({ rows: [] })) } as any);
  await expect(service.update(7, 4, { workLocation: "office" })).rejects.toBeInstanceOf(ProfileWorkspaceAccessError);
});

it("adds the current tenant-scoped photo descriptor to profile self", async () => {
  const version = "11111111-1111-4111-8111-111111111111";
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("membership.user_id") && sql.includes("LIMIT 1")) return { rows: [{ time_zone: "Asia/Bangkok" }] };
    if (sql.includes("to_regclass('public.phone11_workspace_profile_status')")) return { rows: [{ relation: "phone11_workspace_profile_status" }] };
    if (sql.includes("to_regclass('public.phone11_workspace_profile_photos')")) return { rows: [{ photos: "phone11_workspace_profile_photos", deletions: "phone11_profile_photo_deletions" }] };
    if (sql.includes("FROM phone11_workspace_profile_photos")) return { rows: [{ tenant_id: 4, user_id: 7, version, mime_type: "image/png" }] };
    return { rows: [profileRow] };
  });
  await expect(createProfileService({ query } as any).self(7, 4)).resolves.toMatchObject({
    userId: 7,
    photoVersion: version,
    photoUrl: `/api/profile/photo/4/7?v=${version}`,
  });
});
