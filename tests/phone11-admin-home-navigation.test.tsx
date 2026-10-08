import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminDashboard from "../app/admin/index";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup: (node: ReactNode) => string };
const m = vi.hoisted(() => ({
  actions: new Map<string, any>(),
  push: vi.fn(),
  user: { id: 7 } as { id: number } | null,
  selectedTenantId: 18 as number | null,
  role: "admin",
  multiple: true,
  ivr: true as boolean | undefined,
  membershipsLoading: false,
  membershipsError: false,
  tenantLoading: false,
  tenantError: false,
  implicitQueries: [] as boolean[],
}));
function box({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  RefreshControl: () => null,
  Platform: { OS: "web" },
  StyleSheet: { create: (styles: unknown) => styles },
  ScrollView: box,
  View: box,
  Text: box,
  useWindowDimensions: () => ({ width: 1400 }),
  TouchableOpacity: (props: any) => {
    if (props.accessibilityLabel)
      m.actions.set(props.accessibilityLabel, props);
    return createElement(
      "button",
      { disabled: props.disabled },
      props.children,
    );
  },
}));
vi.mock("expo-router", () => ({
  router: { push: m.push, replace: vi.fn(), canGoBack: () => false },
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: box }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../constants/oauth", () => ({ portalSignInRoute: () => "/sign-in" }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    foreground: "#111",
    background: "#fafafa",
    surface: "#fff",
    primary: "#06c",
    border: "#ddd",
    muted: "#555",
  }),
}));
vi.mock("../hooks/use-pbx-admin", () => ({
  usePbxAdminWorkspace: () => ({
    selectedTenantId: m.selectedTenantId,
    hasMultipleMemberships: m.multiple,
    canUseImplicitTenant: !m.multiple,
    manageableMemberships: ["owner", "admin"].includes(m.role)
      ? [{ tenantId: 18, tenantName: "Test workspace", role: m.role }]
      : [],
    membershipsQuery: {
      isLoading: m.membershipsLoading,
      isError: m.membershipsError,
      refetch: vi.fn(),
    },
    chooseTenant: vi.fn(),
  }),
  useTenant: () => ({
    data: { id: m.selectedTenantId, name: "Test workspace", userRole: m.role },
    isSuccess: !m.tenantLoading && !m.tenantError,
    isLoading: m.tenantLoading,
    isError: m.tenantError,
    refetch: vi.fn(),
  }),
  usePbxAdminCapabilities: () => ({
    data: {
      phoneNumbers: true,
      ivr: m.ivr,
      ringGroups: true,
      queues: true,
      businessHours: true,
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
  usePbxDashboardStats: (enabled: boolean) => {
    m.implicitQueries.push(enabled);
    return { data: undefined, refetch: vi.fn() };
  },
  usePbxRecentCalls: (_limit: number, enabled: boolean) => {
    m.implicitQueries.push(enabled);
    return { data: [], refetch: vi.fn() };
  },
}));

function render() {
  m.actions.clear();
  return renderToStaticMarkup(createElement(AdminDashboard));
}
function action(label: string) {
  return [...m.actions.entries()].find(
    ([key]) => key === label || key.startsWith(`${label}:`),
  )?.[1];
}
beforeEach(() => {
  m.push.mockClear();
  m.actions.clear();
  m.user = { id: 7 };
  m.selectedTenantId = 18;
  m.role = "admin";
  m.multiple = true;
  m.ivr = true;
  m.membershipsLoading = false;
  m.membershipsError = false;
  m.tenantLoading = false;
  m.tenantError = false;
  m.implicitQueries = [];
});

describe("admin home IVR navigation", () => {
  it.each(["owner", "admin"])(
    "enables selected-workspace IVR for a multi-workspace %s and preserves implicit route restrictions",
    (role) => {
      m.role = role;
      render();
      const ivr = action("IVR menus");
      expect(ivr).toBeDefined();
      expect(ivr.disabled).toBe(false);
      expect(ivr.accessibilityState.disabled).toBe(false);
      ivr.onPress();
      expect(m.push).toHaveBeenCalledWith("/admin/ivr");
      for (const label of [
        "Ring Groups",
        "Queues",
        "Business Hours",
        "Call analytics",
      ])
        expect(action(label).disabled).toBe(true);
      expect(m.implicitQueries).toEqual([false, false]);
    },
  );
  it.each([false, undefined])(
    "disables IVR without a confirmed capability (%s)",
    (capability) => {
      m.ivr = capability;
      render();
      expect(action("IVR menus").disabled).toBe(true);
      expect(action("IVR menus").accessibilityState.disabled).toBe(true);
      expect(m.push).not.toHaveBeenCalled();
    },
  );
  it("requires a workspace choice before rendering IVR", () => {
    m.selectedTenantId = null;
    expect(render()).toContain("Choose a workspace");
    expect(action("IVR menus")).toBeUndefined();
  });
  it("requires a signed-in administrator", () => {
    m.user = null;
    expect(render()).toContain("Sign in to use workspace administration");
    expect(action("IVR menus")).toBeUndefined();
    m.user = { id: 7 };
    m.role = "user";
    expect(render()).toContain("Only workspace owners and administrators");
    expect(action("IVR menus")).toBeUndefined();
  });
  it.each([
    "membershipsLoading",
    "membershipsError",
    "tenantLoading",
    "tenantError",
  ] as const)("withholds IVR while access is unresolved (%s)", (state) => {
    m[state] = true;
    render();
    expect(action("IVR menus")).toBeUndefined();
    expect(m.push).not.toHaveBeenCalled();
  });
  it("retains all confirmed routes for a single-workspace administrator", () => {
    m.multiple = false;
    render();
    for (const label of [
      "IVR menus",
      "Ring Groups",
      "Queues",
      "Business Hours",
      "Call analytics",
    ])
      expect(action(label).disabled).toBe(false);
    expect(m.implicitQueries).toEqual([true, true]);
  });
});
