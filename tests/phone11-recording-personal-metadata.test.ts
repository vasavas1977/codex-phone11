/* eslint-disable import/first, react-hooks/rules-of-hooks */
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[] },
  owner: { id: 7 } as { id: number } | null,
  authListeners: new Set<() => void>(),
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

import { useRecordingPersonalMetadata } from "../hooks/use-recording-personal-metadata";

const callUuid = "11111111-1111-4111-8111-111111111111";
function render() {
  m.frame.index = 0;
  return useRecordingPersonalMetadata(7, callUuid);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  m.frame = { index: 0, values: [] };
  m.owner = { id: 7 };
  m.authListeners.clear();
  m.getItem.mockReset().mockResolvedValue(null);
  m.setItem.mockReset().mockResolvedValue(undefined);
});

it("publishes optimistic state and serializes rapid personal metadata writes", async () => {
  render();
  await Promise.resolve();
  let hook = render();
  expect(hook.ready).toBe(true);
  const first = deferred();
  const second = deferred();
  m.setItem
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const one = hook.update((current) => ({ ...current, billable: true }));
  const two = hook.update((current) => ({ ...current, feedback: "up" }));
  hook = render();
  expect(hook.value).toMatchObject({ billable: true, feedback: "up" });
  expect(hook.saving).toBe(true);
  await Promise.resolve();
  expect(m.setItem).toHaveBeenCalledTimes(1);
  first.resolve();
  await one;
  await Promise.resolve();
  expect(m.setItem).toHaveBeenCalledTimes(2);
  expect(JSON.parse(m.setItem.mock.calls[1][1])).toMatchObject({
    billable: true,
    feedback: "up",
  });
  second.resolve();
  await two;
  expect(render().saving).toBe(false);
});

it("invalidates loaded personal content immediately on logout", async () => {
  m.getItem.mockResolvedValue(
    JSON.stringify({ billable: true, feedback: "down", updatedAt: 1 }),
  );
  render();
  await Promise.resolve();
  expect(render().value.feedback).toBe("down");
  m.owner = null;
  for (const listener of m.authListeners) listener();
  const hook = render();
  expect(hook.ready).toBe(false);
  expect(hook.value).toEqual({ billable: false, updatedAt: 0 });
  await expect(
    hook.update((current) => ({ ...current, billable: true })),
  ).resolves.toBe(false);
  expect(m.setItem).not.toHaveBeenCalled();
});
