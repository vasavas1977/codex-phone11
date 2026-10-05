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
  warmSupported: false, warm: null as {requestId:string;phase:string;callId?:string;attempted:boolean}|null, begin: vi.fn(), cancel: vi.fn(), complete: vi.fn(),
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
vi.mock("../lib/sip/sip-provider", () => ({ useSip: () => ({ transferCall: m.transfer, supportsBlindTransfer: () => m.supported, hasAttemptedBlindTransfer: () => m.attempted, supportsWarmTransfer: () => m.warmSupported, consultation: () => m.warm, beginConsultation:m.begin, cancelConsultation:m.cancel, completeConsultation:m.complete }) }));
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
  m.warmSupported=false; m.warm=null; m.begin.mockReset().mockResolvedValue(undefined); m.cancel.mockReset().mockResolvedValue(undefined); m.complete.mockReset().mockResolvedValue(undefined);
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

function warmSubmit() {
  m.supported=false; m.warmSupported=true; render(); edit();
  return m.presses.get("Start consultation call").onPress;
}
it("starts the real consultation path only when native capability is enabled",async()=>{
  const submit=warmSubmit(); await submit();
  expect(m.begin).toHaveBeenCalledWith("11","3003"); expect(m.transfer).not.toHaveBeenCalled();
  expect(render()).not.toContain("Transfer confirmed.");
});
it("never falls back to blind transfer when consultation capability changes",async()=>{
  const submit=warmSubmit(); m.warmSupported=false; await submit();
  expect(m.begin).not.toHaveBeenCalled(); expect(m.transfer).not.toHaveBeenCalled();
});
it.each(Object.keys(boundaries))("retires a retained consultation Submit after %s",async key=>{
  const submit=warmSubmit(); boundaries[key as keyof typeof boundaries](); await submit();
  expect(m.begin).not.toHaveBeenCalled(); expect(m.transfer).not.toHaveBeenCalled(); expect(m.retiredWrites).toBe(0);
});
it("shows native phases while the original is held and confirms readiness only from the native phase",async()=>{
  await warmSubmit()(); m.calls["11"]={...m.calls["11"],status:"held",isHeld:true};
  m.warm={requestId:"original-request",phase:"holding",attempted:true};
  expect(render()).toContain("only after hold is confirmed"); expect(m.presses.has("Complete consultation transfer")).toBe(false);
  m.warm={...m.warm,phase:"switching",callId:"12"}; expect(render()).toContain("Waiting for consultation audio focus");
  expect(m.presses.has("Complete consultation transfer")).toBe(false);
  m.warm={...m.warm,phase:"ready"}; expect(render()).toContain("Consultation connected");
  expect(m.presses.has("Complete consultation transfer")).toBe(true);
  await m.presses.get("Complete consultation transfer").onPress(); expect(m.complete).toHaveBeenCalledWith("11","original-request");
  expect(render()).not.toContain("Transfer confirmed.");
  m.warm={...m.warm,phase:"completed"}; expect(render()).toContain("Transfer confirmed.");
});
it("offers explicit cancellation and waits for native original restoration",async()=>{
  m.warmSupported=true; m.warm={requestId:"request",phase:"calling",attempted:true};
  m.calls["11"]={...m.calls["11"],status:"held",isHeld:true}; render();
  await m.presses.get("Return to original call").onPress(); expect(m.cancel).toHaveBeenCalledWith("11","request");
  expect(render()).toContain("original caller is on hold"); expect(m.back).not.toHaveBeenCalled();
  m.warm={...m.warm,phase:"returning"}; expect(render()).toContain("Waiting for hold confirmation");
  m.warm={...m.warm,phase:"restoring_audio"}; expect(render()).toContain("Waiting for audio focus confirmation");
  m.warm={...m.warm,phase:"returned"}; expect(render()).toContain("Your original call is available");
  expect(m.presses.has("Complete consultation transfer")).toBe(false);
});
it("suppresses a retained warm completion/cancellation after request ownership changes",async()=>{
  m.warmSupported=true; m.warm={requestId:"original-request",phase:"ready",attempted:true}; render();
  const complete=m.presses.get("Complete consultation transfer").onPress, cancel=m.presses.get("Return to original call").onPress;
  m.warm={...m.warm,requestId:"replacement-request"}; await complete(); await cancel();
  expect(m.complete).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled();
});
it.each(Object.keys(boundaries))("retires pending warm completion after %s",async key=>{
  m.warmSupported=true; m.warm={requestId:"request",phase:"ready",attempted:true}; const result=deferred(); m.complete.mockReturnValueOnce(result.promise); render();
  const pending=m.presses.get("Complete consultation transfer").onPress(); boundaries[key as keyof typeof boundaries]();
  const before=JSON.stringify(m.frame.values,(_key,value)=>typeof value==="function"?"function":value);
  result.resolve(); await pending; expect(m.retiredWrites).toBe(0);
  expect(JSON.stringify(m.frame.values,(_key,value)=>typeof value==="function"?"function":value)).toBe(before);
});
it("keeps pending transfer uncertain and offers restoration after authoritative failure",()=>{
  m.warmSupported=true; m.warm={requestId:"request",phase:"transferring",attempted:true};
  expect(render()).toContain("server may still complete"); expect(m.presses.has("Return to original call")).toBe(false);
  m.warm={...m.warm,phase:"transfer_failed"}; expect(render()).toContain("Transfer failed");
  expect(m.presses.has("Return to original call")).toBe(true); expect(m.presses.has("Complete consultation transfer")).toBe(false);
});

it.each([[false, true, "Start consultation call"], [true, false, "Confirm blind transfer"], [true, true, "Confirm blind transfer"], [false, false, null]])(
  "actual transfer screen chooses an available mode for blind=%s warm=%s", async (blind, warm, label) => {
    m.supported = blind; m.warmSupported = warm;
    const html = render();
    if (!label) {
      expect(html).toContain("Call transfer is unavailable"); expect(m.inputs.size).toBe(0); return;
    }
    expect(m.presses.has(label)).toBe(true);
    expect(m.presses.has("Choose blind transfer")).toBe(blind && warm);
    expect(m.presses.has("Choose consultation transfer")).toBe(blind && warm);
    if (!blind) expect(html).not.toContain("Transfer now");
    edit(); await m.presses.get(label).onPress();
    expect(m.transfer).toHaveBeenCalledTimes(blind ? 1 : 0);
    expect(m.begin).toHaveBeenCalledTimes(blind ? 0 : 1);
  },
);
it("rejects retained blind Submit after selecting warm and retained warm Submit after selecting blind", async () => {
  m.warmSupported = true; const blind = callback();
  m.presses.get("Choose consultation transfer").onPress();
  await blind(); expect(m.transfer).not.toHaveBeenCalled(); render();
  const warm = m.presses.get("Start consultation call").onPress;
  await blind(); expect(m.transfer).not.toHaveBeenCalled();
  m.presses.get("Choose blind transfer").onPress(); render();
  await warm(); expect(m.begin).not.toHaveBeenCalled();
  await m.presses.get("Confirm blind transfer").onPress(); expect(m.transfer).toHaveBeenCalledOnce();
});
it("selects warm when blind capability disappears without dispatching a retained blind Submit", async () => {
  m.warmSupported = true; const blind = callback(); m.supported = false;
  render(); await blind(); expect(m.transfer).not.toHaveBeenCalled();
  expect(m.presses.has("Confirm blind transfer")).toBe(false);
  await m.presses.get("Start consultation call").onPress(); expect(m.begin).toHaveBeenCalledOnce();
});
it("coalesces duplicate warm Submit while begin is pending and retains one consultation attempt", async () => {
  const result = deferred(); m.begin.mockReturnValueOnce(result.promise);
  const submit = warmSubmit(); const pending = submit(); await submit(); expect(m.begin).toHaveBeenCalledOnce();
  expect(render()).toContain("Starting consultation");
  m.warm = { requestId: "request", phase: "returned", attempted: true }; result.resolve(); await pending;
  await submit(); expect(m.begin).toHaveBeenCalledOnce();
  expect(render()).toContain("One consultation attempt");
  expect(m.presses.has("Start consultation call")).toBe(false);
});
it.each(["logout", "credentials", "endedCall", "reusedCallId"])("retires warm-only pending begin after %s", async key => {
  const result = deferred(); m.begin.mockReturnValueOnce(result.promise);
  const pending = warmSubmit()(); boundaries[key as keyof typeof boundaries]();
  const before = JSON.stringify(m.frame.values, (_key, value) => typeof value === "function" ? "function" : value);
  result.resolve(); await pending;
  expect(JSON.stringify(m.frame.values, (_key, value) => typeof value === "function" ? "function" : value)).toBe(before);
});
it.each(["calling", "consultation_failed", "return_failed", "transfer_failed"])("warm-only recovery remains reachable in phase %s", async phase => {
  m.supported = false; m.warmSupported = true; m.attempted = true;
  m.calls["11"] = { ...m.calls["11"], status: "held", isHeld: true };
  m.warm = { requestId: "recovery", phase, attempted: true }; render();
  expect(m.presses.has("Complete consultation transfer")).toBe(false);
  await m.presses.get("Return to original call").onPress(); expect(m.cancel).toHaveBeenCalledWith("11", "recovery");
  expect(m.transfer).not.toHaveBeenCalled();
});
it("rechecks warm recovery phase, capability and attempt before retained actions", async () => {
  m.supported = false; m.warmSupported = true; m.warm = { requestId: "request", phase: "ready", attempted: true };
  render(); const complete = m.presses.get("Complete consultation transfer").onPress;
  const cancel = m.presses.get("Return to original call").onPress;
  m.warm = { ...m.warm, phase: "transferring" }; await cancel(); expect(m.cancel).not.toHaveBeenCalled();
  m.warm = { ...m.warm, phase: "ready" }; m.attempted = true; await complete(); expect(m.complete).not.toHaveBeenCalled();
  m.attempted = false; m.warmSupported = false; await complete(); await cancel();
  expect(m.cancel).not.toHaveBeenCalled(); expect(m.complete).not.toHaveBeenCalled();
});
it.each(Object.keys(boundaries))("retires warm-only recovery after %s", async key => {
  m.supported = false; m.warmSupported = true; m.warm = { requestId: "request", phase: "return_failed", attempted: true };
  render(); const cancel = m.presses.get("Return to original call").onPress;
  boundaries[key as keyof typeof boundaries](); await cancel(); expect(m.cancel).not.toHaveBeenCalled();
});
