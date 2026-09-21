import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const hooks = read("hooks/use-pbx-admin.ts");
const dashboard = read("app/admin/index.tsx");
const phoneNumbers = read("app/admin/dids.tsx");
const portal = read("app/portal/index.tsx");
const portalNumbers = read("app/portal/dids.tsx");
const advancedPages = {
  ivr: read("app/admin/ivr.tsx"),
  ringGroups: read("app/admin/ring-groups.tsx"),
  queues: read("app/admin/queues.tsx"),
  businessHours: read("app/admin/schedules.tsx"),
};

describe("Phone11 management capability gates", () => {
  it("refreshes server-derived capabilities and does not retain them as a usable client cache", () => {
    expect(hooks).toContain("trpc.pbx.capabilities.useQuery");
    expect(hooks).toContain("staleTime: 0");
    expect(hooks).toContain("gcTime: 0");
    expect(hooks).toContain('refetchOnMount: "always"');
  });

  it("prevents every optional administration list/detail query until its facility is available", () => {
    for (const hook of [
      "useIvrMenus",
      "useIvrMenu",
      "useRingGroups",
      "useRingGroup",
      "useCallQueues",
      "useCallQueue",
      "useTimeConditions",
      "useTimeCondition",
    ]) {
      expect(hooks).toMatch(
        new RegExp(`function ${hook}[\\s\\S]*?enabled: [^\\n]*&& enabled`),
      );
    }
    expect(phoneNumbers).toContain("routeDestinationsEnabled && capabilitiesQuery.data?.ringGroups === true");
    expect(phoneNumbers).toContain("routeDestinationsEnabled && capabilitiesQuery.data?.queues === true");
    expect(phoneNumbers).toContain("routeDestinationsEnabled && capabilitiesQuery.data?.ivr === true");
    expect(phoneNumbers).toContain("routeDestinationsEnabled && capabilitiesQuery.data?.businessHours === true");
  });

  it("replaces false zero and empty number states with explicit unavailable states", () => {
    expect(dashboard).toContain("stats?.phoneNumbersAvailable === true");
    expect(dashboard).toContain('"Not available"');
    expect(phoneNumbers).toContain("Phone number management is unavailable");
    expect(phoneNumbers).toContain("Phone-number inventory and routing actions are unavailable.");
    expect(portal).toContain("phone_numbers_available");
    expect(portal).toContain("Number inventory is not available yet");
    expect(portal).toContain("disabled={!phoneNumbersAvailable}");
    expect(portalNumbers).toContain("Phone numbers are unavailable");
    expect(portalNumbers).toContain("phone_numbers_available");
  });

  it("makes every direct advanced-administration page fail closed before showing create or edit controls", () => {
    for (const [facility, page] of Object.entries(advancedPages)) {
      expect(page).toContain("usePbxCapabilities(tenantQuery.isSuccess)");
      expect(page).toContain("UnavailableAdminScreen");
      expect(page).toContain("This feature is not available for your workspace yet.");
      expect(page).toContain(facility === "businessHours" ? "businessHours === true" : `${facility} === true`);
    }
  });
});
