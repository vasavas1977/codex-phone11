import { describe, expect, it, vi } from "vitest";
import { ChatTypingRegistry } from "../server/chat/typing";
import { createTypingLifecycleController } from "../lib/chat/typing-controller";
import { typingText } from "../lib/chat/typing-format";

const base = { tenantId: 10, conversationId: "room", threadRootId: null, userId: 2,
  sessionId: "phone", generation: "generation", sequence: 1, active: true };

describe("ephemeral typing leases", () => {
  it("keeps device sessions independent and rejects a late true after false", () => {
    const registry = new ChatTypingRegistry();
    registry.publish(base, 1_000);
    registry.publish({ ...base, sessionId: "desktop", sequence: 1 }, 1_000);
    registry.publish({ ...base, sequence: 2, active: false }, 2_000);
    expect(registry.activeUsers(base, 2_001)).toEqual([2]);
    expect(registry.publish({ ...base, sequence: 1, active: true }, 2_002).accepted).toBe(false);
    expect(registry.activeUsers(base, 11_001)).toEqual([]);
  });

  it("isolates tenant, conversation and thread scopes", () => {
    const registry = new ChatTypingRegistry();
    registry.publish({ ...base, threadRootId: "thread-a" }, 1_000);
    expect(registry.activeUsers({ ...base, threadRootId: null }, 1_001)).toEqual([]);
    expect(registry.activeUsers({ ...base, threadRootId: "thread-b" }, 1_001)).toEqual([]);
    expect(registry.activeUsers({ ...base, threadRootId: "thread-a" }, 1_001)).toEqual([2]);
    expect(registry.activeUsers({ ...base, tenantId: 20, threadRootId: "thread-a" }, 1_001)).toEqual([]);
  });

  it("bounds sessions per user and prunes expired leases", () => {
    const registry = new ChatTypingRegistry();
    for (let index = 0; index < 8; index++) expect(registry.publish({ ...base, sessionId: `device-${index}` }, 1_000).accepted).toBe(true);
    expect(registry.publish({ ...base, sessionId: "device-9" }, 1_000).accepted).toBe(false);
    expect(registry.activeUsers(base, 11_001)).toEqual([]);
    expect(registry.size()).toBe(8);
    registry.activeUsers(base, 41_001); expect(registry.size()).toBe(0);
  });
});

describe("typing publisher lifecycle", () => {
  it("does not publish for a restored or programmatically populated draft", async () => {
    const send = vi.fn(async () => undefined);
    createTypingLifecycleController({ nextSequence: () => 1, canSend: () => true, send });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });

  it("orders a stop after an in-flight start so a delayed true cannot win", async () => {
    let releaseStart!: () => void;
    const startPending = new Promise<void>(resolve => { releaseStart = resolve; });
    const sent: { sequence: number; active: boolean }[] = [];
    let sequence = 0;
    const controller = createTypingLifecycleController({
      nextSequence: () => ++sequence,
      canSend: () => true,
      send: async state => { sent.push(state); if (state.active) await startPending; },
    });
    controller.onUserEdit("h");
    await vi.waitFor(() => expect(sent).toEqual([{ sequence: 1, active: true }]));
    controller.stop();
    releaseStart();
    await vi.waitFor(() => expect(sent).toEqual([
      { sequence: 1, active: true },
      { sequence: 2, active: false },
    ]));
  });

  it("stops after inactivity and when the screen backgrounds", async () => {
    vi.useFakeTimers();
    try {
      const sent: { sequence: number; active: boolean }[] = [];
      let sequence = 0;
      const controller = createTypingLifecycleController({
        nextSequence: () => ++sequence,
        canSend: () => true,
        send: async state => { sent.push(state); },
      });
      controller.onUserEdit("hello");
      await vi.advanceTimersByTimeAsync(5_001);
      expect(sent.map(item => item.active)).toEqual([true, false]);
      controller.onUserEdit("again");
      await vi.runOnlyPendingTimersAsync();
      controller.stop();
      await Promise.resolve();
      expect(sent.at(-1)?.active).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops starts after an auth or thread scope change but clears the captured scope", async () => {
    let sequence = 0;
    let currentScope = "thread-a";
    let now = 1_000;
    const sent: { sequence: number; active: boolean }[] = [];
    const controller = createTypingLifecycleController({
      nextSequence: () => ++sequence,
      canSend: state => !state.active || currentScope === "thread-a",
      send: async state => { sent.push(state); },
      now: () => now,
    });
    controller.onUserEdit("a");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    currentScope = "thread-b";
    now += 4_000;
    controller.onUserEdit("ab");
    controller.dispose();
    await vi.waitFor(() => expect(sent.at(-1)?.active).toBe(false));
    expect(sent.filter(item => item.active)).toHaveLength(1);
  });

  it("does not let cleanup from an old auth session publish as the replacement user", async () => {
    let ownerIsCurrent = true;
    let sequence = 0;
    const sent: { sequence: number; active: boolean }[] = [];
    const controller = createTypingLifecycleController({
      nextSequence: () => ++sequence,
      canSend: () => ownerIsCurrent,
      send: async state => { sent.push(state); },
    });
    controller.onUserEdit("hello");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    ownerIsCurrent = false;
    controller.dispose();
    await Promise.resolve();
    expect(sent).toEqual([{ sequence: 1, active: true }]);
  });
});

it("formats compact named one-to-one and group indicators", () => {
  expect(typingText([])).toBe("");
  expect(typingText(["Nicha"])).toBe("Nicha is typing…");
  expect(typingText(["Nicha", "Arun"])).toBe("Nicha and Arun are typing…");
  expect(typingText(["Nicha", "Arun", "May"])).toBe("Nicha, Arun and 1 other are typing…");
  expect(typingText(["Nicha", "Arun", "May", "Krit"])).toBe("Nicha, Arun and 2 others are typing…");
});
