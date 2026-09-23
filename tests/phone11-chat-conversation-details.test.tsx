import { expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
vi.mock("react-native", () => ({
  ActivityIndicator: ({ children }: any) => createElement("div", null, children),
  Linking: { openURL: vi.fn() },
  Modal: ({ children }: any) => createElement("div", null, children),
  Pressable: ({ children }: any) => createElement("button", null, children),
  ScrollView: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  View: ({ children }: any) => createElement("div", null, children),
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "black", muted: "gray", border: "silver", background: "white", error: "red" }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock("../components/chat/message-content", () => ({ ChatAttachmentCard: () => null }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: (props: any) => createElement("span", { "data-user-id": props.userId, "data-tenant-id": props.tenantId, "data-photo-url": props.photoUrl ?? "" }) }));
import { ConversationDetails } from "../components/chat/conversation-details";

it("shows conversation member photos from scoped server descriptors", () => {
  const photoUrl = "/api/profile/photo/10/2?v=11111111-1111-4111-8111-111111111111";
  const html = renderToStaticMarkup(createElement(ConversationDetails, {
    visible: true, loading: false, tenantId: 10, error: null, onRetry: vi.fn(), onClose: vi.fn(),
    details: { members: [{ id: 2, name: "Alice", extension: "3002", photoUrl }], media: [], links: [] },
  }));
  expect(html).toContain("Alice");
  expect(html).toContain('data-user-id="2"');
  expect(html).toContain('data-tenant-id="10"');
  expect(html).toContain(`data-photo-url="${photoUrl}"`);
});
