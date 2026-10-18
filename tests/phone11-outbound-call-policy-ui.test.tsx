/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
  auth: {} as any, workspace: {} as any, query: {} as any,
  presses: new Map<string, any>(), switches: new Map<string, any>(),
  listeners: new Set<() => void>(), mutate: vi.fn(), refetch: vi.fn(),
  retired: false, retiredWrites: 0,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: any) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = initial;
      return [m.frame.values[i], (value: any) => {
        if (m.retired) m.retiredWrites++;
        m.frame.values[i] = typeof value === "function" ? value(m.frame.values[i]) : value;
      }];
    },
    useRef: (initial: any) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = { current: initial };
      return m.frame.values[i];
    },
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      const i = m.frame.index++, old = m.frame.values[i];
      if (!old || deps.some((d, n) => !Object.is(d, old.deps[n])))
        m.frame.effects.push(() => { old?.cleanup?.(); m.frame.values[i] = { deps, cleanup: effect() }; });
    },
  };
});
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({
  ActivityIndicator: () => null, View: element, Text: element,
  StyleSheet: { create: (s: any) => s },
  Pressable: (props: any) => { m.presses.set(props.accessibilityLabel, props); return element(props); },
  Switch: (props: any) => { m.switches.set(props.accessibilityLabel, props); return null; },
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "blue" }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => m.auth }));
vi.mock("../hooks/use-pbx-admin", () => ({
  usePbxAdminWorkspace: () => m.workspace,
  useFraudControls: () => m.query,
  useUpdateFraudControls: () => ({ isPending: false, mutateAsync: m.mutate }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => m.auth,
  addAuthChangeListener: (fn: () => void) => { m.listeners.add(fn); return () => m.listeners.delete(fn); },
}));
import { OutboundCallPolicy } from "../components/admin/outbound-call-policy";
function observation(overrides: Record<string, unknown> = {}) {
  return { ownerId: 7, authIdentity: 1, tenantId: 18, admissionScope: "7:18:1", configured: true,
    internationalEnabled: false, premiumRateEnabled: false, ...overrides };
}
function render() {
  m.frame.index = 0; m.presses.clear(); m.switches.clear();
  const html = renderToStaticMarkup(createElement(OutboundCallPolicy));
  for (const fn of m.frame.effects.splice(0)) fn();
  return html;
}
function toggle(label = "Allow international calls", value = true) {
  m.switches.get(label).onValueChange(value); render();
}
function save() { return m.presses.get("Save outbound call policy").onPress(); }
function unmount() { for (const v of m.frame.values) v?.cleanup?.(); m.retired = true; }
function auth(user: any, loading = false) { m.auth = { user, loading }; m.listeners.forEach(fn => fn()); }
function deferred() {
  let resolve!: (v?: any) => void;
  const promise = new Promise<any>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks(); m.frame = { index: 0, values: [], effects: [] };
  m.listeners.clear(); m.retired = false; m.retiredWrites = 0;
  m.auth = { user: { id: 7 }, loading: false };
  m.workspace = { isAdmitted: true, selectedTenantId: 18, admissionScope: "7:18:1",
    capabilitiesQuery: { data: { explicitFraudControls: true } } };
  m.query = { authIdentity: 1, data: observation(), isSuccess: true, isError: false, isFetching: false,
    isLoading: false, refetch: m.refetch };
  m.mutate.mockResolvedValue({ success: true });
  m.refetch.mockImplementation(async () => ({ isError: false, data: m.query.data }));
});
afterEach(unmount);

describe("selected-workspace outbound call policy", () => {
  it("shows absent policy as off and does not write defaults or no-op saves", async () => {
    m.query.data = observation({ configured: false });
    expect(render()).toContain("No policy has been configured");
    expect(m.switches.get("Allow international calls").value).toBe(false);
    expect(m.switches.get("Allow premium-rate calls").value).toBe(false);
    expect(m.presses.get("Save outbound call policy").disabled).toBe(true);
    await save(); expect(m.mutate).not.toHaveBeenCalled();
    expect(render()).toContain("Domestic, internal and emergency calling behavior is unchanged");
  });
  it.each([undefined, false, "true", 1])("refuses old or malformed capability %s", async bit => {
    m.workspace.capabilitiesQuery.data.explicitFraudControls = bit;
    expect(render()).toContain("does not support selected-workspace");
    toggle(); await save(); expect(m.mutate).not.toHaveBeenCalled();
    expect(m.presses.has("Refresh outbound call policy")).toBe(false);
  });
  it.each(["isLoading", "isFetching", "isError"])("disables controls while %s", async flag => {
    m.query[flag] = true; if (flag === "isLoading") m.query.isSuccess = false;
    render(); expect(m.switches.get("Allow international calls").disabled).toBe(true);
    toggle(); await save(); expect(m.mutate).not.toHaveBeenCalled();
  });
  it.each([{ tenantId: 19 }, { ownerId: 8 }, { admissionScope: "old" },
    { internationalEnabled: "true" }])("rejects mismatched or malformed policy %j", async patch => {
    m.query.data = observation(patch); render(); toggle(); await save();
    expect(m.mutate).not.toHaveBeenCalled();
  });
  it("saves only explicit tenant and both booleans, waiting for matching readback", async () => {
    render(); toggle();
    const readback = deferred(); m.refetch.mockReturnValueOnce(readback.promise);
    const request = save(); await Promise.resolve();
    expect(m.mutate).toHaveBeenCalledWith({ tenantId: 18, internationalEnabled: true, premiumRateEnabled: false });
    expect(render()).not.toContain("saved and confirmed");
    expect(m.refetch).toHaveBeenCalledWith({ cancelRefetch: true });
    m.query.data = observation({ internationalEnabled: true });
    readback.resolve({ isError: false, data: m.query.data }); await request;
    expect(render()).toContain("Outbound call policy saved and confirmed.");
    expect(m.presses.get("Save outbound call policy").disabled).toBe(true);
  });
  it.each(["error", "mismatch", "wrong-tenant"])("does not confirm an unsuccessful readback: %s", async mode => {
    render(); toggle();
    m.refetch.mockResolvedValueOnce({ isError: mode === "error", data: observation(
      mode === "wrong-tenant" ? { tenantId: 19, internationalEnabled: true } : {}) });
    await save(); const html = render(); expect(html).not.toContain("saved and confirmed");
    expect(html).toContain("Refresh the policy");
  });
  it("explains mutation errors and offers a fresh retry without a false success", async () => {
    render(); toggle(); m.mutate.mockRejectedValueOnce(new Error("private backend detail"));
    await save(); const html = render(); expect(html).toContain("could not be confirmed");
    expect(html).not.toContain("private backend detail"); expect(m.refetch).not.toHaveBeenCalled();
    m.presses.get("Refresh outbound call policy").onPress();
    expect(m.refetch).toHaveBeenCalledOnce();
  });
  it("serializes double save handlers before the mutation hook rerenders", async () => {
    render(); toggle(); const wait = deferred(); m.mutate.mockReturnValueOnce(wait.promise);
    const handler = m.presses.get("Save outbound call policy").onPress;
    const first = handler(); await handler(); expect(m.mutate).toHaveBeenCalledOnce();
    wait.resolve(); await first;
  });
  it("rejects an old save handler after its query starts refetching", async () => {
    render(); toggle(); const oldSave = m.presses.get("Save outbound call policy").onPress;
    m.query.isFetching = true; render(); await oldSave();
    expect(m.mutate).not.toHaveBeenCalled();
  });
  it.each(["workspace", "account", "revoked", "membership-refresh", "unmount"])("discards a late mutation after %s", async mode => {
    render(); toggle(); const wait = deferred(); m.mutate.mockReturnValueOnce(wait.promise);
    const request = save();
    if (mode === "workspace") { m.workspace.selectedTenantId = 19; m.workspace.admissionScope = "7:19:1"; render(); }
    if (mode === "account") auth({ id: 8 });
    if (mode === "revoked") { m.workspace.isAdmitted = false; render(); }
    if (mode === "membership-refresh") { m.workspace.admissionScope = "7:18:2"; render(); }
    if (mode === "unmount") unmount();
    wait.resolve(); await request; expect(m.refetch).not.toHaveBeenCalled();
    if (mode !== "unmount") expect(render()).not.toContain("saved and confirmed");
    expect(m.retiredWrites).toBe(0);
  });
  it("discards a late readback after account change and disables an old captured save", async () => {
    render(); toggle(); const oldSave = m.presses.get("Save outbound call policy").onPress;
    const wait = deferred(); m.refetch.mockReturnValueOnce(wait.promise);
    const request = save(); await Promise.resolve(); auth(null);
    wait.resolve({ isError: false, data: observation({ internationalEnabled: true }) });
    await request; await oldSave(); expect(m.mutate).toHaveBeenCalledOnce();
    expect(render()).not.toContain("saved and confirmed");
  });
  it("blocks cached policy after a same-ID authentication identity replacement", async () => {
    render(); toggle();
    auth({ id: 7 }); m.query.authIdentity = 2;
    render(); toggle(); await save();
    expect(m.switches.get("Allow international calls").disabled).toBe(true);
    expect(m.mutate).not.toHaveBeenCalled();
    m.query.data = observation({ authIdentity: 2 }); render();
    expect(m.switches.get("Allow international calls").value).toBe(false);
    expect(m.switches.get("Allow international calls").disabled).toBe(false);
  });
  it("discards a pending readback after same-ID reauthentication", async () => {
    render(); toggle(); const wait = deferred(); m.refetch.mockReturnValueOnce(wait.promise);
    const request = save(); await Promise.resolve();
    auth({ id: 7 }); m.query.authIdentity = 2; render();
    wait.resolve({ isError: false, data: observation({ internationalEnabled: true }) });
    await request; expect(render()).not.toContain("saved and confirmed");
  });
  it("clears draft on workspace change without carrying old permissions", () => {
    render(); toggle(); expect(m.switches.get("Allow international calls").value).toBe(true);
    m.workspace.selectedTenantId = 19; m.workspace.admissionScope = "7:19:1";
    m.query.data = observation({ tenantId: 19, admissionScope: "7:19:1" }); render();
    expect(m.switches.get("Allow international calls").value).toBe(false);
    expect(m.presses.get("Save outbound call policy").disabled).toBe(true);
  });
});
