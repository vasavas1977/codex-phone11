import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");
const portal = read("app/portal/index.tsx");
const numbers = read("app/portal/dids.tsx");
const usage = read("app/portal/usage.tsx");
const forwarding = read("app/portal/forwarding.tsx");
const billing = read("app/portal/billing.tsx");
const support = read("app/portal/support.tsx");
const profile = read("app/portal/profile.tsx");
const voicemail = read("app/portal/voicemail-mgmt.tsx");
const hooks = read("hooks/use-pbx-admin.ts");
const router = read("server/pbx/pbx-router.ts");

describe("Phone11 personal management portal", () => {
  it("uses member-scoped Phone11 data for the supported self-service pages", () => {
    expect(portal).toContain("usePbxSelfService(Boolean(user))");
    expect(numbers).toContain("usePbxSelfService(Boolean(user))");
    expect(usage).toContain("useOwnCallUsage(period, Boolean(user))");
    expect(portal).toContain('router.push("/profile")');
    expect(portal).toContain('router.push("/voicemail")');
    expect(hooks).toContain("trpc.pbx.selfService.overview.useQuery");
    expect(hooks).toContain("trpc.pbx.selfService.usage.useQuery");
    expect(router).toContain("selfService: router");
    expect(router).not.toContain("updatePhoneSettings: protectedProcedure");
  });

  it("does not present sample commercial data or simulated account actions", () => {
    const source = [portal, numbers, usage, forwarding, billing, support].join(
      "\n",
    );
    expect(source).not.toMatch(
      /INV-2026|\$124\.50|CloudPhone11 Subscriber|AVAILABLE_DIDS|USAGE_DATA|TOP_DESTINATIONS|TKT-1238|support@cloudphone11\.com/,
    );
    expect(source).not.toContain("Haptics.notificationAsync");
    expect(billing).toContain(
      "Billing setup is not available for this workspace yet",
    );
    expect(forwarding).toContain("Call forwarding is not available yet");
    expect(support).toContain("Support tickets are not available in Phone11");
  });

  it("keeps supported profile and voicemail flows on their existing guarded routes", () => {
    expect(profile).toContain('<Redirect href="/profile" />');
    expect(voicemail).toContain('<Redirect href="/voicemail" />');
  });
});
