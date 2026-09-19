import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../server/cloud-recordings/migration.sql",
  import.meta.url,
);

describe("cloud recording tenant-pair migration contract", () => {
  it("installs replay-safe database guards for every scoped recording identity", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("phone11_recording_policy_actor_tenant_guard");
    expect(sql).toContain("phone11_recording_tenant_pair_guard");
    expect(sql).toContain("phone11_recording_extension_tenant_immutable");
    expect(sql).toContain("phone11_recording_wake_binding_tenant_immutable");
    expect(sql).toContain("CREATE TRIGGER phone11_cloud_recording_tenant_pair_guard");
    expect(sql).toContain("CREATE TRIGGER phone11_recording_route_tenant_pair_guard");
    expect(sql).toContain("CREATE TRIGGER phone11_recording_wake_link_tenant_pair_guard");
    expect(sql).toContain("DROP TRIGGER IF EXISTS");
    expect(sql).toContain("existing historical rows are left intact");
  });
});
