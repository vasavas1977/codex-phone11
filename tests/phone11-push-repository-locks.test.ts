import { describe, expect, it, vi } from "vitest";
import { createPushRepository } from "../server/push/repository";
import type { PushToken } from "../server/push-gateway";

const token: PushToken = {
  sessionId: "session-1",
  owner: {
    userId: 1,
    tenantId: 10,
    extensionId: 1,
    sipUri: "sip:1001@test.invalid",
  },
  sipUri: "sip:1001@test.invalid",
  token: "a".repeat(64),
  tokenType: "fcm",
  platform: "android",
  deviceId: "device-a",
  bundleId: "ai.phone11.mobile.staging",
  registeredAt: 0,
};

describe("push registration row locking", () => {
  it("locks the writable auth session without requiring row-lock privilege on assignment tables", async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("SELECT ue.user_id")) return { rows: [{ user_id: 1 }] };
      if (sql.includes("SELECT count(*)")) return { rows: [{ n: 0 }] };
      return { rows: [] };
    });
    const repository = createPushRepository(async (fn) => fn({ query } as any));

    await repository.put(token);

    const assignmentQuery = queries.find((sql) =>
      sql.includes("SELECT ue.user_id"),
    );
    expect(assignmentQuery).toContain("FOR SHARE OF auths");
    expect(assignmentQuery).not.toMatch(
      /FOR SHARE OF[^\n]*\b(?:ue|e|t|sa|ai)\b/,
    );
    expect(
      queries.some((sql) => sql.includes("INSERT INTO phone11_push_devices")),
    ).toBe(true);
  });
});
