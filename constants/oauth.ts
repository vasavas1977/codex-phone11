import { Platform } from "react-native";

// Keep this module path for existing API consumers; sign-in is owned by Phone11.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
export const SIGN_IN_ROUTE = "/auth/sign-in" as const;
export const PASSWORD_RESET_REQUEST_ROUTE = "/auth/forgot-password" as const;
export const PASSWORD_RESET_ROUTE = "/auth/reset-password" as const;
export const PASSWORD_RESET_PUBLIC_ORIGIN = "https://1toall.phone11.ai";
export const SESSION_TOKEN_KEY = "phone11_session_token";
export const USER_INFO_KEY = "phone11_user_info";

const portalReturnTargets = [
  "/portal",
  "/portal/dids",
  "/portal/usage",
  "/admin",
] as const;

export type PortalReturnTarget = (typeof portalReturnTargets)[number];

/**
 * Sign-in is shared with the native app, so only browser portal routes may be
 * carried through it. Keep this list explicit to prevent URL-controlled
 * redirects to arbitrary routes or origins.
 */
export function getSafePortalReturnTarget(
  value: unknown,
): PortalReturnTarget | null {
  if (
    typeof value === "string" &&
    (portalReturnTargets as readonly string[]).includes(value)
  ) {
    return value as PortalReturnTarget;
  }
  return null;
}

export function portalSignInRoute(returnTo: PortalReturnTarget) {
  return {
    pathname: SIGN_IN_ROUTE,
    params: { returnTo },
  };
}

export function passwordResetRequestRoute(returnTo: PortalReturnTarget | null) {
  return returnTo
    ? { pathname: PASSWORD_RESET_REQUEST_ROUTE, params: { returnTo } }
    : PASSWORD_RESET_REQUEST_ROUTE;
}

export function passwordResetRoute(returnTo: PortalReturnTarget | null) {
  return returnTo
    ? { pathname: PASSWORD_RESET_ROUTE, params: { returnTo } }
    : PASSWORD_RESET_ROUTE;
}

export function passwordResetPathWithoutToken(
  returnTo: PortalReturnTarget | null,
): string {
  return returnTo
    ? `${PASSWORD_RESET_ROUTE}?returnTo=${encodeURIComponent(returnTo)}`
    : PASSWORD_RESET_ROUTE;
}

export function resetTokenFromFragment(hash: string | undefined): string | null {
  if (!hash?.startsWith("#")) return null;
  const token = new URLSearchParams(hash.slice(1)).get("token")?.trim();
  return token || null;
}

/**
 * Browser recovery stays on the current portal origin. Native recovery must
 * open the trusted public portal rather than the API origin, where there is no
 * reset UI. A caller can choose a portal destination only from the allowlist
 * above; reset tokens are added by Better Auth, never by this client.
 */
export function passwordResetRedirectUrl(
  returnTo: PortalReturnTarget | null,
): string {
  const origin =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.origin
      : PASSWORD_RESET_PUBLIC_ORIGIN;
  const url = new URL(PASSWORD_RESET_ROUTE, origin);
  if (returnTo) url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

export function getApiBaseUrl(): string {
  if (API_BASE_URL) return API_BASE_URL.replace(/\/+$/, "");
  if (Platform.OS !== "web") return "https://api.phone11.ai";

  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    const apiHostname = hostname.replace(/^8081-/, "3000-");
    if (apiHostname !== hostname) return `${protocol}//${apiHostname}`;
  }
  return "";
}
