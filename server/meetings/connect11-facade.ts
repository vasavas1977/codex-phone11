import { z } from "zod";

const contractVersion = "phone11-conference.v1";
const arrivalContractVersion = "agent-arrival.v1";
const language = z.string().regex(/^[a-z]{2}$/);
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
const grantProfile = z.enum(["interactive", "listener"]);
const arrivalState = z.enum([
  "arrival_pending",
  "arrival_verified",
  "arrival_unknown",
  "arrival_verified_late",
  "arrival_missed",
  "dispatch_prepared",
]);

const capabilitiesSchema = z.object({
  contract_version: z.literal(contractVersion),
  available: z.boolean(),
  unavailable_reasons: z.array(z.string()),
  supported_listen_languages: z.array(language),
  grant_profiles: z.array(grantProfile),
  token_ttl_seconds: z.literal(300),
  consent_policy_version: z.string().min(1).max(128),
  interpreter: z.object({
    start: z.literal("join_dispatch"),
    stop: z.literal("unsupported"),
    status: z.literal("arrival_evidence"),
    current_presence: z.literal(false),
  }).strict(),
  worker_media: z.object({
    listen_attribute: z.literal("lang"),
    audio_track_prefix: z.literal("out-"),
  }).strict(),
}).strict();

const admissionSchema = z.object({
  meetingId: identifier,
  participantId: identifier,
  grantProfile,
  listenLanguage: language,
  consent: z.object({
    accepted: z.literal(true),
    purpose: z.literal("live_interpretation"),
    policyVersion: z.string().min(1).max(128),
    assertedAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

const tokenSchema = z.object({
  contract_version: z.literal(contractVersion),
  rtc_url: z.string().url(),
  access_token: z.string().min(1).max(16_384),
  expires_at: z.number().int(),
  arrival_observation_id: z.string().uuid(),
  arrival_state: z.enum(["arrival_pending", "arrival_verified"]),
}).strict();

const arrivalSchema = z.object({
  contract_version: z.literal(arrivalContractVersion),
  observation_id: z.string().uuid(),
  state: arrivalState,
  arrival_verified: z.boolean(),
  expected_by: z.string().datetime({ offset: true }),
  arrival_observed_at: z.string().datetime({ offset: true }).nullable(),
  absence_confirmed_at: z.string().datetime({ offset: true }).nullable(),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

export type Connect11ConferenceCapabilities = z.infer<typeof capabilitiesSchema>;
export type Connect11Admission = z.infer<typeof admissionSchema>;
export type Connect11MeetingToken = z.infer<typeof tokenSchema>;
export type Connect11Arrival = z.infer<typeof arrivalSchema>;

export type Connect11ConferenceConfig = {
  baseUrl: string;
  statusCredential: string;
  joinCredential: string;
};

function safeBaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Secure Connect11 facade URL is required");
  }
  return new URL(`${url.href.replace(/\/+$/, "")}/api/v1/realtime/conference/`);
}

function safeRtcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "wss:" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function unavailable(): Error {
  return new Error("Conference service is unavailable");
}

/**
 * Server-to-server client for Connect11's versioned Phone11 facade. It has no
 * ambient configuration and cannot activate the mounted Phone11 meeting route.
 */
export function createConnect11ConferenceFacade(
  config: Connect11ConferenceConfig,
  request: typeof fetch = fetch,
) {
  const base = safeBaseUrl(config.baseUrl);
  if (!config.statusCredential || !config.joinCredential) throw unavailable();
  const call = async (path: string, credential: string, init: RequestInit = {}) => {
    const response = await request(new URL(path, base), {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json", authorization: `Bearer ${credential}`, ...init.headers },
    });
    if (!response.ok) throw unavailable();
    return response.json().catch(() => { throw unavailable(); });
  };

  const capabilities = async (): Promise<Connect11ConferenceCapabilities> => {
      const parsed = capabilitiesSchema.safeParse(await call("capabilities", config.statusCredential));
      if (!parsed.success) throw unavailable();
      return parsed.data;
  };
  return {
    capabilities,
    async admit(raw: Connect11Admission): Promise<Connect11MeetingToken> {
      const admission = admissionSchema.parse(raw);
      const status = await capabilities();
      if (!status.available || !status.supported_listen_languages.includes(admission.listenLanguage) ||
          !status.grant_profiles.includes(admission.grantProfile) ||
          status.consent_policy_version !== admission.consent.policyVersion) throw unavailable();
      const parsed = tokenSchema.safeParse(await call("tokens", config.joinCredential, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meeting_id: admission.meetingId,
          participant_id: admission.participantId,
          grant_profile: admission.grantProfile,
          listen_language: admission.listenLanguage,
          consent_assertion: {
            accepted: true,
            meeting_id: admission.meetingId,
            participant_id: admission.participantId,
            purpose: "live_interpretation",
            policy_version: admission.consent.policyVersion,
            asserted_at: admission.consent.assertedAt,
          },
        }),
      }));
      const now = Math.floor(Date.now() / 1000);
      if (!parsed.success || !safeRtcUrl(parsed.data.rtc_url) || parsed.data.expires_at <= now || parsed.data.expires_at > now + 330) {
        throw unavailable();
      }
      return parsed.data;
    },
    async arrival(observationId: string): Promise<Connect11Arrival> {
      if (!z.string().uuid().safeParse(observationId).success) throw unavailable();
      const parsed = arrivalSchema.safeParse(await call(`agent-arrivals/${encodeURIComponent(observationId)}`, config.statusCredential));
      if (!parsed.success || parsed.data.observation_id !== observationId ||
          parsed.data.arrival_verified !== ["arrival_verified", "arrival_verified_late"].includes(parsed.data.state)) throw unavailable();
      return parsed.data;
    },
  };
}
