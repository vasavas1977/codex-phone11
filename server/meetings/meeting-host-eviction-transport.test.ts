import { describe, expect, it, vi } from "vitest";
import { createConnect11PlainVideoFacade } from "./connect11-plain-video-facade";

const id = "12345678-1234-4234-8234-123456789012";
const receipt = {
  eviction_id: id,
  contract_version: "phone11-plain-video.v1",
  status: "processing",
  revoke_token_ts: 1790000001,
  created_at: null,
  completed_at: null,
};
const config = {
  baseUrl: "https://connect11.example",
  statusCredential: "status-test",
  joinCredential: "eviction-scoped-test",
};

describe("host control eviction transport compatibility", () => {
  it("preserves processing and legal nullable creation time through POST/GET", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(receipt), { status: 202 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(receipt), { status: 200 }),
      );
    const facade = createConnect11PlainVideoFacade(config, request);
    await expect(
      facade.requestEviction(
        { meetingId: id, participantId: "stable_member" },
        "phone11_removal_key_0001",
      ),
    ).resolves.toEqual(receipt);
    await expect(facade.evictionStatus(id)).resolves.toEqual(receipt);
    expect(request.mock.calls[0][1].headers.authorization).toBe(
      "Bearer eviction-scoped-test",
    );
  });
  it.each([null, "not-a-timestamp"])(
    "refuses completed without valid completion time: %s",
    async (completed_at) => {
      const request = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...receipt, status: "completed", completed_at }),
            { status: 202 },
          ),
        );
      await expect(
        createConnect11PlainVideoFacade(config, request).requestEviction(
          { meetingId: id, participantId: "stable_member" },
          "phone11_removal_key_0001",
        ),
      ).rejects.toThrow("unavailable");
    },
  );
  it("accepts Connect11 offset timestamps and six fractional digits", async () => {
    const completed = {
      ...receipt,
      status: "completed",
      created_at: "2026-10-04T00:00:00.123456+00:00",
      completed_at: "2026-10-04T00:00:01.123456+00:00",
    };
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(completed), { status: 200 }),
      );
    await expect(
      createConnect11PlainVideoFacade(config, request).evictionStatus(id),
    ).resolves.toEqual(completed);
  });
  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, "1790000001", null])(
    "refuses nonpositive, unsafe or malformed revocation cutoff: %s",
    async (revoke_token_ts) => {
      const malformed = {
        ...receipt,
        status: "completed",
        completed_at: "2026-10-04T00:00:01.123456+00:00",
        revoke_token_ts,
      };
      const request = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(malformed), { status: 202 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(malformed), { status: 200 }),
        );
      const facade = createConnect11PlainVideoFacade(config, request);
      await expect(
        facade.requestEviction(
          { meetingId: id, participantId: "stable_member" },
          "phone11_removal_key_0001",
        ),
      ).rejects.toThrow("unavailable");
      await expect(facade.evictionStatus(id)).rejects.toThrow("unavailable");
    },
  );
});
