import { describe, expect, it, vi } from "vitest";

import { createConnect11PlainVideoFacade } from "./connect11-plain-video-facade";

const config = {
  baseUrl: "https://connect11.example",
  statusCredential: "status-secret",
  joinCredential: "join-secret",
};
const capability = {
  contract_version: "phone11-plain-video.v1",
  available: true,
  unavailable_reasons: [],
  grant_profiles: ["interactive", "listener"],
  token_ttl_seconds: 300,
  interpreter: { enabled: false, dispatch: "none", status: "not_applicable" },
};
const admission = {
  meetingId: "meeting_01",
  participantId: "person_01",
  grantProfile: "interactive" as const,
};
const token = {
  contract_version: "phone11-plain-video.v1",
  rtc_url: "wss://media.example",
  access_token: "synthetic",
  expires_at: Math.floor(Date.now() / 1000) + 300,
};

function responses(...bodies: unknown[]) {
  return vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }));
}

describe("Connect11 plain video facade", () => {
  it("uses isolated credentials and sends the exact three-field token body", async () => {
    const request = responses(capability, token);
    await expect(
      createConnect11PlainVideoFacade(config, request).admit(admission),
    ).resolves.toEqual(token);
    expect(request.mock.calls[0][1].headers.authorization).toBe("Bearer status-secret");
    expect(request.mock.calls[1][1].headers.authorization).toBe("Bearer join-secret");
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      meeting_id: "meeting_01",
      participant_id: "person_01",
      grant_profile: "interactive",
    });
    expect(request.mock.calls[1][1].body).toBe(
      '{"meeting_id":"meeting_01","participant_id":"person_01","grant_profile":"interactive"}',
    );
    expect(String(request.mock.calls[1][0])).toBe(
      "https://connect11.example/api/v1/realtime/plain-video/tokens",
    );
  });

  it("rejects client-shaped extras before a token or capability request", async () => {
    const request = responses(capability, token);
    await expect(
      createConnect11PlainVideoFacade(config, request).admit({
        ...admission,
        consent: { accepted: true },
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects malformed presentation names before any provider request", async () => {
    for (const displayName of ["  Member", "Bad\u202eName", "😀".repeat(70)]) {
      const request = responses(capability, token);
      await expect(createConnect11PlainVideoFacade(config, request).admit({
        ...admission, displayName,
      })).rejects.toThrow("unavailable");
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("fails closed for unavailable, malformed, or unsafe responses", async () => {
    const unavailable = createConnect11PlainVideoFacade(
      config,
      responses({ ...capability, available: false, unavailable_reasons: ["not_configured"] }),
    );
    await expect(unavailable.admit(admission)).rejects.toThrow("unavailable");
    for (const badToken of [
      { ...token, rtc_url: "https://media.example" },
      { ...token, expires_at: 1 },
      { ...token, unexpected: true },
    ]) {
      await expect(
        createConnect11PlainVideoFacade(config, responses(capability, badToken)).admit(admission),
      ).rejects.toThrow("unavailable");
    }
  });

  it("refuses non-HTTPS facade origins", () => {
    expect(() =>
      createConnect11PlainVideoFacade({ ...config, baseUrl: "http://connect11.example" }),
    ).toThrow("unavailable");
  });

  it("does not mint when readiness contradicts an isolation failure", async () => {
    const request = responses({
      ...capability,
      unavailable_reasons: ["issuer_isolation_unverified"],
    }, token);
    await expect(createConnect11PlainVideoFacade(config, request).admit(admission))
      .rejects.toThrow("unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not expose malformed configuration or transport failures", async () => {
    expect(() =>
      createConnect11PlainVideoFacade({ ...config, baseUrl: "not a URL" }),
    ).toThrow("unavailable");
    await expect(
      createConnect11PlainVideoFacade(
        config,
        vi.fn().mockRejectedValue(new Error("network details")),
      ).capabilities(),
    ).rejects.toThrow("unavailable");
  });

  it("uses the strict opaque eviction contract and requires a bounded status read", async () => {
    const eviction = {
      eviction_id: "12345678-1234-4234-8234-123456789012",
      contract_version: "phone11-plain-video.v1",
      status: "pending",
      revoke_token_ts: Math.floor(Date.now() / 1_000),
      created_at: "2026-09-19T00:00:00.000Z",
      completed_at: null,
    };
    const request = vi
      .fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify(eviction), { status: 202 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({
        ...eviction,
        status: "completed",
        completed_at: "2026-09-19T00:01:00.000Z",
      }), { status: 200 }));
    const facade = createConnect11PlainVideoFacade(config, request);

    await expect(facade.requestEviction({
      meetingId: "meeting_01",
      participantId: "person_01",
    }, "plain_video_remove_0001")).resolves.toEqual(eviction);
    expect(String(request.mock.calls[0][0])).toBe(
      "https://connect11.example/api/v1/realtime/plain-video/evictions",
    );
    expect(request.mock.calls[0][1].method).toBe("POST");
    expect(request.mock.calls[0][1].headers["Idempotency-Key"]).toBe("plain_video_remove_0001");
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      meeting_id: "meeting_01",
      participant_id: "person_01",
    });

    await expect(facade.evictionStatus(eviction.eviction_id)).resolves.toMatchObject({
      status: "completed",
    });
    expect(String(request.mock.calls[1][0])).toBe(
      `https://connect11.example/api/v1/realtime/plain-video/evictions/${eviction.eviction_id}`,
    );
  });

  it("rejects non-202, malformed, or incomplete eviction acknowledgements", async () => {
    const response = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "completed" }), { status: 202 }),
    );
    const facade = createConnect11PlainVideoFacade(config, response);
    await expect(facade.requestEviction({
      meetingId: "meeting_01",
      participantId: "person_01",
    }, "plain_video_remove_0001")).rejects.toThrow("unavailable");
    expect(response).toHaveBeenCalledTimes(1);
  });
});
