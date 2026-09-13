import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: { id: 1 } as any,
  state: {} as any,
  effects: [] as Array<() => any>,
  listeners: new Set<() => void>(),
  query: vi.fn(),
  appState: "active",
  appListeners: new Set<(state: string) => void>(),
}));
vi.mock("react", () => ({
  useCallback: (f: any) => f,
  useRef: (value: any) => ({ current: value }),
  useState: (value: any) => {
    m.state = value;
    return [
      value,
      (next: any) => {
        m.state = typeof next === "function" ? next(m.state) : next;
      },
    ];
  },
  useEffect: (f: () => any) => m.effects.push(f),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return m.appState;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      m.appListeners.add(listener);
      return { remove: () => m.appListeners.delete(listener) };
    },
  },
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.user }),
  addAuthChangeListener: (f: () => void) => {
    m.listeners.add(f);
    return () => m.listeners.delete(f);
  },
}));
vi.mock("../lib/trpc", () => ({
  createTRPCClient: () => ({
    cloudRecordings: { list: { query: m.query }, detail: { query: m.query } },
  }),
}));
import {
  useCloudRecordings,
  isMissingCloudProcedure,
} from "../hooks/use-cloud-recordings";
beforeEach(() => {
  m.user = { id: 1 };
  m.state = {};
  m.effects = [];
  m.listeners.clear();
  m.query.mockReset();
  m.appState = "active";
  m.appListeners.clear();
});
it("clears loaded cloud metadata synchronously on auth change", async () => {
  m.query.mockResolvedValue({ items: [{ callUuid: "private-call" }] });
  const hook = useCloudRecordings();
  await hook.reload();
  expect(m.state.items).toHaveLength(1);
  const dispose = m.effects[0]();
  await Promise.resolve();
  m.user = { id: 2 };
  m.listeners.forEach((f) => f());
  expect(m.state.items).toEqual([]);
  expect(m.state.detail).toBeUndefined();
  dispose();
});
it("drops an old account response resolving after account change", async () => {
  let resolve!: (v: any) => void;
  m.query.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const hook = useCloudRecordings();
  const pending = hook.reload();
  m.user = { id: 2 };
  resolve({ items: [{ callUuid: "old-private-call" }] });
  await pending;
  expect(m.state.items).toEqual([]);
});
it("a failed cloud request preserves separate local-history ownership and returns only a fixed error", async () => {
  m.query.mockRejectedValue(new Error("private server details"));
  await useCloudRecordings().reload();
  expect(m.state.items).toEqual([]);
  expect(m.state.error).toContain("Your call history is still available");
  expect(m.state.error).not.toContain("private");
});

it("does not request cloud data during cold background mount or manual reload; loads on foreground", async () => {
  m.appState = "background";
  m.query.mockResolvedValue({ items: [] });
  const hook = useCloudRecordings();
  const dispose = m.effects[0]();
  await hook.reload();
  expect(m.query).not.toHaveBeenCalled();
  m.appState = "active";
  m.appListeners.forEach((listener) => listener("active"));
  await Promise.resolve();
  expect(m.query).toHaveBeenCalledTimes(1);
  dispose();
});
it("drops a request response when the app backgrounds before completion", async () => {
  let resolve!: (value: any) => void;
  m.query.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  useCloudRecordings();
  const dispose = m.effects[0]();
  m.appState = "background";
  m.appListeners.forEach((listener) => listener("background"));
  resolve({ items: [{ callUuid: "late" }] });
  await Promise.resolve();
  expect(m.state.items).toEqual([]);
  expect(m.state.loading).toBe(false);
  dispose();
});

it("treats only an exact missing cloud RPC as unavailable without an error banner", async () => {
  m.query.mockRejectedValue({
    data: { code: "NOT_FOUND", path: "cloudRecordings.list" },
    message: 'No procedure found on path "cloudRecordings.list"',
  });
  await useCloudRecordings().reload();
  expect(m.state.unavailable).toBe(true);
  expect(m.state.error).toBeUndefined();
  expect(m.state.items).toEqual([]);
});
it.each([
  { data: { code: "UNAUTHORIZED" }, message: "Please sign in" },
  new Error("Network unavailable"),
  {
    data: { code: "NOT_FOUND", path: "cloudRecordings.detail" },
    message: "Recording unavailable",
  },
  {
    data: { code: "NOT_FOUND", path: "other.list" },
    message: 'No procedure found on path "other.list"',
  },
])(
  "does not suppress genuine auth, network or record-not-found errors",
  async (error) => {
    m.query.mockRejectedValue(error);
    await useCloudRecordings().reload();
    expect(m.state.error).toContain("Could not load");
    expect(m.state.unavailable).not.toBe(true);
  },
);
it("recognizes missing settings procedures but not arbitrary HTTP404", () => {
  expect(
    isMissingCloudProcedure(
      {
        data: { code: "NOT_FOUND" },
        message: 'No "query"-procedure on path "cloudRecordings.getPolicy"',
      },
      "getPolicy",
    ),
  ).toBe(true);
  expect(
    isMissingCloudProcedure(
      {
        data: { code: "NOT_FOUND" },
        message: 'No procedure found on path "cloudRecordings.updatePolicy"',
      },
      "updatePolicy",
    ),
  ).toBe(true);
  expect(isMissingCloudProcedure({ status: 404 }, "getPolicy")).toBe(false);
});
