import { expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
vi.mock("react-native", () => ({ View: ({ children }: any) => createElement("div", null, children), Text: ({ children }: any) => createElement("span", null, children), ActivityIndicator: () => createElement("span", null, "loading"), Pressable: ({ children }: any) => createElement("button", null, children), ScrollView: ({ children }: any) => createElement("div", null, children) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ border: "#eee", surface: "#fff", foreground: "#111", muted: "#777" }) }));
import { MentionPicker } from "../components/chat/mention-picker";
it("renders every current member in the scrollable picker, beyond the old twelve-item cutoff", () => {
  const people = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, name: `Member ${index + 1}`, extension: null }));
  const html = renderToStaticMarkup(createElement(MentionPicker, { people, query: "", onPick: () => {} }));
  expect(html).toContain("Member 13");
  expect(html).toContain("Mention a member");
});
it("shows Thai name matches from the composer query", () => {
  const people = [{ id: 1, name: "Nathasa", extension: "1001" }, { id: 2, name: "มนตรี ใจดี", extension: "1002" }];
  const html = renderToStaticMarkup(createElement(MentionPicker, { people, query: "มนตรี", onPick: () => {} }));
  expect(html).toContain("มนตรี ใจดี");
  expect(html).not.toContain("Nathasa");
  expect(html).not.toContain("@all");
});
