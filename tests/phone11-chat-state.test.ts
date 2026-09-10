import { describe, expect, it, vi } from "vitest";
import { createChatStore, type ChatTransport } from "../lib/chat/state";
import type { ChatMessage } from "../lib/chat/types";
const channel = { id: "room", name: "Team", kind: "group" as const, memberIds: [1, 2], lastMessage: null, lastMessageAt: 1, unreadCount: 2 };
const saved = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({ id: "server-row", channelId: "room", clientId: "client", senderId: 1, senderName: "One", content: "hello", timestamp: 10, sequence: 1, status: "sent", ...overrides });
function setup(overrides: Partial<ChatTransport> = {}) {
  const api: ChatTransport = {
    list: vi.fn(async () => ({ workspace: { id: 10, name: "Alpha" }, workspaces: [{ id: 10, name: "Alpha" }], channels: [channel] })),
    search: vi.fn(async () => ({ messages: [], hasMore: false })),
    directory: vi.fn(async () => []), create: vi.fn(async () => ({ id: "room" })),
    history: vi.fn(async () => ({ messages: [], hasMore: false })), send: vi.fn(async (_tenant, _id, clientId, content) => saved({ clientId, content })),
    read: vi.fn(async () => ({ ok: true })), ...overrides,
  };
  const store = createChatStore(api); store.getState().setUser(1);
  return { store, api };
}
describe("Team Chat network state", () => {
  it("starts empty and does not make requests while signed out", async () => {
    const { store, api } = setup(); store.getState().setUser(null);
    await store.getState().loadChannels(); await store.getState().sendMessage("room", "hello");
    expect(api.list).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled(); expect(store.getState().channels).toEqual([]);
  });
  it("waits for server acknowledgement before showing Sent", async () => {
    let finish!: (message: ChatMessage) => void;
    const { store } = setup({ send: vi.fn(() => new Promise<ChatMessage>(resolve => { finish = resolve; })) });
    await store.getState().loadChannels(); const request = store.getState().sendMessage("room", "hello");
    const pending = store.getState().messages.room[0]; expect(pending.status).toBe("sending");
    await Promise.resolve(); finish(saved({ clientId: pending.clientId })); await request;
    expect(store.getState().messages.room).toHaveLength(1); expect(store.getState().messages.room[0].status).toBe("sent");
  });
  it("retains failed messages and retries with the same idempotency key", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (_t, _r, clientId, content) => saved({ clientId, content }));
    const { store } = setup({ send }); await store.getState().loadChannels(); await store.getState().sendMessage("room", "hello");
    const pending = store.getState().messages.room[0]; expect(pending.status).toBe("failed");
    await store.getState().retryMessage("room", pending.clientId);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]); expect(store.getState().messages.room).toHaveLength(1); expect(store.getState().messages.room[0].status).toBe("sent");
  });
  it("merges a lost-response retry with the server history instead of duplicating it", async () => {
    const { store, api } = setup({ send: vi.fn().mockRejectedValue(new Error("lost response")) }); await store.getState().loadChannels(); await store.getState().sendMessage("room", "hello");
    const pending = store.getState().messages.room[0]; vi.mocked(api.history).mockResolvedValue({ messages: [saved({ clientId: pending.clientId })], hasMore: false });
    await store.getState().loadMessages("room"); expect(store.getState().messages.room).toHaveLength(1); expect(store.getState().messages.room[0].status).toBe("sent");
  });
  it("does not allow another sender's client key to replace a message", async () => {
    const { store } = setup({ history: vi.fn(async () => ({ messages: [saved(), saved({ id: "other", senderId: 2 })], hasMore: false })) });
    await store.getState().loadChannels(); await store.getState().loadMessages("room"); expect(store.getState().messages.room).toHaveLength(2);
  });
  it("does not return a new conversation to a different account after list refresh", async () => {
    const { store, api } = setup(); await store.getState().loadChannels();
    let finish!: (value: Awaited<ReturnType<ChatTransport["list"]>>) => void;
    vi.mocked(api.list).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const creating = store.getState().createConversation("group", "Work", [2]);
    const rejection = expect(creating).rejects.toThrow("Account changed");
    await Promise.resolve(); store.getState().setUser(2);
    finish({ workspace: { id: 10, name: "Old workspace" }, workspaces: [], channels: [channel] });
    await rejection;
  });
  it("clears all account data and rejects late responses after logout", async () => {
    let finish!: (value: Awaited<ReturnType<ChatTransport["list"]>>) => void;
    const { store } = setup({ list: () => new Promise(resolve => { finish = resolve; }) });
    const request = store.getState().loadChannels(); store.getState().setUser(null);
    finish({ workspace: { id: 10, name: "Old workspace" }, workspaces: [], channels: [channel] }); await request;
    expect(store.getState().channels).toEqual([]); expect(store.getState().workspace).toBeNull();
  });
  it("does not restore a previous account's pending send after account switching", async () => {
    let finish!: (value: ChatMessage) => void;
    const { store } = setup({ send: () => new Promise(resolve => { finish = resolve; }) }); await store.getState().loadChannels();
    const request = store.getState().sendMessage("room", "private message"); await Promise.resolve(); store.getState().setUser(2); finish(saved()); await request;
    expect(store.getState().messages).toEqual({}); expect(store.getState().userId).toBe(2);
  });
  it("keeps unread counts until server acknowledgement", async () => {
    const { store, api } = setup({ history: vi.fn(async () => ({ messages: [saved()], hasMore: false })), read: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true }) });
    await store.getState().loadChannels(); await store.getState().loadMessages("room"); await store.getState().markAsRead("room");
    expect(store.getState().channels[0].unreadCount).toBe(2); await store.getState().markAsRead("room"); expect(store.getState().channels[0].unreadCount).toBe(0); expect(api.read).toHaveBeenCalledWith(10, "room", 1);
  });
  it("clears revoked workspace data instead of showing cached conversations", async () => {
    const { store, api } = setup(); await store.getState().loadChannels();
    vi.mocked(api.list).mockRejectedValue({ data: { code: "FORBIDDEN" } }); await store.getState().loadChannels();
    expect(store.getState().channels).toEqual([]); expect(store.getState().workspace).toBeNull(); expect(store.getState().error).toContain("no longer have access");
  });
  it("recovers a history gap after a long disconnection", async () => {
    const { store, api } = setup({ history: vi.fn().mockResolvedValueOnce({ messages: [saved({ sequence: 1 })], hasMore: false }) });
    await store.getState().loadChannels(); await store.getState().loadMessages("room");
    vi.mocked(api.history).mockResolvedValue({ messages: [saved({ id: "new", clientId: "new", sequence: 300 })], hasMore: true });
    await store.getState().loadMessages("room");
    expect(store.getState().messages.room.map(m => m.sequence)).toEqual([300]);
    expect(store.getState().hasMore.room).toBe(true);
    await store.getState().loadMessages("room", true); expect(api.history).toHaveBeenLastCalledWith(10, "room", 300);
  });
  it("loads earlier server pages without removing recent messages", async () => {
    const { store, api } = setup({ history: vi.fn().mockResolvedValueOnce({ messages: [saved({ sequence: 200 })], hasMore: true }).mockResolvedValueOnce({ messages: [saved({ clientId: "older", sequence: 1, timestamp: 1 })], hasMore: false }) });
    await store.getState().loadChannels(); await store.getState().loadMessages("room"); await store.getState().loadMessages("room", true);
    expect(api.history).toHaveBeenLastCalledWith(10, "room", 200); expect(store.getState().messages.room).toHaveLength(2); expect(store.getState().hasMore.room).toBe(false);
  });
});
