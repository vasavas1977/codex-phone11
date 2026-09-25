import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  user: { id: 7 }, role: "admin", states: [] as unknown[], refs: [] as Array<{ current: unknown }>,
  stateIndex: 0, refIndex: 0, buttons: [] as any[], switches: [] as any[],
  overviewInput: null as any, overviewOptions: null as any,
  channelGrant: vi.fn(async () => ({})), directGrant: vi.fn(async () => ({})),
  refetch: vi.fn(async () => ({})),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: unknown) => {
      const index = m.stateIndex++;
      if (index >= m.states.length) m.states[index] = typeof initial === "function" ? initial() : initial;
      return [m.states[index], (value: any) => {
        m.states[index] = typeof value === "function" ? value(m.states[index]) : value;
      }];
    },
    useRef: (initial: unknown) => {
      const index = m.refIndex++;
      if (!m.refs[index]) m.refs[index] = { current: initial };
      return m.refs[index];
    },
  };
});
vi.mock("react-native", () => ({
  ActivityIndicator: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  Pressable: (props: any) => {
    m.buttons.push(props);
    return createElement("button", { disabled: props.disabled }, props.children);
  },
  Switch: (props: any) => { m.switches.push(props); return createElement("input", { type: "checkbox", checked: props.value, readOnly: true }); },
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: ({ children }: { children?: ReactNode }) => createElement("div", null, children) }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../constants/oauth", () => ({ portalSignInRoute: () => "/auth/sign-in" }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "black", muted: "gray", surface: "white", border: "gray", error: "red" }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.user }) }));
vi.mock("expo-router", () => ({ router: { canGoBack: () => false, replace: vi.fn(), back: vi.fn() } }));
vi.mock("../lib/trpc", () => ({ trpc: {
  pbx: { tenant: { get: { useQuery: () => ({ data: { id: 41, name: "Workspace", userRole: m.role }, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }) } } },
  meetings: {
    adminOverview: { useQuery: (input: any, options: any) => {
      m.overviewInput = input;
      m.overviewOptions = options;
      return { data: { available: true,
        channels: [{ id: "channel-1", name: "Team", kind: "channel", members: [{ userId: 8, name: "Colleague", canStartMeeting: false }] }],
        directConversations: [{ id: "direct-1", name: "Direct", kind: "direct", members: [{ userId: 7, name: "Admin", canStartMeeting: false }, { userId: 8, name: "Colleague", canStartMeeting: false }] }],
        channelNextCursor: "channel-2", directNextCursor: "direct-2",
      }, isLoading: false, isFetching: false, error: null, refetch: m.refetch };
    } },
    adminSetHostPermission: { useMutation: () => ({ mutateAsync: m.channelGrant }) },
    adminSetDirectHostPermission: { useMutation: () => ({ mutateAsync: m.directGrant }) },
  },
} }));
import AdminMeetings from "../app/admin/meetings";

function render() {
  m.stateIndex = 0;
  m.refIndex = 0;
  m.buttons = [];
  m.switches = [];
  return renderToStaticMarkup(createElement(AdminMeetings));
}
const button = (label: string) => m.buttons.find(item => item.accessibilityLabel === label);
beforeEach(() => {
  m.role = "admin";
  m.states = [];
  m.refs = [];
  m.channelGrant.mockClear();
  m.directGrant.mockClear();
  m.refetch.mockClear();
});

it("keeps grants unavailable to a non-admin and disables the overview query", () => {
  m.role = "member";
  expect(render()).toContain("Administrator access required");
  expect(m.overviewOptions.enabled).toBe(false);
  expect(m.switches).toHaveLength(0);
});

it("pages channels and direct chats independently and sends kind-specific grant inputs", async () => {
  expect(render()).toContain("Meeting hosting");
  expect(m.overviewOptions.enabled).toBe(true);
  await m.switches[0].onValueChange(true);
  await vi.waitFor(() => expect(m.refs[0].current).toBe(false));
  expect(m.channelGrant).toHaveBeenCalledWith({ tenantId: 41, channelId: "channel-1", userId: 8, canStartMeeting: true });
  expect(m.refetch).toHaveBeenCalledOnce();

  button("Next channels and groups").onPress();
  render();
  expect(m.overviewInput.channelCursor).toBe("channel-2");
  expect(m.overviewInput.directCursor).toBeUndefined();
  button("Direct chats").onPress();
  render();
  expect(m.switches).toHaveLength(2);
  await m.switches[1].onValueChange(true);
  await vi.waitFor(() => expect(m.refs[0].current).toBe(false));
  expect(m.directGrant).toHaveBeenCalledWith({ tenantId: 41, conversationId: "direct-1", userId: 8, canStartMeeting: true });
  button("Next direct chats").onPress();
  render();
  expect(m.overviewInput).toMatchObject({ channelCursor: "channel-2", directCursor: "direct-2" });
  button("Previous direct chats").onPress();
  render();
  expect(m.overviewInput).toMatchObject({ channelCursor: "channel-2", directCursor: undefined });
});
