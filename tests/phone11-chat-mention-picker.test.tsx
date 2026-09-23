import { expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
vi.mock("react-native", () => ({ View: ({ children }: any) => createElement("div", null, children), Text: ({ children }: any) => createElement("span", null, children), ActivityIndicator: () => createElement("span", null, "loading"), Pressable: ({ children }: any) => createElement("button", null, children), ScrollView: ({ children }: any) => createElement("div", null, children) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ border: "#eee", surface: "#fff", foreground: "#111", muted: "#777", primary: "#06c" }) }));
vi.mock("../components/chat/presence-indicator", () => ({ PresenceIndicator: ({ userId }: any) => createElement("span", null, `presence-${userId}`) }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: (props: any) => createElement("span", { "data-user-id": props.userId, "data-tenant-id": props.tenantId, "data-photo-url": props.photoUrl ?? "", "data-initials": props.name.trim().split(/\s+/u).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase() }) }));
import { MentionPicker } from "../components/chat/mention-picker";
it("renders every current member in the scrollable picker, beyond the old twelve-item cutoff", () => {
  const people = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, name: `Member ${index + 1}`, extension: null }));
  const html = renderToStaticMarkup(createElement(MentionPicker, { people, query: "", onPick: () => {} }));
  expect(html).toContain("Member 13");
  expect(html).toContain("M1");
  expect(html).toContain("Mention a member");
});
it("shows Thai name matches from the composer query", () => {
  const people = [{ id: 1, name: "Nathasa", extension: "1001" }, { id: 2, name: "มนตรี ใจดี", extension: "1002" }];
  const html = renderToStaticMarkup(createElement(MentionPicker, { people, query: "มนตรี", tenantId: 10, onPick: () => {} }));
  expect(html).toContain("มนตรี ใจดี");
  expect(html).toContain("มใ");
  expect(html).toContain("presence-2");
  expect(html).not.toContain("Nathasa");
  expect(html).not.toContain("@all");
});
it("uses only the directory photo descriptor for the exact person and tenant", () => {
  const photoUrl = "/api/profile/photo/10/2?v=11111111-1111-4111-8111-111111111111";
  const html = renderToStaticMarkup(createElement(MentionPicker, { people: [{ id: 2, name: "Alice", extension: null, photoUrl }], query: "", tenantId: 10, onPick: () => {} }));
  expect(html).toContain('data-user-id="2"');
  expect(html).toContain('data-tenant-id="10"');
  expect(html).toContain(`data-photo-url="${photoUrl}"`);
});
it("shows @all only when the server grants the capability and the query matches", () => {
  const allowed = renderToStaticMarkup(createElement(MentionPicker, { people: [], query: "al", canMentionAll: true, onPick: () => {}, onPickAll: () => {} }));
  const denied = renderToStaticMarkup(createElement(MentionPicker, { people: [], query: "al", canMentionAll: false, onPick: () => {} }));
  expect(allowed).toContain("@all");
  expect(allowed).toContain("Notify all current members");
  expect(denied).not.toContain("@all");
});
