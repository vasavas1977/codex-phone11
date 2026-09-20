import { beforeEach, expect, it, vi } from "vitest";
import { createReadReceiptController, createReadReceiptRequestGuard, createReadReceiptSummaryLoader, READ_RECEIPT_VIEW_AREA_PERCENT } from "../lib/chat/read-receipts";

beforeEach(() => vi.useFakeTimers());

it("publishes only after a focused visible dwell and cancels when obscured", async () => {
  const send = vi.fn().mockResolvedValue({ recorded: 1 });
  let current = true;
  const scope = { id: 1 };
  const controller = createReadReceiptController({ dwellMs: 800, send, capture: () => scope, current: captured => current && captured === scope });
  controller.setEnabled(true);
  controller.visible(["one"]);
  await vi.advanceTimersByTimeAsync(799);
  expect(send).not.toHaveBeenCalled();
  controller.setEnabled(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(send).not.toHaveBeenCalled();
  controller.setEnabled(true);
  controller.visible(["one"]);
  await vi.advanceTimersByTimeAsync(800);
  expect(send).toHaveBeenCalledWith(["one"], scope);
  current = false;
  controller.visible(["two"]);
  await vi.advanceTimersByTimeAsync(800);
  expect(send).toHaveBeenCalledTimes(1);
});

it("cancels pending work on scope replacement and ignores delayed old responses", async () => {
  let resolve!: () => void;
  const send = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  const oldScope = { id: 1 }, newScope = { id: 2 };
  let scope = oldScope;
  const controller = createReadReceiptController({ dwellMs: 10, send, capture: () => scope, current: captured => captured === scope });
  controller.setEnabled(true);
  controller.visible(["old"]);
  await vi.advanceTimersByTimeAsync(10);
  controller.replaceScope();
  scope = newScope;
  resolve();
  await Promise.resolve();
  controller.visible(["old"]);
  await vi.advanceTimersByTimeAsync(10);
  expect(send).toHaveBeenCalledTimes(2);
});

it("fails closed with bounded retries and can recover from a transient outage", async () => {
  const scope = { id: 1 };
  const send = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({ recorded: 1 });
  const controller = createReadReceiptController({ dwellMs: 1, retryMs: 10, maxAttempts: 3, send, capture: () => scope, current: captured => captured === scope });
  controller.setEnabled(true);
  controller.visible(["one"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(11);
  expect(send).toHaveBeenCalledTimes(2);
  expect(READ_RECEIPT_VIEW_AREA_PERCENT).toBeLessThan(100);
});

it("never sends a delayed dwell into a replacement scope", async () => {
  const oldScope = { id: 1 }, newScope = { id: 2 };
  let scope = oldScope, active = true;
  const send = vi.fn().mockResolvedValue({ recorded: 1 });
  const controller = createReadReceiptController({ dwellMs: 10, send, capture: () => scope,
    current: captured => active && captured === scope });
  controller.setEnabled(true);
  controller.visible(["private"]);
  scope = newScope;
  await vi.advanceTimersByTimeAsync(10);
  expect(send).not.toHaveBeenCalled();
  scope = oldScope; active = false;
  controller.visible(["background"]);
  await vi.advanceTimersByTimeAsync(10);
  expect(send).not.toHaveBeenCalled();
});

it("rearms initial visibility when scope effects run after the FlatList callback", async () => {
  const scope = { thread: "root" }, send = vi.fn().mockResolvedValue({});
  const controller = createReadReceiptController({ dwellMs: 10, send, capture: () => scope, current: captured => captured === scope });
  controller.visible(["visible-before-effects"]);
  controller.replaceScope();
  controller.setEnabled(true);
  await vi.advanceTimersByTimeAsync(10);
  expect(send).toHaveBeenCalledWith(["visible-before-effects"], scope);
});

it("cancels an active thread on switch and redwells the new thread after background resume", async () => {
  let scope = { thread: "a" };
  const send = vi.fn().mockResolvedValue({});
  const controller = createReadReceiptController({ dwellMs: 10, send, capture: () => scope, current: captured => captured === scope });
  controller.setEnabled(true); controller.visible(["a"]);
  const next = { thread: "b" }; scope = next;
  controller.visible(["b"]); controller.replaceScope();
  await vi.advanceTimersByTimeAsync(10);
  expect(send).toHaveBeenCalledTimes(1); expect(send).toHaveBeenLastCalledWith(["b"], next);
  controller.setEnabled(false);
  controller.visible(["b-resumed"]);
  await vi.advanceTimersByTimeAsync(20);
  expect(send).toHaveBeenCalledTimes(1);
  controller.setEnabled(true);
  await vi.advanceTimersByTimeAsync(10);
  expect(send).toHaveBeenLastCalledWith(["b-resumed"], next);
});

it("rejects a delayed details response after target or auth scope replacement", () => {
  let scope: { owner: number } | null = { owner: 1 }, target: string | null = "a";
  const guard = createReadReceiptRequestGuard({ currentScope: () => scope, currentTarget: () => target,
    sameScope: (left, right) => left === right });
  const a = guard.begin(scope, target);
  target = "b";
  guard.invalidate();
  const b = guard.begin(scope, target);
  expect(guard.current(a)).toBe(false); expect(guard.current(b)).toBe(true);
  scope = { owner: 1 };
  expect(guard.current(b)).toBe(false);
});

it("applies a valid summary slower than the poll interval, replays latest once, and clears on current failure", async () => {
  const scope = { owner: 1 }; let current = scope, latestIds = ["message"];
  let resolve!: (rows: { messageId: string; count: number }[]) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise<any[]>(done => { resolve = done; })).mockRejectedValueOnce(new Error("migration missing"));
  const apply = vi.fn(), clear = vi.fn();
  const loader = createReadReceiptSummaryLoader({ load, apply, clear, current: captured => captured === current,
    latest: () => ({ scope: current, ids: latestIds }), sameScope: (left, right) => left === right });
  loader.request(scope, ["message"]); loader.request(scope, ["message"]);
  expect(load).toHaveBeenCalledOnce();
  resolve([{ messageId: "message", count: 2 }]); await Promise.resolve(); await Promise.resolve();
  expect(apply).toHaveBeenCalledWith(scope, [{ messageId: "message", count: 2 }]);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(2);
  await Promise.resolve(); await Promise.resolve();
  expect(clear).toHaveBeenCalledWith(scope, ["message"]);
  latestIds = [];
});

it("drops a delayed summary when the authenticated scope changes", async () => {
  const oldScope = { owner: 1 }; let current = oldScope;
  let resolve!: (rows: { messageId: string; count: number }[]) => void;
  const apply = vi.fn(), clear = vi.fn();
  const loader = createReadReceiptSummaryLoader({ load: () => new Promise<{ messageId: string; count: number }[]>(done => { resolve = done; }), apply, clear,
    current: captured => captured === current, latest: () => null, sameScope: (left, right) => left === right });
  loader.request(oldScope, ["private"]);
  current = { owner: 1 }; loader.replaceScope();
  resolve([{ messageId: "private", count: 1 }]); await Promise.resolve(); await Promise.resolve();
  expect(apply).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
});
