import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { MeetingRoomState } from "../components/meetings/meeting-room-state";
import type { BrowserMeetingSession, BrowserSessionSnapshot } from "../lib/meetings/browser-session";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const state = vi.hoisted(() => ({ platform: "web", owner: { id: 3001, name: "You" }, current: null as { id: number; name: string } | null,
  buttons: new Map<string, { onPress: () => void; disabled: boolean }>() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useSyncExternalStore: (_: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("react-native", () => ({
  Platform: { get OS() { return state.platform; } }, StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children), Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children), Modal: () => null, ActivityIndicator: () => null,
  Pressable: ({ children, accessibilityLabel, onPress, disabled }: { children: ReactNode; accessibilityLabel: string; onPress: () => void; disabled: boolean }) => {
    state.buttons.set(accessibilityLabel, { onPress, disabled }); return createElement("button", { "aria-label": accessibilityLabel, disabled }, children);
  },
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ foreground: "white", primary: "blue", muted: "gray", error: "red" }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: state.owner }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: state.current }) }));
vi.mock("../hooks/use-directory", () => ({ useDirectory: () => ({ owner: 3001, workspace: { id: 7 }, people: [], reload: vi.fn() }), useDirectoryFocusRefresh: vi.fn() }));
vi.mock("../lib/profile/use-workspace-profile", () => ({ useWorkspaceProfile: () => ({ photoDescriptor: null }) }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: () => null, useProfilePhotoCacheScope: vi.fn() }));
vi.mock("../components/meetings/native-video-stage", () => ({ NativeVideoStage: () => null }));
vi.mock("../components/meetings/meeting-room-chat", () => ({ MeetingRoomChat: () => null }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
beforeEach(() => { state.platform = "web"; state.current = state.owner; state.buttons.clear(); });
function render(screenShare?: BrowserSessionSnapshot["screenShare"], status: BrowserSessionSnapshot["status"] = "connected", receiveOnly = false) {
  const snapshot: BrowserSessionSnapshot = { status, participants: [{ identity: "p11-t7-u3001", name: "You", local: true, microphone: false, camera: false, speaking: false, attributes: {} }], error: null, screenShare };
  const session = { subscribe: () => () => {}, getSnapshot: () => snapshot, startScreenShare: vi.fn(async () => {}), stopScreenShare: vi.fn(async () => {}) };
  const html = renderToStaticMarkup(createElement(MeetingRoomState, { session: session as unknown as BrowserMeetingSession, receiveOnly, onBack: vi.fn() }));
  return { session, html };
}
it("invokes Share directly in the button callback", () => {
  const { session, html } = render({ available: true, status: "idle", error: null });
  expect(html).toContain('aria-label="Share screen"');
  state.buttons.get("Share screen")!.onPress();
  expect(session.startScreenShare).toHaveBeenCalledTimes(1); expect(session.stopScreenShare).not.toHaveBeenCalled();
});
it.each(["choosing", "publishing", "sharing"] as const)("offers Stop while %s without claiming success early", phase => {
  const { session, html } = render({ available: true, status: phase, error: null });
  expect(html.includes("You are sharing your screen")).toBe(phase === "sharing");
  state.buttons.get("Stop sharing screen")!.onPress();
  expect(session.stopScreenShare).toHaveBeenCalledTimes(1); expect(session.startScreenShare).not.toHaveBeenCalled();
});
it.each(["ios", "android"])("never exposes browser publishing on %s", platform => {
  state.platform = platform; const { html } = render({ available: true, status: "idle", error: null }); expect(html).not.toContain('aria-label="Share screen"');
});
it("hides unavailable capability instead of enabling profile-only capture", () => {
  expect(render({ available: false, status: "idle", error: null }).html).not.toContain('aria-label="Share screen"');
  expect(render().html).not.toContain('aria-label="Share screen"');
});
it("rejects a stale rendered owner before capture", () => {
  const { session } = render({ available: true, status: "idle", error: null }); state.current = { id: 1020, name: "Other" };
  state.buttons.get("Share screen")!.onPress(); expect(session.startScreenShare).not.toHaveBeenCalled();
});
it.each(["reconnecting", "disconnected"] as const)("disables a new share while %s", status => {
  const { session } = render({ available: true, status: "idle", error: null }, status);
  expect(state.buttons.get("Share screen")!.disabled).toBe(true); state.buttons.get("Share screen")!.onPress(); expect(session.startScreenShare).not.toHaveBeenCalled();
});
it("listener UI cannot initiate screen capture", () => {
  const { session } = render({ available: true, status: "idle", error: null }, "connected", true);
  expect(state.buttons.get("Share screen")!.disabled).toBe(true); state.buttons.get("Share screen")!.onPress(); expect(session.startScreenShare).not.toHaveBeenCalled();
});
it("allows a failed cleanup to be retried with Stop", () => {
  const { session, html } = render({ available: false, status: "stopping", error: "Cleanup requires retry" });
  expect(html).toContain("Cleanup requires retry");
  expect(state.buttons.get("Stop sharing screen")!.disabled).toBe(false); state.buttons.get("Stop sharing screen")!.onPress(); expect(session.stopScreenShare).toHaveBeenCalled();
});
