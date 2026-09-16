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
});
