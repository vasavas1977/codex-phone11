import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({ buttons: new Map<string, any>() }));
function element({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  View: element,
  Text: element,
  Pressable: (props: any) => {
    m.buttons.set(props.accessibilityLabel, props);
    return element(props);
  },
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "#0057ff",
    foreground: "#111111",
    muted: "#777777",
    border: "#eeeeee",
    surface: "#ffffff",
    error: "#ff0000",
  }),
}));
vi.mock("../components/chat/link-preview", () => ({
  ChatLinkPreview: () => null,
}));
vi.mock("../components/chat/message-content", () => ({
  LinkedChatText: ({ text }: any) => createElement("span", null, text),
  ChatAttachmentCard: () => createElement("span", null, "attachment"),
}));
import { ChatMessageRow } from "../components/chat/message-row";
import type { ChatMessage } from "../lib/chat/types";
const base: ChatMessage = {
  id: "msg",
  clientId: "client",
  channelId: "room",
  senderId: 1,
  senderName: "Nathasa",
  content: "Hello",
  timestamp: 1,
  sequence: 1,
  status: "sent",
  parent: null,
};
beforeEach(() => m.buttons.clear());
function render(message: ChatMessage) {
  const actions = {
    onActions: vi.fn(),
    onReplies: vi.fn(),
    onReaction: vi.fn(),
    onRetry: vi.fn(),
  };
  const html = renderToStaticMarkup(
    createElement(ChatMessageRow, {
      message,
      own: true,
      grouped: false,
      root: false,
      ...actions,
    }),
  );
  return { html, ...actions };
}
it("shows a compact accessible receipt control only when a positive label is supplied", () => {
  const onReadReceipts = vi.fn();
  const html = renderToStaticMarkup(createElement(ChatMessageRow, {
    message: base, own: true, grouped: false, root: false, receiptLabel: "Read by 3",
    onReadReceipts, onActions: vi.fn(), onReplies: vi.fn(), onReaction: vi.fn(), onRetry: vi.fn(),
  }));
  expect(html).toContain("Read by 3");
  m.buttons.get("Read by 3. View read receipts").onPress();
  expect(onReadReceipts).toHaveBeenCalledOnce();
  expect(render(base).html).not.toContain("View read receipts");
});
it("keeps replies reachable after the parent is deleted without exposing deleted text or media", () => {
  const { html, onReplies } = render({
    ...base,
    deletedAt: 2,
    replyCount: 5,
    attachments: [
      {
        id: "a",
        conversationId: "room",
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 2,
        status: "attached",
      },
    ],
  });
  expect(html).toContain("Message deleted");
  expect(html).not.toContain("Hello");
  expect(html).not.toContain("attachment");
  m.buttons.get("5 replies").onPress();
  expect(onReplies).toHaveBeenCalledOnce();
  expect(m.buttons.has("Add reaction")).toBe(false);
});
it("toggling an existing reaction explicitly requests removal and exposes the reactor count", () => {
  const { onReaction } = render({
    ...base,
    reactions: [
      { emoji: "👍", count: 5, reacted: true, users: [{ id: 1, name: "You" }] },
    ],
  });
  const button = m.buttons.get("👍, 5 reactions, selected");
  expect(button.accessibilityState.selected).toBe(true);
  button.onPress();
  expect(onReaction).toHaveBeenCalledWith("👍", false);
});
it("failed messages offer retry without exposing sent-message mutations", () => {
  const { onRetry, html } = render({ ...base, status: "failed" });
  expect(html).toContain("Not sent");
  expect(m.buttons.has("Add reaction")).toBe(false);
  m.buttons.get("Retry sending message").onPress();
  expect(onRetry).toHaveBeenCalledOnce();
});
