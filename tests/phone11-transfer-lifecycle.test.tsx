/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
  presses: new Map<string, any>(), inputs: new Map<string, any>(),
  retired: false, retiredWrites: 0, params: { callId: "11" },
  calls: {} as Record<string, any>, account: null as any,
  callListeners: new Set<() => void>(), accountListeners: new Set<() => void>(),
  supported: true, attempted: false, transfer: vi.fn(), back: vi.fn(), replace: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = typeof initial === "function" ? initial() : initial;
      return [m.frame.values[i], (value: any) => {
        if (m.retired) m.retiredWrites++;
        m.frame.values[i] = typeof value === "function" ? value(m.frame.values[i]) : value;
      }];
    },
    useRef: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = { current: initial };
      return m.frame.values[i];
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const i = m.frame.index++, old = m.frame.values[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index])))
        m.frame.effects.push(() => { old?.cleanup?.(); m.frame.values[i] = { deps, cleanup: effect() }; });
    },
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  };
});
vi.mock("react-native", () => ({
  Platform: { OS: "ios" }, ActivityIndicator: () => null,
  StyleSheet: { create: (x: unknown) => x },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TextInput: (props: any) => { m.inputs.set(props.accessibilityLabel, props); return null; },
  Pressable: (props: any) => { m.presses.set(props.accessibilityLabel, props); return createElement("button", { disabled: props.disabled }, props.children); },
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => m.params, router: { canGoBack: () => true, back: m.back, replace: m.replace } }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ background: "white", foreground: "black", muted: "gray", surface: "white", primary: "blue", success: "green", error: "red" }) }));
vi.mock("../lib/sip/sip-provider", () => ({ useSip: () => ({ transferCall: m.transfer, supportsBlindTransfer: () => m.supported, hasAttemptedBlindTransfer: () => m.attempted }) }));
vi.mock("../lib/sip/call-store", () => ({ useSipCallStore: Object.assign((select: any) => select({ activeCalls: m.calls, incomingCall: null }), {
  getState: () => ({ activeCalls: m.calls, incomingCall: null }),
  subscribe: (fn: () => void) => { m.callListeners.add(fn); return () => m.callListeners.delete(fn); },
}) }));
vi.mock("../lib/sip/account-store", () => ({
  useSipAccountStore: Object.assign((select: any) => select({ account: m.account }), {
    getState: () => ({ account: m.account }),
    subscribe: (fn: () => void) => { m.accountListeners.add(fn); return () => m.accountListeners.delete(fn); },
  }),
  sameSipAccount: (current: any, next: any) => current !== null && next !== null && Object.keys(current).every(key => current[key] === next[key]),
}));
vi.mock("../components/feature-unavailable", () => ({ FeatureUnavailable: ({ title }: any) => createElement("span", null, title) }));
import * as Auth from "../lib/_core/auth";
import TransferCallScreen from "../app/call/transfer";
function actor(lastSignedIn = "2026-10-04T00:00:00Z") {
  return { id: 7, openId: "actor-7", name: "Nok", email: "nok@example.test", loginMethod: "email", lastSignedIn: new Date(lastSignedIn) };
}
function call(id = "11", historyId = "original") {
  return { id, status: "active", isHeld: false, startTime: new Date(1000), history: { id: historyId, ownerUserId: 7 } };
}
function render() {
  m.frame.index = 0; m.presses.clear(); m.inputs.clear();
  const html = renderToStaticMarkup(createElement(TransferCallScreen));
  for (const effect of m.frame.effects.splice(0)) effect();
  return html;
}
function edit(value = "3003") { m.inputs.get("Transfer destination").onChangeText(value); return render(); }
function callback() { render(); edit(); return m.presses.get("Confirm blind transfer").onPress; }
function unmount() { for (const slot of m.frame.values) slot?.cleanup?.(); m.retired = true; }
function notifyCall() { m.callListeners.forEach(fn => fn()); }
function notifyAccount() { m.accountListeners.forEach(fn => fn()); }
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const boundaries = {
  unmount,
  logout: () => Auth.updateAuthState({ user: null }),
  replacementSession: () => Auth.updateAuthState({ user: actor("2026-10-04T01:00:00Z") }),
  tenant: () => { m.account = { ...m.account, tenantId: 9 }; notifyAccount(); },
  credentials: () => { m.account = { ...m.account, password: "other-test-value" }; notifyAccount(); },
  endedCall: () => { m.calls = {}; notifyCall(); },
  reusedCallId: () => { m.calls = { "11": call("11", "replacement") }; notifyCall(); },
  otherRoute: () => { m.calls = { "12": call("12", "replacement") }; m.params.callId = "12"; notifyCall(); render(); },
};
beforeEach(() => {
  vi.clearAllMocks(); m.frame = { index: 0, values: [], effects: [] }; m.retired = false; m.retiredWrites = 0;
  m.callListeners.clear(); m.accountListeners.clear(); m.params = { callId: "11" }; m.calls = { "11": call() };
  m.account = { id: "a", ownerUserId: 7, tenantId: 8, username: "1001", password: "not-live", enabled: true };
  m.supported = true; m.attempted = false; m.transfer.mockResolvedValue(undefined);
  Auth.updateAuthState({ user: null }); Auth.updateAuthState({ user: actor(), loading: false, error: null });
});
it.each(Object.keys(boundaries))("retires retained Submit after %s before sending a request", async key => {
  const submit = callback(); boundaries[key as keyof typeof boundaries](); await submit();
  expect(m.transfer).not.toHaveBeenCalled(); expect(m.retiredWrites).toBe(0);
});
it.each(Object.keys(boundaries).flatMap(key => [ [key, "success"], [key, "failure"] ]))("retires pending %s completion (%s)", async (key, outcome) => {
  const result = deferred(); m.transfer.mockReturnValueOnce(result.promise); const submit = callback(); const pending = submit();
  expect(m.transfer).toHaveBeenCalledWith("11", "3003"); render();
  boundaries[key as keyof typeof boundaries]();
  const before = JSON.stringify(m.frame.values, (_key, value) => typeof value === "function" ? "function" : value);
  if (outcome === "success") result.resolve(); else result.reject(new Error("old request failure"));
  await pending;
  expect(m.retiredWrites).toBe(0);
  expect(JSON.stringify(m.frame.values, (_key, value) => typeof value === "function" ? "function" : value)).toBe(before);
  if (!m.retired) { const html = render(); expect(html).not.toContain("Transfer confirmed."); expect(html).not.toContain("old request failure"); }
});
it("rechecks current held state and capability before retained Submit", async () => {
  const submit = callback(); m.calls["11"] = { ...m.calls["11"], isHeld: true }; notifyCall(); await submit();
  m.calls["11"] = { ...m.calls["11"], isHeld: false }; m.supported = false; await submit();
  expect(m.transfer).not.toHaveBeenCalled();
});
it("keeps current transfer pending, rejects duplicate Submit, then reports only success", async () => {
  const result = deferred(); m.transfer.mockReturnValueOnce(result.promise); const submit = callback(); const pending = submit(); await submit();
  expect(m.transfer).toHaveBeenCalledOnce(); expect(render()).toContain("Waiting for transfer confirmation");
  expect(render()).not.toContain("Transfer confirmed."); result.resolve(); await pending;
  expect(render()).toContain("Transfer confirmed."); expect(m.back).not.toHaveBeenCalled(); expect(m.replace).not.toHaveBeenCalled();
});
it("allows retry for a pre-invocation bridge refusal while the original call is current", async () => {
  m.transfer.mockRejectedValueOnce(new Error("Resume the call before transferring it.")); await callback()();
  expect(render()).toContain("Resume the call before transferring it."); await m.presses.get("Confirm blind transfer").onPress();
  expect(m.transfer).toHaveBeenCalledTimes(2); expect(render()).toContain("Transfer confirmed.");
});
it("offers original call controls after an attempted transfer and suppresses another Submit", async () => {
  m.transfer.mockImplementationOnce(async () => { m.attempted = true; throw new Error("Transfer failed. Original call remains available."); });
  await callback()(); const html = render(); expect(html).toContain("Transfer failed"); expect(html).toContain("One transfer attempt");
  expect(m.presses.get("Confirm blind transfer")).toBeUndefined(); m.presses.get("Return to call controls").onPress(); expect(m.back).toHaveBeenCalledOnce();
});
it("clears the old destination and confirmation when a different call route becomes current", async () => {
  await callback()(); expect(render()).toContain("Transfer confirmed."); boundaries.otherRoute();
  expect(render()).not.toContain("Transfer confirmed."); expect(m.inputs.get("Transfer destination").value).toBe("");
});
it("preserves ordinary call updates, account hydration and profile refresh", async () => {
  const submit = callback(); m.calls["11"] = { ...m.calls["11"], isMuted: true }; notifyCall();
  m.account = { ...m.account }; notifyAccount(); Auth.updateAuthState({ user: { ...actor(), name: "Updated name" } });
  render(); await submit(); expect(m.transfer).toHaveBeenCalledWith("11", "3003"); expect(render()).toContain("Transfer confirmed.");
});

it("does not revive a retained Submit when an account changes away and back before render", async () => {
  const submit = callback(), original = m.account;
  m.account = { ...original, tenantId: 9 }; notifyAccount(); m.account = original; notifyAccount();
  await submit(); expect(m.transfer).not.toHaveBeenCalled();
  render(); edit(); await m.presses.get("Confirm blind transfer").onPress(); expect(m.transfer).toHaveBeenCalledOnce();
});
it("does not resend a retained Submit after its confirmed result", async () => {
  const submit = callback(); await submit(); await submit(); expect(m.transfer).toHaveBeenCalledOnce();
});
