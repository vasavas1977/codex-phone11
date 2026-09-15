import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Platform } from "react-native";
import type { AppRouter } from "../../server/routers";
import { getApiBaseUrl } from "../../constants/oauth";
import { getAuthSnapshot, getSessionToken } from "../_core/auth";
import { fetchWithTimeout } from "../_core/api";
import type { ChatTransport } from "./state";

/** Bind queued message bodies to the identity that initiated them, never a later login. */
export function createChatTransport(): ChatTransport {
  const withClient = async <T>(run: (client: ReturnType<typeof createTRPCClient<AppRouter>>) => Promise<T>) => {
    const owner = getAuthSnapshot().user;
    const assertOwner = () => {
      const state = getAuthSnapshot();
      if (!owner || state.user !== owner || state.loading) throw new Error("Your chat session changed. Open Team Chat again.");
    };
    assertOwner();
    const token = Platform.OS === "web" ? null : await getSessionToken();
    assertOwner();
    if (Platform.OS !== "web" && !token) throw new Error("Sign in again to use Team Chat.");
    // A separate batch per operation prevents a later owner's requests from
    // sharing headers with a queued earlier operation.
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({
      url: `${getApiBaseUrl()}/api/trpc`, transformer: superjson,
      headers() {
        assertOwner();
        return { "X-Phone11-Chat-Owner": String(owner!.id), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      },
      fetch(url, options) {
        assertOwner();
        return fetchWithTimeout(url, { ...options, credentials: Platform.OS === "web" ? "include" : "omit" });
      },
    })] });
    const result = await run(client);
    assertOwner();
    return result;
  };
  return {
    list: tenantId => withClient(client => client.chat.list.query({ tenantId })),
    directory: tenantId => withClient(client => client.chat.directory.query({ tenantId })),
    create: (tenantId, kind, name, memberIds) => withClient(client => client.chat.create.mutate({ tenantId, kind, name, memberIds })),
    history: (tenantId, id, before) => withClient(client => client.chat.history.query({ tenantId, id, before })),
    search: (tenantId, id, text) => withClient(client => client.chat.search.query({ tenantId, id, text })),
    send: (tenantId, id, clientId, content) => withClient(client => client.chat.send.mutate({ tenantId, id, clientId, content })),
    read: (tenantId, id, through) => withClient(client => client.chat.read.mutate({ tenantId, id, through })),
  };
}
