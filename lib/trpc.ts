import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";
import { fetchTrpcJsonWithTimeout } from "@/lib/_core/api";
import { Platform } from "react-native";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  const transport = {
    url: `${getApiBaseUrl()}/api/trpc`,
    // tRPC v11: the transformer belongs to each transport link.
    transformer: superjson,
    async headers() {
      const token = await Auth.getSessionToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    // Custom fetch to include credentials for cookie-based auth
    fetch(url: RequestInfo | URL, options?: RequestInit) {
      return fetchTrpcJsonWithTimeout(url, {
        ...options,
        credentials: Platform.OS === "web" ? "include" : "omit",
      });
    },
  };
  return trpc.createClient({
    links: [splitLink({
      // Exact singleton requests let the edge upgrade only these management
      // procedures without moving unrelated tRPC requests to another API.
      condition: operation => ["pbx.capabilities", "pbx.fraudControls.get", "pbx.fraudControls.update"].includes(operation.path),
      true: httpLink(transport),
      false: httpBatchLink(transport),
    })],
  });
}
