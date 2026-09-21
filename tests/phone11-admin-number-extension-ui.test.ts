import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const extensions = readFileSync(
  resolve(process.cwd(), "app/admin/extensions.tsx"),
  "utf8",
);
const phoneNumbers = readFileSync(
  resolve(process.cwd(), "app/admin/dids.tsx"),
  "utf8",
);
const hooks = readFileSync(
  resolve(process.cwd(), "hooks/use-pbx-admin.ts"),
  "utf8",
);
const pbxRouter = readFileSync(
  resolve(process.cwd(), "server/pbx/pbx-router.ts"),
  "utf8",
);

describe("enterprise extension administration", () => {
  it("loads the active workspace through tenant-scoped PBX hooks", () => {
    expect(extensions).toContain("useTenant()");
    expect(extensions).toContain("useExtensions(");
    expect(extensions).toContain("tenantQuery.isSuccess && canManage");
    expect(extensions).not.toContain("orgId");
    expect(extensions).not.toContain("trpc.phone.");
    expect(extensions).not.toMatch(/MOCK_|Phone11 Test User/);
  });

  it("creates validated extensions and assigns them through tenant-scoped APIs", () => {
    expect(extensions).toContain("useCreateExtension()");
    expect(extensions).toContain("useUpdateExtension()");
    expect(extensions).toContain("useTenantPeople(tenantQuery.isSuccess && canManage)");
    expect(extensions).toContain("/^\\d{2,10}$/");
    expect(extensions).toContain('type: "user"');
    expect(extensions).toContain("userId: selectedPersonId");
    expect(extensions).toContain("setSelectedPersonId(null);");
    expect(extensions).toContain("Currently assigned:");
    expect(extensions).toContain("Assignment updates workspace source state only.");
    expect(extensions).toContain(
      "You can assign the new extension to an active workspace person",
    );
  });

  it("closes successful assignment editing before best-effort refresh and retains failed selections", () => {
    expect(extensions).toContain("closeAssignmentEditor();");
    expect(extensions).toContain(
      "void extensionsQuery.refetch().catch(() => undefined);",
    );
    expect(extensions).toContain("setAssignmentError(errorMessage(error));");
  });

  it("keeps the people directory limited to public identity and active tenant membership", () => {
    expect(hooks).toContain("useTenantPeople");
    expect(pbxRouter).toContain("people: protectedProcedure");
    expect(pbxRouter).toContain("const tc = await getTenantAdminCtx(ctx);");
    expect(pbxRouter).toContain("WHERE tm.tenant_id = $1 AND tm.status = 'active'");
    expect(pbxRouter).toContain("assigned_extension_numbers");
    expect(pbxRouter).not.toMatch(/people:[\s\S]{0,1800}secret_ciphertext/);
    expect(pbxRouter).not.toMatch(/people:[\s\S]{0,1800}sip_password/);
  });

  it("provides live search, assignment filters, and query states", () => {
    expect(extensions).toContain(
      'type ExtensionFilter = "all" | "assigned" | "open"',
    );
    expect(extensions).toContain("extensionsQuery.data?.data");
    expect(extensions).toContain("extensionsQuery.isError");
    expect(extensions).toContain("extensionsQuery.refetch()");
  });
});

describe("enterprise phone-number administration", () => {
  it("lists the active workspace inventory without demo rows", () => {
    expect(phoneNumbers).toContain("useTenant()");
    expect(phoneNumbers).toContain("usePhoneNumbers(");
    expect(phoneNumbers).toContain("tenantQuery.isSuccess && canManage");
    expect(phoneNumbers).toContain("numbersQuery.data?.data");
    expect(phoneNumbers).not.toMatch(/MOCK_|555-0101|DIDww|DIDx/);
  });

  it("edits routes for existing carrier-provisioned numbers without adding acquisition", () => {
    expect(phoneNumbers).not.toContain("useCreatePhoneNumber");
    expect(phoneNumbers).toContain("useAssignPhoneNumberRoute()");
    expect(phoneNumbers).toContain("Call destination");
    expect(phoneNumbers).toContain("Save destination");
    expect(phoneNumbers).toContain("Unassigned");
    for (const route of [
      "Extension",
      "Ring group",
      "Queue",
      "IVR menu",
      "Business hours",
    ]) {
      expect(phoneNumbers).toContain(route);
    }
  });

  it("uses tenant-scoped, active human-labelled route choices and preserves retry state", () => {
    for (const hook of [
      "useExtensions(",
    ]) {
      expect(phoneNumbers).toContain(hook);
    }
    expect(phoneNumbers).toContain("routeDestinationsEnabled && capabilitiesQuery.data?.ringGroups === true");
    expect(phoneNumbers).toContain("routeDestinationsEnabled && capabilitiesQuery.data?.queues === true");
    expect(phoneNumbers).toContain("routeDestinationsEnabled && capabilitiesQuery.data?.ivr === true");
    expect(phoneNumbers).toContain("routeDestinationsEnabled && capabilitiesQuery.data?.businessHours === true");
    expect(phoneNumbers).toContain(
      "const routeTenantId = canManage ? tenantId : 0;",
    );
    expect(phoneNumbers).toContain("label: `${name} · ${dialCode}`");
    expect(phoneNumbers).toContain('row.status === "active"');
    expect(phoneNumbers).toContain("!row.deleted_at");
    expect(phoneNumbers).toContain('row.type === "user"');
    expect(phoneNumbers).toContain("Boolean(row.user_id)");
    expect(phoneNumbers).toContain('row.sip_status === "active"');
    expect(phoneNumbers).toContain("Boolean(row.sip_username)");
    expect(phoneNumbers).toContain("Boolean(row.sip_domain)");
    expect(phoneNumbers).toContain("row.is_active !== false");
    expect(phoneNumbers).toContain(
      '["simultaneous", "sequential"].includes(String(row.strategy))',
    );
    expect(phoneNumbers).toContain('row.strategy === "ring_all"');
    expect(phoneNumbers).toContain(
      "Choose an active destination in this workspace.",
    );
    expect(phoneNumbers).toContain("Your selection is still here; try again.");
    expect(phoneNumbers).toContain("closeRouteEditor(true);");
    expect(phoneNumbers).toContain(
      "void numbersQuery.refetch().catch(() => undefined);",
    );
  });

  it("provides live search, route filters, refresh, and error states", () => {
    expect(phoneNumbers).toContain(
      'type NumberFilter = "all" | "assigned" | "unassigned"',
    );
    expect(phoneNumbers).toContain("numbersQuery.isError");
    expect(phoneNumbers).toContain("numbersQuery.refetch()");
    expect(phoneNumbers).toContain("assigned_route_type");
    expect(phoneNumbers).toContain("assigned_route_id");
  });
});

describe("tenant query guards", () => {
  it("lets both directory hooks wait for verified admin membership", () => {
    expect(hooks).toMatch(
      /useExtensions\([\s\S]*?enabled: boolean = true[\s\S]*?\{ enabled, staleTime: 30_000 \}/,
    );
    expect(hooks).toMatch(
      /usePhoneNumbers\([\s\S]*?enabled: boolean = true[\s\S]*?\{ enabled, staleTime: 30_000 \}/,
    );
  });
});
