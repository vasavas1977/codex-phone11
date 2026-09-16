import { z } from "zod";

const contractVersion = "phone11-plain-video.v1";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
const grantProfile = z.enum(["interactive", "listener"]);

const capabilitiesSchema = z
  .object({
    contract_version: z.literal(contractVersion),
    available: z.boolean(),
    unavailable_reasons: z.array(z.enum(["not_configured", "issuer_isolation_unverified"])),
    grant_profiles: z.array(grantProfile),
    token_ttl_seconds: z.literal(300),
    interpreter: z
      .object({
        enabled: z.literal(false),
        dispatch: z.literal("none"),
        status: z.literal("not_applicable"),
      })
      .strict(),
  })
  .strict();

const admissionSchema = z
  .object({
    meetingId: identifier,
    participantId: identifier,
    grantProfile,
  })
  .strict();

const tokenSchema = z
  .object({
    contract_version: z.literal(contractVersion),
    rtc_url: z.string().url(),
    access_token: z.string().min(1).max(16_384),
    expires_at: z.number().int(),
  })
  .strict();

export type Connect11PlainVideoCapabilities = z.infer<typeof capabilitiesSchema>;
export type Connect11PlainVideoAdmission = z.infer<typeof admissionSchema>;
export type Connect11PlainVideoToken = z.infer<typeof tokenSchema>;

export type Connect11PlainVideoConfig = {
  baseUrl: string;
  statusCredential: string;
  joinCredential: string;
};

function unavailable(): Error {
  return new Error("Plain video service is unavailable");
}

function safeBaseUrl(raw: string): URL {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw unavailable();
    return new URL(
      `${url.href.replace(/\/+$/, "")}/api/v1/realtime/plain-video/`,
    );
  } catch {
    throw unavailable();
  }
}

function safeRtcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "wss:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * A server-only facade for Connect11 plain video. It deliberately has a
 * different contract from the interpretation facade: no language, consent,
 * worker, agent, room, identity, customer, or TTL inputs can reach Connect11.
 */
export function createConnect11PlainVideoFacade(
  config: Connect11PlainVideoConfig,
  request: typeof fetch = fetch,
) {
  const base = safeBaseUrl(config.baseUrl);
  if (!config.statusCredential || !config.joinCredential) throw unavailable();

  const call = async (
    path: string,
    credential: string,
    init: RequestInit = {},
  ) => {
    try {
      const response = await request(new URL(path, base), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credential}`,
          ...init.headers,
        },
      });
      if (!response.ok) throw unavailable();
      return await response.json();
    } catch {
      throw unavailable();
    }
  };

  const capabilities = async (): Promise<Connect11PlainVideoCapabilities> => {
    const parsed = capabilitiesSchema.safeParse(
      await call("capabilities", config.statusCredential),
    );
    if (!parsed.success) throw unavailable();
    return parsed.data;
  };

  return {
    capabilities,
    /** `raw` must come from a trusted Phone11 server admission resolver. */
    async admit(raw: unknown): Promise<Connect11PlainVideoToken> {
      const rawAdmission = admissionSchema.safeParse(raw);
      if (!rawAdmission.success) throw unavailable();
      const admission = rawAdmission.data;
      const status = await capabilities();
      if (
        !status.available ||
        status.unavailable_reasons.length !== 0 ||
        !status.grant_profiles.includes(admission.grantProfile)
      )
        throw unavailable();
      const parsed = tokenSchema.safeParse(
        await call("tokens", config.joinCredential, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            meeting_id: admission.meetingId,
            participant_id: admission.participantId,
            grant_profile: admission.grantProfile,
          }),
        }),
      );
      const now = Math.floor(Date.now() / 1000);
      if (
        !parsed.success ||
        !safeRtcUrl(parsed.data.rtc_url) ||
        parsed.data.expires_at <= now ||
        parsed.data.expires_at > now + 330
      )
        throw unavailable();
      return parsed.data;
    },
  };
}
