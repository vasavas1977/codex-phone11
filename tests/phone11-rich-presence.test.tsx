import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const m = vi.hoisted(() => ({ appState: "active", owner: { id: 1 } as { id: number } | null }));
function element({ children, accessibilityLabel }: any) { return createElement("div", { "aria-label": accessibilityLabel }, children); }
vi.mock("react-native", () => ({
  AppState: { get currentState() { return m.appState; }, addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  View: element, Text: element, StyleSheet: { create: (value: any) => value, hairlineWidth: 1 },
  Platform: { OS: "ios" },
}));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.owner, loading: false }), addAuthChangeListener: vi.fn(() => () => {}) }));
vi.mock("../lib/chat/transport", () => ({ createChatTransport: () => ({
  presenceCapability: vi.fn(async () => ({ version: 2 })), presence: vi.fn(async () => []), heartbeat: vi.fn(async () => ({})),
}) }));
vi.mock("../lib/chat/store", () => ({ useChatStore: Object.assign(() => null, { getState: () => ({}) }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ muted: "gray" }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.owner }) }));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: ({ name }: any) => createElement("i", null, name) }));

import { PresenceIndicator } from "../components/chat/presence-indicator";
import { createPresencePublisherController, localPresenceStatus, presenceLabel, useChatPresenceStore } from "../lib/chat/presence";
import { startForegroundPresencePolling } from "../lib/chat/presence-store";
import { useSipCallStore } from "../lib/sip/call-store";
import { clearActiveNativeMeeting, setActiveNativeMeeting } from "../lib/meetings/native-session-registry";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };

function meeting(status: "connecting" | "connected" | "reconnecting" | "disconnected") {
  const listeners = new Set<() => void>();
  const session = {
    getSnapshot: () => ({ status, participants: [], error: null }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { ownerId: 1, session, room: undefined, receiveOnly: false, wasInterruptedBySip: false, leave: vi.fn(async () => {}) } as any;
}

beforeEach(() => {
  m.appState = "active"; m.owner = { id: 1 };
  useSipCallStore.setState({ activeCalls: {}, incomingCall: null });
});
afterEach(() => {
  const active = meeting("disconnected");
  clearActiveNativeMeeting(active);
});

describe("truthful local presence lifecycle", () => {
  it("uses app activity until an actual connected meeting exists", () => {
    expect(localPresenceStatus(1)).toBe("available");
    m.appState = "background"; expect(localPresenceStatus(1)).toBe("away");
    const prejoin = meeting("connecting"); setActiveNativeMeeting(prejoin);
    expect(localPresenceStatus(1)).toBe("away");
    clearActiveNativeMeeting(prejoin);
    const connected = meeting("connected"); setActiveNativeMeeting(connected);
    expect(localPresenceStatus(1)).toBe("in_meeting");
    clearActiveNativeMeeting(connected);
  });

  it("gives a real SIP call priority over a simultaneous meeting and clears on termination", () => {
    const connected = meeting("reconnecting"); setActiveNativeMeeting(connected);
    useSipCallStore.setState({ activeCalls: { call: { id: "call", status: "active", history: { ownerUserId: 1 } } as any } });
    expect(localPresenceStatus(1)).toBe("on_call");
    useSipCallStore.setState({ activeCalls: {} });
    expect(localPresenceStatus(1)).toBe("in_meeting");
    clearActiveNativeMeeting(connected);
  });

  it("ignores a stale prior-owner call", () => {
    useSipCallStore.setState({ activeCalls: { call: { id: "call", status: "active", history: { ownerUserId: 99 } } as any } });
    expect(localPresenceStatus(1)).toBe("available");
  });
});

it("binds cached rows to one owner, merges independent pollers, and expires failed requests to unknown", () => {
  const store = useChatPresenceStore.getState();
  store.setOwner(1);
  store.merge(1, 10, [2], [{ userId: 2, status: "available", available: true, lastSeenAt: 1 }]);
  store.merge(1, 10, [3], [{ userId: 3, status: "away", available: true, lastSeenAt: 2 }]);
  expect(Object.keys(useChatPresenceStore.getState().byWorkspace[10])).toEqual(["2", "3"]);
  store.fail(1, 10, [2]);
  expect(useChatPresenceStore.getState().byWorkspace[10][2]).toBeUndefined();
  expect(useChatPresenceStore.getState().byWorkspace[10][3]?.status).toBe("away");
  store.setOwner(7);
  expect(useChatPresenceStore.getState().byWorkspace).toEqual({});
  store.merge(1, 10, [2], [{ userId: 2, status: "on_call", available: true, lastSeenAt: 3 }]);
  expect(useChatPresenceStore.getState().byWorkspace).toEqual({});
});

it("pauses polling in background and refreshes immediately on foreground resume", () => {
  vi.useFakeTimers();
  const refresh = vi.fn(), listeners = new Set<(state: string) => void>();
  const activity = { currentState: "background", addEventListener: (_event: "change", listener: (state: any) => void) => {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  } } as any;
  const stop = startForegroundPresencePolling(refresh, activity);
  vi.advanceTimersByTime(10_000); expect(refresh).not.toHaveBeenCalled();
  activity.currentState = "active"; listeners.forEach(listener => listener("active"));
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5_000); expect(refresh).toHaveBeenCalledTimes(2);
  stop(); vi.useRealTimers();
});

it("coalesces a hung publication to the newest state and then publishes cleanup", async () => {
  let status: any = "available", sequence = 0, release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const sent: any[] = [];
  const controller = createPresencePublisherController({
    getStatus: () => status, nextSequence: () => ++sequence, canSend: async () => true,
    send: vi.fn(async value => { sent.push(value); if (sent.length === 1) await first; }),
  });
  controller.publish(true, true); await Promise.resolve();
  status = "on_call"; controller.publish(); status = "in_meeting"; controller.publish();
  expect(sent).toEqual([{ sequence: 1, status: "available", active: true }]);
  release(); await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toEqual({ sequence: 3, status: "in_meeting", active: true });
  controller.stop(); await vi.waitFor(() => expect(sent).toHaveLength(3));
  expect(sent[2]).toEqual({ sequence: 4, status: "in_meeting", active: false });
});

it("suppresses a publication after its captured auth or workspace boundary changes", async () => {
  let current = true;
  const send = vi.fn(async () => {});
  const controller = createPresencePublisherController({
    getStatus: () => "on_call", nextSequence: () => 1, canSend: async () => current, send,
  });
  current = false; controller.publish(true, true); await Promise.resolve(); await Promise.resolve();
  expect(send).not.toHaveBeenCalled();
});

it("renders all five public labels plus an explicit unknown state", () => {
  const statuses = ["available", "away", "offline", "on_call", "in_meeting", null] as const;
  const html = renderToStaticMarkup(createElement("main", null,
    ...statuses.map((status, index) => createElement(PresenceIndicator, { key: index, status }))));
  for (const label of ["Available", "Away", "Offline", "On a call", "In a meeting", "Status unavailable"])
    expect(html).toContain(label);
  expect(presenceLabel(undefined)).toBe("Status unavailable");
});
