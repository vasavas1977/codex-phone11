import { expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const buttons = new Map<string, any>();
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({
  ActivityIndicator: element, Modal: element, View: element, Text: element, ScrollView: element,
  Pressable: (props: any) => { buttons.set(props.accessibilityLabel, props); return element(props); },
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "black", muted: "gray", border: "silver", background: "white", error: "red" }) }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: (props: any) => createElement("span", { "data-user-id": props.userId, "data-tenant-id": props.tenantId, "data-photo-url": props.photoUrl ?? "" }) }));
import { ReadReceiptSheet } from "../components/chat/read-receipt-sheet";

it("renders named readers with times and an accessible close action", () => {
  const onClose = vi.fn();
  const photoUrl = "/api/profile/photo/10/2?v=11111111-1111-4111-8111-111111111111";
  const html = renderToStaticMarkup(createElement(ReadReceiptSheet, { visible: true, loading: false, error: null,
    tenantId: 10, rows: [{ userId: 2, name: "Nathasa", photoUrl, readAt: Date.now() }], onClose }));
  expect(html).toContain("Read by"); expect(html).toContain("Nathasa"); expect(html).toContain("Read ");
  expect(html).toContain('data-user-id="2"');
  expect(html).toContain('data-tenant-id="10"');
  expect(html).toContain(`data-photo-url="${photoUrl}"`);
  buttons.get("Close read receipts").onPress(); expect(onClose).toHaveBeenCalledOnce();
});

it("uses a non-authoritative empty message instead of claiming members are unread", () => {
  const html = renderToStaticMarkup(createElement(ReadReceiptSheet, { visible: true, loading: false, error: null, rows: [], onClose: vi.fn() }));
  expect(html).toContain("No read receipts yet"); expect(html).not.toContain("Unread");
});
