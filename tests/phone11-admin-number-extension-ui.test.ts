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

describe("enterprise extension administration", () => {
  it("loads the active workspace through tenant-scoped PBX hooks", () => {
    expect(extensions).toContain("useTenant()");
    expect(extensions).toContain("useExtensions(");
    expect(extensions).toContain("tenantQuery.isSuccess && canManage");
    expect(extensions).not.toContain("orgId");
    expect(extensions).not.toContain("trpc.phone.");
    expect(extensions).not.toMatch(/MOCK_|Phone11 Test User/);
  });

  it("creates only validated unassigned extensions", () => {
    expect(extensions).toContain("useCreateExtension()");
    expect(extensions).toContain("/^\\d{2,10}$/");
    expect(extensions).toContain('type: "user"');
    expect(extensions).not.toContain("assignExtension");
    expect(extensions).toContain(
      "The new extension will remain unassigned until the live People",
    );
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

  it("keeps unsupported acquisition and route changes visibly read-only", () => {
    expect(phoneNumbers).toContain("Destinations are read-only");
    expect(phoneNumbers).toContain("after carrier provisioning is connected");
    expect(phoneNumbers).not.toContain("useCreatePhoneNumber");
    expect(phoneNumbers).not.toContain("useAssignPhoneNumberRoute");
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
