import { describe, expect, it, vi } from "vitest";
import { createConnect11ConferenceFacade } from "./connect11-facade";

const config = { baseUrl: "https://connect11.example", statusCredential: "status-secret", joinCredential: "join-secret" };
const capability = {
  contract_version: "phone11-conference.v1", available: true, unavailable_reasons: [],
  supported_listen_languages: ["th", "en"], grant_profiles: ["interactive", "listener"], token_ttl_seconds: 300,
  consent_policy_version: "phone11-conference-consent.v1",
  interpreter: { start: "join_dispatch", stop: "unsupported", status: "arrival_evidence", current_presence: false },
  worker_media: { listen_attribute: "lang", audio_track_prefix: "out-" },
};
const admission = { meetingId: "meeting_01", participantId: "person_01", grantProfile: "interactive" as const, listenLanguage: "th", consent: { accepted: true as const, purpose: "live_interpretation" as const, policyVersion: "phone11-conference-consent.v1", assertedAt: new Date().toISOString() } };
const token = { contract_version: "phone11-conference.v1", rtc_url: "wss://media.example", access_token: "synthetic", expires_at: Math.floor(Date.now() / 1000) + 300, arrival_observation_id: "12345678-1234-4234-8234-123456789012", arrival_state: "arrival_pending" };

function responses(...bodies: unknown[]) { return vi.fn().mockImplementation(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 })); }

describe("Connect11 conference facade", () => {
  it("uses separate server credentials and exact strict token body", async () => {
    const request = responses(capability, token); const facade = createConnect11ConferenceFacade(config, request);
    await expect(facade.admit(admission)).resolves.toEqual(token);
    expect(request.mock.calls[0][1].headers.authorization).toBe("Bearer status-secret");
    expect(request.mock.calls[1][1].headers.authorization).toBe("Bearer join-secret");
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ meeting_id: "meeting_01", participant_id: "person_01", grant_profile: "interactive", listen_language: "th", consent_assertion: { accepted: true, meeting_id: "meeting_01", participant_id: "person_01", purpose: "live_interpretation", policy_version: "phone11-conference-consent.v1", asserted_at: admission.consent.assertedAt } });
  });
  it("preserves an unavailable capability state and rejects malformed responses", async () => {
    await expect(createConnect11ConferenceFacade(config, responses({ ...capability, available: false })).capabilities()).resolves.toMatchObject({ available: false });
    for (const body of [{ ...capability, token_ttl_seconds: 60 }, {}]) {
      await expect(createConnect11ConferenceFacade(config, responses(body)).capabilities()).rejects.toThrow("unavailable");
    }
  });
  it("rejects an unsupported language before minting", async () => {
    const request = responses(capability); const facade = createConnect11ConferenceFacade(config, request);
    await expect(facade.admit({ ...admission, listenLanguage: "ja" })).rejects.toThrow("unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not mint while Connect11 reports deployment gates unavailable", async () => {
    const request = responses({ ...capability, available: false, unavailable_reasons: ["issuer_isolation_unverified"] });
    await expect(createConnect11ConferenceFacade(config, request).admit(admission)).rejects.toThrow("unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects unsafe RTC URLs, stale tokens and malformed response fields", async () => {
    for (const body of [{ ...token, rtc_url: "https://media.example" }, { ...token, expires_at: 1 }, { ...token, arrival_state: "arrival_missed" }]) {
      await expect(createConnect11ConferenceFacade(config, responses(capability, body)).admit(admission)).rejects.toThrow("unavailable");
    }
  });
  it("validates opaque arrival evidence without calling it interpreter readiness", async () => {
    const arrival = { contract_version: "agent-arrival.v1", observation_id: token.arrival_observation_id, state: "arrival_verified", arrival_verified: true, expected_by: new Date().toISOString(), arrival_observed_at: new Date().toISOString(), absence_confirmed_at: null, updated_at: new Date().toISOString() };
    await expect(createConnect11ConferenceFacade(config, responses(arrival)).arrival(token.arrival_observation_id)).resolves.toEqual(arrival);
  });
});
