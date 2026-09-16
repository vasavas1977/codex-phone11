import { describe, expect, it, vi } from "vitest";

import { createMeetingAdmissionResolver } from "./admission-resolver";
import { createMeetingAdmissionRepository } from "./admission-repository";
import { createConnect11ConferenceFacade } from "./connect11-facade";
import { createConnect11MeetingProvider } from "./connect11-provider";
import { createMeetingService } from "./service";

const grant = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 41,
  userId: 7,
};

const admissionRow = {
  meeting_id: grant.meetingId,
  tenant_id: grant.tenantId,
  user_id: grant.userId,
  participant_id: "participant_41_7",
  role: "member",
  grant_profile: "interactive",
  listen_language: "th",
  room_revision: "22345678-1234-4234-8234-123456789012",
  member_revision: "32345678-1234-4234-8234-123456789012",
  consent_policy_version: "phone11-conference-consent.v1",
  meeting_notice_version: "meeting-notice.v1",
  accepted_at: new Date("2026-09-16T00:00:00.000Z"),
  announcement_acknowledged_at: new Date("2026-09-16T00:00:01.000Z"),
};

const capabilities = {
  contract_version: "phone11-conference.v1",
  available: true,
  unavailable_reasons: [],
  supported_listen_languages: ["th", "en"],
  grant_profiles: ["interactive", "listener"],
  token_ttl_seconds: 300,
  consent_policy_version: "phone11-conference-consent.v1",
  interpreter: {
    start: "join_dispatch",
    stop: "unsupported",
    status: "arrival_evidence",
    current_presence: false,
  },
  worker_media: { listen_attribute: "lang", audio_track_prefix: "out-" },
};

const meetingToken = {
  contract_version: "phone11-conference.v1",
  rtc_url: "wss://media.example",
  access_token: "short-lived-token",
  expires_at: Math.floor(Date.now() / 1000) + 300,
  arrival_observation_id: "42345678-1234-4234-8234-123456789012",
  arrival_state: "arrival_pending",
};

function resolverFor(rows: unknown[]) {
  return createMeetingAdmissionResolver(
    async (fn) => fn({ query: vi.fn().mockResolvedValue({ rows }) }),
    createMeetingAdmissionRepository(),
    () => new Date("2026-09-16T00:05:00.000Z"),
  );
}

function responses(...bodies: unknown[]) {
  return vi.fn().mockImplementation(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }));
}

describe("Phone11 durable admission to Connect11 facade integration", () => {
  it("maps only durable server-owned admission data into the strict Connect11 token request", async () => {
    const request = responses(capabilities, meetingToken);
    const facade = createConnect11ConferenceFacade({
      baseUrl: "https://connect11.example",
      statusCredential: "status-secret",
      joinCredential: "join-secret",
    }, request);
    const provider = createConnect11MeetingProvider(facade, resolverFor([admissionRow]));

    await expect(provider.join(grant)).resolves.toEqual({
      url: "wss://media.example",
      token: "short-lived-token",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      meeting_id: grant.meetingId,
      participant_id: "participant_41_7",
      grant_profile: "interactive",
      listen_language: "th",
      consent_assertion: {
        accepted: true,
        meeting_id: grant.meetingId,
        participant_id: "participant_41_7",
        purpose: "live_interpretation",
        policy_version: "phone11-conference-consent.v1",
        asserted_at: "2026-09-16T00:05:00.000Z",
      },
    });
  });

  it("makes no Connect11 request when durable admission is unavailable", async () => {
    const request = responses(capabilities, meetingToken);
    const facade = createConnect11ConferenceFacade({
      baseUrl: "https://connect11.example",
      statusCredential: "status-secret",
      joinCredential: "join-secret",
    }, request);
    const provider = createConnect11MeetingProvider(facade, resolverFor([]));

    await expect(provider.join(grant)).rejects.toThrow("Meeting admission is unavailable");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not issue a token when Connect11 rejects the deployment gate", async () => {
    const request = responses({ ...capabilities, available: false, unavailable_reasons: ["issuer_isolation_unverified"] });
    const facade = createConnect11ConferenceFacade({
      baseUrl: "https://connect11.example",
      statusCredential: "status-secret",
      joinCredential: "join-secret",
    }, request);
    const provider = createConnect11MeetingProvider(facade, resolverFor([admissionRow]));
    const service = createMeetingService({ authorize: vi.fn().mockResolvedValue(grant) }, provider);

    await expect(service.join(grant.userId, { meetingId: grant.meetingId }))
      .rejects.toThrow("Meeting provider is unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
