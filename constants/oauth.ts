import { Platform } from "react-native";

// Keep this module path for existing API consumers; sign-in is owned by Phone11.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
export const SIGN_IN_ROUTE = "/auth/sign-in" as const;
export const SESSION_TOKEN_KEY = "phone11_session_token";
export const USER_INFO_KEY = "phone11_user_info";

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
