import * as Linking from "expo-linking";
import * as ReactNative from "react-native";

// Extract scheme from bundle ID (last segment timestamp, prefixed with "manus")
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const bundleId = "space.manus.cloudphone11.t20260425073427";
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;
const DEFAULT_NATIVE_API_BASE_URL = "https://api.phone11.ai";
const DEFAULT_DEEP_LINK_SCHEME = "phone11";
const DEFAULT_OAUTH_PORTAL_URL = "https://manus.im";

type RuntimeOAuthConfig = {
  oauthPortalUrl?: string | null;
  appId?: string | null;
  deepLinkScheme?: string | null;
};

const env = {
  portal: process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL ?? DEFAULT_OAUTH_PORTAL_URL,
  server: process.env.EXPO_PUBLIC_OAUTH_SERVER_URL ?? "",
  appId: process.env.EXPO_PUBLIC_APP_ID ?? "",
  ownerId: process.env.EXPO_PUBLIC_OWNER_OPEN_ID ?? "",
  ownerName: process.env.EXPO_PUBLIC_OWNER_NAME ?? "",
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  deepLinkScheme:
    process.env.EXPO_PUBLIC_DEEP_LINK_SCHEME || DEFAULT_DEEP_LINK_SCHEME || schemeFromBundleId,
};

let runtimeOAuthConfigPromise: Promise<RuntimeOAuthConfig | null> | null = null;

export const OAUTH_PORTAL_URL = env.portal;
export const OAUTH_SERVER_URL = env.server;
export const APP_ID = env.appId;
export const OWNER_OPEN_ID = env.ownerId;
export const OWNER_NAME = env.ownerName;
export const API_BASE_URL = env.apiBaseUrl;

/**
 * Get the API base URL, deriving from current hostname if not set.
 * Metro runs on 8081, API server runs on 3000.
 * URL pattern: https://PORT-sandboxid.region.domain
 */
export function getApiBaseUrl(): string {
  // If API_BASE_URL is set, use it
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/\/$/, "");
  }

  // Native builds cannot use a relative URL. Use the public Phone11 API by default
  // so admin provisioning can reach phone.getConfig and register the SIP account.
  if (ReactNative.Platform.OS !== "web") {
    return DEFAULT_NATIVE_API_BASE_URL;
  }

  // On web, derive from current hostname by replacing port 8081 with 3000
  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    // Pattern: 8081-sandboxid.region.domain -> 3000-sandboxid.region.domain
    const apiHostname = hostname.replace(/^8081-/, "3000-");
    if (apiHostname !== hostname) {
      return `${protocol}//${apiHostname}`;
    }
  }

  // Fallback to empty (will use relative URL)
  return "";
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";

export function isOAuthConfigured(): boolean {
  return Boolean(OAUTH_PORTAL_URL || getApiBaseUrl());
}

export function getOAuthConfigMessage(): string {
  return "Phone11 login could not load an OAuth app ID from the build or Phone11 API.";
}

const encodeState = (value: string) => {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  const BufferImpl = (globalThis as Record<string, any>).Buffer;
  if (BufferImpl) {
    return BufferImpl.from(value, "utf-8").toString("base64");
  }
  return value;
};

async function loadRuntimeOAuthConfig(): Promise<RuntimeOAuthConfig | null> {
  if (!runtimeOAuthConfigPromise) {
    runtimeOAuthConfigPromise = (async () => {
      const baseUrl = getApiBaseUrl();
      if (!baseUrl) return null;

      try {
        const response = await fetch(`${baseUrl}/api/mobile/config`);
        if (!response.ok) return null;
        return (await response.json()) as RuntimeOAuthConfig;
      } catch (error) {
        console.warn("[OAuth] Failed to load runtime OAuth config:", error);
        return null;
      }
    })();
  }

  return runtimeOAuthConfigPromise;
}

async function resolveOAuthConfig() {
  const runtime = await loadRuntimeOAuthConfig();
  const portal = runtime?.oauthPortalUrl || OAUTH_PORTAL_URL || DEFAULT_OAUTH_PORTAL_URL;
  const appId = runtime?.appId || APP_ID;
  const deepLinkScheme = runtime?.deepLinkScheme || env.deepLinkScheme;

  return { portal, appId, deepLinkScheme };
}

/**
 * Get the redirect URI for OAuth callback.
 * - Web: uses API server callback endpoint
 * - Native: uses deep link scheme
 */
export const getRedirectUri = (deepLinkScheme = env.deepLinkScheme) => {
  if (ReactNative.Platform.OS === "web") {
    return `${getApiBaseUrl()}/api/oauth/callback`;
  } else {
    return Linking.createURL("/oauth/callback", {
      scheme: deepLinkScheme,
    });
  }
};

export const getLoginUrl = async () => {
  const config = await resolveOAuthConfig();
  if (!config.appId) {
    throw new Error(getOAuthConfigMessage());
  }

  const redirectUri = getRedirectUri(config.deepLinkScheme);
  const state = encodeState(redirectUri);

  const url = new URL(`${config.portal}/app-auth`);
  url.searchParams.set("appId", config.appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

/**
 * Start OAuth login flow.
 *
 * On native platforms (iOS/Android), open the system browser directly so
 * the OAuth callback returns via deep link to the app.
 *
 * On web, this simply redirects to the login URL.
 *
 * @returns Always null, the callback is handled via deep link.
 */
export async function startOAuthLogin(): Promise<string | null> {
  const loginUrl = await getLoginUrl();

  if (ReactNative.Platform.OS === "web") {
    // On web, just redirect
    if (typeof window !== "undefined") {
      window.location.href = loginUrl;
    }
    return null;
  }

  const supported = await Linking.canOpenURL(loginUrl);
  if (!supported) {
    console.warn("[OAuth] Cannot open login URL: URL scheme not supported");
    return null;
  }

  try {
    await Linking.openURL(loginUrl);
  } catch (error) {
    console.error("[OAuth] Failed to open login URL:", error);
  }

  // The OAuth callback will reopen the app via deep link.
  return null;
}
