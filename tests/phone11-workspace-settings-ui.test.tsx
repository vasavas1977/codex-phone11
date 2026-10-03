/* eslint-disable import/first */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };

const m = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(),
  getUseQuery: vi.fn(),
  invalidate: vi.fn(),
  inputs: new Map<string, any>(),
  mutateAsync: vi.fn(),
  presses: new Map<string, any>(),
  refetch: vi.fn(),
  replace: vi.fn(),
  user: { id: 7 },
  frame: { index: 0, values: [] as any[] },
  tenantQuery: {} as any,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
    useRef: (initial: unknown) => {
      const index = m.frame.index++;
      if (!(index in m.frame.values))
        m.frame.values[index] = { current: initial };
      return m.frame.values[index];
    },
    useState: (initial: unknown) => {
      const index = m.frame.index++;
      if (!(index in m.frame.values)) m.frame.values[index] = initial;
      return [
        m.frame.values[index],
        (value: unknown) => {
          m.frame.values[index] =
            typeof value === "function"
              ? (value as (current: unknown) => unknown)(m.frame.values[index])
              : value;
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
  Pressable: (props: any) => {
    if (props.accessibilityLabel)
      m.presses.set(props.accessibilityLabel, props);
    return createElement(
      "button",
      { disabled: props.disabled },
      props.children,
    );
  },
  ScrollView: element,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: element,
  TextInput: (props: any) => {
    if (props.accessibilityLabel) m.inputs.set(props.accessibilityLabel, props);
    return createElement("input", {
      "aria-label": props.accessibilityLabel,
      onChange: () => undefined,
      value: props.value,
    });
  },
  View: element,
}));
vi.mock("expo-router", () => ({
  router: {
    back: m.back,
    canGoBack: () => m.canGoBack(),
    replace: m.replace,
  },
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/admin/admin-workspace-boundary", () => ({
  AdminWorkspaceBoundary: element,
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../constants/oauth", () => ({
  portalSignInRoute: (path: string) => `/auth/sign-in?returnTo=${path}`,
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    background: "#fff",
    border: "#ddd",
    error: "#c00",
    foreground: "#111",
    muted: "#666",
    primary: "#06c",
    success: "#080",
    surface: "#eee",
  }),
}));
vi.mock("../hooks/use-pbx-admin", () => ({
  usePbxAdminWorkspace: () => ({ selectedTenantId: 18 }),
}));
vi.mock("../lib/trpc", () => ({
  trpc: {
    pbx: {
      tenant: {
        get: { useQuery: m.getUseQuery },
        updateSettings: {
          useMutation: () => ({ isPending: false, mutateAsync: m.mutateAsync }),
        },
      },
    },
    useUtils: () => ({
      pbx: { tenant: { get: { invalidate: m.invalidate } } },
    }),
  },
}));

import WorkspaceSettingsScreen from "../app/admin/workspace-settings";
import {
  canManageWorkspaceTimezone,
  normalizeIanaTimezone,
} from "../lib/pbx/workspace-timezone";

function validTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 18,
    name: "Support workspace",
    userRole: "owner",
    settingsAvailable: true,
    supportedSettings: ["businessHoursTimezone"],
    business_hours_timezone: null,
    ...overrides,
  };
}

function render() {
  m.frame.index = 0;
  m.inputs.clear();
  m.presses.clear();
  return renderToStaticMarkup(createElement(WorkspaceSettingsScreen));
}

function typeTimezone(value: string) {
  m.inputs.get("Workspace timezone")?.onChangeText(value);
}

function save() {
  return m.presses.get("Save workspace timezone")?.onPress();
}

beforeEach(() => {
  vi.clearAllMocks();
  m.user = { id: 7 };
  m.frame = { index: 0, values: [] };
  m.tenantQuery = {
    data: validTenant(),
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: m.refetch,
  };
  m.getUseQuery.mockReturnValue(m.tenantQuery);
  m.canGoBack.mockReturnValue(true);
  m.invalidate.mockResolvedValue(undefined);
  m.mutateAsync.mockResolvedValue({
    success: true,
    businessHoursTimezone: "Asia/Tokyo",
  });
});

describe("workspace timezone contract", () => {
  it("requires an owner or administrator plus the server-confirmed setting capability", () => {
    expect(
      canManageWorkspaceTimezone({
        userRole: "owner",
        settingsAvailable: true,
        supportedSettings: ["businessHoursTimezone"],
      }),
    ).toBe(true);
    expect(
      canManageWorkspaceTimezone({
        userRole: "user",
        settingsAvailable: true,
        supportedSettings: ["businessHoursTimezone"],
      }),
    ).toBe(false);
    expect(
      canManageWorkspaceTimezone({
        userRole: "admin",
        settingsAvailable: false,
        supportedSettings: ["businessHoursTimezone"],
      }),
    ).toBe(false);
    expect(
      canManageWorkspaceTimezone({
        userRole: "admin",
        settingsAvailable: true,
        supportedSettings: [],
      }),
    ).toBe(false);
  });

  it("uses the same IANA validation and trimming behavior as the server input", () => {
    expect(normalizeIanaTimezone("  Asia/Bangkok ")).toBe("Asia/Bangkok");
    expect(normalizeIanaTimezone("Not/a-timezone")).toBeNull();
    expect(normalizeIanaTimezone(" ")).toBeNull();
  });
});

describe("workspace timezone screen", () => {
  it("shows an unset value and never writes a default timezone", () => {
    const html = render();
    expect(html).toContain("Unset — no workspace timezone has been saved.");
    expect(m.inputs.get("Workspace timezone").value).toBe("");
    expect(m.presses.get("Save workspace timezone").disabled).toBe(true);
    expect(m.mutateAsync).not.toHaveBeenCalled();
    expect(m.getUseQuery).toHaveBeenCalledWith(
      { tenantId: 18 },
      expect.objectContaining({
        gcTime: 0,
        refetchOnMount: "always",
        staleTime: 0,
      }),
    );
  });

  it("requires an explicit valid save, trims the value, and invalidates the workspace query", async () => {
    render();
    typeTimezone("  Asia/Tokyo  ");
    render();

    expect(m.mutateAsync).not.toHaveBeenCalled();
    await save();

    expect(m.mutateAsync).toHaveBeenCalledOnce();
    expect(m.mutateAsync).toHaveBeenCalledWith({
      tenantId: 18,
      businessHoursTimezone: "Asia/Tokyo",
    });
    expect(m.invalidate).toHaveBeenCalledOnce();
    expect(render()).toContain("Workspace timezone saved.");
  });

  it("keeps invalid user input local and explains how to correct it", async () => {
    render();
    typeTimezone("Not/a-timezone");
    render();

    expect(m.presses.get("Save workspace timezone").disabled).toBe(false);
    await save();

    expect(m.mutateAsync).not.toHaveBeenCalled();
    expect(render()).toContain(
      "Enter a supported IANA time zone, such as Asia/Bangkok.",
    );
  });

  it("does not save a stale tenant response into another selected workspace", async () => {
    m.tenantQuery.data = validTenant({ id: 19 });
    render();
    typeTimezone("Asia/Tokyo");
    render();
    await save();
    expect(m.mutateAsync).not.toHaveBeenCalled();
  });

  it("does not render writable controls without the confirmed capability or role", () => {
    m.tenantQuery.data = validTenant({
      settingsAvailable: false,
      supportedSettings: [],
    });
    expect(render()).toContain("Workspace timezone is unavailable");
    expect(m.inputs.has("Workspace timezone")).toBe(false);
    expect(m.presses.has("Save workspace timezone")).toBe(false);

    m.tenantQuery.data = validTenant({ userRole: "user" });
    expect(render()).toContain("Administrator access required");
    expect(m.inputs.has("Workspace timezone")).toBe(false);
    expect(m.presses.has("Save workspace timezone")).toBe(false);
  });

  it("links the distinct workspace settings page from workspace administration", () => {
    const dashboard = readFileSync(
      resolve(process.cwd(), "app/admin/index.tsx"),
      "utf8",
    );
    expect(dashboard).toContain('label: "Workspace settings"');
    expect(dashboard).toContain('route: "/admin/workspace-settings"');
  });
});
