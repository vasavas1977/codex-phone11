import { describe, expect, it, vi } from "vitest";
import { createConferenceRepository } from "../server/conference/repository";

describe("conference workspace resolution on the production membership schema", () => {
  it("resolves one active workspace without legacy membership columns", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] });
    const repository = createConferenceRepository({ query } as any);

    await expect(repository.scope(9)).resolves.toEqual({ userId: 9, tenantId: 7 });

    expect(query).toHaveBeenCalledWith(
      expect.not.stringContaining("is_default"),
      [9],
    );
    expect(String(query.mock.calls[0][0])).toContain("ORDER BY tm.created_at,tm.tenant_id");
  });

  it.each([
    { rows: [] as Array<{ tenant_id: number }> },
    { rows: [{ tenant_id: 7 }, { tenant_id: 8 }] },
  ])("fails closed when the active workspace is missing or ambiguous", async ({ rows }) => {
    const query = vi.fn().mockResolvedValueOnce({ rows });
    const repository = createConferenceRepository({ query } as any);

    await expect(repository.scope(9)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
