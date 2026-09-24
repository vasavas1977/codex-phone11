import { z } from "zod";

import { connect11PlainVideoTokenSchema } from "./connect11-plain-video-facade";
import { normalizePlainVideoDisplayName } from "./plain-video-display-name";
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
  .max(4_096)
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
    customerKey: opaqueCustomerKey,
    apiBaseUrl: z.string().refine((value) => secureUrl(value, "https:")),
    rtcUrl: z.string().refine((value) => secureUrl(value, "wss:")),
    statusCredential: secret,
    joinCredential: secret,
    displayNameEnabled: z.boolean().optional(),
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

  if (disabledConfigurationSchema.safeParse(candidate).success) {
    return { enabled: false };
  }
  const parsed = enabledConfigurationSchema.safeParse(candidate);
  if (!parsed.success) return { enabled: false };

  const tenantIds = new Set<number>();
  const customerKeys = new Set<string>();
  const joinCredentials = new Set<string>();
  for (const tenant of parsed.data.tenants) {
    if (
      tenantIds.has(tenant.tenantId) ||
      customerKeys.has(tenant.customerKey) ||
      joinCredentials.has(tenant.joinCredential)
    ) {
      return { enabled: false };
    }
    tenantIds.add(tenant.tenantId);
    customerKeys.add(tenant.customerKey);
    joinCredentials.add(tenant.joinCredential);
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
    displayName: z.string().optional(),
  })
  .strict();

function matchingRtcOrigin(actual: string, configured: string): boolean {
  return new URL(actual).origin === new URL(configured).origin;
}

function validFacadeExpiry(expiresAt: number): boolean {
  const now = Math.floor(Date.now() / 1_000);
  return expiresAt > now && expiresAt <= now + 330;
}

function trustedAdmissionFor(
  raw: unknown,
  grant: MeetingGrant,
): TrustedConnect11PlainVideoAdmission | null {
  const parsed = trustedAdmissionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.meetingId !== grant.meetingId) return null;
  if (parsed.data.displayName !== undefined &&
      normalizePlainVideoDisplayName(parsed.data.displayName) !== parsed.data.displayName) return null;
  return parsed.data;
}

/**
 * Builds an unmounted tenant-aware provider. It resolves the durable Phone11
 * admission before selecting a tenant configuration or constructing a client.
 * The injected factory is the only component allowed to receive credentials.
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
  // Re-parse to protect this composition seam from a caller who bypasses the
  // exported configuration parser or mutates the parsed object later.
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

      const tenant = effectiveConfiguration.tenants.find(
        (item) => item.tenantId === grant.data.tenantId,
      );
      if (!tenant) throw new PlainVideoTenantProviderUnavailableError();
      const pending = tenant.displayNameEnabled === true
        ? await resolver.prepare(grant.data, true)
        : await resolver.prepare(grant.data);
      const admission = trustedAdmissionFor(pending.admission, grant.data);
      if (!admission || (tenant.displayNameEnabled !== true && admission.displayName !== undefined))
        throw new PlainVideoTenantProviderUnavailableError();

      const token = connect11PlainVideoTokenSchema.safeParse(
        await clientFactory.create(tenant).admit(admission),
      );
      if (
        !token.success ||
        !matchingRtcOrigin(token.data.rtc_url, tenant.rtcUrl) ||
        !validFacadeExpiry(token.data.expires_at)
      ) {
        throw new PlainVideoTenantProviderUnavailableError();
      }
      const confirmed = trustedAdmissionFor(
        await resolver.confirm(pending.lease),
        grant.data,
      );
      if (
        !confirmed ||
        confirmed.participantId !== admission.participantId ||
        confirmed.grantProfile !== admission.grantProfile
      ) {
        throw new PlainVideoTenantProviderUnavailableError();
      }
      return {
        url: token.data.rtc_url,
        token: token.data.access_token,
        grant_profile: admission.grantProfile,
        contract_version: token.data.contract_version,
        expires_at: token.data.expires_at,
      };
    },
  };
}
