/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
  listeners: new Set<() => void>(),
  presses: new Map<string, any>(),
  user: { id: 7 },
  authUser: { id: 7 } as { id: number } | null,
  tenant: {} as any,
  workspace: {} as any,
  members: [] as any[],
  edit: null as null | ((member: any) => void),
  mutate: vi.fn(),
  refetch: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: (fn: unknown, deps: unknown[]) => {
      const i = m.frame.index++;
      const old = m.frame.values[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index]))) {
        m.frame.values[i] = { deps, fn };
      }
      return m.frame.values[i].fn;
    },
    useState: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = initial;
      return [
        m.frame.values[i],
        (value: any) => {
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
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const i = m.frame.index++;
      const old = m.frame.values[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index]))) {
        m.frame.effects.push(() => {
          old?.cleanup?.();
          m.frame.values[i] = { deps, cleanup: effect() };
        });
      }
    },
  };
});
function element({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Alert: { alert: m.alert },
  Modal: ({ visible, children }: any) =>
    visible ? element({ children }) : null,
  Platform: { OS: "web" },
  StyleSheet: { create: (s: unknown) => s },
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  TouchableOpacity: (props: any) => {
    const label =
      props.accessibilityLabel ||
      (typeof props.children?.props?.children === "string"
        ? props.children.props.children
        : null);
    if (label) m.presses.set(label, props);
    // Radio options use two Text children, as the real editor does.
    if (props.accessibilityRole === "radio") {
      m.presses.set(props.children[0].props.children, props);
    }
    return createElement(
      "button",
      { disabled: props.disabled, "aria-label": props.accessibilityLabel },
      props.children,
    );
  },
  View: element,
  ScrollView: element,
  useWindowDimensions: () => ({ width: 1200 }),
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/admin/admin-workspace-boundary", () => ({
  AdminWorkspaceBoundary: element,
}));
vi.mock("../components/admin/admin-invitations", () => ({
  AdminInvitations: () => null,
}));
vi.mock("../components/admin/admin-people-table", () => ({
  AdminPeopleTable: ({ onEdit }: any) => {
    m.edit = onEdit;
    return null;
  },
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), push: vi.fn() } }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ primary: "#06c", surface: "#fff", border: "#ddd" }),
}));
vi.mock("../hooks/use-directory", () => ({
  useDirectory: () => ({ people: [] }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.authUser }),
  addAuthChangeListener: (listener: () => void) => {
    m.listeners.add(listener);
    return () => m.listeners.delete(listener);
  },
}));
vi.mock("../hooks/use-pbx-admin", () => ({
  useTenant: () => m.tenant,
  usePbxAdminWorkspace: () => m.workspace,
  useTenantMembers: () => ({
    data: m.members,
    isSuccess: true,
    refetch: m.refetch,
  }),
  useUpdateTenantMember: () => ({ mutateAsync: m.mutate, isPending: false }),
}));
import AdminUsers from "../app/admin/users";

function render() {
  m.frame.index = 0;
  m.presses.clear();
  const markup = renderToStaticMarkup(createElement(AdminUsers));
  for (const effect of m.frame.effects.splice(0)) effect();
  return markup;
}
function press(label: string) {
  const button = m.presses.get(label);
  expect(button, `button ${label}`).toBeDefined();
  expect(button.disabled, `enabled ${label}`).not.toBe(true);
  return button.onPress();
}
function open(member = m.members[0]) {
  render();
  m.edit!(member);
  render();
}
function requestDeactivation() {
  open();
  press("Inactive");
  render();
  press("Save membership changes");
  return render();
}
async function settled() {
  await Promise.resolve();
  await Promise.resolve();
  render();
}
function unmount() {
  for (const slot of m.frame.values) slot?.cleanup?.();
}
beforeEach(() => {
  vi.clearAllMocks();
  m.listeners.clear();
  m.frame = { index: 0, values: [], effects: [] };
  m.user = { id: 7 };
  m.authUser = m.user;
  m.tenant = {
    data: { id: 18, userRole: "owner", name: "Support" },
    isSuccess: true,
  };
  m.workspace = {
    selectedTenantId: 18,
    membershipsQuery: { isSuccess: true, isFetching: false },
  };
  m.members = [{ id: 88, name: "Nok", role: "user", status: "active" }];
  m.mutate.mockResolvedValue({ success: true });
  m.refetch.mockResolvedValue({});
});

describe("web member deactivation confirmation", () => {
  it("ignores a retained role Save after the same draft returns to Member", async () => {
    open();
    press("Administrator");
    render();
    const oldSave = m.presses.get("Save membership changes").onPress;
    press("Member");
    render();
    oldSave();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.presses.has("Close member editor")).toBe(true);
  });
  it("ignores a retained Inactive Save after cancel and return to Active", async () => {
    open();
    press("Inactive");
    render();
    const oldSave = m.presses.get("Save membership changes").onPress;
    oldSave();
    render();
    press("Cancel member deactivation");
    render();
    press("Active");
    render();
    oldSave();
    render();
    expect(m.presses.has("Confirm member deactivation")).toBe(false);
    expect(m.mutate).not.toHaveBeenCalled();
  });
  it("invalidates Save synchronously when a role draft changes before rerender", async () => {
    open();
    press("Administrator");
    render();
    const oldSave = m.presses.get("Save membership changes").onPress;
    press("Member");
    oldSave();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.presses.has("Close member editor")).toBe(true);
    press("Save membership changes");
    render();
    expect(m.presses.has("Close member editor")).toBe(false);
  });
  it("invalidates an old no-change Save when roleChanged first transitions to true", async () => {
    open();
    const noChangeSave = m.presses.get("Save membership changes").onPress;
    press("Member");
    noChangeSave();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.presses.has("Close member editor")).toBe(true);
    press("Administrator");
    render();
    press("Save membership changes");
    await settled();
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 18,
      userId: 88,
      role: "admin",
    });
  });
  it("keeps a retained Save inert when role values cycle back to the same value", async () => {
    open();
    press("Administrator");
    render();
    const oldSave = m.presses.get("Save membership changes").onPress;
    press("Member");
    render();
    press("Administrator");
    render();
    oldSave();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
    press("Save membership changes");
    await settled();
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 18,
      userId: 88,
      role: "admin",
    });
  });
  it("keeps current Save usable when the selected role is pressed again without a state change", async () => {
    open();
    press("Administrator");
    render();
    const save = m.presses.get("Save membership changes").onPress;
    press("Administrator");
    save();
    await settled();
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 18,
      userId: 88,
      role: "admin",
    });
  });
  it("keeps current Save usable when the selected status is pressed again without a state change", async () => {
    open();
    press("Inactive");
    render();
    const save = m.presses.get("Save membership changes").onPress;
    press("Inactive");
    save();
    render();
    expect(m.presses.has("Confirm member deactivation")).toBe(true);
    press("Confirm member deactivation");
    await settled();
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 18,
      userId: 88,
      status: "inactive",
    });
  });
  it("keeps retained Save inert across status cycles and unchanged-draft Cancel", async () => {
    open();
    press("Inactive");
    render();
    const oldSave = m.presses.get("Save membership changes").onPress;
    press("Active");
    render();
    press("Inactive");
    render();
    oldSave();
    render();
    expect(m.presses.has("Confirm member deactivation")).toBe(false);
    press("Save membership changes");
    render();
    const beforeCancelSave = m.presses.get(
      "Confirm member deactivation",
    ).onPress;
    press("Cancel member deactivation");
    render();
    oldSave();
    beforeCancelSave();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.presses.has("Confirm member deactivation")).toBe(false);
    press("Save membership changes");
    render();
    press("Confirm member deactivation");
    await settled();
    expect(m.mutate).toHaveBeenCalledTimes(1);
  });
  it("opens explicit confirmation instead of the no-op web Alert and submits only after confirmation", async () => {
    const markup = requestDeactivation();
    expect(markup).toContain("Deactivate membership?");
    expect(m.alert).not.toHaveBeenCalled();
    expect(m.mutate).not.toHaveBeenCalled();
    press("Confirm member deactivation");
    await settled();
    expect(m.mutate).toHaveBeenCalledTimes(1);
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 18,
      userId: 88,
      status: "inactive",
    });
  });
  it("describes the real SIP and extension consequences and does not promise automatic restoration", () => {
    const markup = requestDeactivation();
    expect(markup).toContain("revokes SIP access");
    expect(markup).toContain("suspends those extensions and SIP accounts");
    expect(markup).toContain(
      "removes their permission to use assigned extensions",
    );
    expect(markup).toContain("Reactivating membership does not restore");
    expect(markup).not.toContain("SIP credentials are not changed");
    expect(markup).not.toContain("do not suspend SIP credentials");
  });
  it("Cancel preserves the draft and invalidates a retained confirmation callback", async () => {
    requestDeactivation();
    const oldConfirm = m.presses.get("Confirm member deactivation").onPress;
    press("Cancel member deactivation");
    render();
    oldConfirm();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.presses.get("Inactive").accessibilityState.selected).toBe(true);
    press("Save membership changes");
    render();
    press("Confirm member deactivation");
    await settled();
    expect(m.mutate).toHaveBeenCalledTimes(1);
  });
  it("requires a fresh confirmation after a cancelled draft changes role", async () => {
    requestDeactivation();
    const oldConfirm = m.presses.get("Confirm member deactivation").onPress;
    press("Cancel member deactivation");
    render();
    press("Administrator");
    render();
    press("Save membership changes");
    render();
    oldConfirm();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
    press("Confirm member deactivation");
    await settled();
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 18,
      userId: 88,
      role: "admin",
      status: "inactive",
    });
  });
  it("invalidates cancelled confirmation when the draft returns to Active", async () => {
    requestDeactivation();
    const oldConfirm = m.presses.get("Confirm member deactivation").onPress;
    press("Cancel member deactivation");
    render();
    press("Active");
    render();
    oldConfirm();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
    press("Save membership changes");
    render();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.presses.has("Close member editor")).toBe(false);
  });
  it("locks draft controls while awaiting explicit confirmation", () => {
    requestDeactivation();
    expect(m.presses.get("Administrator").disabled).toBe(true);
    expect(m.presses.get("Active").disabled).toBe(true);
    // Retained radio callbacks cannot bypass the disabled controls.
    m.presses.get("Administrator").onPress();
    m.presses.get("Active").onPress();
    render();
    expect(m.presses.get("Inactive").accessibilityState.selected).toBe(true);
    expect(m.presses.get("Member").accessibilityState.selected).toBe(true);
  });
  it("rejects rapid duplicate confirmations before the mutation hook rerenders", async () => {
    let resolve!: (value: unknown) => void;
    m.mutate.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    requestDeactivation();
    const confirm = m.presses.get("Confirm member deactivation").onPress;
    confirm();
    confirm();
    render();
    expect(m.mutate).toHaveBeenCalledTimes(1);
    expect(m.presses.get("Confirm member deactivation").disabled).toBe(true);
    resolve({ success: true });
    await settled();
    expect(m.presses.has("Confirm member deactivation")).toBe(false);
  });
  it("keeps the confirmation and error available for an explicit retry", async () => {
    m.mutate.mockRejectedValueOnce(
      new Error("Membership update unavailable. Try again."),
    );
    requestDeactivation();
    press("Confirm member deactivation");
    await settled();
    expect(render()).toContain("Membership update unavailable. Try again.");
    press("Confirm member deactivation");
    await settled();
    expect(m.mutate).toHaveBeenCalledTimes(2);
    expect(m.refetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    "close",
    "member",
    "workspace",
    "account",
    "same-account-session",
    "unmount",
    "role-loss",
    "owner-downgrade",
    "target-change",
    "workspace-refetch",
  ])("makes a retained confirmation inert after %s", async (change) => {
    requestDeactivation();
    const confirm = m.presses.get("Confirm member deactivation").onPress;
    if (change === "close") {
      press("Close member editor");
      render();
    }
    if (change === "member") {
      m.members.push({ id: 89, name: "Mai", role: "user", status: "active" });
      m.edit!(m.members[1]);
      render();
    }
    if (change === "workspace") {
      m.workspace.selectedTenantId = 19;
      render();
    }
    if (change === "account" || change === "same-account-session") {
      m.authUser = { id: change === "account" ? 9 : 7 };
      for (const listener of m.listeners) listener();
      // Exercise invalidation before useAuth has published a new render.
    }
    if (change === "unmount") unmount();
    if (change === "role-loss") {
      m.tenant.data.userRole = "user";
      render();
    }
    if (change === "owner-downgrade") {
      m.tenant.data.userRole = "admin";
      render();
    }
    if (change === "target-change") {
      m.members[0] = { ...m.members[0], status: "inactive" };
      render();
    }
    if (change === "workspace-refetch") {
      m.workspace.membershipsQuery.isFetching = true;
      render();
    }
    confirm();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
  });
  it.each(["resolve", "reject"])(
    "ignores a stale %s after the editor closes",
    async (outcome) => {
      let resolve!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      m.mutate.mockReturnValue(
        new Promise((done, fail) => {
          resolve = done;
          reject = fail;
        }),
      );
      requestDeactivation();
      press("Confirm member deactivation");
      press("Close member editor");
      render();
      if (outcome === "resolve") resolve({ success: true });
      else reject(new Error("stale error"));
      await settled();
      expect(render()).not.toContain("stale error");
      expect(m.refetch).not.toHaveBeenCalled();
    },
  );
  it("preserves ordinary role-only Save and prevents rapid duplicate submissions", async () => {
    open();
    press("Administrator");
    render();
    const save = m.presses.get("Save membership changes").onPress;
    save();
    save();
    await settled();
    expect(m.mutate).toHaveBeenCalledTimes(1);
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 18,
      userId: 88,
      role: "admin",
    });
    expect(m.alert).not.toHaveBeenCalled();
  });
  it("preserves active membership restoration without restoring extensions implicitly", async () => {
    m.members[0].status = "inactive";
    open();
    press("Active");
    render();
    press("Save membership changes");
    await settled();
    expect(m.mutate).toHaveBeenCalledWith({
      tenantId: 18,
      userId: 88,
      status: "active",
    });
  });
  it("ignores an old Save callback after another member replaces the editor", async () => {
    open();
    press("Administrator");
    render();
    const oldSave = m.presses.get("Save membership changes").onPress;
    m.members.push({ id: 89, name: "Mai", role: "user", status: "active" });
    m.edit!(m.members[1]);
    render();
    oldSave();
    await settled();
    expect(m.mutate).not.toHaveBeenCalled();
  });
  it("does not publish a previous session's failed mutation into a new editor", async () => {
    let reject!: (error: Error) => void;
    m.mutate.mockReturnValueOnce(
      new Promise((_done, fail) => {
        reject = fail;
      }),
    );
    requestDeactivation();
    press("Confirm member deactivation");
    m.authUser = { id: 9 };
    for (const listener of m.listeners) listener();
    m.user = m.authUser;
    render();
    open();
    reject(new Error("previous session error"));
    await settled();
    expect(render()).not.toContain("previous session error");
    expect(m.presses.has("Close member editor")).toBe(true);
    expect(m.refetch).not.toHaveBeenCalled();
  });
  it("preserves errors and retry for an ordinary role-only save", async () => {
    m.mutate.mockRejectedValueOnce(new Error("Role update failed"));
    open();
    press("Administrator");
    render();
    press("Save membership changes");
    await settled();
    expect(render()).toContain("Role update failed");
    press("Save membership changes");
    await settled();
    expect(m.mutate).toHaveBeenCalledTimes(2);
    expect(m.refetch).toHaveBeenCalledTimes(1);
  });
  it("closes after success even when the mutation hook has already refreshed membership state", async () => {
    let resolve!: (value: unknown) => void;
    m.mutate.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    requestDeactivation();
    press("Confirm member deactivation");
    m.members[0] = { ...m.members[0], status: "inactive" };
    m.workspace.membershipsQuery.isFetching = true;
    render();
    resolve({ success: true });
    await settled();
    expect(m.presses.has("Close member editor")).toBe(false);
    expect(m.refetch).toHaveBeenCalledTimes(1);
  });
});
