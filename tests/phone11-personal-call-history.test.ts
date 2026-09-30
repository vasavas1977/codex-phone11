import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));

import { listPersonalCallHistory } from "../server/pbx/personal-call-history";

const input = { tenantId: 7, userId: 9, limit: 2 };
const row = (id: number, startedAt: string) => ({
  id, call_uuid: `call-${id}`, direction: "inbound", disposition: "missed",
  caller_number: "+6620000001", callee_number: "3101",
  callback_number: "+6620000001", total_duration_seconds: 0, started_at: startedAt,
});

beforeEach(() => db.query.mockReset());

describe("personal CDR history", () => {
  it("fails closed before CDR read when live assignment or membership is lost", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(listPersonalCallHistory(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).toHaveBeenCalledTimes(1);
    const [gate, values] = db.query.mock.calls[0];
    expect(gate).toContain("tm.status = 'active'");
    expect(gate).toContain("t.status = 'active'");
    expect(gate).toContain("e.status = 'active'");
    expect(gate).toContain("e.deleted_at IS NULL");
    expect(gate).toContain("JOIN user_extensions ue");
    expect(values).toEqual([9, 7]);
  });

  it("uses immutable owner IDs and a bounded, deterministic keyset page", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [
        row(30, "2026-09-29T10:00:00.000002Z"),
        row(29, "2026-09-29T10:00:00.000001Z"),
        row(28, "2026-09-28T10:00:00.000000Z"),
      ] });
    const result = await listPersonalCallHistory(input);
    expect(result).toEqual({
      tenantId: 7,
      items: [row(30, "2026-09-29T10:00:00.000002Z"), row(29, "2026-09-29T10:00:00.000001Z")],
      nextCursor: { startedAt: "2026-09-29T10:00:00.000001Z", id: 29 },
    });
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).toContain("cr.tenant_id = $1");
    expect(sql).toContain("cr.caller_user_id = $2 OR cr.callee_user_id = $2");
    expect(sql).toContain("cl.caller_user_id = $2 OR cl.callee_user_id = $2");
    expect(sql).toContain("cr.ended_at IS NOT NULL");
    expect(sql).toContain("(cr.started_at, cr.id) <");
    expect(sql).toContain("ORDER BY cr.started_at DESC, cr.id DESC");
    expect(sql).toContain("to_char(cr.started_at AT TIME ZONE 'UTC'");
    expect(sql).toContain("CASE WHEN cr.caller_user_id = $2 THEN cr.to_number");
    expect(sql).toContain("WHEN cr.callee_user_id = $2 THEN cr.from_number");
    expect(sql).toContain("ELSE NULL END AS callback_number");
    expect(sql).toContain("tm.status = 'active'");
    expect(sql).not.toMatch(/JOIN user_extensions ue ON ue\.extension_id = cl\.extension_id|cr\.\*|recording_url|sip_password|metadata/);
    expect(values).toEqual([7, 9, null, null, 3]);
  });

  it("passes the prior page cursor and ends without another cursor", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [row(28, "2026-09-28T10:00:00.000000Z")] });
    const cursor = { startedAt: "2026-09-29T10:00:00.000001Z", id: 29 };
    await expect(listPersonalCallHistory({ ...input, cursor })).resolves.toMatchObject({ nextCursor: null });
    expect(db.query.mock.calls[1][1]).toEqual([7, 9, cursor.startedAt, 29, 3]);
  });
});
