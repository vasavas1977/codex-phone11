import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };

const m = vi.hoisted(() => ({ buttons: new Map<string, any>(), textStyles: [] as any[] }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children, style }: any) => {
    m.textStyles.push(style);
    return createElement("span", null, children);
  },
  Pressable: (props: any) => {
    m.buttons.set(props.accessibilityLabel, props);
    return createElement("button", null, props.children);
  },
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ error: "#FF453A" }),
}));

import { NewMessagesJump, UnreadMessageDivider } from "../components/chat/unread-message-indicator";

beforeEach(() => {
  m.buttons.clear();
  m.textStyles = [];
});

it("renders an accessible red divider only when the caller supplies a trusted boundary", () => {
  const html = renderToStaticMarkup(createElement(UnreadMessageDivider, { kind: "replies" }));
  expect(html).toContain("New replies");
  expect(m.textStyles).toContainEqual({ color: "#FF453A", fontSize: 12, fontWeight: "700" });
  expect(m.buttons.size).toBe(0);
});

it("offers a red local-arrival jump alert without displaying an invented unread count", () => {
  const onPress = vi.fn();
  const html = renderToStaticMarkup(createElement(NewMessagesJump, { onPress }));
  expect(html).toContain("New messages ↓");
  const button = m.buttons.get("Jump to new messages");
  expect(button.accessibilityHint).toContain("arrived while you were reading");
  button.onPress();
  expect(onPress).toHaveBeenCalledOnce();
});
