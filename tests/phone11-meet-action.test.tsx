import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server");
const state = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  result: {} as any,
  alert: vi.fn(),
  push: vi.fn(),
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
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
import { MeetAction } from "../components/meet-action";

beforeEach(() => vi.clearAllMocks());

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

it("shows an accessible 44pt Meet icon and opens the meeting flow only when available", () => {
  state.user = { id: 1 };
  state.result = { data: { available: true } };
  const props = pressableProps();
  expect(props.accessibilityLabel).toBe("Meet");
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

it("explains unavailable meetings without opening a false pre-join flow", () => {
  state.result = { data: { available: false, reason: "Meetings are not enabled for this workspace." } };
  const props = pressableProps();
  expect(props.accessibilityLabel).toBe("Video meetings unavailable");
  props.onPress();
  expect(state.alert).toHaveBeenCalledWith("Video meetings unavailable", "Meetings are not enabled for this workspace.");
  expect(state.push).not.toHaveBeenCalled();
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
