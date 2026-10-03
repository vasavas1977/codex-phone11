import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };

const m = vi.hoisted(() => ({ mentionTexts: [] as string[] }));

vi.mock("react-native", () => ({
  Text: ({ children, style }: any) => {
    if (style?.fontWeight === "700") m.mentionTexts.push(String(children));
    return createElement("span", null, children);
  },
  View: ({ children }: any) => createElement("div", null, children),
  Pressable: ({ children }: any) => createElement("button", null, children),
  ActivityIndicator: () => null,
  Image: () => null,
  Linking: { openURL: vi.fn() },
  Modal: ({ children }: any) => createElement("div", null, children),
  ScrollView: ({ children }: any) => createElement("div", null, children),
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ primary: "#0057FF", foreground: "#101010", muted: "#777777", border: "#eeeeee", surface: "#ffffff" }),
}));
vi.mock("../lib/chat/media-client", () => ({ getChatMediaSource: vi.fn(), shareChatFile: vi.fn() }));
vi.mock("../components/chat/received-media", () => ({ ReceivedMedia: () => null }));

import { LinkedChatText, mentionSegments } from "../components/chat/message-content";

beforeEach(() => {
  m.mentionTexts = [];
});

it("uses structured ranges for mixed Thai and English mentions without styling plain @words", () => {
  const text = "Please ask @Nathasa and @มณี before @all joins.";
  const nathasa = "@Nathasa";
  const thaiName = "@มณี";
  const all = "@all";
  const allMention = { start: text.indexOf(all), length: 4 as const };
  const mentions = [
    { userId: 4, name: "Nathasa", start: text.indexOf(nathasa), length: nathasa.length },
    { userId: 7, name: "มณี", start: text.indexOf(thaiName), length: thaiName.length },
  ];

  const segments = mentionSegments(text, [
    ...mentions,
    allMention,
  ]);
  expect(segments.filter((segment) => segment.mention).map((segment) => segment.text)).toEqual([
    nathasa,
    thaiName,
    all,
  ]);

  renderToStaticMarkup(createElement(LinkedChatText, {
    text,
    mentions,
    allMention,
  }));
  expect(m.mentionTexts).toEqual([nathasa, thaiName, all]);

  renderToStaticMarkup(createElement(LinkedChatText, { text: "Plain @Nathasa is not a structured mention." }));
  expect(m.mentionTexts).toEqual([nathasa, thaiName, all]);
});

it("ignores malformed and overlapping server ranges instead of styling unintended text", () => {
  const text = "Hello @Nathasa";
  expect(mentionSegments(text, [
    { userId: 4, name: "Nathasa", start: 6, length: 8 },
    { userId: 8, name: "bad", start: 8, length: 3 },
    { userId: 9, name: "outside", start: 30, length: 4 },
  ])).toEqual([
    { text: "Hello " },
    { text: "@Nathasa", mention: true },
  ]);
});
