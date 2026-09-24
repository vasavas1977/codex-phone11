import { z } from "zod";
import { normalizePlainVideoDisplayName } from "./plain-video-display-name";

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
    displayName: z.string().optional(),
  })
  .strict();

/** The exact token contract returned by the plain-video facade. */
export const connect11PlainVideoTokenSchema = z
  .object({
    contract_version: z.literal(contractVersion),
    rtc_url: z.string().url(),
    access_token: z.string().min(1).max(16_384),
    expires_at: z.number().int(),
  })
  .strict();

const evictionStatusSchema = z.enum(["pending", "completed", "failed"]);
const evictionRequestSchema = z
  .object({
    meetingId: identifier,
    participantId: identifier,
  })
  .strict();
const evictionSchema = z
  .object({
    eviction_id: z.string().uuid(),
    contract_version: z.literal(contractVersion),
    status: evictionStatusSchema,
    revoke_token_ts: z.number().int().positive(),
    created_at: z.string().datetime({ offset: true }),
    completed_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "completed" && value.completed_at === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "completed_at is required" });
    }
  });
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

export type Connect11PlainVideoCapabilities = z.infer<typeof capabilitiesSchema>;
export type Connect11PlainVideoAdmission = z.infer<typeof admissionSchema>;
export type Connect11PlainVideoToken = z.infer<
  typeof connect11PlainVideoTokenSchema
>;
export type Connect11PlainVideoEviction = z.infer<typeof evictionSchema>;

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

  const evictionCall = async (
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> => {
    try {
      const response = await request(new URL(path, base), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.joinCredential}`,
          ...init.headers,
        },
      });
      return { status: response.status, body: await response.json() };
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
      if (admission.displayName !== undefined &&
          normalizePlainVideoDisplayName(admission.displayName) !== admission.displayName) throw unavailable();
      const status = await capabilities();
      if (
        !status.available ||
        status.unavailable_reasons.length !== 0 ||
        !status.grant_profiles.includes(admission.grantProfile)
      )
        throw unavailable();
      const parsed = connect11PlainVideoTokenSchema.safeParse(
        await call("tokens", config.joinCredential, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            meeting_id: admission.meetingId,
            participant_id: admission.participantId,
            grant_profile: admission.grantProfile,
            ...(admission.displayName === undefined ? {} : { display_name: admission.displayName }),
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
    /**
     * This acknowledges receipt only when the response is 202. A pending
     * eviction never proves a participant was removed; callers must observe
     * `status: completed` through the bounded status method below.
     */
    async requestEviction(raw: unknown, rawIdempotencyKey: unknown): Promise<Connect11PlainVideoEviction> {
      const eviction = evictionRequestSchema.safeParse(raw);
      const key = idempotencyKey.safeParse(rawIdempotencyKey);
      if (!eviction.success || !key.success) throw unavailable();
      const response = await evictionCall("evictions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": key.data,
        },
        body: JSON.stringify({
          meeting_id: eviction.data.meetingId,
          participant_id: eviction.data.participantId,
        }),
      });
      const parsed = evictionSchema.safeParse(response.body);
      if (response.status !== 202 || !parsed.success) throw unavailable();
      return parsed.data;
    },
    /** Performs one scoped status read; polling cadence belongs to a caller. */
    async evictionStatus(rawEvictionId: unknown): Promise<Connect11PlainVideoEviction> {
      const evictionId = z.string().uuid().safeParse(rawEvictionId);
      if (!evictionId.success) throw unavailable();
      const response = await evictionCall(
        `evictions/${encodeURIComponent(evictionId.data)}`,
      );
      const parsed = evictionSchema.safeParse(response.body);
      if (response.status !== 200 || !parsed.success || parsed.data.eviction_id !== evictionId.data) {
        throw unavailable();
      }
      return parsed.data;
    },
  };
}
