import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminDashboard from "../app/admin/index";
import { AdminWorkspaceBoundary } from "../components/admin/admin-workspace-boundary";
import { isAdminSessionUnauthorized } from "../lib/admin/session-recovery";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  buttons: new Map<string, () => void>(),
  replace: vi.fn(),
  logout: vi.fn(),
  refetch: vi.fn(),
  auth: {} as any,
  workspace: {} as any,
  tenant: {} as any,
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
    const label = renderToStaticMarkup(props.children).replace(/<[^>]*>/g, "");
    m.buttons.set(label, props.onPress);
    return createElement("button", null, props.children);
  },
}));
vi.mock("expo-router", () => ({ router: { replace: m.replace } }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: box }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
// Retain a hydrated identity while the server rejects its expired cookie.
vi.mock("../components/admin/use-admin-auth-state", () => ({
  useAdminAuthState: () => ({ ...m.auth, retry: m.refetch }),
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({}) }));
vi.mock("../hooks/use-pbx-admin", () => ({
  usePbxAdminWorkspace: () => m.workspace,
  useTenant: () => m.tenant,
  usePbxAdminCapabilities: () => ({ refetch: m.refetch }),
  usePbxDashboardStats: () => ({ refetch: m.refetch }),
  usePbxRecentCalls: () => ({ refetch: m.refetch }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  m.buttons.clear();
  m.auth = { user: { id: 7 }, checking: false, unavailable: false };
  m.tenant = { isError: false, isSuccess: false, refetch: m.refetch };
  m.workspace = {
    selectedTenantId: 18,
    manageableMemberships: [{ tenantId: 18, role: "admin" }],
    canUseImplicitTenant: false,
    admissionError: false,
    tenantQuery: m.tenant,
    membershipsQuery: { isError: false, isLoading: false, refetch: m.refetch },
  };
});

describe("confirmed admin session expiry", () => {
  it.each([
    { data: { code: "UNAUTHORIZED", httpStatus: 401 } },
    { data: { code: "UNAUTHORIZED" } },
  ])("recognizes a tRPC unauthorized response (%j)", (error) => {
    expect(isAdminSessionUnauthorized(error)).toBe(true);
  });
  it.each([
    { data: { code: "FORBIDDEN", httpStatus: 403 } },
    { data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    { data: { code: "UNAUTHORIZED", httpStatus: 403 } },
    { data: { code: "UNAUTHORIZED", httpStatus: 500 } },
    { status: 401 },
    { message: "UNAUTHORIZED" },
    new TypeError("Failed to fetch"),
    null,
    "UNAUTHORIZED",
  ])(
    "does not infer expiry from permission, transport or malformed errors (%j)",
    (error) => {
      expect(isAdminSessionUnauthorized(error)).toBe(false);
    },
  );
  it("treats throwing data accessors as unknown failures", () => {
    expect(
      isAdminSessionUnauthorized({
        get data() {
          throw new Error("unreadable");
        },
      }),
    ).toBe(false);
  });
});

for (const surface of ["dashboard", "boundary"] as const) {
  describe(`${surface} session recovery`, () => {
    const render = () =>
      renderToStaticMarkup(
        surface === "dashboard" ? (
          createElement(AdminDashboard)
        ) : (
          <AdminWorkspaceBoundary>
            Protected workspace form
          </AdminWorkspaceBoundary>
        ),
      );
    it.each([
      { checking: true, unavailable: false, title: "Checking your session" },
      { checking: false, unavailable: true, title: "Session verification unavailable" },
    ])("preserves $title ahead of a cached expired-workspace response", ({ title, ...auth }) => {
      m.auth = { user: null, ...auth };
      Object.assign(m.workspace.membershipsQuery, {
        isError: true,
        error: { data: { code: "UNAUTHORIZED", httpStatus: 401 } },
      });
      const html = render();
      expect(html).toContain(title);
      expect(html).not.toMatch(/Your session has expired|Protected workspace form/);
      expect(m.buttons.has("Sign in")).toBe(false);
      expect(m.replace).not.toHaveBeenCalled();
      expect(m.refetch).not.toHaveBeenCalled();
    });
    for (const failure of ["memberships", "admission"] as const) {
      it(`offers a safe explicit sign-in action after ${failure} 401 with cached user/workspace`, () => {
        const query =
          failure === "memberships" ? m.workspace.membershipsQuery : m.tenant;
        Object.assign(query, {
          isError: true,
          error: { data: { code: "UNAUTHORIZED", httpStatus: 401 } },
        });
        m.workspace.admissionError = failure === "admission";
        const html = render();
        expect(html).toContain("Your session has expired");
        expect(html).not.toContain("Protected workspace form");
        expect(m.buttons.has("Try again")).toBe(false);
        expect(m.replace).not.toHaveBeenCalled();
        m.buttons.get("Sign in")!();
        // The real shared route preserves the explicitly allowlisted returnTo.
        expect(m.replace).toHaveBeenCalledWith({
          pathname: "/auth/sign-in",
          params: { returnTo: "/admin" },
        });
        expect(m.logout).not.toHaveBeenCalled();
        expect(m.refetch).not.toHaveBeenCalled();
      });
      it.each([
        { data: { code: "FORBIDDEN", httpStatus: 403 } },
        { data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
        new TypeError("Failed to fetch"),
      ])(
        `retains retry and workspace isolation for ${failure} errors (%j)`,
        (error) => {
          const query =
            failure === "memberships" ? m.workspace.membershipsQuery : m.tenant;
          Object.assign(query, { isError: true, error });
          m.workspace.admissionError = failure === "admission";
          const html = render();
          expect(html).not.toContain("Your session has expired");
          expect(html).not.toContain("Protected workspace form");
          expect(m.buttons.has("Sign in")).toBe(false);
          m.buttons.get("Try again")!();
          expect(m.refetch).toHaveBeenCalledOnce();
          expect(m.replace).not.toHaveBeenCalled();
          expect(m.logout).not.toHaveBeenCalled();
        },
      );
    }
  });
}
