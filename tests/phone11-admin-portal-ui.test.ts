import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_WEEK,
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

  it("creates business hours and rules through the PBX API", () => {
    expect(schedules).toContain("useTimeConditions(tenantId)");
    expect(schedules).toContain("useCreateTimeCondition()");
    expect(schedules).toContain("useSetTimeConditionRules()");
    expect(schedules).toContain("useDeleteTimeCondition()");
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
    expect(dashboard).not.toContain('route: "/admin/users"');
    expect(dashboard).not.toContain('route: "/admin/call-history"');
    expect(dashboard).not.toContain('route: "/admin/voicemail"');
    expect(dashboard).not.toContain('route: "/admin/live-calls"');
    expect(dashboard).not.toContain('route: "/admin/settings"');
    expect(dashboard).not.toContain('route: "/admin/analytics"');
  });

  it("does not present demo users, analytics, or system health as live data", () => {
    const unavailable = readFileSync(
      resolve(process.cwd(), "components/admin/unavailable-admin-screen.tsx"),
      "utf8",
    );

    for (const screen of ["users", "analytics", "system"]) {
      const source = readFileSync(
        resolve(process.cwd(), `app/admin/${screen}.tsx`),
        "utf8",
      );
      expect(source).toContain("UnavailableAdminScreen");
      expect(source).not.toMatch(/MOCK_USERS|Math\.random|All systems operational/);
    }

    expect(unavailable).toContain("Not available yet");
    expect(unavailable).toContain("live service");
    expect(unavailable).toContain("router.back()");
  });

  it("offers workspace administration only to owner or admin memberships", () => {
    expect(settings).toContain('["owner", "admin"].includes');
    expect(settings).toContain('router.push("/admin")');
    expect(settings).toContain("canManageWorkspace && row");
  });
});
