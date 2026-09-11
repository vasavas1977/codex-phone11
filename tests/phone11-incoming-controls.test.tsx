import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  hooks: null as { values: any[]; index: number; effects: (() => void)[] } | null,
  owner: { id: 1 } as { id: number } | null,
  state: {} as any,
  params: { callId: "incoming-1" } as any,
  press: new Map<string, { run: () => Promise<void>; disabled: boolean }>(),
  answer: vi.fn(async (_id: string) => {}),
  hangup: vi.fn(async (_id: string) => {}),
  alert: vi.fn(),
  diagnostics: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: true,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState(initial: any) {
      if (!m.hooks) return actual.useState(initial);
      const frame = m.hooks, i = frame.index++;
      if (i >= frame.values.length) frame.values[i] = typeof initial === "function" ? initial() : initial;
      return [frame.values[i], (value: any) => { frame.values[i] = typeof value === "function" ? value(frame.values[i]) : value; }];
    },
    useRef(initial: any) {
      if (!m.hooks) return actual.useRef(initial);
      const frame = m.hooks, i = frame.index++;
      if (i >= frame.values.length) frame.values[i] = { current: initial };
      return frame.values[i];
    },
    useEffect(effect: () => void | (() => void), deps: any[]) {
      if (!m.hooks) return actual.useEffect(effect, deps);
      const frame = m.hooks, i = frame.index++, previous = frame.values[i];
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) {
        frame.effects.push(() => { previous?.cleanup?.(); frame.values[i] = { deps, cleanup: effect() }; });
      }
    },
  };
});
vi.mock("react-native", () => ({
  Alert: { alert: m.alert },
  Vibration: { vibrate: vi.fn(), cancel: vi.fn() },
  StyleSheet: { create: (s: any) => s },
  ScrollView: ({ children }: any) =>
    createElement("section", { "data-scroll": true }, children),
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({
    children,
    accessibilityLabel,
    disabled,
    onPress,
  }: any) => {
    m.press.set(accessibilityLabel, { run: onPress, disabled });
    return createElement(
      "button",
      { "aria-label": accessibilityLabel, disabled },
      children,
    );
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 60, bottom: 40 }),
}));
vi.mock("expo-router", () => ({
  router: { back: m.back, replace: m.replace, canGoBack: () => m.canGoBack },
  useLocalSearchParams: () => m.params,
}));
vi.mock("expo-haptics", () => ({
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "#008877",
    error: "#bb0000",
    success: "#008877",
  }),
}));
vi.mock("../lib/sip/sip-provider", () => ({
  useSip: () => ({ answerCall: m.answer, hangupCall: m.hangup }),
}));
vi.mock("../lib/sip/call-store", () => ({
  useSipCallStore: Object.assign((select: any) => select(m.state), {
    getState: () => m.state,
  }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.owner }),
}));
vi.mock("../lib/sip/diagnostics-store", () => ({
  useSipDiagnosticsStore: { getState: () => ({ addEvent: m.diagnostics }) },
}));
import IncomingCallScreen from "../app/call/incoming";
function render() {
  return renderToStaticMarkup(<IncomingCallScreen />);
}
beforeEach(() => {
  vi.useFakeTimers();
  m.hooks = null;
  vi.clearAllMocks();
  m.owner = { id: 1 };
  m.press.clear();
  m.params = { callId: "incoming-1" };
  m.canGoBack = true;
  m.answer.mockResolvedValue(undefined);
  m.hangup.mockResolvedValue(undefined);
  m.state = {
    activeCalls: {},
    incomingCall: {
      id: "incoming-1",
      status: "incoming",
      remoteNumber: "3002",
    },
  };
});
it("uses honest tap instructions and keeps Answer outside the scrolling caller details", () => {
  const html = render();
  expect(html).toContain("Tap Answer or Decline");
  expect(html).not.toContain("Slide");
  expect(html.indexOf('aria-label="Answer call"')).toBeGreaterThan(
    html.indexOf("</section>"),
  );
  expect(m.press.get("Answer call")!.disabled).toBe(false);
});
it("records whether an Answer tap was eligible without recording the caller or account", async () => {
  render();
  const answer = m.press.get("Answer call")!.run;
  await answer();
  await answer();
  expect(m.diagnostics).toHaveBeenNthCalledWith(1, {
    level: "info", category: "call", message: "Incoming Answer tapped",
    context: { eligible: true, pending: false, hasCall: true },
  });
  expect(m.diagnostics).toHaveBeenNthCalledWith(2, {
    level: "info", category: "call", message: "Incoming Answer tapped",
    context: { eligible: false, pending: true, hasCall: true },
  });
  expect(m.answer).toHaveBeenCalledOnce();
});
it("answers the real incoming ID once, including while awaiting the connected callback", async () => {
  render();
  const answer = m.press.get("Answer call")!.run;
  await answer();
  await answer();
  expect(m.answer).toHaveBeenCalledOnce();
  expect(m.answer).toHaveBeenCalledWith("incoming-1");
  expect(m.replace).not.toHaveBeenCalled();
});
it("allows retry after rejected Answer without faking a connected call", async () => {
  m.answer.mockRejectedValueOnce(new Error("SDK rejected"));
  render();
  const answer = m.press.get("Answer call")!.run;
  await answer();
  expect(m.alert).toHaveBeenCalledWith(
    "Could not answer call",
    expect.any(String),
  );
  await answer();
  expect(m.answer).toHaveBeenCalledTimes(2);
  expect(m.state.incomingCall.status).toBe("incoming");
});
it("keeps Decline usable while an Answer request is pending and ignores its later rejection", async () => {
  let reject!: (error: Error) => void;
  m.answer.mockImplementationOnce(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  render();
  const pending = m.press.get("Answer call")!.run();
  await m.press.get("Decline call")!.run();
  expect(m.hangup).toHaveBeenCalledOnce();
  expect(m.hangup).toHaveBeenCalledWith("incoming-1");
  reject(new Error("answer canceled"));
  await pending;
  expect(m.alert).not.toHaveBeenCalled();
});
it("ignores an incoming call canceled between rendering and the user's tap", async () => {
  render();
  m.state.incomingCall = null;
  await m.press.get("Answer call")!.run();
  expect(m.answer).not.toHaveBeenCalled();
});
it("never answers a stale route or an already connected session", async () => {
  m.params.callId = "old-call";
  render();
  expect(m.press.get("Answer call")!.disabled).toBe(true);
  await m.press.get("Answer call")!.run();
  expect(m.answer).not.toHaveBeenCalled();
  m.params.callId = "incoming-1";
  m.state.incomingCall.status = "active";
  render();
  expect(m.press.get("Answer call")!.disabled).toBe(true);
  await m.press.get("Answer call")!.run();
  expect(m.answer).not.toHaveBeenCalled();
});
it("does not send repeated Decline commands while the first is pending", async () => {
  let finish!: () => void;
  m.hangup.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  const decline = m.press.get("Decline call")!.run;
  const pending = decline();
  await decline();
  expect(m.hangup).toHaveBeenCalledOnce();
  finish();
  await pending;
});
it("offers a working Close action when the call has ended and there is no back history", async () => {
  m.state.incomingCall = null;
  m.canGoBack = false;
  render();
  await m.press.get("Close ended call")!.run();
  expect(m.replace).toHaveBeenCalledWith("/(tabs)");
  expect(m.hangup).not.toHaveBeenCalled();
});

it("can stop the same call if it becomes connecting between Answer and Decline", async () => {
  render();
  await m.press.get("Answer call")!.run();
  m.state.incomingCall.status = "connecting";
  await m.press.get("Decline call")!.run();
  expect(m.hangup).toHaveBeenCalledWith("incoming-1");
});

it("old controls cannot answer or end a replacement owner's reused SDK call ID", async () => {
  render();
  const answer = m.press.get("Answer call")!.run;
  const decline = m.press.get("Decline call")!.run;
  m.owner = { id: 2 };
  m.state.incomingCall = {
    id: "incoming-1",
    status: "incoming",
    remoteNumber: "3003",
  };
  await answer();
  await decline();
  expect(m.answer).not.toHaveBeenCalled();
  expect(m.hangup).not.toHaveBeenCalled();
});
it("suppresses a late answer error after the same owner signs in to a replacement session", async () => {
  let reject!: (error: Error) => void;
  m.answer.mockImplementationOnce(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  render();
  const pending = m.press.get("Answer call")!.run();
  m.owner = { id: 1 };
  reject(new Error("old session ended"));
  await pending;
  expect(m.alert).not.toHaveBeenCalled();
});

it("retains accepted Answer after a failed Decline while keeping Decline retryable", async () => {
  m.hangup.mockRejectedValueOnce(new Error("SDK refused hangup"));
  render();
  const answer = m.press.get("Answer call")!.run;
  const decline = m.press.get("Decline call")!.run;
  await answer();
  await decline();
  await answer();
  expect(m.answer).toHaveBeenCalledOnce();
  expect(m.alert).toHaveBeenCalledWith(
    "Could not end call",
    expect.any(String),
  );
  await decline();
  expect(m.hangup).toHaveBeenCalledTimes(2);
});

function persistentRender() {
  m.hooks ??= { values: [], index: 0, effects: [] };
  m.hooks.index = 0;
  const html = render();
  for (const effect of m.hooks.effects.splice(0)) effect();
  return html;
}
function unmount() { for (const slot of m.hooks?.values ?? []) slot?.cleanup?.(); }
afterEach(() => { unmount(); vi.clearAllTimers(); vi.useRealTimers(); });

it("keeps accepted End latched until actual termination instead of enabling Answer again", async () => {
  persistentRender();
  await m.press.get("Answer call")!.run();
  await m.press.get("Decline call")!.run();
  const html = persistentRender();
  expect(html).toContain("Ending…");
  expect(m.press.get("Answer call")!.disabled).toBe(true);
  await m.press.get("Answer call")!.run();
  await (m.press.get("End call") ?? m.press.get("Decline call"))!.run();
  expect(m.answer).toHaveBeenCalledOnce();
  expect(m.hangup).toHaveBeenCalledOnce();
  m.state.incomingCall = null;
  persistentRender();
  expect(persistentRender()).toContain("Call ended");
  expect(m.press.get("Close ended call")!.disabled).toBe(false);
});

it("replaces endless Answering after 20 seconds while retaining a usable End and no fake connection", async () => {
  persistentRender();
  await m.press.get("Answer call")!.run();
  await vi.advanceTimersByTimeAsync(19_999);
  expect(persistentRender()).toContain("Answering…");
  await vi.advanceTimersByTimeAsync(1);
  const html = persistentRender();
  expect(html).toContain("The call has not connected. Tap End call to stop trying.");
  expect(html).not.toContain("Answering…");
  expect(m.press.get("Answer call")!.disabled).toBe(true);
  expect(m.press.get("End call")!.disabled).toBe(false);
  expect(m.state.incomingCall.status).toBe("incoming");
  expect(m.replace).not.toHaveBeenCalled();
  await m.press.get("End call")!.run();
  expect(m.hangup).toHaveBeenCalledOnce();
});

it.each(["connected", "owner", "replacement", "unmount"])("cancels the no-connect deadline on %s", async transition => {
  m.state.incomingCall.history = { id: "old-call" };
  persistentRender();
  await m.press.get("Answer call")!.run();
  expect(vi.getTimerCount()).toBe(1);
  if (transition === "connected") m.state.incomingCall.status = "active";
  if (transition === "owner") m.owner = { id: 1 };
  if (transition === "replacement") m.state.incomingCall = { ...m.state.incomingCall, history: { id: "replacement" } };
  if (transition === "unmount") unmount(); else persistentRender();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(m.hangup).not.toHaveBeenCalled();
  expect(m.alert).not.toHaveBeenCalled();
  if (transition === "owner" || transition === "replacement") {
    expect(persistentRender()).not.toContain("The call has not connected");
    expect(m.press.get("Answer call")!.disabled).toBe(false);
  }
});

it("keeps Ending latched if a late connected callback arrives before termination", async () => {
  persistentRender();
  await m.press.get("Answer call")!.run();
  await m.press.get("Decline call")!.run();
  m.state.incomingCall.status = "active";
  persistentRender();
  expect(persistentRender()).toContain("Ending…");
  expect(m.press.get("End call")!.disabled).toBe(true);
  expect(m.replace).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("restores the original connection deadline after an explicit End rejection", async () => {
  persistentRender();
  await m.press.get("Answer call")!.run();
  await vi.advanceTimersByTimeAsync(19_000);
  m.hangup.mockRejectedValueOnce(new Error("command rejected"));
  await m.press.get("Decline call")!.run();
  expect(m.alert).toHaveBeenCalledWith("Could not end call", expect.any(String));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(persistentRender()).toContain("The call has not connected.");
  expect(m.press.get("End call")!.disabled).toBe(false);
  expect(m.press.get("Answer call")!.disabled).toBe(true);
});

it("never arms an old Answer's deadline after the owner and reused call ID change", async () => {
  let finish!: () => void;
  m.answer.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  m.state.incomingCall.history = { id: "old-call" };
  persistentRender();
  const old = m.press.get("Answer call")!.run();
  m.owner = { id: 1 };
  m.state.incomingCall = { ...m.state.incomingCall, history: { id: "new-call" } };
  persistentRender();
  await m.press.get("Answer call")!.run();
  expect(vi.getTimerCount()).toBe(1);
  finish(); await old;
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(persistentRender()).toContain("The call has not connected.");
  expect(m.hangup).not.toHaveBeenCalled();
});

it("keeps a replacement call's End pending when an old End request rejects late", async () => {
  let failOld!: (error: Error) => void;
  m.hangup.mockImplementationOnce(() => new Promise<void>((_, reject) => { failOld = reject; }));
  m.state.incomingCall.history = { id: "old-call" };
  persistentRender();
  const old = m.press.get("Decline call")!.run();
  m.state.incomingCall = { ...m.state.incomingCall, history: { id: "replacement" } };
  persistentRender(); persistentRender();
  expect(m.press.get("Decline call")!.disabled).toBe(false);
  await m.press.get("Decline call")!.run();
  failOld(new Error("old SDK failure")); await old;
  expect(persistentRender()).toContain("Ending…");
  expect(m.press.get("End call")!.disabled).toBe(true);
  expect(m.alert).not.toHaveBeenCalled();
});
