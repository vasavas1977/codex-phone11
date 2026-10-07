/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  presses: new Map<string, any>(),
  fetching: false,
  requests: [] as number[],
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = m.index++;
      if (!(index in m.values)) m.values[index] = initial;
      return [m.values[index], (value: any) => {
        m.values[index] = typeof value === "function" ? value(m.values[index]) : value;
      }];
    },
  };
});
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Alert: { alert: vi.fn() },
  FlatList: ({ data, renderItem }: any) => element({ children: data.map((item: any) => createElement("div", { key: item.id }, renderItem({ item }))) }),
  Modal: ({ visible, children }: any) => visible ? element({ children }) : null,
  Platform: { OS: "web" },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: element,
  TextInput: () => null,
  TouchableOpacity: (props: any) => {
    if (props.accessibilityLabel) m.presses.set(props.accessibilityLabel, props);
    return createElement("button", { disabled: props.disabled }, props.children);
  },
  View: element,
  ScrollView: element,
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/admin/admin-workspace-boundary", () => ({ AdminWorkspaceBoundary: element }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: () => null }));
vi.mock("../components/profile/profile-card-provider", () => ({ ProfileCardProvider: element }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("expo-router", () => ({ router: { back: vi.fn() } }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7 } }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#06c", surface: "#fff", border: "#ddd" }) }));
vi.mock("../hooks/use-directory", () => ({ useDirectory: () => ({ people: [] }) }));
vi.mock("../hooks/use-pbx-admin", () => ({
  useTenant: () => ({ data: { id: 1, userRole: "admin" }, isSuccess: true }),
  useExtensions: (page: number, pageSize: number, enabled: boolean) => {
    m.requests.push(page);
    expect(pageSize).toBe(100);
    expect(enabled).toBe(true);
    const start = (page - 1) * pageSize;
    return {
      data: {
        data: Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({ id: start + i + 1, extension_number: String(1000 + start + i + 1) })),
        pagination: { page, total: 101, totalPages: 2, hasPrev: page > 1, hasNext: page < 2 },
      },
      isFetching: m.fetching,
    };
  },
  useTenantPeople: () => ({ data: [] }),
  useCreateExtension: () => ({ mutateAsync: vi.fn() }),
  useUpdateExtension: () => ({ mutateAsync: vi.fn() }),
}));
import AdminExtensions from "../app/admin/extensions";
function render() {
  m.index = 0;
  m.presses.clear();
  return renderToStaticMarkup(createElement(AdminExtensions));
}
function press(label: string) {
  const button = m.presses.get(label);
  expect(button).toBeDefined();
  expect(button.disabled).not.toBe(true);
  button.onPress();
}
beforeEach(() => {
  m.values = [];
  m.requests = [];
  m.fetching = false;
});
describe("extension inventory pagination", () => {
  it("reaches extension 101 and returns to the first page with truthful counts", () => {
    const first = render();
    expect(first).toContain("101 total");
    expect(m.presses.get("Previous extensions page").disabled).toBe(true);
    expect(m.presses.has("Assign person for extension 1101")).toBe(false);
    press("Next extensions page");
    const second = render();
    expect(m.requests).toEqual([1, 2]);
    expect(second).toContain("Page 2 of 2");
    expect(m.presses.has("Assign person for extension 1101")).toBe(true);
    expect(m.presses.get("Next extensions page").disabled).toBe(true);
    press("Previous extensions page");
    render();
    expect(m.requests).toEqual([1, 2, 1]);
  });
  it("disables page transitions while the inventory is refreshing", () => {
    m.fetching = true;
    render();
    expect(m.presses.get("Next extensions page").disabled).toBe(true);
    expect(m.presses.get("Previous extensions page").disabled).toBe(true);
  });
});
