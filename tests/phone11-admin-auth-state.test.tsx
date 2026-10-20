import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminDashboard from "../app/admin/index";
import { AdminWorkspaceBoundary } from "../components/admin/admin-workspace-boundary";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  auth: {
    user: null as { id: number } | null,
    loading: true,
    error: null as Error | null,
  },
  frame: { index: 0, values: [] as any[] },
  actions: new Map<string, any>(),
  refresh: vi.fn(),
  membershipRefresh: vi.fn(),
  role: "owner",
  workspaceChecking: false,
  workspaceError: false,
  admissionError: false,
  updateRequired: false,
  selectedTenantId: 18 as number | null,
}));

// Retain state/ref slots across explicit renders, as in the existing admin
// confirmation tests; no DOM runtime or new dependency is needed.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = m.frame.index++;
      if (!(index in m.frame.values)) m.frame.values[index] = initial;
      return [
        m.frame.values[index],
        (value: unknown) => {
          m.frame.values[index] = value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = m.frame.index++;
      if (!(index in m.frame.values))
        m.frame.values[index] = { current: initial };
      return m.frame.values[index];
    },
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  };
});
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => m.auth,
  addAuthChangeListener: vi.fn(() => () => {}),
}));
vi.mock("../lib/_core/api", () => ({ refreshAuth: m.refresh }));
function box({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  ActivityIndicator: () => createElement("span", { role: "progressbar" }),
  RefreshControl: () => null,
  Platform: { OS: "web" },
  StyleSheet: { create: (styles: unknown) => styles },
  ScrollView: box,
  View: box,
  Text: box,
  useWindowDimensions: () => ({ width: 1400 }),
  TouchableOpacity: (props: any) => {
    const label =
      props.accessibilityLabel || props.children?.props?.children || "";
    m.actions.set(label, props);
    return createElement(
      "button",
      { disabled: props.disabled },
      props.children,
    );
  },
}));
vi.mock("expo-router", () => ({ router: { replace: vi.fn(), push: vi.fn() } }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: box }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({}) }));
vi.mock("../hooks/use-pbx-admin", () => ({
  usePbxAdminWorkspace: () => ({
    selectedTenantId: m.selectedTenantId,
    canUseImplicitTenant: true,
    admissionChecking: m.workspaceChecking,
    admissionError: m.admissionError,
    updateRequired: m.updateRequired,
    manageableMemberships: ["owner", "admin"].includes(m.role)
      ? [{ tenantId: 18, tenantName: "Allowed workspace", role: m.role }]
      : [],
    membershipsQuery: {
      isLoading: false,
      isError: m.workspaceError,
      refetch: m.membershipRefresh,
    },
  }),
  useTenant: () => ({ data: { userRole: m.role }, isSuccess: true }),
  usePbxAdminCapabilities: () => ({ data: {}, isSuccess: true }),
  usePbxDashboardStats: () => ({}),
  usePbxRecentCalls: () => ({}),
}));

function render(screen: "home" | "boundary") {
  m.frame.index = 0;
  m.actions.clear();
  return renderToStaticMarkup(
    screen === "home" ? (
      createElement(AdminDashboard)
    ) : (
      <AdminWorkspaceBoundary>ADMITTED_CHILD</AdminWorkspaceBoundary>
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  m.auth = { user: null, loading: true, error: null };
  m.frame.values = [];
  m.role = "owner";
  m.workspaceChecking =
    m.workspaceError =
    m.admissionError =
    m.updateRequired =
      false;
  m.selectedTenantId = 18;
});

describe.each(["home", "boundary"] as const)(
  "admin %s session presentation",
  (screen) => {
    it("withholds sign-in and cached workspace content until initial verification completes", () => {
      const html = render(screen);
      expect(html).toContain("Checking your session");
      expect(html).toContain('role="progressbar"');
      expect(html).not.toMatch(/Sign in|ADMITTED_CHILD|Allowed workspace/);
      expect(m.actions.has("Try again")).toBe(false);
      expect(m.refresh).not.toHaveBeenCalled();
    });
    it("shows genuine anonymous state after a completed 401 check", () => {
      m.auth.loading = false;
      expect(render(screen)).toContain("Sign in");
      expect(render(screen)).not.toContain("Session verification unavailable");
      expect(m.actions.has("Try again")).toBe(false);
    });
    it.each(["Cannot connect", "Unexpected profile"])(
      "offers session Retry for a cold %s failure",
      async (message) => {
        m.auth = { user: null, loading: false, error: new Error(message) };
        expect(render(screen)).toContain("Session verification unavailable");
        expect(render(screen)).not.toContain(message);
        expect(render(screen)).not.toMatch(/Sign in|ADMITTED_CHILD/);
        const retry = m.actions.get("Try again").onPress;
        let resolve!: () => void;
        m.refresh.mockReturnValueOnce(
          new Promise<void>((done) => {
            resolve = done;
          }),
        );
        retry();
        retry(); // Guard duplicate clicks even before the next render.
        expect(m.refresh).toHaveBeenCalledTimes(1);
        expect(m.membershipRefresh).not.toHaveBeenCalled();
        expect(render(screen)).toContain("Checking your session");
        expect(m.actions.has("Try again")).toBe(false);
        resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(render(screen)).toContain("Session verification unavailable");
        expect(m.actions.has("Try again")).toBe(true);
      },
    );
    it("transitions from Retry to anonymous when verification confirms no session", async () => {
      m.auth = { user: null, loading: false, error: new Error("unavailable") };
      render(screen);
      m.refresh.mockImplementationOnce(async () => {
        m.auth.error = null;
      });
      m.actions.get("Try again").onPress();
      await Promise.resolve();
      expect(render(screen)).toContain("Sign in");
    });
    it("keeps verified users behind workspace checks during refresh and preserves role denial", () => {
      m.auth = {
        user: { id: 7 },
        loading: true,
        error: new Error("refresh failed"),
      };
      m.workspaceChecking = true;
      expect(render(screen)).toContain("Checking workspace access");
      expect(render(screen)).not.toMatch(
        /Sign in|Session verification unavailable|ADMITTED_CHILD/,
      );
      m.workspaceChecking = false;
      m.auth.loading = false;
      m.role = "user";
      expect(render(screen)).toContain(
        screen === "home"
          ? "Only workspace owners"
          : "Administrator access required",
      );
      expect(render(screen)).not.toMatch(/Sign in|ADMITTED_CHILD/);
      m.role = "owner";
      expect(render(screen)).not.toMatch(
        /Sign in|Session verification unavailable/,
      );
      if (screen === "boundary")
        expect(render(screen)).toContain("ADMITTED_CHILD");
    });
    it("retains workspace API failures and routes their Retry to memberships", () => {
      m.auth = { user: { id: 7 }, loading: false, error: null };
      m.workspaceError = true;
      expect(render(screen)).toContain(
        screen === "home"
          ? "Workspace administration is unavailable"
          : "Workspace access unavailable",
      );
      m.actions.get("Try again").onPress();
      expect(m.membershipRefresh).toHaveBeenCalledTimes(1);
      expect(m.refresh).not.toHaveBeenCalled();
    });
  },
);
