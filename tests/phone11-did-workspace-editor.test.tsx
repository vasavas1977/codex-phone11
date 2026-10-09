/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Offline component/event boundaries with injected query results, not live browser/QueryClient proof.
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[] },
  cleanups: [] as (() => void)[],
  buttons: [] as any[],
  workspace: {} as any,
  tenant: {} as any,
  capabilities: {} as any,
  numbers: {} as any,
  queries: {} as Record<string, any>,
  calls: [] as [string, any[]][],
  mutate: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (fn: () => (() => void) | void) => {
      const cleanup = fn();
      if (cleanup) m.cleanups.push(cleanup);
    },
    useRef: (initial: unknown) => {
      const i = m.frame.index++;
      return (m.frame.values[i] ??= { current: initial });
    },
    useState: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = initial;
      return [
        m.frame.values[i],
        (value: unknown) => {
          m.frame.values[i] = value;
        },
      ];
    },
  };
});
function element({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
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
  Modal: ({ visible, children }: any) =>
    visible ? element({ children }) : null,
  ScrollView: element,
  Text: element,
  View: element,
  TextInput: () => null,
  StyleSheet: { create: (s: unknown) => s },
  TouchableOpacity: (props: any) => {
    m.buttons.push(props);
    return createElement(
      "button",
      { disabled: props.disabled },
      props.children,
    );
  },
}));
vi.mock("expo-router", () => ({ router: { back: vi.fn() } }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/admin/admin-workspace-boundary", () => ({
  AdminWorkspaceBoundary: element,
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ primary: "#06c", muted: "#666" }),
}));
vi.mock("../hooks/use-pbx-admin", () => ({
  usePbxAdminWorkspace: () => m.workspace,
  useTenant: () => m.tenant,
  usePbxAdminCapabilities: () => m.capabilities,
  usePhoneNumbers: (...args: any[]) => {
    m.calls.push(["numbers", args]);
    return m.numbers;
  },
  useAssignPhoneNumberRoute: () => ({
    isPending: false,
    mutateAsync: m.mutate,
  }),
  ...Object.fromEntries(
    [
      ["useExtensions", "extensions"],
      ["useRingGroups", "ringGroups"],
      ["useCallQueues", "queues"],
      ["useIvrMenus", "ivr"],
      ["useTimeConditions", "businessHours"],
    ].map(([hook, label]) => [
      hook,
      (...args: any[]) => {
        m.calls.push([label, args]);
        return m.queries[label];
      },
    ]),
  ),
}));
import Screen from "../app/admin/dids";
const fresh = (data: unknown) => ({
  data,
  isSuccess: true,
  isFetching: false,
  isError: false,
  dataUpdatedAt: 1,
});
const extension = (name: string) => ({
  id: 5,
  extension_number: "3001",
  display_name: name,
  type: "user",
  user_id: 9,
  status: "active",
  sip_status: "active",
  sip_username: "synthetic",
  sip_domain: "example.test",
});
function render() {
  m.frame.index = 0;
  m.buttons = [];
  m.calls = [];
  return renderToStaticMarkup(createElement(Screen));
}
function button(label: string) {
  const found = m.buttons.find((p) => p.accessibilityLabel === label);
  if (!found) throw new Error(`Missing test button ${label}`);
  return found;
}
function open() {
  render();
  button("Change destination for +6620000000").onPress();
  render();
}
beforeEach(() => {
  vi.clearAllMocks();
  m.frame = { index: 0, values: [] };
  m.cleanups = [];
  m.workspace = {
    canEditDidRoutes: true,
    canUseImplicitTenant: false,
    admissionScope: "account9:tenant12:observation1",
  };
  m.tenant = fresh({ id: 12, userRole: "admin" });
  m.capabilities = fresh({
    phoneNumbers: true,
    ringGroups: true,
    queues: true,
    ivr: true,
    businessHours: true,
  });
  m.numbers = {
    ...fresh({
      data: [
        {
          id: 8,
          number_e164: "+6620000000",
          assigned_route_type: "extension",
          assigned_route_id: 5,
        },
      ],
    }),
    refetch: m.refetch,
  };
  m.queries = { extensions: fresh({ data: [extension("Workspace B")] }) };
  for (const key of ["ringGroups", "queues", "ivr", "businessHours"])
    m.queries[key] = fresh([
      {
        id: 5,
        name: `B ${key}`,
        is_active: true,
        strategy: key === "ringGroups" ? "simultaneous" : "ring_all",
      },
    ]);
  m.mutate.mockResolvedValue({ success: true });
  m.refetch.mockResolvedValue(undefined);
});

describe("selected-workspace DID editor event boundaries", () => {
  it("opens a multi-workspace editor with all directories requested fresh and selected scope saved", async () => {
    open();
    expect(m.calls).toEqual([
      ["numbers", [1, 100, true, true]],
      ["extensions", [1, 100, true, true]],
      ["ringGroups", [12, true, true]],
      ["queues", [12, true, true]],
      ["ivr", [12, true, true]],
      ["businessHours", [12, true, true]],
    ]);
    await button("Save destination").onPress();
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 12,
      id: 8,
      assignedRouteType: "extension",
      assignedRouteId: 5,
    });
  });
  it("does not open or request directories without separately verified route admission", () => {
    m.workspace.canEditDidRoutes = false;
    expect(render()).toContain("selected-workspace destination support");
    expect(button("Phone number +6620000000").disabled).toBe(true);
    button("Phone number +6620000000").onPress();
    expect(render()).not.toContain("Save destination");
    expect(
      m.calls
        .filter(([key]) => key !== "numbers")
        .every(([, args]) => args.includes(false)),
    ).toBe(true);
  });
  it.each(["extensions", "ringGroups", "queues", "ivr", "businessHours"])(
    "retires %s rows and denies even a retained save callback while refreshing or failed",
    async (key) => {
      open();
      const staleSave = button("Save destination").onPress;
      m.queries[key].isFetching = true;
      const html = render();
      expect(render()).not.toContain("Save destination");
      expect(html).not.toContain(
        key === "extensions" ? "Workspace B" : `B ${key}`,
      );
      await staleSave();
      expect(m.mutate).not.toHaveBeenCalled();
      m.queries[key].isFetching = false;
      m.queries[key].isError = true;
      render();
      await staleSave();
      expect(m.mutate).not.toHaveBeenCalled();
    },
  );
  it("rejects a stale read closure after refresh completes, even with overlapping IDs", async () => {
    open();
    const staleSave = button("Save destination").onPress;
    m.queries.extensions = {
      ...fresh({ data: [extension("Replacement B")] }),
      dataUpdatedAt: 2,
    };
    render();
    await staleSave();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(render()).not.toContain("Save destination");
    open();
    await button("Save destination").onPress();
    expect(m.mutate).toHaveBeenCalledTimes(1);
  });
  it.each(["tenant", "account", "membership refresh"])(
    "does not submit a retained old-scope handler after %s changes",
    async (change) => {
      open();
      const staleSave = button("Save destination").onPress;
      m.workspace.admissionScope = change;
      if (change === "tenant") m.tenant.data.id = 7;
      render();
      await staleSave();
      expect(m.mutate).not.toHaveBeenCalled();
    },
  );
  it("refuses a removed DID or inactive/absent target on newest read", async () => {
    open();
    m.numbers.data.data = [];
    render();
    await button("Save destination").onPress();
    expect(m.mutate).not.toHaveBeenCalled();
    m.numbers.data.data = [{ id: 8, number_e164: "+6620000000" }];
    m.queries.extensions.data.data[0].status = "inactive";
    render();
    await button("Save destination").onPress();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(render()).toContain("Choose an active destination");
  });
  it("drops pending completion/refetch after unmount, without another mutation", async () => {
    open();
    let complete!: () => void;
    m.mutate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const save = button("Save destination").onPress;
    const pending = save();
    await save();
    expect(m.mutate).toHaveBeenCalledTimes(1);
    m.cleanups.forEach((fn) => fn());
    complete();
    await pending;
    expect(m.refetch).not.toHaveBeenCalled();
  });
  it("retains retry state on same-scope failure and ignores an old-scope failure", async () => {
    open();
    m.mutate.mockRejectedValueOnce(new Error("synthetic failure"));
    await button("Save destination").onPress();
    expect(render()).toContain("synthetic failure");
    let fail!: (error: Error) => void;
    m.mutate.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const pending = button("Save destination").onPress();
    m.workspace.admissionScope = "replacement account";
    render();
    fail(new Error("late private result"));
    await pending;
    expect(render()).not.toContain("late private result");
  });
  it.each(["extension", "ring_group", "queue", "ivr", "time_condition"])(
    "saves an overlapping %s ID only in the current selected workspace",
    async (type) => {
      for (const tenantId of [7, 12]) {
        m.frame = { index: 0, values: [] };
        m.cleanups = [];
        m.workspace.admissionScope = `account9:tenant${tenantId}:observation1`;
        m.tenant.data.id = tenantId;
        m.numbers.data.data[0].assigned_route_type = type;
        open();
        await button("Save destination").onPress();
        expect(m.mutate).toHaveBeenLastCalledWith({
          tenantId,
          id: 8,
          assignedRouteType: type,
          assignedRouteId: 5,
        });
      }
    },
  );
  it("retires equal-timestamp refreshes and refuses changed current admin role", async () => {
    open();
    const staleSave = button("Save destination").onPress;
    m.queries.extensions.isFetching = true;
    render();
    m.queries.extensions.isFetching = false;
    render();
    await staleSave();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(render()).not.toContain("Save destination");
    open();
    const adminSave = button("Save destination").onPress;
    m.tenant.data.userRole = "user";
    render();
    await adminSave();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.calls.find(([key]) => key === "extensions")?.[1]).toEqual([
      1,
      100,
      false,
      true,
    ]);
  });
});
