import { describe, expect, it, vi } from "vitest";
import {
  callBlockNumberKey,
  createCallBlocksStore,
} from "../lib/phone/call-blocks";

describe("owner-scoped call blocklist", () => {
  it("normalizes one number and persists its explicit reason per owner", async () => {
    let owner: number | null = 7;
    const data = new Map<string, string>();
    const storage = {
      getItem: vi.fn(async (key: string) => data.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        data.set(key, value);
      }),
    };
    const store = createCallBlocksStore(storage, () => owner, () => 1234);
    await store.load(7);
    await store.set(7, "081 234 5678", "spam");
    expect(store.getSnapshot()).toMatchObject({
      ownerUserId: 7,
      entries: [{ number: "+66812345678", reason: "spam", updatedAt: 1234 }],
    });
    expect(
      JSON.parse(data.get("phone11_call_blocks_v1_user_7")!),
    ).toEqual([
      { number: "+66812345678", reason: "spam", updatedAt: 1234 },
    ]);

    await store.set(7, "+66812345678", "other");
    expect(store.getSnapshot().entries).toHaveLength(1);
    expect(store.getSnapshot().entries[0].reason).toBe("other");

    await store.set(7, "0812345678", null);
    expect(store.getSnapshot().entries).toEqual([]);

    owner = 8;
    await store.load(8);
    await expect(store.set(7, "0812345678", "spam")).rejects.toThrow(
      "owner changed",
    );
    expect(store.getSnapshot()).toMatchObject({ ownerUserId: 8, entries: [] });
  });

  it("fails closed on corrupt persisted content and preserves extensions", async () => {
    const store = createCallBlocksStore(
      {
        getItem: async () => '{"not":"a list"}',
        setItem: async () => undefined,
      },
      () => 7,
    );
    await store.load(7);
    expect(store.getSnapshot()).toMatchObject({
      ownerUserId: 7,
      entries: [],
      error: "Could not load blocked numbers. Pull to retry.",
    });
    expect(callBlockNumberKey("3001")).toBe("3001");
  });
});
