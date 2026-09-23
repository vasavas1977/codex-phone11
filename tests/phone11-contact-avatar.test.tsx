import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const avatar = vi.hoisted(() => ({ props: null as any }));
vi.mock("react-native", () => ({ StyleSheet: { create: (value: unknown) => value } }));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({ useColors: vi.fn() }));
vi.mock("../hooks/use-directory", () => ({ useDirectory: vi.fn(), useDirectoryFocusRefresh: vi.fn(), openDirectConversation: vi.fn() }));
vi.mock("../hooks/use-phone-call", () => ({ usePhoneCall: vi.fn() }));
vi.mock("../hooks/use-auth", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: vi.fn() }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: vi.fn() }));
vi.mock("../components/chat/presence-indicator", () => ({ PresenceIndicator: () => null }));
vi.mock("../lib/chat/presence-store", () => ({ usePresencePolling: vi.fn() }));
vi.mock("../lib/profile/use-workspace-profile", () => ({ useWorkspaceProfile: vi.fn() }));
vi.mock("../components/profile/profile-avatar", () => ({
  useProfilePhotoCacheScope: vi.fn(),
  ProfileAvatar: (props: any) => {
    avatar.props = props;
    return createElement("div");
  },
}));

import { ContactAvatar } from "../components/contact-details";

const current = { id: 7, name: "Current user", extension: null, photoUrl: "/api/profile/photo/20/7?v=old" };
const saved = { userId: 7, photoUrl: "/api/profile/photo/20/7?v=new", photoVersion: "new" };

beforeEach(() => { avatar.props = null; });

it("uses the current user's confirmed photo over a stale directory entry", () => {
  renderToStaticMarkup(createElement(ContactAvatar, {
    person: current, ownPhoto: saved, ownerId: 7, tenantId: 20, size: 44,
  }));
  expect(avatar.props).toMatchObject({
    photoUrl: saved.photoUrl, photoVersion: saved.photoVersion,
    tenantId: 20, userId: 7, size: 44,
  });
});

it("uses each coworker's directory photo within the active tenant", () => {
  const peer = { ...current, id: 8, photoUrl: "/api/profile/photo/20/8?v=peer" };
  renderToStaticMarkup(createElement(ContactAvatar, {
    person: peer, ownPhoto: saved, ownerId: 7, tenantId: 20, size: 88,
  }));
  expect(avatar.props).toMatchObject({
    photoUrl: peer.photoUrl, tenantId: 20, userId: 8, size: 88,
  });
  expect(avatar.props.photoVersion).toBeUndefined();
});

it("does not use an earlier account's saved descriptor", () => {
  renderToStaticMarkup(createElement(ContactAvatar, {
    person: current, ownPhoto: saved, ownerId: 9, tenantId: 20, size: 44,
  }));
  expect(avatar.props.photoUrl).toBe(current.photoUrl);
  expect(avatar.props.photoVersion).toBeUndefined();
});
