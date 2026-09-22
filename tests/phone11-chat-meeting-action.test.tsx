import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  available: false,
  reason: undefined as string | undefined,
  isLoading: false,
  isFetching: false,
  error: null as unknown,
  push: vi.fn(),
  button: null as any,
}));
vi.mock("react-native", () => ({
  Pressable: (props: any) => {
    m.button = props;
    return createElement(
      "button",
      { "aria-label": props.accessibilityLabel, disabled: props.disabled },
      props.children,
    );
  },
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("expo-router", () => ({
  router: { push: (...args: any[]) => m.push(...args) },
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ primary: "#07c" }),
}));
vi.mock("../lib/trpc", () => ({
  trpc: {
    meetings: {
      capabilities: {
        useQuery: () => ({
          isLoading: m.isLoading,
          isFetching: m.isFetching,
          error: m.error,
          data:
            m.available || m.reason
              ? { available: m.available, reason: m.reason }
              : undefined,
        }),
      },
    },
  },
}));

import { ChatMeetingAction } from "../components/chat/meeting-action";

beforeEach(() => {
  m.available = false;
  m.reason = undefined;
  m.isLoading = false;
  m.isFetching = false;
  m.error = null;
  m.button = null;
  m.push.mockReset();
});

it("keeps a disabled camera in the header when admitted meetings are unavailable", () => {
  const html = renderToStaticMarkup(createElement(ChatMeetingAction));
  expect(html).toContain("Video meetings unavailable");
  expect(m.button).toMatchObject({
    disabled: true,
    accessibilityState: { disabled: true, busy: false },
  });
  expect(m.button.accessibilityHint).toContain("Phone calls remain available");
  m.button.onPress?.();
  expect(m.push).not.toHaveBeenCalled();
});

it("keeps the camera slot visible and busy while availability is loading", () => {
  m.isLoading = true;
  const html = renderToStaticMarkup(createElement(ChatMeetingAction));
  expect(html).toContain("Checking meeting availability");
  expect(m.button).toMatchObject({
    disabled: true,
    accessibilityState: { disabled: true, busy: true },
  });
  expect(m.button.accessibilityHint).toContain("admitted video meetings");
});

it("shows the server's fail-closed meeting explanation after an availability error", () => {
  m.reason = "Meeting service is awaiting isolated provider verification";
  m.error = new Error("offline");
  renderToStaticMarkup(createElement(ChatMeetingAction));
  expect(m.button).toMatchObject({
    accessibilityLabel: "Video meetings unavailable",
    disabled: true,
  });
  expect(m.button.accessibilityHint).toBe(m.reason);
});

it("does not navigate from a cached availability result when its refresh fails", () => {
  m.available = true;
  m.error = new Error("offline");
  renderToStaticMarkup(createElement(ChatMeetingAction));
  expect(m.button).toMatchObject({
    accessibilityLabel: "Video meetings unavailable",
    disabled: true,
  });
  m.button.onPress?.();
  expect(m.push).not.toHaveBeenCalled();
});

it("opens the existing pre-join route without presenting a direct-chat invite", () => {
  m.available = true;
  m.isFetching = true;
  renderToStaticMarkup(createElement(ChatMeetingAction));
  expect(m.button.accessibilityLabel).toBe("Meet");
  expect(m.button.disabled).toBe(false);
  expect(m.button.accessibilityHint).toContain(
    "does not call or invite this person",
  );
  m.button.onPress();
  expect(m.push).toHaveBeenCalledWith("/conference");
});
