import {
  readConnect11PlainVideoTenantConfiguration,
  type Connect11PlainVideoTenantConfiguration,
} from "./connect11-plain-video-tenant-provider";

/**
 * This JSON value is server-only. It is intentionally not read by Expo config
 * or sent through tRPC: tenant routing and Connect11 credentials stay on the
 * Phone11 service.
 */
export const connect11PlainVideoTenantConfigEnvironment =
  "PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS";

/**
 * Missing, malformed, or disabled configuration is indistinguishable to the
 * router. That keeps the public meeting surface unavailable until a reviewed
 * deployment injects complete per-tenant configuration.
 */
export function readServerConnect11PlainVideoTenantConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Connect11PlainVideoTenantConfiguration {
  return readConnect11PlainVideoTenantConfiguration(
    env[connect11PlainVideoTenantConfigEnvironment],
  );
}
