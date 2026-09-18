import { z } from "zod";

import type {
  Connect11PlainVideoAdmissionClient,
  Connect11PlainVideoAdmissionResolver,
  TrustedConnect11PlainVideoAdmission,
} from "./connect11-plain-video-provider";
import type { MeetingGrant, MeetingProvider } from "./service";

const opaqueIdentifier = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
const opaqueCustomerKey = z.string().regex(/^[A-Za-z0-9_-]{8,512}$/);
const secret = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.trim() === value && !/[\r\n]/.test(value));

function secureUrl(value: string, protocol: "https:" | "wss:"): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === protocol &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

const tenantExternalConfigSchema = z
  .object({
    tenantId: z.number().int().positive().refine(Number.isSafeInteger),
    // This is an opaque Connect11 customer routing key, not a Phone11 tenant ID.
    // It must be unique in this configuration so a single Customer key cannot be
    // accidentally shared by otherwise unrelated Phone11 tenants.
    customerKey: opaqueCustomerKey,
    apiBaseUrl: z.string().refine((value) => secureUrl(value, "https:")),
    rtcUrl: z.string().refine((value) => secureUrl(value, "wss:")),
    statusCredential: secret,
    joinCredential: secret,
  })
  .strict();

const enabledConfigurationSchema = z
  .object({
    enabled: z.literal(true),
    tenants: z.array(tenantExternalConfigSchema).min(1).max(100),
  })
  .strict();

const disabledConfigurationSchema = z
  .object({ enabled: z.literal(false) })
  .strict();

export type Connect11PlainVideoTenantExternalConfig = z.infer<
  typeof tenantExternalConfigSchema
>;

export type Connect11PlainVideoTenantConfiguration =
  | { enabled: false }
  | {
      enabled: true;
      tenants: readonly Connect11PlainVideoTenantExternalConfig[];
    };

export class PlainVideoTenantProviderUnavailableError extends Error {
  constructor() {
    super("Plain video provider is unavailable");
  }
}

function parseRawConfiguration(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Parses an injected server-only configuration. Missing, malformed, duplicate,
 * or explicitly disabled configuration is intentionally indistinguishable to
 * callers: all result in a disabled provider and no external request.
 */
export function readConnect11PlainVideoTenantConfiguration(
  raw: unknown,
): Connect11PlainVideoTenantConfiguration {
  const candidate = parseRawConfiguration(raw);
  if (candidate === undefined || candidate === null) return { enabled: false };

  const disabled = disabledConfigurationSchema.safeParse(candidate);
  if (disabled.success) return { enabled: false };

  const parsed = enabledConfigurationSchema.safeParse(candidate);
  if (!parsed.success) return { enabled: false };

  const tenantIds = new Set<number>();
  const customerKeys = new Set<string>();
  for (const tenant of parsed.data.tenants) {
    if (
      tenantIds.has(tenant.tenantId) ||
      customerKeys.has(tenant.customerKey)
    ) {
      return { enabled: false };
    }
    tenantIds.add(tenant.tenantId);
    customerKeys.add(tenant.customerKey);
  }
  return { enabled: true, tenants: parsed.data.tenants };
}

const grantSchema = z
  .object({
    meetingId: z.string().uuid(),
    tenantId: z.number().int().positive().refine(Number.isSafeInteger),
    userId: z.number().int().positive().refine(Number.isSafeInteger),
  })
  .strict();

const trustedAdmissionSchema = z
  .object({
    meetingId: z.string().uuid(),
    participantId: opaqueIdentifier,
    grantProfile: z.enum(["interactive", "listener"]),
  })
  .strict();

const tokenSchema = z
  .object({
    rtc_url: z.string().refine((value) => secureUrl(value, "wss:")),
    access_token: z.string().min(1).max(16_384),
  })
  .strict();

function matchingRtcOrigin(actual: string, configured: string): boolean {
  return new URL(actual).origin === new URL(configured).origin;
}

function trustedAdmissionFor(
  raw: unknown,
  grant: MeetingGrant,
): TrustedConnect11PlainVideoAdmission | null {
  const parsed = trustedAdmissionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.meetingId !== grant.meetingId) return null;
  return parsed.data;
}

/**
 * Builds an unmounted tenant-aware provider. It resolves and validates the
 * durable Phone11 admission before selecting any tenant's external Connect11
 * configuration or constructing a client. The injected factory is the only
 * component allowed to receive credentials; this module never logs or stores
 * credentials or issued tokens.
 */
export function createConnect11PlainVideoTenantProvider(
  configuration: Connect11PlainVideoTenantConfiguration,
  resolver: Connect11PlainVideoAdmissionResolver,
  clientFactory: {
    create(
      config: Connect11PlainVideoTenantExternalConfig,
    ): Connect11PlainVideoAdmissionClient;
  },
): MeetingProvider {
  // Keep this boundary defensive even when a future composition root bypasses
  // the exported parser or mutates an object after parsing.
  const effectiveConfiguration = configuration.enabled
    ? readConnect11PlainVideoTenantConfiguration({
        enabled: true,
        tenants: configuration.tenants,
      })
    : { enabled: false as const };

  return {
    async join(rawGrant) {
      const grant = grantSchema.safeParse(rawGrant);
      if (!grant.success || !effectiveConfiguration.enabled) {
        throw new PlainVideoTenantProviderUnavailableError();
      }

      // Admission comes first. Do not look up a Customer key, construct a
      // client, or call Connect11 until the tenant-bound resolver accepts it.
      const admission = trustedAdmissionFor(
        await resolver.resolve(grant.data),
        grant.data,
      );
      if (!admission) throw new PlainVideoTenantProviderUnavailableError();

      const tenant = effectiveConfiguration.tenants.find(
        (item) => item.tenantId === grant.data.tenantId,
      );
      if (!tenant) throw new PlainVideoTenantProviderUnavailableError();

      const token = tokenSchema.safeParse(
        await clientFactory.create(tenant).admit(admission),
      );
      if (
        !token.success ||
        !matchingRtcOrigin(token.data.rtc_url, tenant.rtcUrl)
      ) {
        throw new PlainVideoTenantProviderUnavailableError();
      }
      return { url: token.data.rtc_url, token: token.data.access_token };
    },
  };
}
