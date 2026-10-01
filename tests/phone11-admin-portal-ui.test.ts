import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_WEEK,
  businessHoursFromRules,
  buildBusinessHoursRule,
  buildScheduleRules,
  describeSchedule,
  isValidBusinessHours,
  isValidScheduleDate,
  isValidScheduleTimezone,
  parseEditableScheduleRules,
  validateEditableSchedule,
} from "../lib/pbx/admin-schedules";

describe("enterprise PBX admin schedules", () => {
  it("builds a Monday to Friday rule using the PBX day numbering", () => {
    expect(BUSINESS_WEEK).toEqual([1, 2, 3, 4, 5]);
    expect(buildBusinessHoursRule("09:00", "18:00")).toEqual({
      day_of_week: [1, 2, 3, 4, 5],
      start_time: "09:00",
      end_time: "18:00",
      is_holiday: false,
      label: "Monday to Friday",
      sort_order: 0,
    });
  });

  it("rejects malformed and reversed office hours", () => {
    expect(isValidBusinessHours("9:00", "18:00")).toBe(false);
    expect(isValidBusinessHours("18:00", "09:00")).toBe(false);
    expect(() => buildBusinessHoursRule("24:00", "25:00")).toThrow();
  });

  it("loads editable weekday hours from persisted rules with SQL time precision", () => {
    expect(
      businessHoursFromRules([
        {
          day_of_week: [1, 2, 3, 4, 5],
          start_time: "08:30:00",
          end_time: "17:15:00",
        },
      ]),
    ).toEqual({ startTime: "08:30", endTime: "17:15" });
    expect(
      businessHoursFromRules([
        { day_of_week: [0], start_time: "09:00", end_time: "17:00" },
      ]),
    ).toEqual({ startTime: "09:00", endTime: "18:00" });
  });

  it("round trips multiple daily ranges and holiday closures from persisted PBX rules", () => {
    const persisted = [
      { id: 1, time_condition_id: 4, day_of_week: [1, 2, 3, 4, 5], start_time: "09:00:00", end_time: "12:00:00", start_date: null, end_date: null, is_holiday: false, label: "Morning", sort_order: 0 },
      { id: 2, time_condition_id: 4, day_of_week: [1, 2, 3, 4, 5], start_time: "13:00:00", end_time: "18:00:00", start_date: null, end_date: null, is_holiday: false, label: "Afternoon", sort_order: 1 },
      { id: 3, time_condition_id: 4, day_of_week: null, start_time: null, end_time: null, start_date: "2026-12-31", end_date: "2027-01-02", is_holiday: true, label: "New Year", sort_order: 2 },
    ];
    const parsed = parseEditableScheduleRules(persisted);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schedule.intervals).toEqual([
      { startTime: "09:00", endTime: "12:00", label: "Morning" },
      { startTime: "13:00", endTime: "18:00", label: "Afternoon" },
    ]);
    expect(parsed.schedule.holidays).toEqual([{ startDate: "2026-12-31", endDate: "2027-01-02", label: "New Year" }]);
    expect(buildScheduleRules(parsed.schedule)).toMatchObject([
      { start_time: "09:00", end_time: "12:00", label: "Morning", is_holiday: false },
      { start_time: "13:00", end_time: "18:00", label: "Afternoon", is_holiday: false },
      { start_date: "2026-12-31", end_date: "2027-01-02", label: "New Year", is_holiday: true },
    ]);
  });

  it("blocks unsupported persisted rules and invalid calendar/timezone inputs", () => {
    expect(parseEditableScheduleRules([{ day_of_week: [0, 6], start_time: "09:00:00", end_time: "18:00:00" }]).ok).toBe(false);
    expect(parseEditableScheduleRules([{ day_of_week: [1, 2, 3, 4, 5], start_time: "09:00:00", end_time: "18:00:00", future_field: "keep" }]).ok).toBe(false);
    expect(isValidScheduleDate("2026-02-29")).toBe(false);
    expect(isValidScheduleDate("2028-02-29")).toBe(true);
    expect(isValidScheduleTimezone("Asia/Bangkok")).toBe(true);
    expect(isValidScheduleTimezone("Mars/Olympus")).toBe(false);
    expect(validateEditableSchedule({ intervals: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "12:00", endTime: "18:00" }], holidays: [] })).toMatch(/overlap/);
  });

  it("preserves date-limited weekday ranges and permits separate seasonal windows", () => {
    const parsed = parseEditableScheduleRules([
      { day_of_week: [1, 2, 3, 4, 5], start_time: "09:00:00", end_time: "18:00:00", start_date: "2026-06-01", end_date: "2026-08-31", is_holiday: false, label: "Summer" },
      { day_of_week: [1, 2, 3, 4, 5], start_time: "09:00:00", end_time: "18:00:00", start_date: "2026-09-01", end_date: "2026-12-31", is_holiday: false, label: "Autumn" },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateEditableSchedule(parsed.schedule)).toBeUndefined();
    expect(buildScheduleRules(parsed.schedule)).toMatchObject([
      { start_date: "2026-06-01", end_date: "2026-08-31", label: "Summer" },
      { start_date: "2026-09-01", end_date: "2026-12-31", label: "Autumn" },
    ]);
  });

  it("describes open and closed routing without inventing destinations", () => {
    expect(
      describeSchedule({
        match_action: "transfer",
        match_target: "300",
        nomatch_action: "voicemail",
        nomatch_target: "399",
      }),
    ).toEqual({ open: "transfer 300", closed: "voicemail 399" });
    expect(describeSchedule({ nomatch_action: "hangup" }).closed).toBe(
      "hangup",
    );
  });
});

// These are source-contract checks; rendered UI acceptance is separate.
describe("enterprise PBX admin screen source contracts", () => {
  const ivr = readFileSync(resolve(process.cwd(), "app/admin/ivr.tsx"), "utf8");
  const schedules = readFileSync(
    resolve(process.cwd(), "app/admin/schedules.tsx"),
    "utf8",
  );
  const dashboard = readFileSync(
    resolve(process.cwd(), "app/admin/index.tsx"),
    "utf8",
  );
  const analytics = readFileSync(
    resolve(process.cwd(), "app/admin/analytics.tsx"),
    "utf8",
  );
  const settings = readFileSync(
    resolve(process.cwd(), "app/(tabs)/settings.tsx"),
    "utf8",
  );

  it("loads and mutates IVR menus through tenant-scoped hooks", () => {
    expect(ivr).toContain("useIvrMenus(tenantId, ivrAvailable)");
    expect(ivr).toContain("capabilitiesQuery.data?.ivr === true");
    expect(ivr).toContain("if (!ivrAvailable)");
    expect(ivr).toContain("useCreateIvrMenu()");
    expect(ivr).toContain("useDeleteIvrMenu()");
    expect(ivr).not.toContain("MOCK_FLOWS");
    expect(ivr).not.toContain("Deployed to FreeSWITCH successfully");
  });

  it("creates and edits business hours through tenant-scoped PBX APIs", () => {
    expect(schedules).toContain("useTimeConditions(tenantId, businessHoursAvailable)");
    expect(schedules).toContain("capabilitiesQuery.data?.businessHours === true");
    expect(schedules).toContain("if (!businessHoursAvailable)");
    expect(schedules).toContain("useTimeCondition(editingId ?? 0, businessHoursAvailable)");
    expect(schedules).toContain("useCreateTimeCondition()");
    expect(schedules).toContain("useUpdateTimeCondition()");
    expect(schedules).toContain("useSetTimeConditionRules()");
    expect(schedules).toContain("useDeleteTimeCondition()");
    expect(schedules).toContain("Edit business hours");
    expect(schedules).toContain("Save changes");
    expect(schedules).toContain("void schedulesQuery.refetch().catch");
    expect(schedules).not.toMatch(/MOCK_|Math\.random/);
    expect(schedules).toContain("CONFIGURED");
    expect(schedules).not.toContain(">ACTIVE<");
  });

  it("links business hours from the admin dashboard", () => {
    expect(dashboard).toContain('label: "Business Hours"');
    expect(dashboard).toContain('route: "/admin/schedules"');
  });

  it("does not claim PBX infrastructure is online without telemetry", () => {
    expect(dashboard).not.toContain("SYSTEM HEALTH");
    expect(dashboard).not.toContain("Kamailio SIP Proxy");
    expect(dashboard).not.toContain('status: "online"');
  });

  it("shows only implemented, source-backed management destinations", () => {
    expect(dashboard).not.toContain('route: "/admin/call-history"');
    expect(dashboard).toContain('route: "/admin/voicemail"');
    expect(dashboard).not.toContain('route: "/admin/live-calls"');
    expect(dashboard).not.toContain('route: "/admin/settings"');
    expect(dashboard).toContain('label: "Call analytics"');
    expect(dashboard).toContain('route: "/admin/analytics"');
    expect(dashboard).toContain('label: "People"');
    expect(dashboard).toContain('route: "/admin/users"');
    expect(dashboard).toContain('label: "Extensions"');
    expect(dashboard).toContain('route: "/admin/extensions"');
  });

  it("renders CDR-backed analytics without claiming live PBX data", () => {
    expect(analytics).toContain("usePbxCallAnalytics(period)");
    expect(analytics).toContain('value: "today"');
    expect(analytics).toContain('value: "week"');
    expect(analytics).toContain('value: "month"');
    expect(analytics).toContain("Hourly distribution");
    expect(analytics).toContain("Top callers");
    expect(analytics).toContain("Top destinations");
    expect(analytics).toContain("RefreshControl");
    expect(analytics).toContain("Call analytics could not be loaded.");
    expect(analytics).toContain("No recorded calls for this period.");
    expect(analytics).toContain("may update after call processing");
    expect(analytics).not.toContain("UnavailableAdminScreen");
    expect(analytics).not.toMatch(/MOCK_|Math\.random|All systems operational/);
  });

  it("does not present demo users or system health as live data", () => {
    const unavailable = readFileSync(
      resolve(process.cwd(), "components/admin/unavailable-admin-screen.tsx"),
      "utf8",
    );

    const system = readFileSync(
      resolve(process.cwd(), "app/admin/system.tsx"),
      "utf8",
    );
    expect(system).toContain("UnavailableAdminScreen");
    expect(system).not.toMatch(
      /MOCK_USERS|Math\.random|All systems operational/,
    );

    expect(unavailable).toContain("Not available for this workspace");
    expect(unavailable).toContain("live workspace capability");
    expect(unavailable).toContain("router.back()");
  });

  it("offers workspace administration only to owner or admin memberships", () => {
    expect(settings).toContain('["owner", "admin"].includes');
    expect(settings).toContain('router.push("/admin")');
    expect(settings).toContain("canManageWorkspace && row");
  });

  it("does not render dashboard data before sign-in and workspace authorization resolve", () => {
    expect(dashboard).toContain("useAuth({ autoFetch: false })");
    expect(dashboard).toContain("useTenant(Boolean(user))");
    expect(dashboard).toContain("Sign in to use workspace administration");
    expect(dashboard).toContain("Checking workspace access");
    expect(dashboard).toContain("Workspace administration is unavailable");
    expect(dashboard).toContain(
      "Only workspace owners and administrators can open this area.",
    );
    expect(dashboard).toContain('router.replace(portalSignInRoute("/admin"))');
  });
});
