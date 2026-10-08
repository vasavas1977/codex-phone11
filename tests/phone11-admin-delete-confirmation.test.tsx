/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
  presses: new Map<string, any>(),
  listeners: new Set<() => void>(),
  auth: { user: { id: 7 }, loading: false } as {
    user: { id: number } | null;
    loading: boolean;
  },
  tenant: 18,
  role: "admin",
  implicit: true,
  workspaceError: false,
  available: true,
  fetching: false,
  queryError: false,
  mutationPending: false,
  extraMembership: false,
  rows: {} as Record<string, any[]>,
  platform: "web",
  modal: null as any,
  mutate: vi.fn(),
  alert: vi.fn(),
  retired: false,
  retiredWrites: 0,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const effect = (callback: () => void | (() => void), deps: unknown[]) => {
    const index = m.frame.index++,
      old = m.frame.values[index];
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
      m.frame.effects.push(() => {
        old?.cleanup?.();
        m.frame.values[index] = { deps, callback, cleanup: callback() };
      });
    }
  };
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = m.frame.index++;
      if (!(index in m.frame.values))
        m.frame.values[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        m.frame.values[index],
        (value: any) => {
          if (m.retired) m.retiredWrites++;
          m.frame.values[index] =
            typeof value === "function" ? value(m.frame.values[index]) : value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = m.frame.index++;
      if (!(index in m.frame.values))
        m.frame.values[index] = { current: initial };
      return m.frame.values[index];
    },
    useEffect: effect,
    useLayoutEffect: effect,
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  };
});
function element({ children }: any) {
  return createElement("div", null, children);
}
function button(props: any) {
  if (props.accessibilityLabel) m.presses.set(props.accessibilityLabel, props);
  return createElement("button", { disabled: props.disabled }, props.children);
}
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return m.platform;
    },
  },
  useWindowDimensions: () => ({ width: 1100 }),
  View: element,
  Text: element,
  ScrollView: element,
  TouchableOpacity: button,
  Pressable: button,
  ActivityIndicator: () => null,
  TextInput: () => null,
  Switch: () => null,
  StyleSheet: { create: (value: unknown) => value },
  Alert: { alert: m.alert },
  Modal: (props: any) => {
    if (!props.visible) return null;
    m.modal = props;
    return element(props);
  },
  FlatList: ({ data, renderItem, ListEmptyComponent }: any) =>
    createElement(
      "div",
      null,
      data.length
        ? data.map((item: any) =>
            createElement("div", { key: item.id }, renderItem({ item })),
          )
        : ListEmptyComponent,
    ),
}));
vi.mock("expo-router", () => ({ router: { back: vi.fn() } }));
vi.mock("../components/admin/admin-workspace-boundary", () => ({
  AdminWorkspaceBoundary: element,
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/admin/unavailable-admin-screen", () => ({
  UnavailableAdminScreen: () => null,
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "blue",
    foreground: "black",
    muted: "gray",
    surface: "white",
    border: "gray",
    error: "red",
  }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => m.auth,
  addAuthChangeListener: (listener: () => void) => {
    m.listeners.add(listener);
    return () => m.listeners.delete(listener);
  },
}));
vi.mock("../hooks/use-pbx-admin", () => {
  const query = (list: string) => ({
    data: m.rows[list],
    isSuccess: !m.queryError,
    isFetching: m.fetching,
    isError: m.queryError,
    refetch: vi.fn(),
  });
  const mutation = () => ({
    mutateAsync: m.mutate,
    isPending: m.mutationPending,
  });
  return {
    usePbxAdminWorkspace: () => ({
      selectedTenantId: m.tenant,
      canUseImplicitTenant: m.implicit,
      manageableMemberships: ["admin", "owner"].includes(m.role)
        ? [{ tenantId: m.tenant, role: m.role }]
        : [],
      membershipsQuery: {
        isSuccess: !m.workspaceError,
        isError: m.workspaceError,
      },
    }),
    useTenant: () => ({ data: { id: m.tenant }, isSuccess: true }),
    usePbxCapabilities: () => ({
      data: {
        ivr: m.available,
        queues: m.available,
        ringGroups: m.available,
        businessHours: m.available,
      },
    }),
    usePbxAdminCapabilities: () => ({ data: { ivr: m.available } }),
    useIvrMenus: () => query("ivr"),
    useTimeConditions: () => query("timeConditions"),
    useRingGroups: () => query("ringGroups"),
    useCallQueues: () => query("queues"),
    useIvrMenu: () => ({}),
    useTimeCondition: () => ({}),
    useRingGroup: () => ({}),
    useCallQueue: () => ({}),
    useExtensions: () => ({}),
    useDeleteIvrMenu: mutation,
    useDeleteTimeCondition: mutation,
    useDeleteRingGroup: mutation,
    useDeleteCallQueue: mutation,
    useCreateIvrMenu: mutation,
    useCreateTimeCondition: mutation,
    useCreateRingGroup: mutation,
    useCreateCallQueue: mutation,
    useUpdateTimeCondition: mutation,
    useUpdateRingGroup: mutation,
    useUpdateCallQueue: mutation,
    useSetIvrActions: mutation,
    useSetTimeConditionRules: mutation,
    useSetRingGroupMembers: mutation,
    useSetQueueAgents: mutation,
  };
});
vi.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      pbx: {
        tenant: {
          memberships: {
            getData: () => [
              { userId: m.auth.user?.id, tenantId: m.tenant, role: m.role },
              ...(m.extraMembership
                ? [{ userId: m.auth.user?.id, tenantId: 99, role: "admin" }]
                : []),
            ],
          },
        },
      },
      ivr: Object.fromEntries(
        ["ivr", "timeConditions", "ringGroups", "queues"].map((list) => [
          list,
          {
            list: {
              getData: ({ tenant_id }: any) =>
                tenant_id === m.tenant ? m.rows[list] : undefined,
            },
          },
        ]),
      ),
    }),
  },
}));
import AdminIVR from "../app/admin/ivr";
import AdminSchedules from "../app/admin/schedules";
import AdminRingGroups from "../app/admin/ring-groups";
import AdminQueues from "../app/admin/queues";
const screens = [
  { list: "ivr", Screen: AdminIVR, args: { id: 101, tenant_id: 18 } },
  { list: "timeConditions", Screen: AdminSchedules, args: { id: 101 } },
  { list: "ringGroups", Screen: AdminRingGroups, args: { id: 101 } },
  { list: "queues", Screen: AdminQueues, args: { id: 101 } },
];
function row(id = 101, name = "Support") {
  return {
    id,
    name,
    extension: "1001",
    max_wait_time: 300,
    rules: [],
    strategy: "simultaneous",
  };
}
function render(Screen: typeof AdminIVR) {
  m.frame.index = 0;
  m.modal = null;
  m.presses.clear();
  const html = renderToStaticMarkup(createElement(Screen));
  for (const effect of m.frame.effects.splice(0)) effect();
  return html;
}
function press(label: string) {
  return m.presses.get(label).onPress as () => void;
}
function open(Screen: typeof AdminIVR) {
  render(Screen);
  press("Delete Support")();
  return render(Screen);
}
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
function owner(user: { id: number } | null, loading = false) {
  m.auth = { user, loading };
  m.listeners.forEach((listener) => listener());
}
function unmount() {
  for (const value of m.frame.values) value?.cleanup?.();
  m.retired = true;
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.frame = { index: 0, values: [], effects: [] };
  m.listeners.clear();
  m.presses.clear();
  m.auth = { user: { id: 7 }, loading: false };
  m.tenant = 18;
  m.role = "admin";
  m.implicit = true;
  m.workspaceError = false;
  m.available = true;
  m.fetching = false;
  m.queryError = false;
  m.mutationPending = false;
  m.extraMembership = false;
  m.platform = "web";
  m.modal = null;
  m.retired = false;
  m.retiredWrites = 0;
  m.rows = Object.fromEntries(
    screens.map((screen) => [screen.list, [row(), row(102, "Sales")]]),
  );
  m.mutate.mockResolvedValue(undefined);
});
for (const { list, Screen, args } of screens)
  describe(`${list} browser deletion`, () => {
    it("starts a fresh confirmation lifetime after development effect replay", async () => {
      render(Screen);
      for (const value of m.frame.values) {
        if (value?.callback) {
          value.cleanup?.();
          value.cleanup = value.callback();
        }
      }
      press("Delete Support")();
      render(Screen);
      expect(m.modal.visible).toBe(true);
      press("Confirm delete Support")();
      await flush();
      expect(m.mutate).toHaveBeenCalledTimes(1);
    });
    it("opens named visible confirmation and cancel/dismiss makes retained callbacks inert", async () => {
      expect(open(Screen)).toContain("Support");
      expect(m.modal.visible).toBe(true);
      expect(m.alert).not.toHaveBeenCalled();
      expect(m.mutate).not.toHaveBeenCalled();
      const retained = press("Confirm delete Support");
      press("Cancel deletion")();
      retained();
      await flush();
      expect(m.mutate).not.toHaveBeenCalled();
      render(Screen);
      expect(m.modal).toBeNull();
      press("Delete Support")();
      render(Screen);
      const dismiss = m.modal.onRequestClose,
        again = press("Confirm delete Support");
      dismiss();
      again();
      await flush();
      expect(m.mutate).not.toHaveBeenCalled();
    });
    it("confirms exactly once before rerender, shows pending and blocks another resource", async () => {
      const wait = deferred();
      m.mutate.mockReturnValue(wait.promise);
      open(Screen);
      const confirm = press("Confirm delete Support"),
        other = press("Delete Sales");
      confirm();
      confirm();
      other();
      expect(m.mutate).toHaveBeenCalledTimes(1);
      expect(m.mutate).toHaveBeenCalledWith(args);
      expect(render(Screen)).toContain("Deleting Support");
      expect(m.presses.get("Delete Sales").disabled).toBe(true);
      expect(m.presses.get("Confirm delete Support").disabled).toBe(true);
      m.modal.onRequestClose();
      expect(m.mutate).toHaveBeenCalledTimes(1);
      wait.resolve();
      await flush();
      render(Screen);
      expect(m.modal).toBeNull();
      expect(m.presses.get("Delete Sales").disabled).toBe(false);
    });
    it("retains a visible error and requires a fresh explicit confirmation for retry", async () => {
      m.mutate.mockRejectedValueOnce(new Error("Delete refused"));
      open(Screen);
      const old = press("Confirm delete Support");
      old();
      await flush();
      expect(render(Screen)).toContain("Delete refused");
      expect(m.modal).toBeNull();
      old();
      expect(m.mutate).toHaveBeenCalledTimes(1);
      press("Delete Support")();
      render(Screen);
      press("Confirm delete Support")();
      await flush();
      expect(m.mutate).toHaveBeenCalledTimes(2);
    });
    it.each(["removed", "renamed", "replaced"])(
      "refuses a %s cached row even before rerender",
      async (change) => {
        open(Screen);
        const confirm = press("Confirm delete Support");
        if (change === "removed") m.rows[list] = [];
        else
          m.rows[list][0] = {
            ...m.rows[list][0],
            [change === "renamed" ? "name" : "extension"]: "Changed",
          };
        confirm();
        await flush();
        expect(m.mutate).not.toHaveBeenCalled();
        m.rows[list] = [row()];
        confirm();
        expect(m.mutate).not.toHaveBeenCalled();
        render(Screen);
        expect(m.modal).toBeNull();
      },
    );
    it("cached authority revocation retires a callback before rerender even if restored", async () => {
      open(Screen);
      const confirm = press("Confirm delete Support");
      m.role = "member";
      confirm();
      m.role = "admin";
      confirm();
      await flush();
      expect(m.mutate).not.toHaveBeenCalled();
      render(Screen);
      expect(m.modal).toBeNull();
    });
    if (list !== "ivr")
      it("refuses newly ambiguous implicit workspace before rerender", async () => {
        open(Screen);
        const confirm = press("Confirm delete Support");
        m.extraMembership = true;
        confirm();
        m.extraMembership = false;
        confirm();
        await flush();
        expect(m.mutate).not.toHaveBeenCalled();
      });
    it("does not open confirmation for a stale displayed row or an already pending mutation", () => {
      render(Screen);
      const stale = press("Delete Support");
      m.rows[list][0] = { ...m.rows[list][0], name: "Renamed" };
      stale();
      render(Screen);
      expect(m.modal).toBeNull();
      expect(m.mutate).not.toHaveBeenCalled();
      m.rows[list] = [row()];
      m.mutationPending = true;
      render(Screen);
      press("Delete Support")();
      render(Screen);
      expect(m.modal).toBeNull();
      expect(m.mutate).not.toHaveBeenCalled();
    });
    it.each([
      "workspace",
      "role",
      "query error",
      "refetch",
      "capability",
      "membership error",
    ])("retires confirmation permanently after %s", async (change) => {
      open(Screen);
      const confirm = press("Confirm delete Support");
      if (change === "workspace") m.tenant = 19;
      if (change === "role") m.role = "member";
      if (change === "query error") m.queryError = true;
      if (change === "refetch") m.fetching = true;
      if (change === "capability") m.available = false;
      if (change === "membership error") m.workspaceError = true;
      render(Screen);
      confirm();
      await flush();
      expect(m.mutate).not.toHaveBeenCalled();
      m.tenant = 18;
      m.role = "admin";
      m.queryError = false;
      m.fetching = false;
      m.available = true;
      m.workspaceError = false;
      render(Screen);
      confirm();
      expect(m.mutate).not.toHaveBeenCalled();
    });
    it("retires a replacement same-number owner before rerender and never revives it", async () => {
      open(Screen);
      const confirm = press("Confirm delete Support"),
        original = m.auth.user;
      owner({ id: 7 });
      owner(original);
      confirm();
      await flush();
      expect(m.mutate).not.toHaveBeenCalled();
    });
    it("ignores a late failure after sign-out or unmount without retired state writes", async () => {
      const wait = deferred();
      m.mutate.mockReturnValue(wait.promise);
      open(Screen);
      press("Confirm delete Support")();
      owner(null);
      unmount();
      wait.reject(new Error("Old scope failed"));
      await flush();
      expect(m.retiredWrites).toBe(0);
    });
    it.each(["ios", "android"])(
      "keeps native %s Alert confirmation and dismissal",
      async (platform) => {
        m.platform = platform;
        render(Screen);
        press("Delete Support")();
        expect(m.modal).toBeNull();
        expect(m.mutate).not.toHaveBeenCalled();
        const [, , buttons, options] = m.alert.mock.calls.at(-1)!;
        options.onDismiss();
        buttons[1].onPress();
        await flush();
        expect(m.mutate).not.toHaveBeenCalled();
        render(Screen);
        press("Delete Support")();
        const confirm = m.alert.mock.calls.at(-1)![2][1].onPress;
        confirm();
        confirm();
        await flush();
        expect(m.mutate).toHaveBeenCalledTimes(1);
        expect(m.mutate).toHaveBeenCalledWith(args);
      },
    );
  });
