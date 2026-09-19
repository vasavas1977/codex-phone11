import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const members = readFileSync(
  resolve(process.cwd(), "app/admin/users.tsx"),
  "utf8",
);
const hooks = readFileSync(
  resolve(process.cwd(), "hooks/use-pbx-admin.ts"),
  "utf8",
);
const router = readFileSync(
  resolve(process.cwd(), "server/pbx/pbx-router.ts"),
  "utf8",
);

describe("workspace member administration", () => {
  it("uses the tenant-scoped member directory and mutation hooks", () => {
    expect(members).toContain("useTenantMembers(tenantQuery.isSuccess && canManage)");
    expect(members).toContain("useUpdateTenantMember()");
    expect(hooks).toContain("trpc.pbx.tenant.members.useQuery");
    expect(hooks).toContain("trpc.pbx.tenant.updateMember.useMutation");
    expect(members).not.toMatch(/MOCK_|Math\.random|demo user/i);
  });

  it("keeps invitations unavailable until a verified delivery path exists", () => {
    expect(members).toContain("Invitations are not available yet");
    expect(members).toContain("verified invitation delivery service");
    expect(router).toMatch(
      /adding a\s+\* person needs an identity-verification and invitation-delivery service/,
    );
    expect(router).not.toMatch(/updateMember[\s\S]{0,4000}INSERT INTO users/);
    expect(router).not.toMatch(/updateMember[\s\S]{0,4000}INSERT INTO tenant_memberships/);
  });

  it("makes membership limits visible before a destructive status change", () => {
    expect(members).toContain("Deactivate membership?");
    expect(members).toContain("do not suspend SIP credentials or remove");
    expect(members).toContain("extension assignments. Manage extensions separately.");
    expect(members).toContain("Only a workspace owner can change administrator roles.");
    expect(members).toContain("setRoleChanged(true);");
  });

  it("provides a back action, search, status, role and extension context", () => {
    expect(members).toContain('accessibilityLabel="Back to admin portal"');
    expect(members).toContain('accessibilityLabel="Search people"');
    expect(members).toContain("assigned_extension_numbers");
    expect(members).toContain("Workspace role");
    expect(members).toContain("Membership status");
  });
});
