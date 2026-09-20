import { create } from "zustand";
import type { ChatPersistence } from "./persistence";
import type { ChatAllMention, ChatAttachment, ChatChannel, ChatConversationDetails, ChatKind, ChatMention, ChatMessage, ChatParentPreview, ChatPerson, ChatWorkspace } from "./types";
export interface ChatThread { root: ChatMessage; replies: ChatMessage[]; hasMore: boolean }
export interface ChatTransport {
  list(tenantId?: number): Promise<{ workspace: ChatWorkspace; workspaces: ChatWorkspace[]; channels: ChatChannel[] }>;
  directory(tenantId: number): Promise<ChatPerson[]>;
  create(tenantId: number, kind: ChatKind, name: string, memberIds: number[]): Promise<{ id: string }>;
  history(tenantId: number, id: string, before?: number): Promise<{ messages: ChatMessage[]; hasMore: boolean; latestSequence?: number }>;
  search(tenantId: number, id: string, text: string): Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  thread(tenantId: number, id: string, parentMessageId: string, before?: number): Promise<ChatThread>;
  send(tenantId: number, id: string, clientId: string, content: string, parentMessageId?: string, attachmentIds?: string[], mentions?: Pick<ChatMention, "userId" | "start" | "length">[], allMention?: ChatAllMention): Promise<ChatMessage>;
  details?: (tenantId: number, id: string) => Promise<ChatConversationDetails>;
  report(tenantId: number, id: string, category: "harassment" | "spam" | "safety" | "other", comment?: string, messageId?: string): Promise<{ recorded: true }>;
  block(tenantId: number, userId: number): Promise<{ blocked: true }>;
  unblock(tenantId: number, userId: number): Promise<{ blocked: false }>;
  read(tenantId: number, id: string, through: number): Promise<unknown>;
}
function newId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16); return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
export function chatDraftKey(roomId: string, rootId?: string) { return rootId ? `${roomId}:thread:${rootId}` : roomId; }
export function chatError(error: unknown): string {
  const code = (error as any)?.data?.code;
  if (code === "UNAUTHORIZED") return "Your session expired. Sign in again to use Team Chat.";
  if (code === "FORBIDDEN") return "You no longer have access to this workspace. Contact your administrator.";
  if (code === "NOT_FOUND") return "Team Chat is not available for this conversation. Refresh or contact your administrator.";
  if (code === "PRECONDITION_FAILED") return "Direct messaging is blocked for this workspace relationship.";
  // Do not expose raw server/SQL errors to the app.
  return "Could not connect to Team Chat. Check your connection and try again.";
}
function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]) {
  const result = new Map(existing.map(m => [`${m.senderId}:${m.clientId}`, m]));
  incoming.forEach(m => result.set(`${m.senderId}:${m.clientId}`, m));
  // Server sequence is authoritative; transaction timestamps and phone clocks can
  // be out of order. Keep unacknowledged local messages after saved history.
  return [...result.values()].sort((a, b) => a.status === "sent" && b.status === "sent" ? a.sequence - b.sequence
    : a.status === "sent" ? -1 : b.status === "sent" ? 1 : a.timestamp - b.timestamp);
}
interface ChatState {
  userId: number | null; workspace: ChatWorkspace | null; workspaces: ChatWorkspace[];
  channels: ChatChannel[]; messages: Record<string, ChatMessage[]>; people: ChatPerson[];
  drafts: Record<string, string>; storageError: string | null;
  setDraft: (id: string, text: string) => void;
  loading: boolean; error: string | null; roomErrors: Record<string, string | null>;
  roomLoading: Record<string, boolean>; hasMore: Record<string, boolean>; latestSequences: Record<string, number>;
  setUser: (id: number | null) => void;
  loadChannels: (tenantId?: number) => Promise<void>;
  cancelChannelRefresh: () => void;
  loadDirectory: () => Promise<void>;
  createConversation: (kind: ChatKind, name: string, memberIds: number[]) => Promise<string>;
  loadMessages: (id: string, older?: boolean) => Promise<void>;
  loadThread: (id: string, parentMessageId: string, before?: number) => Promise<ChatThread>;
  reportMessage: (id: string, category: "harassment" | "spam" | "safety" | "other", comment?: string, messageId?: string) => Promise<void>;
  blockMember: (userId: number) => Promise<void>;
  unblockMember: (userId: number) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  searchMessages: (id: string, text: string) => Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  sendMessage: (id: string, content: string, parentMessageId?: string, attachments?: ChatAttachment[], mentions?: Pick<ChatMention, "userId" | "start" | "length">[], allMention?: ChatAllMention) => Promise<void>;
  loadDetails: (id: string) => Promise<ChatConversationDetails>;
  retryMessage: (id: string, clientId: string) => Promise<void>;
}
export function createChatStore(api: ChatTransport, persistence?: ChatPersistence) {
  let generation = 0;
  let channelRequest = 0;
  let restoredWorkspace: number | null = null;
  let restoreInFlight: Promise<void> | null = null;
  let restoreFailed = false;
  let requestedWorkspace: number | undefined;
  let channelRefreshInFlight: Promise<void> | null = null;
  let readRefreshQueue: Promise<void> = Promise.resolve();
  // A room screen and the foreground refresh can both notice the same unread
  // message. Keep one acknowledgement in flight for that room so opening a
  // chat never produces duplicate read receipts.
  const readRequests = new Map<string, Promise<void>>();
  const readCursors = new Map<string, number>();
  const empty = () => ({ workspace: null, workspaces: [], channels: [], messages: {}, people: [], drafts: {}, storageError: null, loading: false, error: null, roomErrors: {}, roomLoading: {}, hasMore: {}, latestSequences: {} });
  return create<ChatState>((set, get) => {
    const persist = async () => {
      const current = generation;
      if (restoreInFlight) await restoreInFlight;
      if (current !== generation || restoreFailed) return false;
      const state = get();
      if (!persistence || !state.userId || !state.workspace) return true;
      const messages = Object.fromEntries(Object.entries(state.messages).map(([id, rows]) =>
        [id, rows.filter(m => m.senderId === state.userId && m.status !== "sent")]).filter(([, rows]) => (rows as ChatMessage[]).length));
      try {
        await persistence.save(state.userId, state.workspace.id, { drafts: state.drafts, messages });
        if (current === generation) set({ storageError: null });
        return true;
      } catch {
        if (current === generation) set({ storageError: "Could not save your draft on this phone. Keep this screen open and try again." });
        return false;
      }
    };
    const refreshChannelsAfterRead = async (current: number) => {
      if (current !== generation) return;
      // A foreground refresh may have started before the read acknowledgement.
      // Its response reflects the old cursor, so invalidate it and wait for it
      // to finish before fetching the authoritative unread count.
      const inFlight = channelRefreshInFlight;
      if (get().loading && inFlight) {
        const staleRequest = channelRequest;
        channelRequest++;
        await inFlight;
        if (current !== generation) return;
        if (channelRequest === staleRequest + 1 && get().loading) set({ loading: false });
      }
      if (current === generation) await get().loadChannels();
    };
    const queueReadRefresh = (current: number) => {
      const refresh = readRefreshQueue.then(() => refreshChannelsAfterRead(current), () => refreshChannelsAfterRead(current));
      readRefreshQueue = refresh.catch(() => { /* A stale generation cannot block later reads. */ });
      return refresh;
    };
    const deliver = async (id: string, pending: ChatMessage) => {
      const state = get();
      if (!state.userId || !state.workspace || pending.senderId !== state.userId || !state.channels.some(c => c.id === id)) return;
      const current = generation;
      const matchesPending = (m: ChatMessage) => m.senderId === pending.senderId && m.clientId === pending.clientId;
      set(s => ({ messages: { ...s.messages, [id]: (s.messages[id] || []).map(m => matchesPending(m) ? { ...m, status: "sending" } : m) },
        roomErrors: { ...s.roomErrors, [id]: null } }));
      if (!await persist()) {
        if (current === generation) set(s => ({ messages: { ...s.messages, [id]: (s.messages[id] || []).map(m => matchesPending(m) ? { ...m, status: "failed" } : m) } }));
        return;
      }
      if (current !== generation) return;
      try {
        const attachmentIds = pending.attachments?.map(a => a.id) || [];
        const mentions = pending.mentions?.map(({ userId, start, length }) => ({ userId, start, length })) || [];
        // Retain the established five-argument call for legacy text retries.
        // Optional metadata only crosses the wire when it exists.
        const sent = pending.allMention
          ? await api.send(state.workspace.id, id, pending.clientId, pending.content, pending.parent?.id, attachmentIds, mentions, pending.allMention)
          : attachmentIds.length || mentions.length
          ? await api.send(state.workspace.id, id, pending.clientId, pending.content, pending.parent?.id, attachmentIds, mentions)
          : await api.send(state.workspace.id, id, pending.clientId, pending.content, pending.parent?.id);
        if (current !== generation) return;
        set(s => ({ messages: { ...s.messages, [id]: mergeMessages(s.messages[id] || [], [sent]) },
          channels: s.channels.map(c => c.id === id && sent.timestamp >= c.lastMessageAt ? { ...c, lastMessage: sent.content, lastMessageAt: sent.timestamp } : c).sort((a, b) => b.lastMessageAt - a.lastMessageAt) }));
        await persist();
      } catch (error) {
        if (current !== generation) return;
        const blocked = (error as any)?.data?.code === "PRECONDITION_FAILED";
        set(s => ({ messages: { ...s.messages, [id]: (s.messages[id] || []).map(m => matchesPending(m) && m.status !== "sent" ? { ...m, status: "failed" } : m) },
          roomErrors: { ...s.roomErrors, [id]: chatError(error) }, channels: blocked ? s.channels.map(channel => channel.id === id ? { ...channel, blocked: true } : channel) : s.channels }));
        await persist();
      }
    };
    return {
      userId: null, ...empty(),
      setUser: id => {
        const previous = get().userId;
        if (id !== previous) {
          generation++; readRequests.clear(); readCursors.clear(); readRefreshQueue = Promise.resolve(); channelRefreshInFlight = null; requestedWorkspace = undefined; restoredWorkspace = null; restoreInFlight = null; restoreFailed = false; set({ userId: id, ...empty() });
          if (previous && persistence) void persistence.clearOwner(previous).catch(() => {
            set({ storageError: "Could not clear saved chat drafts. Sign out again before sharing this phone." });
          });
        }
      },
      setDraft: (id, text) => {
        if (!get().userId || !get().workspace) return;
        set(s => ({ drafts: { ...s.drafts, [id]: text.slice(0, 4000) } }));
        void persist();
      },
      cancelChannelRefresh: () => {
        // Invalidate only list responses; do not discard drafts or interrupt sends.
        channelRequest++;
        if (get().loading) set({ loading: false });
      },
      loadChannels: async tenantId => {
        if (!get().userId) return;
        if (tenantId !== undefined && tenantId !== (requestedWorkspace ?? get().workspace?.id)) {
          generation++; readRequests.clear(); readCursors.clear(); readRefreshQueue = Promise.resolve(); channelRefreshInFlight = null; restoredWorkspace = null; restoreInFlight = null; restoreFailed = false; set({ ...empty() });
        }
        requestedWorkspace = tenantId ?? requestedWorkspace ?? get().workspace?.id;
        const current = generation;
        if (get().loading) return;
        const request = ++channelRequest;
        const currentRequest = () => current === generation && request === channelRequest;
        set({ loading: true, error: null });
        const refresh = (async () => {
          try {
            const data = await api.list(requestedWorkspace);
            if (!currentRequest()) return;
            requestedWorkspace = data.workspace.id;
            set({ ...data, loading: false });
            if (persistence && restoredWorkspace !== data.workspace.id) {
              restoredWorkspace = data.workspace.id;
              restoreFailed = false;
              restoreInFlight = (async () => {
                try {
                  const saved = await persistence.load(get().userId!, data.workspace.id);
                  if (current !== generation) return;
                  set(s => ({ drafts: { ...saved.drafts, ...s.drafts }, messages: Object.fromEntries(
                    [...new Set([...Object.keys(saved.messages), ...Object.keys(s.messages)])].map(id =>
                      [id, mergeMessages(saved.messages[id] || [], s.messages[id] || [])])) }));
                } catch {
                  if (current === generation) { restoredWorkspace = null; restoreFailed = true; set({ storageError: "Could not restore saved drafts. Try refreshing before writing a new message." }); }
                }
              })();
              await restoreInFlight;
            }
          } catch (error) {
            if (currentRequest()) {
              const denied = ["FORBIDDEN", "UNAUTHORIZED"].includes((error as any)?.data?.code);
              if (denied) { generation++; requestedWorkspace = undefined; restoredWorkspace = null; restoreInFlight = null; restoreFailed = false; set({ ...empty(), error: chatError(error) }); }
              else set({ loading: false, error: chatError(error) });
            }
          }
        })();
        channelRefreshInFlight = refresh;
        try { await refresh; }
        finally { if (channelRefreshInFlight === refresh) channelRefreshInFlight = null; }
      },
      loadDirectory: async () => {
        const state = get(), current = generation;
        if (!state.workspace || !state.userId) return;
        // Keep the most recently authorized directory visible while refreshing.
        // A temporary network failure must not turn an open composer into an
        // empty picker or make a user lose the context for a selected teammate.
        // An authorization failure is different: cached teammate identities
        // must not remain visible after workspace access has been revoked.
        try {
          const people = await api.directory(state.workspace.id);
          if (current === generation) set({ people });
        } catch (error) {
          if (current !== generation) throw error;
          if (["FORBIDDEN", "UNAUTHORIZED"].includes((error as any)?.data?.code)) {
            generation++; requestedWorkspace = undefined; restoredWorkspace = null; restoreInFlight = null; restoreFailed = false;
            set({ ...empty(), error: chatError(error) });
          }
          throw error;
        }
      },
      createConversation: async (kind, name, members) => {
        const state = get(), current = generation;
        if (!state.workspace || !state.userId) throw new Error("Choose a workspace first.");
        const result = await api.create(state.workspace.id, kind, name, members);
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
        await get().loadChannels();
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
        return result.id;
      },
      loadMessages: async (id, older = false) => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace || state.roomLoading[id]) return;
        const existing = state.messages[id] || [];
        const sequences = existing.filter(m => m.status === "sent").map(m => m.sequence);
        const before = older && sequences.length ? Math.min(...sequences) : undefined;
        set(s => ({ roomLoading: { ...s.roomLoading, [id]: true } }));
        try {
          const data = await api.history(state.workspace.id, id, before);
          if (current !== generation) return;
          set(s => {
            const currentMessages = s.messages[id] || [];
            const knownIds = new Set(currentMessages.filter(m => m.status === "sent").map(m => m.id));
            // A long disconnection may leave a gap larger than one page. Rebase on
            // the latest page, preserving unsent messages, so Load earlier can fill it.
            const gap = !older && data.hasMore && knownIds.size > 0 && !data.messages.some(m => knownIds.has(m.id));
            return { messages: { ...s.messages, [id]: mergeMessages(gap ? currentMessages.filter(m => m.status !== "sent") : currentMessages, data.messages) },
              roomErrors: { ...s.roomErrors, [id]: null }, roomLoading: { ...s.roomLoading, [id]: false },
              hasMore: { ...s.hasMore, [id]: older || gap || s.hasMore[id] === undefined ? data.hasMore : s.hasMore[id] },
              latestSequences: { ...s.latestSequences, [id]: Math.max(s.latestSequences[id] || 0, data.latestSequence || 0) } };
          });
          await persist();
        } catch (error) {
          if (current !== generation) return;
          const forbidden = ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes((error as any)?.data?.code);
          set(s => ({ messages: { ...s.messages, [id]: forbidden ? (s.messages[id] || []).filter(m => m.senderId === s.userId && m.status !== "sent") : s.messages[id] || [] },
            channels: forbidden ? s.channels.filter(c => c.id !== id) : s.channels,
            roomErrors: { ...s.roomErrors, [id]: chatError(error) }, roomLoading: { ...s.roomLoading, [id]: false } }));
        }
      },
      loadThread: async (id, parentMessageId, before) => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace || !state.channels.some(channel => channel.id === id)) throw new Error("Conversation is unavailable.");
        const result = await api.thread(state.workspace.id, id, parentMessageId, before);
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
        return result;
      },
      reportMessage: async (id, category, comment, messageId) => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace || !state.channels.some(channel => channel.id === id)) throw new Error("Conversation is unavailable.");
        await api.report(state.workspace.id, id, category, comment, messageId);
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
      },
      blockMember: async targetUserId => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace || targetUserId === state.userId) throw new Error("Workspace member is unavailable.");
        await api.block(state.workspace.id, targetUserId);
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
        set(s => ({ people: s.people.filter(person => person.id !== targetUserId) }));
        await get().loadChannels(state.workspace.id);
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
      },
      unblockMember: async targetUserId => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace || targetUserId === state.userId) throw new Error("Workspace member is unavailable.");
        await api.unblock(state.workspace.id, targetUserId);
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
        await get().loadChannels(state.workspace.id);
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
        await get().loadDirectory();
        if (current !== generation) throw new Error("Account changed. Open Team Chat again.");
      },
      markAsRead: async id => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace) return;
        const channel = state.channels.find(candidate => candidate.id === id);
        const sent = (state.messages[id] || []).filter(m => m.status === "sent");
        const hasIncoming = sent.some(message => message.senderId !== state.userId);
        // Root history intentionally excludes replies. The server supplies the
        // room ceiling so viewing the current room can acknowledge newer thread
        // activity instead of leaving its unread badge permanently stuck.
        const through = Math.max(0, state.latestSequences[id] || 0, ...sent.map(m => m.sequence));
        const scope = `${current}:${state.workspace.id}:${id}`;
        // A cached list can report zero while a just-loaded history page already
        // contains the incoming message. Keep the zero guard for local-only
        // history so sending a message cannot create a read receipt for itself.
        if (!channel || !through || (channel.unreadCount <= 0 && (!hasIncoming || through <= (readCursors.get(scope) || 0)))) return;
        const key = `${scope}:${through}`;
        const existing = readRequests.get(key);
        if (existing) return existing;
        let request!: Promise<void>;
        request = (async () => {
          try {
            await api.read(state.workspace!.id, id, through);
            if (current === generation) readCursors.set(scope, Math.max(readCursors.get(scope) || 0, through));
            // New messages may arrive after the acknowledged cursor. Fetch the
            // server's remaining count instead of erasing those unread messages.
            await queueReadRefresh(current);
          } catch { /* Keep the unread marker until the server acknowledges it. */ }
          finally { if (readRequests.get(key) === request) readRequests.delete(key); }
        })();
        readRequests.set(key, request);
        return request;
      },
      searchMessages: async (id, text) => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace) throw new Error("Choose a workspace first.");
        const result = await api.search(state.workspace.id, id, text);
        if (current !== generation) throw new Error("Account changed.");
        return result;
      },
      loadDetails: async id => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace || !state.channels.some(channel => channel.id === id)) throw new Error("Conversation is unavailable.");
        if (!api.details) throw new Error("Conversation details are unavailable until Team Chat is updated.");
        const details = await api.details(state.workspace.id, id);
        if (current !== generation) throw new Error("Account changed.");
        return details;
      },
      sendMessage: async (id, text, parentMessageId, attachments = [], mentions = [], allMention) => {
        const state = get(), content = text.trim();
        if (!state.userId || !state.workspace || !state.channels.some(c => c.id === id) || (!content && !attachments.length) || content.length > 4000 || attachments.length > 10) return;
        const source = parentMessageId ? (state.messages[id] || []).find(message => message.id === parentMessageId && message.status === "sent") : undefined;
        // The server remains authoritative. A local preview makes the optimistic
        // bubble intelligible while a stale/deleted parent is rejected safely.
        const parent: ChatParentPreview | null = parentMessageId ? source ? { id: source.id, senderName: source.senderName, content: source.content }
          : { id: parentMessageId, senderName: "Team member", content: "Original message is unavailable." } : null;
        const pending: ChatMessage = { id: newId(), clientId: newId(), channelId: id, senderId: state.userId, senderName: "You",
          content, timestamp: Date.now(), sequence: 0, status: "sending", parent, attachments,
          mentions: mentions.map(item => ({ ...item, name: (state.people.find(person => person.id === item.userId)?.name || "Team member") })), allMention };
        const threadRootId = source?.parent?.id || parentMessageId;
        set(s => ({ drafts: { ...s.drafts, [chatDraftKey(id, threadRootId)]: "" }, messages: { ...s.messages, [id]: [...(s.messages[id] || []), pending] }, roomErrors: { ...s.roomErrors, [id]: null } }));
        await deliver(id, pending);
      },
      retryMessage: async (id, clientId) => {
        const pending = get().messages[id]?.find(m => m.clientId === clientId && m.senderId === get().userId);
        if (pending?.status === "failed") await deliver(id, pending);
      },
    };
  });
}
