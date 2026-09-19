import { describe, expect, it, vi } from "vitest";

import {
  deriveFixtureReferences,
  parseFixtureArguments,
  PlainVideoFixtureInputError,
  PlainVideoFixtureUnavailableError,
  provisionPlainVideoFixture,
} from "../scripts/phone11-plain-video-admission-fixture";

const request = { tenantId: 41, userIds: [7, 8] as const, apply: true };

function mockPool(rows: unknown[] = [{ user_id: 7 }, { user_id: 8 }]) {
  const query = vi.fn().mockResolvedValue({ rows });
  const release = vi.fn();
  return {
    pool: { connect: vi.fn().mockResolvedValue({ query, release }) },
    query,
    release,
  };
}

describe("plain-video admission fixture utility", () => {
  it("requires a tenant and exactly two distinct existing Phone11 user IDs", () => {
    expect(
      parseFixtureArguments([
        "--tenant-id",
        "41",
        "--user-id",
        "7",
        "--user-id",
        "8",
      ]),
    ).toEqual({ ...request, apply: false });
    expect(() =>
      parseFixtureArguments([
        "--tenant-id",
        "41",
        "--user-id",
        "7",
        "--user-id",
        "7",
      ]),
    ).toThrow(PlainVideoFixtureInputError);
    expect(() =>
      parseFixtureArguments(["--tenant-id", "41", "--user-id", "7"]),
    ).toThrow(PlainVideoFixtureInputError);
    expect(() =>
      parseFixtureArguments([
        "--tenant-id",
        "41",
        "--user-id",
        "7",
        "--user-id",
        "8",
        "--apply",
        "--dry-run",
      ]),
    ).toThrow(PlainVideoFixtureInputError);
  });

  it("uses a read-only transaction by default and creates no room or member", async () => {
    const { pool, query, release } = mockPool();
    await expect(
      provisionPlainVideoFixture(pool, { ...request, apply: false }),
    ).resolves.toEqual({ mode: "dry_run", admittedParticipants: 2 });

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = '3s'",
      expect.stringContaining("SELECT u.id AS user_id"),
      "COMMIT",
    ]);
    expect(query.mock.calls.some(([sql]) => /\bINSERT\b/i.test(sql))).toBe(
      false,
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects users without active membership in the requested tenant", async () => {
    const { pool, query, release } = mockPool([{ user_id: 7 }]);
    await expect(
      provisionPlainVideoFixture(pool, request),
    ).rejects.toBeInstanceOf(PlainVideoFixtureUnavailableError);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SET LOCAL statement_timeout = '3s'",
      expect.stringContaining("FOR UPDATE OF t, u, tm, ai"),
      "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects an inactive or missing Phone11 identity before any insert", async () => {
    const { pool, query } = mockPool([]);
    await expect(
      provisionPlainVideoFixture(pool, request),
    ).rejects.toBeInstanceOf(PlainVideoFixtureUnavailableError);
    expect(query.mock.calls.some(([sql]) => /\bINSERT\b/i.test(sql))).toBe(
      false,
    );
  });

  it("fails closed when generated participant references collide", async () => {
    const nextUuid = vi
      .fn()
      .mockReturnValueOnce("12345678-1234-4234-8234-123456789012")
      .mockReturnValueOnce("22345678-1234-4234-8234-123456789012")
      .mockReturnValueOnce("32345678-1234-4234-8234-123456789012")
      .mockReturnValueOnce("42345678-1234-4234-8234-123456789012")
      .mockReturnValueOnce("52345678-1234-4234-8234-123456789012")
      .mockReturnValueOnce("52345678-1234-4234-8234-123456789012");
    const { pool, query } = mockPool();
    await expect(
      provisionPlainVideoFixture(pool, request, nextUuid),
    ).rejects.toBeInstanceOf(PlainVideoFixtureUnavailableError);
    expect(query.mock.calls.some(([sql]) => /\bINSERT\b/i.test(sql))).toBe(
      false,
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("rolls back both writes if the member insert fails", async () => {
    const { pool, query, release } = mockPool();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }, { user_id: 8 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("database write failed"));

    await expect(provisionPlainVideoFixture(pool, request)).rejects.toThrow(
      "database write failed",
    );
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SET LOCAL statement_timeout = '3s'",
      expect.stringContaining("SELECT u.id AS user_id"),
      expect.stringContaining(
        "INSERT INTO phone11_plain_video_admission_rooms",
      ),
      expect.stringContaining(
        "INSERT INTO phone11_plain_video_admission_members",
      ),
      "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("derives opaque valid references without accepting caller room or identity values", () => {
    const uuids = [
      "12345678-1234-4234-8234-123456789012",
      "22345678-1234-4234-8234-123456789012",
      "32345678-1234-4234-8234-123456789012",
      "42345678-1234-4234-8234-123456789012",
      "52345678-1234-4234-8234-123456789012",
      "62345678-1234-4234-8234-123456789012",
    ];
    const references = deriveFixtureReferences(() => uuids.shift()!);
    expect(references.members[0].participantId).toMatch(
      /^[A-Za-z0-9_-]{1,96}$/,
    );
  });
});
