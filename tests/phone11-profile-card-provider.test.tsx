import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({ target: null as any, owner: 7 as number | undefined, path: "/chat/room", open: null as any, detail: null as any, self: null as any, close: null as any, user: null as any, loading: false, chat: null as any, navigate: vi.fn(), dismissKeyboard: vi.fn() }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: () => [m.target, (value: any) => { m.target = value; }] };
});
vi.mock("react-native", () => ({
  BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) }, Keyboard: { dismiss: m.dismissKeyboard },
  StyleSheet: { create: (s: any) => s, absoluteFill: {}, hairlineWidth: 1 },
  Text: ({ children }: any) => createElement("span", null, children),
  View: ({ children }: any) => createElement("div", null, children),
  Pressable: ({ children, accessibilityLabel, onPress }: any) => {
    if (accessibilityLabel === "Back from profile") m.close = onPress;
    return createElement("button", null, children);
  },
}));
vi.mock("expo-router", () => ({ router: { push: m.navigate }, usePathname: () => m.path }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 10, bottom: 10 }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.owner ? (m.user?.id === m.owner ? m.user : (m.user = { id: m.owner, name: "Signed-in person", email: "owner@example.com" })) : (m.user = null) }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.user, loading: m.loading }) }));
vi.mock("../lib/chat/store", () => ({ useChatStore: { getState: () => m.chat } }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({}) }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../components/contact-details", () => ({ ContactDetails: (props: any) => { m.detail = props; return createElement("span", null, "Resolved contact"); } }));
vi.mock("../components/profile/account-hub", () => ({ AccountDetails: (props: any) => { m.self = props; return createElement("span", null, "My profile details"); } }));
import { ProfileCardProvider } from "../components/profile/profile-card-provider";
import { useOpenProfileCard } from "../components/profile/profile-card-context";
function Child() { m.open = useOpenProfileCard(); return createElement("span", null, "Existing meeting or picker"); }
function render(selectionOnly = false) { m.detail = null; m.self = null; return renderToStaticMarkup(<ProfileCardProvider selectionOnly={selectionOnly}><Child /></ProfileCardProvider>); }
beforeEach(() => { m.target = null; m.owner = 7; m.path = "/chat/room"; m.user = null; m.loading = false; m.chat = { userId: 7, workspace: { id: 20 } }; vi.clearAllMocks(); });

it("opens an exact tenant/user card without removing the source screen", () => {
  render(); m.open({ tenantId: 20, userId: 8 });
  const html = render();
  expect(html).toContain("Existing meeting or picker");
  expect(html).toContain("Resolved contact");
  expect(m.detail).toMatchObject({ id: "8", tenantId: "20", embedded: true, actionsEnabled: true });
  expect(m.dismissKeyboard).toHaveBeenCalledOnce();
  m.close(); expect(render()).not.toContain("Resolved contact");
});
it("keeps picker cards informational and returns to the retained selection", () => {
  render(true); m.open({ tenantId: 20, userId: 8 }); render(true);
  expect(m.detail.actionsEnabled).toBe(false);
  m.close(); expect(render(true)).toContain("Existing meeting or picker");
});
it("opens canonical self details without querying the coworker directory or using avatar labels", () => {
  render(); m.open({ tenantId: 20, userId: 7, name: "Someone else", photoUrl: "/api/profile/photo/20/7?v=123" });
  render();
  expect(m.navigate).toHaveBeenCalledOnce();
  expect(m.navigate).toHaveBeenCalledWith({ pathname: "/profile", params: { view: "details", ownerId: "7", tenantId: "20" } });
  expect(m.detail).toBeNull(); expect(m.self).toBeNull(); expect(m.target).toBeNull();
});
it.each(["workspace", "owner", "loading", "session"])("rejects a stale own-avatar navigation after %s changes", kind => {
  render(); const open = m.open;
  if (kind === "workspace") m.chat.workspace = { id: 30 };
  if (kind === "owner") m.chat.userId = 8;
  if (kind === "loading") m.loading = true;
  if (kind === "session") m.user = { ...m.user };
  open({ tenantId: 20, userId: 7 });
  expect(m.navigate).not.toHaveBeenCalled(); expect(m.target).toBeNull();
});
it("keeps a picker mounted when the signed-in user taps their own avatar", () => {
  render(true); m.open({ tenantId: 20, userId: 7 });
  const html = render(true);
  expect(html).toContain("Existing meeting or picker");
  expect(html).toContain("My profile details");
  expect(m.detail).toBeNull();
});
it.each(["/call/active", "/conference/room"])("does not offer a second call or chat during %s", path => {
  m.path = path; render(); m.open({ tenantId: 20, userId: 8 }); render();
  expect(m.detail.actionsEnabled).toBe(false);
});
it("keeps incoming-call avatars noninteractive so Answer and Decline stay accessible", () => {
  m.path = "/call/incoming";
  expect(render()).toContain("Existing meeting or picker");
  expect(m.open).toBeNull();
  expect(m.detail).toBeNull();
});
it("hides an old account's card immediately and rejects unauthenticated opens", () => {
  render(); m.open({ tenantId: 20, userId: 8 }); m.owner = 9;
  expect(render()).not.toContain("Resolved contact");
  m.owner = undefined; m.target = null; render(); m.open({ tenantId: 20, userId: 8 });
  expect(m.target).toBeNull();
});
it("hides a card when the route changes and rejects invalid identities", () => {
  render(); m.open({ tenantId: 20, userId: 8 }); m.path = "/auth/sign-in";
  expect(render()).not.toContain("Resolved contact");
  m.target = null; m.open({ tenantId: 20, userId: NaN }); expect(m.target).toBeNull();
});

it.each(["/call/active", "/conference/room"])("keeps self cards readonly during %s", path => {
  m.path = path; render(); m.open({ tenantId: 20, userId: 7 }); render();
  expect(m.self.photoOptionsEnabled).toBe(false); m.self.onEditPhoto();
  expect(m.navigate).not.toHaveBeenCalled();
});
it("retires a card when the same numeric owner has a replacement session", () => {
  render(true); m.open({ tenantId: 20, userId: 7 }); render(true);
  m.user = { ...m.user }; expect(render(true)).not.toContain("My profile details");
});
