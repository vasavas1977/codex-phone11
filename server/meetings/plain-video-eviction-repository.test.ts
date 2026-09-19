import { describe, expect, it, vi } from "vitest";

import { createPlainVideoEvictionRepository } from "./plain-video-eviction-repository";

const target = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 41,
  userId: 7,
  participantId: "participant_41_7",
};
const key = "plain_video_remove_0001";
const operationRow = {
  id: "32345678-1234-4234-8234-123456789012",
  tenant_id: target.tenantId,
  meeting_id: target.meetingId,
  user_id: target.userId,
  participant_id: target.participantId,
  idempotency_key: key,
  state: "pending",
  provider_eviction_id: null,
  revoke_token_ts: null,
  provider_created_at: null,
  provider_completed_at: null,
};

describe("plain-video eviction repository", () => {
  it("durably revokes the exact tenant member before creating a pending provider operation", async () => {
    let revoked = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT") && sql.includes("phone11_plain_video_eviction_operations")) {
        return { rows: [] };
      }
      if (sql.includes("UPDATE phone11_plain_video_admission_members")) {
        revoked = true;
        return { rows: [{ meeting_id: target.meetingId }] };
      }
      if (sql.includes("INSERT INTO phone11_plain_video_eviction_operations")) {
        return { rows: [operationRow] };
      }
      return { rows: revoked ? [] : [] };
    });
    const transaction = vi.fn(async (fn) => fn({ query }));
    const repository = createPlainVideoEvictionRepository(transaction);

    await expect(repository.begin(target, key)).resolves.toMatchObject({
      id: operationRow.id,
      state: "pending",
      target,
    });
    const sql = query.mock.calls.map(([statement]) => statement as string);
    expect(sql[1]).toContain("SET revoked_at = clock_timestamp()");
    expect(sql[1]).toContain("r.id = $1 AND r.tenant_id = $2");
    expect(sql[1]).toContain("m.user_id = $3 AND m.participant_id = $4");
    expect(sql[2]).toContain("phone11_plain_video_admission_leases");
    expect(sql[2]).toContain("state IN ('pending', 'issued')");
    expect(sql[3]).toContain("phone11_plain_video_eviction_operations");
  });

  it("does not let an idempotency key be reused for another member", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ...operationRow, participant_id: "participant_41_8", user_id: 8 }],
    });
    const repository = createPlainVideoEvictionRepository(async (fn) => fn({ query }));

    await expect(repository.begin(target, key)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
