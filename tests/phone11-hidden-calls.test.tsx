/* eslint-disable import/first, react-hooks/rules-of-hooks */
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[] },
  owner: { id: 7 } as { id: number } | null,
  authListeners: new Set<() => void>(),
  data: new Map<string, string>(),
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

function sameDependencies(left?: unknown[], right?: unknown[]) {
  return Boolean(
    left &&
      right &&
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index])),
  );
}

vi.mock("react", () => ({
  useRef(initial: unknown) {
    const frame = m.frame;
    const index = frame.index++;
    return (frame.values[index] ??= { current: initial });
  },
  useState(initial: unknown) {
    const frame = m.frame;
    const index = frame.index++;
    if (!(index in frame.values))
      frame.values[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      frame.values[index],
      (value: unknown) => {
        frame.values[index] =
          typeof value === "function"
            ? (value as (current: unknown) => unknown)(frame.values[index])
            : value;
      },
    ];
  },
  useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
    const frame = m.frame;
    const index = frame.index++;
    const previous = frame.values[index] as
      | { dependencies?: unknown[]; cleanup?: () => void }
      | undefined;
    if (sameDependencies(previous?.dependencies, dependencies)) return;
    previous?.cleanup?.();
    const cleanup = effect();
    frame.values[index] = {
      dependencies,
      ...(typeof cleanup === "function" ? { cleanup } : {}),
    };
  },
  useCallback(callback: unknown) {
    m.frame.index++;
    return callback;
  },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: m.getItem, setItem: m.setItem },
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.owner }),
  addAuthChangeListener: (listener: () => void) => {
    m.authListeners.add(listener);
    return () => m.authListeners.delete(listener);
  },
}));

import { useHiddenCalls } from "../hooks/use-hidden-calls";

function render(owner = 7) {
  m.frame.index = 0;
  return useHiddenCalls(owner);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  m.frame = { index: 0, values: [] };
  m.owner = { id: 7 };
  m.authListeners.clear();
  m.data.clear();
  m.getItem.mockReset().mockImplementation(async (key: string) => {
    return m.data.get(key) ?? null;
  });
  m.setItem
    .mockReset()
    .mockImplementation(async (key: string, value: string) => {
      m.data.set(key, value);
    });
});

it("loads only the authenticated owner's hidden calls", async () => {
  m.data.set("phone11_hidden_calls_v1_7", '["call-seven"]');
  m.data.set("phone11_hidden_calls_v1_8", '["call-eight"]');
  render(7);
  await settle();
  expect(render(7).ids).toEqual(["call-seven"]);

  m.owner = { id: 8 };
  for (const listener of m.authListeners) listener();
  render(8);
  await settle();
  expect(render(8).ids).toEqual(["call-eight"]);
  expect(render(8).ids).not.toContain("call-seven");
});

it("is not ready until the authenticated owner's persisted list loads", async () => {
  const gate = deferred();
  m.data.set("phone11_hidden_calls_v1_7", '["persisted-call"]');
  m.getItem.mockImplementationOnce(async (key: string) => {
    await gate.promise;
    return m.data.get(key) ?? null;
  });

  expect(render().ready).toBe(false);
  expect(render().ids).toEqual([]);
  gate.resolve();
  await settle();
  expect(render().ready).toBe(true);
  expect(render().ids).toEqual(["persisted-call"]);
});

it("serializes rapid hides without losing either call", async () => {
  render();
  await settle();
  const hook = render();
  const gate = deferred();
  m.setItem.mockImplementationOnce(async (key: string, value: string) => {
    await gate.promise;
    m.data.set(key, value);
  });

  const first = hook.hide("call-a");
  const second = hook.hide("call-b");
  await settle();
  expect(m.setItem).toHaveBeenCalledTimes(1);

  gate.resolve();
  await first;
  await settle();
  expect(m.setItem).toHaveBeenCalledTimes(2);
  await second;
  expect(JSON.parse(m.data.get("phone11_hidden_calls_v1_7")!)).toEqual([
    "call-a",
    "call-b",
  ]);
  expect(render().ids).toEqual(["call-a", "call-b"]);
});

it("restores all hidden calls without deleting call content", async () => {
  m.data.set("phone11_hidden_calls_v1_7", '["call-a","call-b"]');
  render();
  await settle();
  const hook = render();
  expect(hook.ids).toEqual(["call-a", "call-b"]);

  await hook.restoreAll();
  expect(m.data.get("phone11_hidden_calls_v1_7")).toBe("[]");
  expect(render().ids).toEqual([]);
});

it("rejects a hide when auth changes before or during persistence", async () => {
  render();
  await settle();
  let hook = render();
  m.owner = { id: 8 };
  await expect(hook.hide("call-a")).rejects.toThrow(
    "Call history owner changed",
  );
  expect(m.setItem).not.toHaveBeenCalled();

  m.owner = { id: 7 };
  for (const listener of m.authListeners) listener();
  render();
  await settle();
  hook = render();
  const gate = deferred();
  m.setItem.mockImplementationOnce(async (key: string, value: string) => {
    await gate.promise;
    m.data.set(key, value);
  });
  const pending = hook.hide("call-b");
  await settle();
  expect(m.setItem).toHaveBeenCalledTimes(1);
  m.owner = { id: 8 };
  for (const listener of m.authListeners) listener();
  gate.resolve();
  await expect(pending).rejects.toThrow("Call history owner changed");
  expect(render().ids).toEqual([]);
});
