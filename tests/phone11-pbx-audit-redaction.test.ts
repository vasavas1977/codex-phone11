import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));

// The audit module must load after the database wrapper is mocked.
// eslint-disable-next-line import/first
import { queryAuditLogs, redactAuditRow, redactAuditValue, writeAuditLog } from "../server/pbx/audit";

beforeEach(() => db.query.mockReset());

describe("PBX audit credential redaction", () => {
  it("scrubs nested credentials from a new audit write", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await writeAuditLog({
      tenantId: 7,
      action: "update",
      resourceType: "extension",
      oldValue: {
        extension_number: "3001",
        sip_password: "old-sip-password",
        nested: { secretCiphertext: "cipher", ha1: "digest", label: "Sales" },
      },
    });

    const values = db.query.mock.calls[0][1];
    const saved = JSON.parse(values[5]);
    expect(saved.extension_number).toBe("3001");
    expect(saved.nested.label).toBe("Sales");
    expect(JSON.stringify(saved)).not.toContain("old-sip-password");
    expect(JSON.stringify(saved)).not.toContain("cipher");
    expect(JSON.stringify(saved)).not.toContain("digest");
  });

  it("scrubs historical JSON payloads before the admin API reads them", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        id: 5,
        tenant_id: 7,
        old_value: JSON.stringify({ sip_password: "legacy-secret", user_id: 9 }),
        new_value: { nested: [{ authToken: "old-token", state: "active" }] },
      }] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    const result = await queryAuditLogs({ tenantId: 7 });
    expect(result.total).toBe(1);
    expect(result.rows[0].old_value.user_id).toBe(9);
    expect(result.rows[0].new_value.nested[0].state).toBe("active");
    expect(JSON.stringify(result.rows)).not.toContain("legacy-secret");
    expect(JSON.stringify(result.rows)).not.toContain("old-token");
  });

  it("does not echo malformed historical payload text", () => {
    const row = redactAuditRow({ old_value: "{sip_password:legacy-secret}" });
    expect(row.old_value).toBe("[redacted]");
    expect(redactAuditRow({ old_value: JSON.stringify("legacy-secret") }).old_value)
      .toBe("[redacted]");
    expect(redactAuditValue(Buffer.from("legacy-secret"))).toBe("[redacted]");
  });
});
