import { create } from "zustand";
import type { ChatPersistence } from "./persistence";
import type { ChatChannel, ChatKind, ChatMessage, ChatPerson, ChatWorkspace } from "./types";
export interface ChatTransport {
  list(tenantId?: number): Promise<{ workspace: ChatWorkspace; workspaces: ChatWorkspace[]; channels: ChatChannel[] }>;
  directory(tenantId: number): Promise<ChatPerson[]>;
  create(tenantId: number, kind: ChatKind, name: string, memberIds: number[]): Promise<{ id: string }>;
  history(tenantId: number, id: string, before?: number): Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  search(tenantId: number, id: string, text: string): Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  send(tenantId: number, id: string, clientId: string, content: string): Promise<ChatMessage>;
  read(tenantId: number, id: string, through: number): Promise<unknown>;
}
function newId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16); return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
export function chatError(error: unknown): string {
  const code = (error as any)?.data?.code;
  if (code === "UNAUTHORIZED") return "Your session expired. Sign in again to use Team Chat.";
  if (code === "FORBIDDEN") return "You no longer have access to this workspace. Contact your administrator.";
  if (code === "NOT_FOUND") return "Team Chat is not available for this conversation. Refresh or contact your administrator.";
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
  roomLoading: Record<string, boolean>; hasMore: Record<string, boolean>;
  setUser: (id: number | null) => void;
  loadChannels: (tenantId?: number) => Promise<void>;
  loadDirectory: () => Promise<void>;
  createConversation: (kind: ChatKind, name: string, memberIds: number[]) => Promise<string>;
  loadMessages: (id: string, older?: boolean) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  searchMessages: (id: string, text: string) => Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  sendMessage: (id: string, content: string) => Promise<void>;
  retryMessage: (id: string, clientId: string) => Promise<void>;
}
export function createChatStore(api: ChatTransport, persistence?: ChatPersistence) {
  let generation = 0;
  let restoredWorkspace: number | null = null;
  let restoreInFlight: Promise<void> | null = null;
  let restoreFailed = false;
  let requestedWorkspace: number | undefined;
  const empty = () => ({ workspace: null, workspaces: [], channels: [], messages: {}, people: [], drafts: {}, storageError: null, loading: false, error: null, roomErrors: {}, roomLoading: {}, hasMore: {} });
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
    const deliver = async (id: string, pending: ChatMessage) => {
      const state = get();
      if (!state.userId || !state.workspace || pending.senderId !== state.userId || !state.channels.some(c => c.id === id)) return;
      const current = generation;
      const matchesPending = (m: ChatMessage) => m.senderId === pending.senderId && m.clientId === pending.clientId;
      set(s => ({ messages: { ...s.messages, [id]: (s.messages[id] || []).map(m => matchesPending(m) ? { ...m, status: "sending" } : m) } }));
      if (!await persist()) {
        if (current === generation) set(s => ({ messages: { ...s.messages, [id]: (s.messages[id] || []).map(m => matchesPending(m) ? { ...m, status: "failed" } : m) } }));
        return;
      }
      if (current !== generation) return;
      try {
        const sent = await api.send(state.workspace.id, id, pending.clientId, pending.content);
        if (current !== generation) return;
        set(s => ({ messages: { ...s.messages, [id]: mergeMessages(s.messages[id] || [], [sent]) },
          channels: s.channels.map(c => c.id === id && sent.timestamp >= c.lastMessageAt ? { ...c, lastMessage: sent.content, lastMessageAt: sent.timestamp } : c).sort((a, b) => b.lastMessageAt - a.lastMessageAt) }));
        await persist();
      } catch (error) {
        if (current !== generation) return;
        set(s => ({ messages: { ...s.messages, [id]: (s.messages[id] || []).map(m => matchesPending(m) && m.status !== "sent" ? { ...m, status: "failed" } : m) },
          roomErrors: { ...s.roomErrors, [id]: chatError(error) } }));
        await persist();
      }
    };
    return {
      userId: null, ...empty(),
      setUser: id => {
        const previous = get().userId;
        if (id !== previous) {
          generation++; requestedWorkspace = undefined; restoredWorkspace = null; restoreInFlight = null; restoreFailed = false; set({ userId: id, ...empty() });
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
      loadChannels: async tenantId => {
        if (!get().userId) return;
        if (tenantId !== undefined && tenantId !== (requestedWorkspace ?? get().workspace?.id)) {
          generation++; restoredWorkspace = null; restoreInFlight = null; restoreFailed = false; set({ ...empty() });
        }
        requestedWorkspace = tenantId ?? requestedWorkspace ?? get().workspace?.id;
        const current = generation;
        if (get().loading) return;
        set({ loading: true, error: null });
        try {
          const data = await api.list(requestedWorkspace);
          if (current !== generation) return;
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
          if (current === generation) {
            const denied = ["FORBIDDEN", "UNAUTHORIZED"].includes((error as any)?.data?.code);
            if (denied) { generation++; requestedWorkspace = undefined; restoredWorkspace = null; restoreInFlight = null; restoreFailed = false; set({ ...empty(), error: chatError(error) }); }
            else set({ loading: false, error: chatError(error) });
          }
        }
      },
      loadDirectory: async () => {
        const state = get(), current = generation;
        if (!state.workspace || !state.userId) return;
        set({ people: [] });
        const people = await api.directory(state.workspace.id);
        if (current === generation) set({ people });
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
              hasMore: { ...s.hasMore, [id]: older || gap || s.hasMore[id] === undefined ? data.hasMore : s.hasMore[id] } };
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
      markAsRead: async id => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace) return;
        const through = Math.max(0, ...(state.messages[id] || []).filter(m => m.status === "sent").map(m => m.sequence));
        if (!through) return;
        try {
          await api.read(state.workspace.id, id, through);
          // New messages may arrive after the acknowledged cursor. Fetch the
          // server's remaining count instead of erasing those unread messages.
          if (current === generation) await get().loadChannels();
        } catch { /* Keep the unread marker until the server acknowledges it. */ }
      },
      searchMessages: async (id, text) => {
        const state = get(), current = generation;
        if (!state.userId || !state.workspace) throw new Error("Choose a workspace first.");
        const result = await api.search(state.workspace.id, id, text);
        if (current !== generation) throw new Error("Account changed.");
        return result;
      },
      sendMessage: async (id, text) => {
        const state = get(), content = text.trim();
        if (!state.userId || !state.workspace || !state.channels.some(c => c.id === id) || !content || content.length > 4000) return;
        const pending: ChatMessage = { id: newId(), clientId: newId(), channelId: id, senderId: state.userId, senderName: "You",
          content, timestamp: Date.now(), sequence: 0, status: "sending" };
        set(s => ({ drafts: { ...s.drafts, [id]: "" }, messages: { ...s.messages, [id]: [...(s.messages[id] || []), pending] }, roomErrors: { ...s.roomErrors, [id]: null } }));
        await deliver(id, pending);
      },
      retryMessage: async (id, clientId) => {
        const pending = get().messages[id]?.find(m => m.clientId === clientId && m.senderId === get().userId);
        if (pending?.status === "failed") await deliver(id, pending);
      },
    };
  });
}
