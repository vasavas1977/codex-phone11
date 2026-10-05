import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRequire } from "node:module";
import { MeetAction } from "../components/meet-action";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server");
const state = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  currentUser: null as { id: number } | null,
  authLoading: false,
  chat: { userId: 1, workspace: { id: 7 } } as { userId: number | null; workspace: { id: number } | null },
  result: {} as any,
  alert: vi.fn(),
  push: vi.fn(),
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: state.currentUser, loading: state.authLoading }) }));
vi.mock("../lib/chat/store", () => ({
  useChatStore: Object.assign((select: any) => select(state.chat), { getState: () => state.chat }),
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", muted: "gray" }) }));
vi.mock("../lib/trpc", () => ({
  trpc: { meetings: { capabilities: { useQuery: () => state.result } } },
}));
vi.mock("expo-router", () => ({ router: { push: state.push } }));
vi.mock("react-native", () => ({
  Alert: { alert: state.alert },
  Pressable: ({ children, accessibilityLabel }: any) => createElement("button", { "aria-label": accessibilityLabel }, children),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: ({ name }: any) => createElement("span", { "data-icon": name }) }));

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 1 };
  state.currentUser = state.user;
  state.authLoading = false;
  state.chat = { userId: 1, workspace: { id: 7 } };
  state.result = { data: { available: true }, refetch: vi.fn() };
});

function pressableProps() {
  return (MeetAction() as any).props as {
    accessibilityLabel: string;
    accessibilityHint: string;
    accessibilityState?: { busy?: boolean };
    onPress: () => void;
    style: { minWidth: number; minHeight: number };
  };
}

it("keeps signed-out meeting entry hidden", () => {
  state.user = null;
  state.result = { data: { available: true } };
  expect(MeetAction()).toBeNull();
});

it("shows an accessible 44pt Meet icon and opens the generic meeting flow for admitted rooms", () => {
  const props = pressableProps();
  expect(props.accessibilityLabel).toBe("Meet");
  expect(props.accessibilityHint).toContain("meeting setup");
  expect(props.style).toMatchObject({ minWidth: 44, minHeight: 44 });
  expect(renderToStaticMarkup(MeetAction())).toContain('data-icon="video.fill"');
  props.onPress();
  expect(state.push).toHaveBeenCalledWith("/conference");
});

it("keeps a visible, actionable entry while availability is loading", () => {
  state.result = { isLoading: true, isFetching: true, refetch: vi.fn() };
  const props = pressableProps();
  expect(props.accessibilityLabel).toBe("Checking meeting availability");
  expect(props.accessibilityState?.busy).toBe(true);
  props.onPress();
  expect(state.alert).toHaveBeenCalledWith(
    "Checking meeting availability",
    expect.any(String),
    expect.arrayContaining([expect.objectContaining({ text: "Check again" })]),
  );
});

it("does not open pre-join from stale availability while a refresh is running", () => {
  state.result = { data: { available: true }, isFetching: true, refetch: vi.fn() };
  const props = pressableProps();
  expect(props.accessibilityLabel).toBe("Checking meeting availability");
  props.onPress();
  expect(state.push).not.toHaveBeenCalled();
});

it.each([
  "Meetings are not enabled for this workspace.",
  "There are no admitted meetings for this account.",
])("offers explicit setup with the unavailable explanation: %s", reason => {
  state.result = { data: { available: false, reason } };
  const props = pressableProps();
  expect(props.accessibilityLabel).toBe("Open meeting setup");
  expect(props.accessibilityHint).toContain("Joining and hosting are checked separately");
  expect(props.accessibilityState?.busy).toBe(false);
  props.onPress();
  expect(state.alert).toHaveBeenCalledWith("Video meetings unavailable", reason, expect.any(Array));
  expect(state.push).not.toHaveBeenCalled();
  alertAction("Open meeting setup")();
  expect(state.push).toHaveBeenCalledOnce();
  expect(state.push).toHaveBeenCalledWith("/conference");
});

it("offers a capability retry after a failed availability check", () => {
  const refetch = vi.fn();
  state.result = { error: new Error("network"), refetch };
  const props = pressableProps();
  expect(props.accessibilityLabel).toBe("Retry meeting availability");
  props.onPress();
  const actions = state.alert.mock.lastCall?.[2];
  expect(state.alert).toHaveBeenCalledWith("Could not check meeting availability", expect.any(String), expect.any(Array));
  actions.find((action: { text: string }) => action.text === "Try again").onPress();
  expect(refetch).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});

function alertAction(text: string): () => void {
  const actions = state.alert.mock.lastCall?.[2];
  return actions.find((action: { text: string }) => action.text === text).onPress;
}

it.each(["loading", "error"])("allows explicit setup during %s without claiming joining is ready", status => {
  state.result = status === "loading"
    ? { data: { available: true }, isFetching: true, refetch: vi.fn() }
    : { data: { available: true }, error: new Error("offline"), refetch: vi.fn() };
  const props = pressableProps();
  expect(props.accessibilityLabel).not.toBe("Meet");
  props.onPress();
  expect(state.push).not.toHaveBeenCalled();
  alertAction("Open meeting setup")();
  expect(state.push).toHaveBeenCalledOnce();
  expect(state.push).toHaveBeenCalledWith("/conference");
  expect(state.result.refetch).not.toHaveBeenCalled();
});

it("retries the loading check while its original context remains current", () => {
  state.result = { isLoading: true, refetch: vi.fn() };
  pressableProps().onPress();
  alertAction("Check again")();
  expect(state.result.refetch).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});

const replacements = [
  ["logout", () => { state.currentUser = null; }],
  ["same-account sign-in", () => { state.currentUser = { id: 1 }; }],
  ["another account", () => { state.currentUser = { id: 2 }; }],
  ["auth check", () => { state.authLoading = true; }],
  ["another workspace", () => { state.chat.workspace = { id: 8 }; }],
  ["same-ID workspace replacement", () => { state.chat.workspace = { id: 7 }; }],
  ["workspace removed", () => { state.chat.workspace = null; }],
  ["chat owner replacement", () => { state.chat.userId = 2; }],
] as const;

describe.each(replacements)("retained actions after %s", (_name, replace) => {
  it.each(["available", "unavailable", "loading", "error"])("drops the old %s entry tap before opening a route or alert", status => {
    state.result = { data: { available: status === "available" }, isLoading: status === "loading",
      error: status === "error" ? new Error("offline") : undefined, refetch: vi.fn() };
    const oldPress = pressableProps().onPress;
    replace();
    oldPress();
    expect(state.alert).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
    expect(state.result.refetch).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "loading", "error"])("drops the %s alert's retained setup action", status => {
    state.result = { data: { available: false }, isLoading: status === "loading",
      error: status === "error" ? new Error("offline") : undefined, refetch: vi.fn() };
    pressableProps().onPress();
    const oldSetup = alertAction("Open meeting setup");
    replace();
    oldSetup();
    expect(state.push).not.toHaveBeenCalled();
    expect(state.result.refetch).not.toHaveBeenCalled();
  });

  it.each(["loading", "error"])("drops the %s alert's retained retry", status => {
    state.result = { isLoading: status === "loading", error: status === "error" ? new Error("offline") : undefined, refetch: vi.fn() };
    pressableProps().onPress();
    const oldRetry = alertAction(status === "loading" ? "Check again" : "Try again");
    replace();
    oldRetry();
    expect(state.push).not.toHaveBeenCalled();
    expect(state.result.refetch).not.toHaveBeenCalled();
  });
});
