/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
  presses: new Map<string, any>(), inputs: new Map<string, any>(),
  auth: { user: null as any, loading: false }, listeners: new Set<() => void>(),
  workspace: null as any, memberships: [] as any[], rows: [] as any[], people: [] as any[],
  inventoryFetching: false, peopleFetching: false, peopleError: false,
  create: vi.fn(), update: vi.fn(), alerts: vi.fn(), rowsRefresh: vi.fn(), peopleRefresh: vi.fn(), statsRefresh: vi.fn(),
  retired: false, retiredWrites: 0, mutations: [] as Promise<unknown>[],
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = { current: initial };
      return m.frame.values[i];
    },
    useState: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = initial;
      return [m.frame.values[i], (value: any) => {
        if (m.retired) m.retiredWrites++;
        m.frame.values[i] = typeof value === "function" ? value(m.frame.values[i]) : value;
      }];
    },
    useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const i = m.frame.index++;
      const old = m.frame.values[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index])))
        m.frame.effects.push(() => {
          old?.cleanup?.();
          m.frame.values[i] = { deps, effect, cleanup: effect() };
        });
    },
  };
});
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({
  ActivityIndicator: () => null, Alert: { alert: m.alerts }, Platform: { OS: "web" },
  FlatList: ({ data, renderItem }: any) => element({ children: data.map((item: any) => createElement("div", { key: item.id }, renderItem({ item }))) }),
  Modal: ({ visible, children }: any) => visible ? element({ children }) : null,
  StyleSheet: { create: (styles: unknown) => styles }, Text: element, View: element, ScrollView: element,
  TextInput: (props: any) => { m.inputs.set(props.accessibilityLabel, props); return null; },
  TouchableOpacity: (props: any) => {
    const label = props.accessibilityLabel || props.children?.props?.children;
    if (typeof label === "string") m.presses.set(label, props);
    return createElement("button", {
      disabled: props.disabled,
      role: props.accessibilityRole,
      "aria-label": props.accessibilityLabel,
      "aria-checked": props["aria-checked"],
    }, props.children);
  },
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/admin/admin-workspace-boundary", () => ({ AdminWorkspaceBoundary: element }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: () => null }));
vi.mock("../components/profile/profile-card-provider", () => ({ ProfileCardProvider: element }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("expo-router", () => ({ router: { back: vi.fn() } }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.auth.user }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#06c", surface: "#fff", border: "#ddd" }) }));
vi.mock("../hooks/use-directory", () => ({ useDirectory: () => ({ people: [] }) }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => m.auth,
  addAuthChangeListener: (listener: () => void) => {
    m.listeners.add(listener);
    return () => m.listeners.delete(listener);
  },
}));
vi.mock("../lib/trpc", () => {
  const mutation = (write: typeof m.create, options: any) => ({
    mutateAsync: (input: unknown) => {
      const completion = (async () => {
        const result = await write(input); options.onSuccess?.(result, input); return result;
      })();
      m.mutations.push(completion.catch(() => undefined));
      return completion;
    },
  });
  return { trpc: { pbx: { extensions: {
    create: { useMutation: (options: any) => mutation(m.create, options) },
    update: { useMutation: (options: any) => mutation(m.update, options) },
  } }, useUtils: () => ({ pbx: {
    tenant: { memberships: { getData: () => m.memberships }, people: { getData: () => m.people, invalidate: m.peopleRefresh } },
    extensions: { list: { getData: () => ({ data: m.rows }), invalidate: m.rowsRefresh } },
    dashboard: { stats: { invalidate: m.statsRefresh } },
  } }) } };
});
vi.mock("../hooks/use-pbx-admin", async () => ({
  ...await vi.importActual<typeof import("../hooks/use-pbx-admin")>("../hooks/use-pbx-admin"),
  usePbxAdminWorkspace: () => m.workspace,
  useTenant: () => ({ data: { id: m.workspace.selectedTenantId, userRole: "admin" }, isSuccess: true }),
  useExtensions: () => ({ data: { data: m.rows }, isSuccess: true, isFetching: m.inventoryFetching, refetch: m.rowsRefresh }),
  useTenantPeople: () => ({ data: m.people, isSuccess: !m.peopleError, isError: m.peopleError, isFetching: m.peopleFetching, refetch: m.peopleRefresh }),
}));
import AdminExtensions from "../app/admin/extensions";
import { useCreateExtension, useUpdateExtension } from "../hooks/use-pbx-admin";

function render() {
  m.frame.index = 0; m.presses.clear(); m.inputs.clear();
  const markup = renderToStaticMarkup(createElement(AdminExtensions));
  for (const effect of m.frame.effects.splice(0)) effect();
  return markup;
}
function press(label: string) {
  const button = m.presses.get(label);
  expect(button, label).toBeDefined(); expect(button.disabled, label).not.toBe(true);
  return invoke(button.onPress);
}
// Native onPress returns void; wait for the real hook transport and its screen continuation.
async function invoke(handler: () => unknown) {
  const result = handler();
  await Promise.resolve(result);
  await Promise.all(m.mutations);
}
function unmount() {
  for (const value of m.frame.values) value?.cleanup?.();
  m.retired = true;
}
function authChanged() { for (const listener of m.listeners) listener(); }
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function prepare(kind: "create" | "assign") {
  render();
  if (kind === "create") {
    press("Create extension"); render();
    m.inputs.get("Extension number").onChangeText("3005"); render();
    const handler = m.presses.get("Confirm create extension").onPress;
    return () => invoke(handler);
  }
  press("Assign person for extension 3005"); render();
  press("Assign Nok"); render();
  const handler = m.presses.get("Save person assignment").onPress;
  return () => invoke(handler);
}
beforeEach(() => {
  for (const value of m.frame.values) value?.cleanup?.();
  m.frame = { index: 0, values: [], effects: [] };
  m.listeners.clear(); m.retired = false; m.retiredWrites = 0; m.mutations = [];
  m.auth = { user: { id: 7 }, loading: false };
  m.memberships = [{ userId: 7, tenantId: 18, role: "admin", tenantStatus: "active" }];
  m.workspace = { selectedTenantId: 18, isAdmitted: true, canUseImplicitTenant: true, admissionScope: "admission-1", manageableMemberships: m.memberships, membershipsQuery: { isSuccess: true, isError: false } };
  m.rows = [{ id: 51, extension_number: "3005", user_id: null }];
  m.people = [{ id: 11, name: "Nok" }];
  m.inventoryFetching = false; m.peopleFetching = false; m.peopleError = false;
  for (const mock of [m.create, m.update, m.alerts, m.rowsRefresh, m.peopleRefresh, m.statsRefresh]) mock.mockReset();
  m.create.mockResolvedValue({}); m.update.mockResolvedValue({});
  m.rowsRefresh.mockResolvedValue({}); m.peopleRefresh.mockResolvedValue({}); m.statsRefresh.mockResolvedValue({});
});

describe.each(["create", "assign"] as const)("extension %s lifecycle", kind => {
  it("writes once with the selected tenant even before a pending rerender", async () => {
    const save = prepare(kind), result = deferred();
    const mutation = kind === "create" ? m.create : m.update;
    mutation.mockReturnValueOnce(result.promise);
    const first = save(); const second = save();
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0][0]).toMatchObject({ tenantId: 18 });
    result.resolve({}); await Promise.all([first, second]);
    expect(m.rowsRefresh).toHaveBeenCalledWith({ tenantId: 18, page: 1, pageSize: 100, sortBy: "extension_number", sortOrder: "asc" }, { exact: true });
    if (kind === "create") {
      expect(m.alerts).toHaveBeenCalledWith("Extension created", expect.any(String));
      expect(m.statsRefresh).toHaveBeenCalledWith(undefined, { exact: true });
      expect(m.peopleRefresh).not.toHaveBeenCalled();
    }
    else {
      expect(m.update).toHaveBeenCalledWith({ tenantId: 18, id: 51, userId: 11 });
      expect(m.rowsRefresh).toHaveBeenCalledTimes(1);
      expect(m.peopleRefresh).toHaveBeenCalledWith({ tenantId: 18 }, { exact: true });
      expect(m.statsRefresh).not.toHaveBeenCalled();
    }
  });
  it.each(["logout", "replacement", "loading", "workspace", "admission", "not admitted", "revoked", "inactive", "wrong member", "membership failure", "unmount"])("rejects retained Save after %s", async change => {
    const save = prepare(kind);
    if (change === "logout") { m.auth.user = null; authChanged(); }
    if (change === "replacement") { m.auth.user = { id: 7 }; authChanged(); }
    if (change === "loading") { m.auth.loading = true; authChanged(); m.auth.loading = false; }
    if (change === "workspace") m.workspace.selectedTenantId = 19;
    if (change === "admission") m.workspace.admissionScope = "admission-2";
    if (change === "not admitted") m.workspace.isAdmitted = false;
    if (change === "revoked") m.memberships = [{ ...m.memberships[0], role: "user" }];
    if (change === "inactive") m.memberships = [{ ...m.memberships[0], tenantStatus: "inactive" }];
    if (change === "wrong member") m.memberships = [{ ...m.memberships[0], userId: 8 }];
    if (change === "membership failure") m.workspace.membershipsQuery.isError = true;
    if (change === "unmount") unmount();
    await save();
    expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
    expect(m.alerts).not.toHaveBeenCalled(); expect(m.retiredWrites).toBe(0);
  });
  it.each(["success", "failure"].flatMap(outcome => ["replacement", "logout", "workspace", "admission"].map(change => ({ outcome, change }))))("suppresses late $outcome after $change through the real mutation hook", async ({ outcome, change }) => {
    const save = prepare(kind), result = deferred();
    (kind === "create" ? m.create : m.update).mockReturnValueOnce(result.promise);
    const saving = save();
    if (change === "replacement") { m.auth.user = { id: 7 }; authChanged(); }
    if (change === "logout") { m.auth.user = null; authChanged(); }
    if (change === "workspace") m.workspace.selectedTenantId = 19;
    if (change === "admission") m.workspace.admissionScope = "admission-2";
    if (outcome === "success") result.resolve({}); else result.reject(new Error("old session failure"));
    await saving;
    expect(m.alerts).not.toHaveBeenCalled(); expect(m.rowsRefresh).not.toHaveBeenCalled();
    expect(m.peopleRefresh).not.toHaveBeenCalled(); expect(m.statsRefresh).not.toHaveBeenCalled();
    expect(render()).not.toContain("old session failure");
  });
  it.each(["success", "failure"])("does not update retired screen after late %s", async outcome => {
    const save = prepare(kind), result = deferred();
    (kind === "create" ? m.create : m.update).mockReturnValueOnce(result.promise);
    const saving = save(); unmount();
    if (outcome === "success") result.resolve({}); else result.reject(new Error("retired failure"));
    await saving;
    expect(m.retiredWrites).toBe(0); expect(m.alerts).not.toHaveBeenCalled();
    expect(m.rowsRefresh).not.toHaveBeenCalled(); expect(m.peopleRefresh).not.toHaveBeenCalled();
    expect(m.statsRefresh).not.toHaveBeenCalled();
  });
  it("does not revive a retained Save after closing and reopening the editor", async () => {
    const save = prepare(kind);
    press(kind === "create" ? "Close extension creation" : "Close assignment editor"); render();
    if (kind === "create") { press("Create extension"); render(); m.inputs.get("Extension number").onChangeText("3005"); render(); }
    else { press("Assign person for extension 3005"); render(); press("Assign Nok"); render(); }
    await save(); expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("admits a new Save after workspace reverification while retiring the former handler", async () => {
    const oldSave = prepare(kind);
    m.workspace.admissionScope = "admission-2"; render();
    await oldSave(); expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
    await press(kind === "create" ? "Confirm create extension" : "Save person assignment");
    expect(kind === "create" ? m.create : m.update).toHaveBeenCalledTimes(1);
  });
});

describe("extension creation freshness", () => {
  it("rejects an old form handler after changing the extension number", async () => {
    const save = prepare("create");
    m.inputs.get("Extension number").onChangeText("3006"); render();
    await save(); expect(m.create).not.toHaveBeenCalled();
    await press("Confirm create extension");
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ extensionNumber: "3006", tenantId: 18 }));
  });
  it("keeps ordinary creation failure visible and permits a deliberate retry", async () => {
    const save = prepare("create"); m.create.mockRejectedValueOnce(new Error("create failed"));
    await save(); expect(m.alerts).toHaveBeenCalledWith("Extension not created", "create failed");
    render(); await press("Confirm create extension"); expect(m.create).toHaveBeenCalledTimes(2);
  });
});

describe("extension assignment freshness", () => {
  it.each(["row", "person"])("rejects a cache-revoked %s before React rerenders", async change => {
    const save = prepare("assign");
    if (change === "row") m.rows = []; else m.people = [];
    await save(); expect(m.update).not.toHaveBeenCalled();
  });
  it.each(["removed row", "changed row", "refreshing inventory", "removed person", "refreshing people", "failed people"])("rejects Save with %s", async change => {
    const save = prepare("assign");
    if (change === "removed row") m.rows = [];
    if (change === "changed row") m.rows = [{ ...m.rows[0], user_id: 22 }];
    if (change === "refreshing inventory") m.inventoryFetching = true;
    if (change === "removed person") m.people = [];
    if (change === "refreshing people") m.peopleFetching = true;
    if (change === "failed people") m.peopleError = true;
    render(); await save(); expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects the old selected-person Save after selecting Unassign", async () => {
    const save = prepare("assign"); press("Unassign"); render();
    await save(); expect(m.update).not.toHaveBeenCalled();
    await press("Save unassigned extension");
    expect(m.update).toHaveBeenCalledWith({ tenantId: 18, id: 51, userId: null });
  });
  it("retains a failed assignment and permits a deliberate retry", async () => {
    const save = prepare("assign"); m.update.mockRejectedValueOnce(new Error("save failed"));
    await save(); expect(render()).toContain("save failed");
    await press("Save person assignment"); expect(m.update).toHaveBeenCalledTimes(2);
    expect(render()).not.toContain("save failed");
  });
});


describe("shared extension mutation hook defaults", () => {
  it.each(["create", "assign"] as const)("preserves default and explicit enabled invalidation for %s", async kind => {
    const hook = kind === "create" ? useCreateExtension : useUpdateExtension;
    await hook().mutateAsync({ tenantId: 18 } as any);
    await hook(true).mutateAsync({ tenantId: 18 } as any);
    expect(m.rowsRefresh).toHaveBeenCalledTimes(2);
    expect(m.rowsRefresh).toHaveBeenCalledWith();
    expect(kind === "create" ? m.statsRefresh : m.peopleRefresh).toHaveBeenCalledTimes(2);
  });
  it.each(["create", "assign"] as const)("lets a caller own refresh for %s", async kind => {
    const hook = kind === "create" ? useCreateExtension : useUpdateExtension;
    await hook(false).mutateAsync({ tenantId: 18 } as any);
    expect(m.rowsRefresh).not.toHaveBeenCalled(); expect(m.peopleRefresh).not.toHaveBeenCalled();
    expect(m.statsRefresh).not.toHaveBeenCalled();
  });
});
it("does not refresh legacy implicit statistics for a multi-workspace creation", async () => {
  const save = prepare("create"); m.workspace.canUseImplicitTenant = false;
  await save();
  expect(m.rowsRefresh).toHaveBeenCalledTimes(1); expect(m.statsRefresh).not.toHaveBeenCalled();
});
it.each(["create", "assign"] as const)("rechecks scope between %s refreshes", async kind => {
  const save = prepare(kind);
  m.rowsRefresh.mockImplementationOnce(() => { m.auth.user = null; authChanged(); return Promise.resolve({}); });
  await save();
  expect(m.rowsRefresh).toHaveBeenCalledTimes(1); expect(m.peopleRefresh).not.toHaveBeenCalled();
  expect(m.statsRefresh).not.toHaveBeenCalled(); expect(m.alerts).not.toHaveBeenCalled();
});


describe("extension assignment radio checked semantics", () => {
  const expectChecked = (markup: string, person: string, checked: boolean) => {
    const button = markup.match(/<button[^>]*>/g)?.find((tag) =>
      tag.includes(`aria-label="Assign ${person}"`));
    expect(button, `Assign ${person} radio`).toBeDefined();
    expect(button).toContain('role="radio"');
    expect(button).toContain(`aria-checked="${checked}"`);
  };
  const openEditor = async (assigned = false) => {
    m.people.push({ id: 22, name: "Som" });
    if (assigned) m.rows[0].user_id = 11;
    render();
    await press(`${assigned ? "Change" : "Assign"} person for extension 3005`);
    return render();
  };
  const expectNoAssignmentWrite = () => expect(m.update).not.toHaveBeenCalled();

  it("exposes every person unchecked for an unassigned extension", async () => {
    const markup = await openEditor();
    expectChecked(markup, "Nok", false); expectChecked(markup, "Som", false);
    expectNoAssignmentWrite();
  });
  it("exposes the existing assignee checked when the editor opens", async () => {
    const markup = await openEditor(true);
    expectChecked(markup, "Nok", true); expectChecked(markup, "Som", false);
    expectNoAssignmentWrite();
  });
  it("checks the chosen person without submitting the assignment", async () => {
    await openEditor(); await press("Assign Nok"); const markup = render();
    expectChecked(markup, "Nok", true); expectChecked(markup, "Som", false);
    expectNoAssignmentWrite();
  });
  it("moves checked state to the newly chosen person", async () => {
    await openEditor(); await press("Assign Nok"); render();
    await press("Assign Som"); const markup = render();
    expectChecked(markup, "Nok", false); expectChecked(markup, "Som", true);
    expectNoAssignmentWrite();
  });
  it("clears every person checked state after choosing Unassign", async () => {
    await openEditor(); await press("Assign Nok"); render();
    await press("Unassign"); const markup = render();
    expectChecked(markup, "Nok", false); expectChecked(markup, "Som", false);
    expect(m.presses.has("Save unassigned extension")).toBe(true);
    expectNoAssignmentWrite();
  });
  it("restores the existing assignee checked state after closing an unsaved choice", async () => {
    await openEditor(true); await press("Assign Som"); render();
    await press("Close assignment editor"); render();
    await press("Change person for extension 3005"); const markup = render();
    expectChecked(markup, "Nok", true); expectChecked(markup, "Som", false);
    expectNoAssignmentWrite();
  });
});
