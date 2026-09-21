import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_WEEK,
  businessHoursFromRules,
  buildBusinessHoursRule,
  describeSchedule,
  isValidBusinessHours,
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

describe("enterprise PBX admin screens", () => {
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
    expect(ivr).toContain("useIvrMenus(tenantId)");
    expect(ivr).toContain("useCreateIvrMenu()");
    expect(ivr).toContain("useDeleteIvrMenu()");
    expect(ivr).not.toContain("MOCK_FLOWS");
    expect(ivr).not.toContain("Deployed to FreeSWITCH successfully");
  });

  it("creates and edits business hours through tenant-scoped PBX APIs", () => {
    expect(schedules).toContain("useTimeConditions(tenantId)");
    expect(schedules).toContain("useTimeCondition(editingId ?? 0)");
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
    expect(dashboard).not.toContain('route: "/admin/voicemail"');
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

    expect(unavailable).toContain("Not available yet");
    expect(unavailable).toContain("live service");
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
    expect(dashboard).toContain("router.replace(SIGN_IN_ROUTE)");
  });
});
