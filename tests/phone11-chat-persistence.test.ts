import { describe, expect, it, vi } from "vitest";
import { createChatPersistence, decodePending, type PendingStorage } from "../lib/chat/persistence";
import { createChatStore, type ChatTransport } from "../lib/chat/state";
import type { ChatMessage } from "../lib/chat/types";
const room = "e2c949c0-9988-4000-8000-663bee2e3eaa";
const message = (senderId = 1): ChatMessage => ({ id: "c68a7adf-7654-4000-8000-99e17ef3c456", clientId: "dc999694-9999-4000-8000-848848d0c731", channelId: room,
  senderId, senderName: "You", content: "Keep this after restart", timestamp: 10, sequence: 0, status: "sending" });
function memoryStorage() {
  const rows = new Map<string, string>();
  const storage: PendingStorage = { getItem: async k => rows.get(k) ?? null, setItem: async (k, v) => { rows.set(k, v); },
    removeItem: async k => { rows.delete(k); }, getAllKeys: async () => [...rows.keys()] };
  return { rows, storage };
}
const api = (tenant = 10): ChatTransport => ({
  list: async () => ({ workspace: { id: tenant, name: "Work" }, workspaces: [], channels: [{ id: room, name: "Private", kind: "direct", memberIds: [1, 2], lastMessage: null, lastMessageAt: 0, unreadCount: 0 }] }),
  search: async () => ({ messages: [], hasMore: false }),
  directory: async () => [], create: async () => ({ id: room }), history: async () => ({ messages: [], hasMore: false }),
  send: vi.fn(async (_tenant, _id, clientId, content) => ({ ...message(), id: "persisted", clientId, content, status: "sent" as const, sequence: 5 })), read: async () => ({ ok: true }),
});
describe("durable user and tenant scoped drafts/outbox", () => {
  it("restores drafts and interrupted sends as Failed; never automatically sends", async () => {
    const { storage } = memoryStorage(); const persistence = createChatPersistence(storage);
    await persistence.save(1, 10, { drafts: { [room]: "Typed draft" }, messages: { [room]: [message()] } });
    const network = api(), restarted = createChatStore(network, createChatPersistence(storage));
    restarted.getState().setUser(1); await restarted.getState().loadChannels();
    expect(restarted.getState().drafts[room]).toBe("Typed draft"); expect(restarted.getState().messages[room][0].status).toBe("failed"); expect(network.send).not.toHaveBeenCalled();
    await restarted.getState().retryMessage(room, message().clientId);
    expect(network.send).toHaveBeenCalledWith(10, room, message().clientId, message().content);
    expect((await persistence.load(1, 10)).messages).toEqual({});
  });
  it("persists a newly typed draft and failed message through a new store instance", async () => {
    const { storage } = memoryStorage(); const persistence = createChatPersistence(storage), network = api();
    vi.mocked(network.send).mockRejectedValue(new Error("offline"));
    const first = createChatStore(network, persistence); first.getState().setUser(1); await first.getState().loadChannels();
    first.getState().setDraft(room, "draft text"); await persistence.load(1, 10); // ordered flush
    const second = createChatStore(network, persistence); second.getState().setUser(1); await second.getState().loadChannels(); expect(second.getState().drafts[room]).toBe("draft text");
    await second.getState().sendMessage(room, "message text");
    const third = createChatStore(network, persistence); third.getState().setUser(1); await third.getState().loadChannels();
    expect(third.getState().drafts[room]).toBe(""); expect(third.getState().messages[room][0]).toMatchObject({ content: "message text", status: "failed" });
  });
  it("does not hydrate another user or tenant's pending text", async () => {
    const { storage } = memoryStorage(), persistence = createChatPersistence(storage);
    await persistence.save(1, 10, { drafts: { [room]: "private" }, messages: { [room]: [message()] } });
    expect(await persistence.load(2, 10)).toEqual({ drafts: {}, messages: {} }); expect(await persistence.load(1, 20)).toEqual({ drafts: {}, messages: {} });
    const other = createChatStore(api(), persistence); other.getState().setUser(2); await other.getState().loadChannels(); expect(other.getState().messages).toEqual({});
  });
  it("logout deletion runs after an already-pending disk write", async () => {
    const { rows, storage } = memoryStorage(); let release!: () => void;
    storage.setItem = async (k, v) => { await new Promise<void>(resolve => { release = resolve; }); rows.set(k, v); };
    const persistence = createChatPersistence(storage);
    const save = persistence.save(1, 10, { drafts: { [room]: "private" }, messages: {} }); await Promise.resolve(); await Promise.resolve();
    const clear = persistence.clearOwner(1); release(); await save; await clear;
    expect(rows.size).toBe(0);
  });
  it("a logout during pending persistence prevents the old message from being sent", async () => {
    const { storage } = memoryStorage(); const persistence = createChatPersistence(storage), network = api();
    const state = createChatStore(network, persistence); state.getState().setUser(1); await state.getState().loadChannels();
    let release!: () => void;
    const original = storage.setItem;
    storage.setItem = async (k, v) => { await new Promise<void>(resolve => { release = resolve; }); await original(k, v); };
    const send = state.getState().sendMessage(room, "private"); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    state.getState().setUser(null); release(); await send;
    expect(network.send).not.toHaveBeenCalled(); expect(await persistence.load(1, 10)).toEqual({ drafts: {}, messages: {} });
  });
  it("never marks or sends a message when the phone cannot save its pending text", async () => {
    const { storage } = memoryStorage(); storage.setItem = async () => { throw new Error("disk full"); };
    const network = api(), state = createChatStore(network, createChatPersistence(storage)); state.getState().setUser(1); await state.getState().loadChannels();
    await state.getState().sendMessage(room, "private");
    expect(network.send).not.toHaveBeenCalled(); expect(state.getState().messages[room][0].status).toBe("failed"); expect(state.getState().storageError).toContain("Could not save");
  });
  it("validates cached identity, message size, status and channel before restoring", () => {
    const data = JSON.stringify({ version: 1, drafts: { [room]: "okay", bad: "not a room" }, messages: { [room]: [message(2), { ...message(), status: "sent" }, { ...message(), content: "x".repeat(4001) }, message()] } });
    const result = decodePending(data, 1); expect(result.drafts).toEqual({ [room]: "okay" }); expect(result.messages[room]).toHaveLength(1); expect(result.messages[room][0].status).toBe("failed");
  });
  it("waits for pending hydration before saving newly typed drafts", async () => {
    const { storage } = memoryStorage(), persistence = createChatPersistence(storage);
    const otherRoom = "ba772ee1-eeee-4000-8000-118133244edd";
    await persistence.save(1, 10, { drafts: { [otherRoom]: "existing draft" }, messages: {} });
    let release!: () => void; const original = storage.getItem;
    storage.getItem = async key => { await new Promise<void>(resolve => { release = resolve; }); return original(key); };
    const state = createChatStore(api(), persistence); state.getState().setUser(1);
    const loading = state.getState().loadChannels(); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    state.getState().setDraft(room, "new draft"); release(); await loading;
    storage.getItem = original;
    const saved = await persistence.load(1, 10); expect(saved.drafts[otherRoom]).toBe("existing draft"); expect(saved.drafts[room]).toBe("new draft");
  });
  it("clears only the signing-out owner's storage", async () => {
    const { storage } = memoryStorage(), persistence = createChatPersistence(storage);
    await persistence.save(1, 10, { drafts: { [room]: "one" }, messages: {} }); await persistence.save(11, 10, { drafts: { [room]: "eleven" }, messages: {} });
    await persistence.clearOwner(1); expect((await persistence.load(11, 10)).drafts[room]).toBe("eleven");
  });
});
