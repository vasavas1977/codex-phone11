import { describe, expect, it, vi } from "vitest";
import {
  createCallFavoritesStore,
  resolveExistingDirectChat,
  uniqueDeviceContactId,
} from "../lib/phone/call-actions";

describe("call action resolution", () => {
  it("opens only one exact device profile", () => {
    const contact = {
      id: "a",
      name: "A",
      phones: [{ number: "0812345678", label: "mobile", key: "+66812345678" }],
    };
    expect(uniqueDeviceContactId([contact], "+66812345678")).toBe("a");
    expect(uniqueDeviceContactId([contact, { ...contact, id: "b" }], "+66812345678")).toBeUndefined();
    expect(uniqueDeviceContactId([contact], "+66800000000")).toBeUndefined();
  });

  it("resolves Chat only for one exact teammate and one existing direct room", () => {
    const input = {
      number: "3002",
      ownerUserId: 1,
      workspaceId: 10,
      people: [{ id: 2, name: "Nok", extension: "3002" }],
      channels: [
        {
          id: "room",
          name: "Direct",
          kind: "direct" as const,
          memberIds: [1, 2],
          lastMessage: null,
          lastMessageAt: 0,
          unreadCount: 0, blocked: false,
        },
      ],
    };
    expect(resolveExistingDirectChat(input)).toEqual({
      personId: 2,
      conversationId: "room",
      workspaceId: 10,
    });
    expect(resolveExistingDirectChat({ ...input, number: "+6620303002" })).toBeUndefined();
    expect(resolveExistingDirectChat({ ...input, channels: [] })).toBeUndefined();
    expect(
      resolveExistingDirectChat({
        ...input,
        people: [...input.people, { id: 3, name: "Duplicate", extension: "3002" }],
      }),
    ).toBeUndefined();
  });
});

describe("owner-scoped call favorites", () => {
  it("persists stars per owner and never displays another owner's state", async () => {
    let owner: number | null = 1;
    const data = new Map<string, string>();
    const storage = {
      getItem: vi.fn(async (key: string) => data.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        data.set(key, value);
      }),
    };
    const store = createCallFavoritesStore(storage, () => owner);
    await store.load(1);
    expect(await store.toggle(1, "call-a")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      ownerUserId: 1,
      ids: ["call-a"],
    });
    expect(data.get("phone11_call_favorites_v1_user_1")).toBe('["call-a"]');

    owner = 2;
    await store.load(2);
    expect(store.getSnapshot()).toMatchObject({ ownerUserId: 2, ids: [] });
    await expect(store.toggle(1, "call-b")).rejects.toThrow("owner changed");
    expect(data.get("phone11_call_favorites_v1_user_1")).toBe('["call-a"]');
  });

  it("surfaces corrupt local state without accepting it", async () => {
    const store = createCallFavoritesStore(
      {
        getItem: async () => '{"not":"a list"}',
        setItem: async () => undefined,
      },
      () => 1,
    );
    await store.load(1);
    expect(store.getSnapshot()).toMatchObject({
      ownerUserId: 1,
      ids: [],
      loading: false,
      error: "Could not load starred calls. Pull to retry.",
    });
  });
});
