import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({ enabled: false, owner: { id: 1 } as { id: number } | null, state: {} as any,
  enable: vi.fn(), buttons: new Map<string, any>(), frame: { values: [] as any[], index: 0 } }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: any) => { const f = m.frame, i = f.index++; if (i >= f.values.length) f.values[i] = initial; return [f.values[i], (v: any) => { f.values[i] = v; }]; },
    useRef: (initial: any) => { const f = m.frame, i = f.index++; if (i >= f.values.length) f.values[i] = { current: initial }; return f.values[i]; },
  };
});
function element({ children }: any) { return createElement("div", null, children); }
vi.mock("react-native", () => ({ View: element, Text: element, StyleSheet: { create: (x: any) => x },
  Pressable: (p: any) => { if (p.accessibilityLabel) m.buttons.set(p.accessibilityLabel, p); return createElement("button", { disabled: p.disabled }, p.children); } }));
vi.mock("expo-router", () => ({ router: { canGoBack: () => false, replace: vi.fn() } }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: element }));
vi.mock("../components/feature-unavailable", () => ({ FeatureUnavailable: ({ title, description }: any) => createElement("div", null, title, description) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "green", foreground: "black", muted: "gray" }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.owner }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.owner, loading: false }) }));
vi.mock("../lib/chat/store", () => ({ useChatStore: Object.assign(() => m.state, { getState: () => m.state }) }));
vi.mock("../lib/notifications/client", () => ({ chatNotificationClientEnabled: () => m.enabled }));
vi.mock("../lib/notifications/chat-notifications", () => ({ enableChatNotifications: () => m.enable() }));
import Preferences from "../app/notifications/preferences";
function render() { m.frame.index = 0; m.buttons.clear(); return renderToStaticMarkup(createElement(Preferences)); }
const action = () => m.buttons.get("Enable message alerts");
function deferred() { let resolve!: (v: any) => void; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; }
beforeEach(() => { vi.resetAllMocks(); m.enabled = false; m.owner = { id: 1 }; m.state = { userId: 1, workspace: { id: 10, name: "Work" } }; m.frame = { values: [], index: 0 }; m.enable.mockResolvedValue({ status: "enabled" }); });
it("default off has no permission action or prompt", () => { expect(render()).toContain("Notification settings are not available yet"); expect(action()).toBeUndefined(); expect(m.enable).not.toHaveBeenCalled(); });
it("requires an explicit action and discloses selected workspace before reporting saved setup", async () => {
  m.enabled = true; const html = render(); expect(html).toContain("workspace currently selected in Team Chat"); expect(m.enable).not.toHaveBeenCalled();
  await action().onPress(); expect(render()).toContain("Alert setup saved for Work."); expect(m.enable).toHaveBeenCalledTimes(1);
});
it.each(["permission-denied", "unavailable", "session-changed"])("does not claim setup succeeded after %s", async status => {
  m.enabled = true; m.enable.mockResolvedValue({ status }); render(); await action().onPress(); const html = render(); expect(html).not.toContain("Alert setup saved");
  expect(html).toContain(status === "permission-denied" ? "Allow notifications for Phone11" : status === "unavailable" ? "Check your connection" : "account or workspace changed");
});
it("shows retry guidance for rejected network work without raw error details", async () => { m.enabled = true; m.enable.mockRejectedValue(new Error("private server details")); render(); await action().onPress(); const html = render(); expect(html).toContain("Check your connection"); expect(html).not.toContain("private server"); expect(action().disabled).toBe(false); });
it("does not prompt without an authenticated selected workspace", async () => {
  m.enabled = true; m.owner = null; render(); expect(action().disabled).toBe(true); await action().onPress(); expect(m.enable).not.toHaveBeenCalled();
  m.owner = { id: 1 }; m.state.workspace = null; render(); expect(action().disabled).toBe(true); await action().onPress(); expect(m.enable).not.toHaveBeenCalled();
});
it("ignores a captured handler after identity changes and coalesces double taps", async () => {
  m.enabled = true; render(); const old = action().onPress; m.owner = { id: 2 }; await old(); expect(m.enable).not.toHaveBeenCalled();
  m.state = { userId: 2, workspace: { id: 20, name: "Other" } }; render(); const d = deferred(); m.enable.mockReturnValue(d.promise);
  const one = action().onPress(); await action().onPress(); expect(m.enable).toHaveBeenCalledTimes(1); d.resolve({ status: "enabled" }); await one;
});
it("old session completion cannot publish feedback or release a new workspace action", async () => {
  m.enabled = true; const old = deferred(), next = deferred(); m.enable.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  render(); const first = action().onPress(); m.owner = { id: 1 }; m.state = { userId: 1, workspace: { id: 20, name: "New work" } }; render();
  expect(action().disabled).toBe(false); const second = action().onPress(); render(); expect(action().disabled).toBe(true);
  old.resolve({ status: "enabled" }); await first; expect(render()).not.toContain("Alert setup saved"); expect(action().disabled).toBe(true);
  next.resolve({ status: "enabled" }); await second; expect(render()).toContain("Alert setup saved for New work."); expect(action().disabled).toBe(false);
});
