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
const m = vi.hoisted(() => ({ links: new Map<string, any>(), width: 1400 }));
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
    return createElement("button", { disabled: p.disabled }, p.children);
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
beforeEach(() => {
  m.links.clear();
  m.width = 1400;
});
describe("admin navigation boundaries", () => {
  it("exposes matching authorized destinations and preserves selected state", () => {
    const p = props();
    renderToStaticMarkup(createElement(AdminShell, p));
    expect(m.links.get("People").accessibilityState.selected).toBe(true);
    m.links.get("Call queues").onPress();
    expect(p.onNavigate).toHaveBeenCalledWith("/admin/queues");
  });
  it("keeps management destinations hidden without verified admin membership", () => {
    renderToStaticMarkup(
      createElement(AdminShell, { ...props(), canManage: false }),
    );
    expect(m.links.has("People")).toBe(false);
    expect(m.links.has("Call queues")).toBe(false);
    expect(m.links.has("Auto receptionists")).toBe(false);
    expect(m.links.has("Overview")).toBe(true);
  });
  it("requires a selected workspace and schema capability before exposing facility links", () => {
    renderToStaticMarkup(
      createElement(AdminShell, { ...props(), selectedTenantId: null }),
    );
    expect(m.links.has("Extensions")).toBe(false);
    expect(m.links.has("Auto receptionists")).toBe(false);
    m.links.clear();
    renderToStaticMarkup(
      createElement(AdminShell, { ...props(), capabilities: undefined }),
    );
    expect(m.links.has("People")).toBe(true);
    expect(m.links.has("Call queues")).toBe(false);
    expect(m.links.has("Phone numbers")).toBe(false);
    expect(m.links.has("Auto receptionists")).toBe(false);
  });
  it("hides legacy implicit-tenant routes for multi-workspace accounts", () => {
    renderToStaticMarkup(
      createElement(AdminShell, { ...props(), canUseImplicitTenant: false }),
    );
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
    renderToStaticMarkup(createElement(AdminShell, p));
    expect(m.links.has("Auto receptionists")).toBe(true);
    m.links.get("Auto receptionists").onPress();
    expect(p.onNavigate).toHaveBeenCalledWith("/admin/ivr");
  });
  it("requires IVR capability even when a multi-workspace administrator has selected a workspace", () => {
    const p = props();
    renderToStaticMarkup(
      createElement(AdminShell, {
        ...p,
        canUseImplicitTenant: false,
        capabilities: { ...p.capabilities!, ivr: false },
      }),
    );
    expect(m.links.has("Auto receptionists")).toBe(false);
    expect(m.links.has("Phone numbers")).toBe(true);
  });
  it("offers the compact navigation control at mobile width", () => {
    m.width = 390;
    renderToStaticMarkup(createElement(AdminShell, props()));
    expect(m.links.has("Open admin navigation")).toBe(true);
    expect(m.links.has("Call queues")).toBe(false);
  });
});
