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
    expect(store.getState().channels[0].unreadCount).toBe(2);
    vi.mocked(api.list).mockResolvedValue({ workspace: { id: 10, name: "Alpha" }, workspaces: [], channels: [{ ...channel, unreadCount: 0 }] });
    await store.getState().markAsRead("room"); expect(store.getState().channels[0].unreadCount).toBe(0); expect(api.read).toHaveBeenCalledWith(10, "room", 1);
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
  it("retains newer unread messages when an older read acknowledgment arrives", async () => {
    let finish!: () => void;
    const { store, api } = setup({ history: async () => ({ messages: [saved()], hasMore: false }), read: () => new Promise<void>(resolve => { finish = resolve; }) });
    await store.getState().loadChannels(); await store.getState().loadMessages("room");
    const reading = store.getState().markAsRead("room");
    vi.mocked(api.list).mockResolvedValue({ workspace: { id: 10, name: "Alpha" }, workspaces: [], channels: [{ ...channel, unreadCount: 1, lastMessage: "Arrived during read" }] });
    finish(); await reading;
    expect(store.getState().channels[0].unreadCount).toBe(1);
  });
  it("orders saved messages by server sequence even when timestamps regress", async () => {
    const { store } = setup({ history: async () => ({ messages: [saved({ sequence: 1, timestamp: 200 }), saved({ id: "second", clientId: "second", sequence: 2, timestamp: 100 })], hasMore: false }) });
    await store.getState().loadChannels(); await store.getState().loadMessages("room");
    expect(store.getState().messages.room.map(m => m.sequence)).toEqual([1, 2]);
  });
  it("honors the latest workspace selection while an earlier workspace is still loading", async () => {
    let first!: (value: Awaited<ReturnType<ChatTransport["list"]>>) => void;
    const { store, api } = setup(); await store.getState().loadChannels();
    vi.mocked(api.list).mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
      .mockResolvedValueOnce({ workspace: { id: 30, name: "Gamma" }, workspaces: [], channels: [] });
    const previous = store.getState().loadChannels(20); await store.getState().loadChannels(30);
    first({ workspace: { id: 20, name: "Beta" }, workspaces: [], channels: [channel] }); await previous;
    expect(store.getState().workspace?.id).toBe(30); expect(store.getState().channels).toEqual([]);
  });
  it("preserves pending text but removes cached received messages when conversation access is revoked", async () => {
    const { store, api } = setup({ send: vi.fn().mockRejectedValue(new Error("offline")) });
    await store.getState().loadChannels(); store.getState().setDraft("room", "keep draft");
    await store.getState().sendMessage("room", "keep failed message");
    store.getState().setDraft("room", "next draft");
    vi.mocked(api.history).mockResolvedValueOnce({ messages: [saved({ senderId: 2 })], hasMore: false });
    await store.getState().loadMessages("room");
    vi.mocked(api.history).mockRejectedValue({ data: { code: "NOT_FOUND" } });
    await store.getState().loadMessages("room");
    expect(store.getState().messages.room).toHaveLength(1);
    expect(store.getState().messages.room[0]).toMatchObject({ content: "keep failed message", status: "failed" });
    expect(store.getState().drafts.room).toBe("next draft"); expect(store.getState().channels).toEqual([]);
    await store.getState().retryMessage("room", store.getState().messages.room[0].clientId);
    await store.getState().sendMessage("room", "blocked");
    expect(api.send).toHaveBeenCalledTimes(1);
  });
  it("does not downgrade another sender's matching client key when retrying", async () => {
    const { store, api } = setup({ send: vi.fn().mockRejectedValue(new Error("offline")) });
    await store.getState().loadChannels(); await store.getState().sendMessage("room", "pending");
    const pending = store.getState().messages.room[0];
    vi.mocked(api.history).mockResolvedValue({ messages: [saved({ clientId: pending.clientId, senderId: 2 })], hasMore: false });
    await store.getState().loadMessages("room"); await store.getState().retryMessage("room", pending.clientId);
    expect(store.getState().messages.room.find(m => m.senderId === 2)?.status).toBe("sent");
  });
});
