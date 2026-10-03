import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ref: { current: null as string | null },
  focus: null as null | (() => void),
  ownerId: 1,
}));
vi.mock("react", () => ({
  useRef: () => m.ref,
  useCallback: (fn: () => void) => fn,
  useEffect: vi.fn(),
  useState: vi.fn(),
}));
vi.mock("expo-router", () => ({ useFocusEffect: (fn: () => void) => { m.focus = fn; } }));
vi.mock("../hooks/use-auth", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: { id: m.ownerId } }) }));
vi.mock("../lib/trpc", () => ({ createTRPCClient: vi.fn() }));

import { useDirectoryFocusRefresh } from "../hooks/use-directory";

beforeEach(() => {
  m.ref.current = null;
  m.focus = null;
  m.ownerId = 1;
});

it("refreshes on returning to the same Team scope, but not on first load or scope changes", () => {
  const reload = vi.fn(async () => {});
  const focus = (owner: number | null, tenant: number | undefined, enabled: boolean) => {
    useDirectoryFocusRefresh(owner, tenant, enabled, reload);
    m.focus!();
  };
  focus(1, 20, true);
  expect(reload).not.toHaveBeenCalled();
  focus(1, 20, true);
  expect(reload).toHaveBeenCalledTimes(1);
  focus(1, 21, true);
  expect(reload).toHaveBeenCalledTimes(1);
  focus(1, 21, true);
  expect(reload).toHaveBeenCalledTimes(2);
  focus(1, 21, false);
  expect(reload).toHaveBeenCalledTimes(2);
  m.ownerId = 2;
  focus(1, 21, true);
  expect(reload).toHaveBeenCalledTimes(2);
  focus(2, 21, true);
  expect(reload).toHaveBeenCalledTimes(2);
  focus(2, 21, true);
  expect(reload).toHaveBeenCalledTimes(3);
});
