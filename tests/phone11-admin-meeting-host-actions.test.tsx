/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
  presses: new Map<string | undefined, any>(),
  switches: new Map<string, any>(),
  listeners: new Set<() => void>(),
  auth: { user: { id: 7 }, loading: false } as {
    user: { id: number; name?: string } | null;
    loading: boolean;
  },
  tenantId: 18,
  tenantError: false,
  tenantFetching: false,
  overviewError: false,
  overviewFetching: false,
  overview: null as any,
  memberRole: "admin",
  mutate: vi.fn(),
  directMutate: vi.fn(),
  refetch: vi.fn(),
  writes: 0,
  retiredWrites: 0,
  retired: false,
  externalChanges: 0,
  onExternalChange: undefined as undefined | (() => void),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values))
        m.frame.values[i] = typeof initial === "function" ? initial() : initial;
      return [
        m.frame.values[i],
        (value: any) => {
          m.writes++;
          if (m.retired) m.retiredWrites++;
          m.frame.values[i] =
            typeof value === "function" ? value(m.frame.values[i]) : value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = { current: initial };
      return m.frame.values[i];
    },
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      const i = m.frame.index++,
        old = m.frame.values[i];
      if (!old || deps.some((d, n) => !Object.is(d, old.deps[n])))
        m.frame.effects.push(() => {
          old?.cleanup?.();
          m.frame.values[i] = { deps, cleanup: effect() };
        });
    },
    useSyncExternalStore: (
      subscribe: (fn: () => void) => () => void,
      read: () => unknown,
    ) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) {
        m.frame.values[i] = {};
        m.frame.effects.push(() => {
          m.frame.values[i].cleanup = subscribe(() => {
            m.externalChanges++;
            m.onExternalChange?.();
          });
        });
      }
      return read();
    },
  };
});
function element({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Platform: { OS: "web" },
  StyleSheet: { create: (value: unknown) => value },
  Text: element,
  View: element,
  ScrollView: element,
  TextInput: () => null,
  useWindowDimensions: () => ({ width: 1200 }),
  Pressable: (props: any) => {
    m.presses.set(props.accessibilityLabel, props);
    return element(props);
  },
  Switch: (props: any) => {
    m.switches.set(props.accessibilityLabel, props);
    return null;
  },
}));
vi.mock("expo-router", () => ({
  router: { canGoBack: () => true, back: vi.fn() },
}));
vi.mock("../components/admin/admin-workspace-boundary", () => ({
  AdminWorkspaceBoundary: element,
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/profile/profile-avatar", () => ({
  ProfileAvatar: () => null,
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ foreground: "black", primary: "blue" }),
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => m.auth }));
vi.mock("../hooks/use-directory", () => ({
  useDirectory: () => ({ people: [] }),
}));
vi.mock("../hooks/use-pbx-admin", () => ({
  usePbxAdminWorkspace: () => ({ selectedTenantId: m.tenantId }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => m.auth,
  addAuthChangeListener: (fn: () => void) => {
    m.listeners.add(fn);
    return () => m.listeners.delete(fn);
  },
}));
vi.mock("../lib/trpc", () => ({
  trpc: {
    pbx: {
      tenant: {
        get: {
          useQuery: () => ({
            data: { id: m.tenantId, name: "Workspace", userRole: m.memberRole },
            isError: m.tenantError,
            isFetching: m.tenantFetching,
          }),
        },
      },
    },
    meetings: {
      adminOverview: {
        useQuery: () => ({
          data: m.overview,
          isError: m.overviewError,
          isFetching: m.overviewFetching,
          refetch: m.refetch,
        }),
      },
      adminSetHostPermission: {
        useMutation: () => ({ mutateAsync: m.mutate }),
      },
      adminSetDirectHostPermission: {
        useMutation: () => ({ mutateAsync: m.directMutate }),
      },
    },
  },
}));
import AdminMeetings from "../app/admin/meetings";
function conversation(kind = "channel") {
  return {
    id: "room-18",
    kind,
    name: "Test",
    members: [{ userId: 8, name: "Member", canStartMeeting: false }],
  };
}
function render() {
  m.frame.index = 0;
  m.presses.clear();
  m.switches.clear();
  const html = renderToStaticMarkup(createElement(AdminMeetings));
  for (const fn of m.frame.effects.splice(0)) fn();
  return html;
}
function select(title = "Test") {
  render();
  m.presses.get(`Manage meeting hosts in ${title}`).onPress();
  render();
  return m.switches.get(`Member can start meetings in ${title}`).onValueChange;
}
function unmount() {
  for (const slot of m.frame.values) slot?.cleanup?.();
  m.retired = true;
}
function auth(user: typeof m.auth.user, loading = false) {
  m.auth = { user, loading };
  m.listeners.forEach((fn) => fn());
}
function deferred() {
  let resolve!: () => void, reject!: (e: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.clearAllMocks();
  m.frame = { index: 0, values: [], effects: [] };
  m.listeners.clear();
  m.auth = { user: { id: 7 }, loading: false };
  m.tenantId = 18;
  m.memberRole = "admin";
  m.tenantError =
    m.tenantFetching =
    m.overviewError =
    m.overviewFetching =
      false;
  m.overview = {
    available: true,
    channels: [conversation()],
    directConversations: [],
  };
  m.writes = m.retiredWrites = m.externalChanges = 0;
  m.retired = false;
  m.onExternalChange = undefined;
  m.mutate.mockReset().mockResolvedValue(undefined);
  m.directMutate.mockReset().mockResolvedValue(undefined);
  m.refetch.mockReset().mockResolvedValue(undefined);
});
afterEach(unmount);
it("synchronously admits one host write from opposing same-render switches", async () => {
  const wait = deferred();
  m.mutate.mockReturnValue(wait.promise);
  const press = select();
  press(true);
  press(false);
  const count = m.mutate.mock.calls.length;
  wait.resolve();
  await flush();
  expect(count).toBe(1);
});
it("refuses a retained switch after same-ID sign-in replacement", async () => {
  const press = select();
  auth({ id: 7 });
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("refuses a retained switch after unmount", async () => {
  const press = select();
  unmount();
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("sends only the selected channel/member/tenant through the existing API", async () => {
  const press = select();
  press(true);
  await flush();
  expect(m.mutate).toHaveBeenCalledOnce();
  expect(m.mutate).toHaveBeenCalledWith({
    tenantId: 18,
    channelId: "room-18",
    userId: 8,
    canStartMeeting: true,
  });
  expect(m.directMutate).not.toHaveBeenCalled();
  expect(m.refetch).toHaveBeenCalledOnce();
});
it("keeps direct-chat writes on the existing direct API", async () => {
  m.overview = {
    available: true,
    channels: [],
    directConversations: [conversation("direct")],
  };
  const press = select("Member");
  press(true);
  await flush();
  expect(m.directMutate).toHaveBeenCalledOnce();
  expect(m.directMutate).toHaveBeenCalledWith({
    tenantId: 18,
    conversationId: "room-18",
    userId: 8,
    canStartMeeting: true,
  });
  expect(m.mutate).not.toHaveBeenCalled();
});
it("retires observed logout even if the original object returns before render", async () => {
  const original = m.auth.user;
  const press = select();
  auth(null);
  auth(original);
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("retires A to B to A with the same numeric ID and restored object", async () => {
  const original = m.auth.user;
  const press = select();
  auth({ id: 7 });
  auth(original);
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("retires an observed loading lifetime even after it clears", async () => {
  const original = m.auth.user;
  const press = select();
  auth(original, true);
  auth(original);
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("permits profile refresh on the same stable auth object", async () => {
  const press = select();
  m.auth.user!.name = "Updated name";
  auth(m.auth.user);
  press(true);
  await flush();
  expect(m.mutate).toHaveBeenCalledOnce();
});
it("refuses a retained action across a workspace hop even with the same row reference", async () => {
  const press = select();
  m.tenantId = 36;
  render();
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("refuses a retained action after conversation replacement with the same ID", async () => {
  const press = select();
  m.overview.channels = [conversation()];
  render();
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("refuses a retained action after member replacement with the same ID", async () => {
  const press = select();
  m.overview.channels[0].members = [
    { userId: 8, name: "New member", canStartMeeting: false },
  ];
  render();
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("refuses a retained action after member removal", async () => {
  const press = select();
  m.overview.channels[0].members = [];
  render();
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it.each([
  "tenantError",
  "tenantFetching",
  "overviewError",
  "overviewFetching",
] as const)(
  "does not write while %s makes the cached row unconfirmed",
  async (flag) => {
    const press = select();
    m[flag] = true;
    render();
    press(true);
    await flush();
    expect(m.mutate).not.toHaveBeenCalled();
  },
);
it("refuses cached host controls after administrator-role loss", async () => {
  const press = select();
  m.memberRole = "member";
  render();
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("refuses cached host controls after availability loss", async () => {
  const press = select();
  m.overview.available = false;
  render();
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
});
it("keeps an already-dispatched write owned across workspace remount until settlement", async () => {
  const wait = deferred();
  m.mutate.mockReturnValue(wait.promise);
  const oldPress = select();
  oldPress(true);
  unmount();
  m.frame = { index: 0, values: [], effects: [] };
  m.retired = false;
  m.tenantId = 36;
  const next = conversation();
  next.id = "room-36";
  m.overview.channels = [next];
  const newPress = select();
  expect(m.switches.get("Member can start meetings in Test").disabled).toBe(
    true,
  );
  expect(render()).toContain("Waiting for the current hosting change");
  newPress(false);
  const count = m.mutate.mock.calls.length,
    notifications = m.externalChanges;
  wait.resolve();
  await flush();
  expect(count).toBe(1);
  expect(m.refetch).not.toHaveBeenCalled();
  expect(m.externalChanges).toBeGreaterThan(notifications);
  render();
  expect(m.switches.get("Member can start meetings in Test").disabled).toBe(
    false,
  );
  newPress(true);
  await flush();
  expect(m.mutate.mock.calls.map(([input]) => input.tenantId)).toEqual([
    18, 36,
  ]);
});
it("discards a late error after auth replacement and releases request custody", async () => {
  const wait = deferred();
  m.mutate.mockReturnValue(wait.promise);
  select()(true);
  auth({ id: 7 });
  wait.reject(new Error("Old request failed"));
  await flush();
  expect(render()).not.toContain("Old request failed");
  expect(m.refetch).not.toHaveBeenCalled();
  expect(m.retiredWrites).toBe(0);
});
it("does not update or refetch an unmounted screen after dispatched settlement", async () => {
  const wait = deferred();
  m.mutate.mockReturnValue(wait.promise);
  select()(true);
  unmount();
  wait.resolve();
  await flush();
  expect(m.mutate).toHaveBeenCalledOnce();
  expect(m.refetch).not.toHaveBeenCalled();
  expect(m.retiredWrites).toBe(0);
});
it("waits through refetch settlement before accepting another write", async () => {
  const wait = deferred();
  m.refetch.mockReturnValue(wait.promise);
  const press = select();
  press(true);
  await flush();
  press(false);
  const count = m.mutate.mock.calls.length;
  wait.resolve();
  await flush();
  expect(count).toBe(1);
  press(false);
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(2);
});
it("shows uncertain write failure without claiming a server change was cancelled", async () => {
  m.mutate.mockRejectedValue({ network: true });
  select()(true);
  await flush();
  expect(render()).toContain("could not be confirmed");
  expect(render()).not.toContain("No settings were changed");
});
it("keeps current overview retry available but rejects its unmounted callback", async () => {
  m.overviewError = true;
  render();
  const retry = m.presses.get(undefined).onPress;
  retry();
  await flush();
  expect(m.refetch).toHaveBeenCalledOnce();
  unmount();
  retry();
  await flush();
  expect(m.refetch).toHaveBeenCalledOnce();
});
it("rechecks ownership after synchronous in-flight notification before dispatch", async () => {
  const press = select();
  m.onExternalChange = () => auth({ id: 7 });
  press(true);
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
  expect(m.refetch).not.toHaveBeenCalled();
});
it.each(["conversation", "member", "role"])(
  "discards settlement after current %s is replaced",
  async (kind) => {
    const wait = deferred();
    m.mutate.mockReturnValue(wait.promise);
    select()(true);
    if (kind === "conversation") m.overview.channels = [conversation()];
    else if (kind === "member")
      m.overview.channels[0].members = [
        { userId: 8, name: "Replacement", canStartMeeting: false },
      ];
    else m.memberRole = "member";
    render();
    wait.reject(new Error("Old response"));
    await flush();
    expect(m.refetch).not.toHaveBeenCalled();
    expect(render()).not.toContain("Old response");
  },
);
