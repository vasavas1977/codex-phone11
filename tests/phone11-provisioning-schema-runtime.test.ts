import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { assertPhoneProvisioningSchema, phoneProvisioningColumns } from "../server/pbx/phone-provisioning-schema";

function database(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("runtime provisioning schema validation", () => {
  it("uses one read-only catalog query without requesting migration rights", async () => {
    const db = database();
    await assertPhoneProvisioningSchema(db as never);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql.trim()).toMatch(/^WITH expected AS/);
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT)\b/i);
    expect(sql).toContain("ns.nspname = 'public'");
    expect(sql).toContain("pg_catalog.to_regclass(expected.table_name) IS DISTINCT FROM relation.oid");
    expect(sql).toContain("attribute.atttypid <> expected.type_oid");
    expect(sql).toContain("NOT attribute.attisdropped");
    const wanted = JSON.parse(params[0]);
    expect(new Set(wanted.map((r: { table_name: string }) => r.table_name)))
      .toEqual(new Set(["subscriber", "organizations", "tenants", "extensions", "user_extensions", "sip_accounts", "did_numbers"]));
    expect(wanted).toContainEqual({ table_name: "sip_accounts", column_name: "secret_ciphertext", type_oid: 17 });
    expect(phoneProvisioningColumns.extensions.tenant_id).toBe(23);
  });

  it("refuses catalog violations without repairing production schema", async () => {
      const db = database([{ table_name: "extensions", column_name: "tenant_id" }]);
      await expect(assertPhoneProvisioningSchema(db as never)).rejects.toMatchObject({
        code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE",
      });
      expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("preserves database failure instead of treating it as an empty result", async () => {
    const error = Object.assign(new Error("catalog unavailable"), { code: "08006" });
    const db = { query: vi.fn().mockRejectedValue(error) };
    await expect(assertPhoneProvisioningSchema(db as never)).rejects.toBe(error);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("removes the legacy request-path DDL and retains retry on failed validation", () => {
    const source = readFileSync(new URL("../server/phone-provisioning.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bCREATE TABLE\b|\bALTER TABLE\b/);
    expect(source).toContain("schemaReady = assertPhoneProvisioningSchema(db).catch");
    expect(source).toContain("schemaReady = null;");
  });
});
