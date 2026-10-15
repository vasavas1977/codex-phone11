import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminShell,
  type AdminShellProps,
} from "../components/admin/admin-shell";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup: (node: ReactNode) => string };
const m = vi.hoisted(() => ({
  links: new Map<string, any>(),
  width: 1400,
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
}));
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
    useEffect: (effect: () => void, deps: unknown[]) => {
      const index = m.frame.index++;
      const previous = m.frame.values[index];
      if (
        !previous ||
        deps.some((value, i) => !Object.is(value, previous[i]))
      ) {
        m.frame.values[index] = deps;
        m.frame.effects.push(effect);
      }
    },
  };
});
function box({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  View: box,
  Text: box,
  ScrollView: box,
  Modal: box,
  Platform: { OS: "web" },
  useWindowDimensions: () => ({ width: m.width }),
  StyleSheet: { create: (x: unknown) => x, absoluteFillObject: {} },
  Pressable: (p: any) => {
    m.links.set(p.accessibilityLabel, p);
    return createElement(
      "button",
      {
        disabled: p.disabled,
        "aria-label": p.accessibilityLabel,
        "aria-expanded": p.accessibilityState?.expanded,
      },
      p.children,
    );
  },
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    surface: "#fff",
    foreground: "#111",
    primary: "#0057ff",
    border: "#ddd",
    muted: "#555",
    background: "#fafafa",
  }),
}));
const props = (): AdminShellProps => ({
  children: createElement("p", null, "protected page"),
  pathname: "/admin/users",
  workspaceName: "Test",
  workspaces: [{ id: 1, name: "Test" }],
  selectedTenantId: 1,
  canManage: true,
  canUseImplicitTenant: true,
  capabilities: {
    phoneNumbers: true,
    sites: true,
    queues: true,
    ringGroups: true,
    ivr: true,
    businessHours: true,
  },
  onNavigate: vi.fn(),
  onChooseWorkspace: vi.fn(),
});
function resetFrame() {
  m.frame = { index: 0, values: [], effects: [] };
}
function renderShell(p: AdminShellProps, mounted = true) {
  const render = () => {
    m.frame.index = 0;
    m.links.clear();
    return renderToStaticMarkup(createElement(AdminShell, p));
  };
  const first = render();
  if (!mounted) return first;
  for (const effect of m.frame.effects.splice(0)) effect();
  return render();
}
beforeEach(() => {
  resetFrame();
  m.links.clear();
  m.width = 1400;
});
describe("admin navigation boundaries", () => {
  it("exposes matching authorized destinations and preserves selected state", () => {
    const p = props();
    renderShell(p);
    expect(m.links.get("People").accessibilityState.selected).toBe(true);
    m.links.get("Call queues").onPress();
    expect(p.onNavigate).toHaveBeenCalledWith("/admin/queues");
  });
  it("keeps management destinations hidden without verified admin membership", () => {
    renderShell({ ...props(), canManage: false });
    expect(m.links.has("People")).toBe(false);
    expect(m.links.has("Call queues")).toBe(false);
    expect(m.links.has("Auto receptionists")).toBe(false);
    expect(m.links.has("Overview")).toBe(true);
  });
  it("requires a selected workspace and schema capability before exposing facility links", () => {
    renderShell({ ...props(), selectedTenantId: null });
    expect(m.links.has("Extensions")).toBe(false);
    expect(m.links.has("Auto receptionists")).toBe(false);
    m.links.clear();
    renderShell({ ...props(), capabilities: undefined });
    expect(m.links.has("People")).toBe(true);
    expect(m.links.has("Call queues")).toBe(false);
    expect(m.links.has("Phone numbers")).toBe(false);
    expect(m.links.has("Auto receptionists")).toBe(false);
  });
  it("hides legacy implicit-tenant routes for multi-workspace accounts", () => {
    renderShell({ ...props(), canUseImplicitTenant: false });
    for (const label of [
      "Call queues",
      "Business hours",
      "Ring groups",
      "Call analytics",
    ])
      expect(m.links.has(label)).toBe(false);
    expect(m.links.has("People")).toBe(true);
    expect(m.links.has("Phone numbers")).toBe(true);
  });
  it("exposes the explicit-workspace IVR route for authorized multi-workspace administrators", () => {
    const p = { ...props(), canUseImplicitTenant: false };
    renderShell(p);
    expect(m.links.has("Auto receptionists")).toBe(true);
    m.links.get("Auto receptionists").onPress();
    expect(p.onNavigate).toHaveBeenCalledWith("/admin/ivr");
  });
  it("requires IVR capability even when a multi-workspace administrator has selected a workspace", () => {
    const p = props();
    renderShell({
      ...p,
      canUseImplicitTenant: false,
      capabilities: { ...p.capabilities!, ivr: false },
    });
    expect(m.links.has("Auto receptionists")).toBe(false);
    expect(m.links.has("Phone numbers")).toBe(true);
  });
  it("offers the compact navigation control at mobile width", () => {
    m.width = 390;
    renderShell(props());
    expect(m.links.has("Open admin navigation")).toBe(true);
    expect(m.links.has("Call queues")).toBe(false);
  });
  it("matches static markup on the first desktop render, then adopts desktop navigation after mount", () => {
    const p = { ...props(), canManage: false, selectedTenantId: null };
    m.width = 0;
    const exported = renderShell(p, false);
    resetFrame();
    m.width = 1400;
    expect(renderShell(p, false)).toBe(exported);
    expect(m.links.has("Open admin navigation")).toBe(true);
    expect(m.links.has("My account")).toBe(false);
    renderShell(p);
    expect(m.links.has("Open admin navigation")).toBe(false);
    expect(m.links.has("My account")).toBe(true);
    expect(m.links.has("People")).toBe(false);
  });
  it("retains compact navigation, selected links and menu dismissal after a mounted resize", () => {
    const p = props();
    renderShell(p);
    m.width = 390;
    renderShell(p);
    expect(
      m.links.get("Open admin navigation").accessibilityState.expanded,
    ).toBe(false);
    m.links.get("Open admin navigation").onPress();
    expect(renderShell(p)).toContain('aria-expanded="true"');
    expect(m.links.has("Close admin navigation")).toBe(true);
    expect(m.links.get("People").accessibilityState.selected).toBe(true);
    m.links.get("People").onPress();
    expect(p.onNavigate).toHaveBeenCalledWith("/admin/users");
    renderShell(p);
    expect(m.links.has("Open admin navigation")).toBe(true);
    expect(m.links.has("People")).toBe(false);
  });
});
