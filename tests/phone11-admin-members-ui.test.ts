import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const members = readFileSync(
  resolve(process.cwd(), "app/admin/users.tsx"),
  "utf8",
);
const invitations = readFileSync(
  resolve(process.cwd(), "components/admin/admin-invitations.tsx"),
  "utf8",
);
const peopleTable = readFileSync(
  resolve(process.cwd(), "components/admin/admin-people-table.tsx"),
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
const extensions = readFileSync(
  resolve(process.cwd(), "app/admin/extensions.tsx"),
  "utf8",
);

describe("workspace member administration", () => {
  it("uses the tenant-scoped member directory and mutation hooks", () => {
    expect(members).toContain(
      "useTenantMembers(tenantQuery.isSuccess && canManage)",
    );
    expect(members).toContain("useUpdateTenantMember()");
    expect(hooks).toContain("trpc.pbx.tenant.members.useQuery");
    expect(hooks).toContain("trpc.pbx.tenant.updateMember.useMutation");
    expect(members).not.toMatch(/MOCK_|Math\.random|demo user/i);
  });

  it("mounts capability-gated invitations without changing existing member management", () => {
    expect(members).toContain("<AdminInvitations");
    expect(members).toContain("workspace.selectedTenantId === tenantId");
    expect(invitations).toContain("client.invitations.availability.query");
    expect(invitations).toContain("Invitations are not available yet");
    expect(router).toMatch(
      /adding a\s+\* person needs an identity-verification and invitation-delivery service/,
    );
    expect(router).not.toMatch(/updateMember[\s\S]{0,4000}INSERT INTO users/);
    expect(router).not.toMatch(
      /updateMember[\s\S]{0,4000}INSERT INTO tenant_memberships/,
    );
  });

  it("makes membership limits visible before a destructive status change", () => {
    expect(members).toContain("Deactivate membership?");
    expect(members).toContain(
      "revokes SIP access for their assigned active extensions",
    );
    expect(members).toContain(
      "removes their permission to use assigned extensions",
    );
    expect(members).toContain("Reactivating membership does not restore");
    expect(members).not.toContain("do not suspend SIP credentials or remove");
    expect(members).toContain(
      "Only a workspace owner can change administrator roles.",
    );
    expect(members).toContain("setRoleChanged(true);");
  });

  it("provides a back action, search, status, role and extension context", () => {
    expect(members).toContain('accessibilityLabel="Back to admin portal"');
    expect(peopleTable).toContain('accessibilityLabel="Search people"');
    expect(peopleTable).toContain('"All roles"');
    expect(peopleTable).toContain('"All status"');
    expect(peopleTable).toContain(
      "Showing {filtered.length} of {members.length}",
    );
    expect(peopleTable).toContain("assigned_extension_numbers");
    expect(members).toContain("Workspace role");
    expect(members).toContain("Membership status");
  });

  it("renders tenant-scoped member photos with initials fallback in member and extension pickers", () => {
    expect(peopleTable).toContain("<ProfileAvatar");
    expect(peopleTable).toContain('member.status === "active"');
    expect(peopleTable).toContain(
      "? member.photoUrl || directoryPhotos.get(member.id)",
    );
    expect(peopleTable).toContain(": null");
    expect(peopleTable).toContain(
      'photoVersion={member.status === "active" ? member.photoVersion : null}',
    );
    expect(members).toContain(
      "const directory = useDirectory(tenantId, tenantQuery.isSuccess && canManage)",
    );
    expect(members).toContain("directory.owner !== user.id");
    expect(members).toContain("directory.requestedTenant !== tenantId");
    expect(members).toContain("directory.workspace?.id !== tenantId");
    expect(peopleTable).toContain("directoryPhotos.get(member.id)");
    expect(members).not.toMatch(
      /directory\.people[\s\S]{0,500}\.find\([^)]*name/,
    );
    expect(extensions).toContain("<ProfileAvatar");
    expect(extensions).toContain("photoUrl={photoUrl}");
    expect(extensions).toContain(
      "const photoUrl = person.photoUrl || directoryPhotos.get(person.id) || null",
    );
    expect(extensions).toContain("directory.owner !== user.id");
    expect(extensions).toContain("directory.requestedTenant !== tenantId");
    expect(extensions).toContain("directory.workspace?.id !== tenantId");
    expect(extensions).toContain("directoryPhotos.get(person.id)");
    expect(router).toContain("profilePhotoDescriptors(");
    expect(router).toContain(
      'row.status === "active" && row.profile_photo_authorized === true',
    );
    expect(router).toContain("FROM user_extensions photo_ue");
  });
});
