import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Platform } from "react-native";
import type { AppRouter } from "../../server/routers";
import { getApiBaseUrl } from "../../constants/oauth";
import { getAuthSnapshot, getSessionToken } from "../_core/auth";
import { fetchWithTimeout } from "../_core/api";
import type { ChatTransport } from "./state";

/** Bind queued message bodies to the identity that initiated them, never a later login. */
export function createChatTransport() {
  const withClient = async <T>(
    run: (client: ReturnType<typeof createTRPCClient<AppRouter>>) => Promise<T>,
  ) => {
    const owner = getAuthSnapshot().user;
    const assertOwner = () => {
      const state = getAuthSnapshot();
      if (!owner || state.user !== owner || state.loading)
        throw new Error("Your chat session changed. Open Team Chat again.");
    };
    assertOwner();
    const token = Platform.OS === "web" ? null : await getSessionToken();
    assertOwner();
    if (Platform.OS !== "web" && !token)
      throw new Error("Sign in again to use Team Chat.");
    // A separate batch per operation prevents a later owner's requests from
    // sharing headers with a queued earlier operation.
    const client = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${getApiBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers() {
            assertOwner();
            return {
              "X-Phone11-Chat-Owner": String(owner!.id),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            };
          },
          fetch(url, options) {
            assertOwner();
            return fetchWithTimeout(url, {
              ...options,
              credentials: Platform.OS === "web" ? "include" : "omit",
            });
          },
        }),
      ],
    });
    const result = await run(client);
    assertOwner();
    return result;
  };
  const base: ChatTransport = {
    list: (tenantId) =>
      withClient((client) => client.chat.list.query({ tenantId })),
    directory: (tenantId) =>
      withClient((client) => client.chat.directory.query({ tenantId })),
    create: (tenantId, kind, name, memberIds) =>
      withClient((client) =>
        client.chat.create.mutate({ tenantId, kind, name, memberIds }),
      ),
    history: (tenantId, id, before) =>
      withClient((client) =>
        client.chat.history.query({ tenantId, id, before }),
      ),
    search: (tenantId, id, text) =>
      withClient((client) => client.chat.search.query({ tenantId, id, text })),
    thread: (tenantId, id, parentMessageId, before) =>
      withClient((client) =>
        client.chat.thread.query({ tenantId, id, parentMessageId, before }),
      ),
    send: (
      tenantId: number,
      id: string,
      clientId: string,
      content: string,
      parentMessageId?: string,
      attachmentIds?: string[],
      mentions?: { userId: number; start: number; length: number }[],
    ) =>
      withClient((client) =>
        client.chat.send.mutate({
          tenantId,
          id,
          clientId,
          content,
          ...(parentMessageId ? { parentMessageId } : {}),
          ...(attachmentIds?.length ? { attachmentIds } : {}),
          ...(mentions?.length ? { mentions } : {}),
        }),
      ),
    report: (tenantId, id, category, comment, messageId) =>
      withClient((client) =>
        client.chat.report.mutate({
          tenantId,
          id,
          category,
          ...(comment ? { comment } : {}),
          ...(messageId ? { messageId } : {}),
        }),
      ),
    block: (tenantId, userId) =>
      withClient((client) => client.chat.block.mutate({ tenantId, userId })),
    unblock: (tenantId, userId) =>
      withClient((client) => client.chat.unblock.mutate({ tenantId, userId })),
    read: (tenantId, id, through) =>
      withClient((client) =>
        client.chat.read.mutate({ tenantId, id, through }),
      ),
  };
  return {
    ...base,
    details: (tenantId: number, id: string) =>
      withClient((c) => c.chat.details.query({ tenantId, id })),
    typingPublish: (tenantId: number, id: string, input: { threadRootId?: string; sessionId: string; generation: string; sequence: number; active: boolean }) =>
      withClient((c) => c.chat.typingPublish.mutate({ tenantId, id, ...input })),
    typing: (tenantId: number, id: string, threadRootId?: string) =>
      withClient((c) => c.chat.typing.query({ tenantId, id, ...(threadRootId ? { threadRootId } : {}) })),
    linkPreview: (
      tenantId: number,
      id: string,
      messageId: string,
      url: string,
    ) =>
      withClient((c) =>
        c.chat.linkPreview.query({ tenantId, id, messageId, url }),
      ),
    setReaction: (
      tenantId: number,
      id: string,
      messageId: string,
      emoji: string,
      reacted: boolean,
    ) =>
      withClient((c) =>
        c.chat.setReaction.mutate({ tenantId, id, messageId, emoji, reacted }),
      ),
    edit: (tenantId: number, id: string, messageId: string, content: string) =>
      withClient((c) =>
        c.chat.edit.mutate({ tenantId, id, messageId, content }),
      ),
    deleteMessage: (tenantId: number, id: string, messageId: string) =>
      withClient((c) => c.chat.delete.mutate({ tenantId, id, messageId })),
    setBookmark: (
      tenantId: number,
      id: string,
      messageId: string,
      bookmarked: boolean,
    ) =>
      withClient((c) =>
        c.chat.setBookmark.mutate({ tenantId, id, messageId, bookmarked }),
      ),
    setPin: (
      tenantId: number,
      id: string,
      messageId: string,
      pinned: boolean,
    ) =>
      withClient((c) =>
        c.chat.setPin.mutate({ tenantId, id, messageId, pinned }),
      ),
    bookmarks: (tenantId: number) =>
      withClient((c) => c.chat.bookmarks.query({ tenantId })),
    savedMessages: (tenantId: number, id: string) =>
      withClient((c) => c.chat.savedMessages.query({ tenantId, id })),
    pinnedMessages: (tenantId: number, id: string) =>
      withClient((c) => c.chat.pinnedMessages.query({ tenantId, id })),
    forward: (
      tenantId: number,
      id: string,
      sourceConversationId: string,
      sourceMessageId: string,
      clientId: string,
    ) =>
      withClient((c) =>
        c.chat.forward.mutate({
          tenantId,
          id,
          sourceConversationId,
          sourceMessageId,
          clientId,
        }),
      ),
    setNotificationMute: (tenantId: number, id: string, muted: boolean) =>
      withClient((c) =>
        c.chat.setNotificationMute.mutate({ tenantId, id, muted }),
      ),
    presenceCapability: (tenantId: number) =>
      withClient((c) => c.chat.presenceCapability.query({ tenantId })),
    heartbeat: (tenantId: number, session?: { sessionId: string; generation: string; sequence: number; status: "available" | "away" | "on_call" | "in_meeting"; active: boolean }) =>
      withClient((c) => c.chat.heartbeat.mutate(session ? { tenantId, ...session } : { tenantId })),
    presence: (tenantId: number, userIds: number[]) =>
      withClient((c) => c.chat.presence.query({ tenantId, userIds })),
    intelligenceCapability: (tenantId: number) =>
      withClient((c) => c.chat.intelligenceCapability.query({ tenantId })),
    summarizeThread: (tenantId: number, id: string, parentMessageId: string) =>
      withClient((c) =>
        c.chat.summarizeThread.mutate({ tenantId, id, parentMessageId }),
      ),
    translateMessage: (
      tenantId: number,
      id: string,
      messageId: string,
      targetLanguage: string,
    ) =>
      withClient((c) =>
        c.chat.translateMessage.mutate({
          tenantId,
          id,
          messageId,
          targetLanguage,
        }),
      ),
    composeDraft: (tenantId: number, id: string, instruction: string) =>
      withClient((c) =>
        c.chat.composeDraft.mutate({ tenantId, id, instruction }),
      ),
    refineDraft: (
      tenantId: number,
      id: string,
      draft: string,
      instruction: string,
    ) =>
      withClient((c) =>
        c.chat.refineDraft.mutate({ tenantId, id, draft, instruction }),
      ),
    reactionUsers: (
      tenantId: number,
      id: string,
      messageId: string,
      emoji: string,
    ) =>
      withClient((c) =>
        c.chat.reactionUsers.query({ tenantId, id, messageId, emoji }),
      ),
  };
}
