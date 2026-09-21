import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  available: false,
  push: vi.fn(),
  button: null as any,
}));
vi.mock("react-native", () => ({
  Pressable: (props: any) => {
    m.button = props;
    return createElement("button", { "aria-label": props.accessibilityLabel }, props.children);
  },
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("expo-router", () => ({ router: { push: (...args: any[]) => m.push(...args) } }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#07c" }) }));
vi.mock("../lib/trpc", () => ({ trpc: { meetings: {
  capabilities: { useQuery: () => ({ isLoading: false, isFetching: false, error: null, data: { available: m.available } }) },
} } }));

import { ChatMeetingAction } from "../components/chat/meeting-action";

beforeEach(() => { m.available = false; m.button = null; m.push.mockReset(); });

it("hides the video action when admitted meetings are unavailable", () => {
  expect(renderToStaticMarkup(createElement(ChatMeetingAction))).toBe("");
  expect(m.button).toBeNull();
});

it("opens the existing pre-join route without presenting a direct-chat invite", () => {
  m.available = true;
  renderToStaticMarkup(createElement(ChatMeetingAction));
  expect(m.button.accessibilityLabel).toBe("Meet");
  expect(m.button.accessibilityHint).toContain("does not call or invite this person");
  m.button.onPress();
  expect(m.push).toHaveBeenCalledWith("/conference");
});
