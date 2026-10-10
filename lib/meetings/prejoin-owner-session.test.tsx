import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
import ConferenceScreen from "../../app/conference/index";
import type { MeetingJoinPreferences } from "../../components/meetings/meeting-prejoin";
import { MeetingJoinFailure } from "./join-failure";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const state = vi.hoisted(() => ({
  platform: "web" as "web" | "ios" | "android",
  source: "direct" as "direct" | "channel",
  renderedOwner: { id: 3001, name: "Pilot" },
  currentOwner: null as { id: number; name: string } | null,
  onJoin: undefined as ((preferences: MeetingJoinPreferences) => Promise<void>) | undefined,
  onBack: undefined as (() => void) | undefined,
  routeCleanups: [] as (() => void)[],
  focusSetup: undefined as (() => void | (() => void)) | undefined,
  focusCleanup: undefined as (() => void) | undefined,
  admit: vi.fn(),
  webJoin: vi.fn(),
  nativeJoin: vi.fn(),
  leave: vi.fn(async () => undefined),
  push: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: (setup: () => void | (() => void)) => {
    const cleanup = setup();
    if (cleanup) state.routeCleanups.push(cleanup);
  },
}));
vi.mock("react-native", () => ({
  Platform: { get OS() { return state.platform; } },
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  Pressable: ({ children }: { children: ReactNode }) => createElement("button", null, children),
}));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "#05f" }) }));
vi.mock("expo-router", () => ({
  router: { push: state.push, back: vi.fn(), replace: vi.fn(), canGoBack: () => false },
  useLocalSearchParams: () => ({ meetingId: "admitted-id", tenantId: "1", source: state.source }),
  useFocusEffect: (setup: () => void | (() => void)) => {
    state.focusSetup = setup;
    const cleanup = setup();
    state.focusCleanup = cleanup || undefined;
    if (cleanup) state.routeCleanups.push(cleanup);
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.renderedOwner }) }));
vi.mock("@/lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: state.currentOwner }) }));
vi.mock("@/lib/chat/store", () => ({
  useChatStore: Object.assign((selector: (value: unknown) => unknown) => selector({
    userId: 3001, workspace: { id: 1 },
  }), { getState: () => ({ userId: 3001, workspace: { id: 1 } }) }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { meetings: {
    join: { useMutation: () => ({ mutateAsync: state.admit }) },
    capabilities: { useQuery: () => ({ data: { available: true }, isLoading: false, isFetching: false }) },
    available: { useQuery: () => ({ data: [], isLoading: false, isFetching: false }) },
    availableForTenant: { useQuery: () => ({ data: [], isLoading: false, isFetching: false }) },
    availableMeetingForTenant: { useQuery: () => ({
      data: { meetingId: "admitted-id", tenantId: 1 }, isLoading: false, isFetching: false,
    }) },
  } },
}));
vi.mock("@/components/meetings/meeting-prejoin", () => ({
  MeetingPrejoin: ({ onJoin, onBack }: { onJoin?: typeof state.onJoin; onBack: () => void }) => {
    state.onJoin = onJoin;
    state.onBack = onBack;
    return createElement("div", null, "Meeting prejoin");
  },
}));
vi.mock("@/components/screen-container", () => ({
  ScreenContainer: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/lib/meetings/web-session", () => ({ WebMeetingLifecycle: { join: state.webJoin } }));
vi.mock("@/lib/meetings/native-session", () => ({ NativeMeetingLifecycle: { join: state.nativeJoin } }));
vi.mock("@/lib/sip/call-store", () => ({
  useSipCallStore: { getState: () => ({ incomingCall: null, activeCalls: {} }) },
}));

const preferences: MeetingJoinPreferences = {
  meetingCode: "admitted-id", microphoneEnabled: false, cameraEnabled: false,
};
const admission = { url: "wss://admitted.invalid", token: "admitted-token" };
const contexts = [
  ["web", "direct"], ["ios", "direct"], ["android", "direct"],
  ["web", "channel"], ["ios", "channel"], ["android", "channel"],
] as const;
function renderJoin() {
  renderToStaticMarkup(createElement(ConferenceScreen));
  expect(state.onJoin).toBeTypeOf("function");
  return state.onJoin!;
}
function replaceSameAccountSession() {
  // Auth preserves this reference for ordinary profile refreshes, but a real
  // login is a new owner object even when its numeric account ID is unchanged.
  state.currentOwner = { ...state.renderedOwner };
}
beforeEach(() => {
  state.platform = "web";
  state.source = "direct";
  state.renderedOwner = { id: 3001, name: "Pilot" };
  state.currentOwner = state.renderedOwner;
  state.routeCleanups = [];
  state.focusSetup = undefined;
  state.focusCleanup = undefined;
  state.onJoin = undefined;
  state.onBack = undefined;
  state.admit.mockReset().mockResolvedValue(admission);
  state.leave.mockReset().mockResolvedValue(undefined);
  state.webJoin.mockReset().mockResolvedValue({ leave: state.leave });
  state.nativeJoin.mockReset().mockResolvedValue({ leave: state.leave });
  state.push.mockClear();
});

it.each(contexts)("denies a retained %s %s invitation callback after the same account signs in again", async (platform, source) => {
  state.platform = platform; state.source = source;
  const join = renderJoin();
  replaceSameAccountSession();
  await expect(join(preferences)).rejects.toMatchObject({ stage: "admission" });
  expect(state.admit).not.toHaveBeenCalled();
  expect(state.webJoin).not.toHaveBeenCalled();
  expect(state.nativeJoin).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});

it.each(contexts)("discards a pending %s %s admission after same-account session replacement", async (platform, source) => {
  state.platform = platform; state.source = source;
  let resolveAdmission!: (value: typeof admission) => void;
  state.admit.mockReturnValueOnce(new Promise(resolve => { resolveAdmission = resolve; }));
  const pending = renderJoin()(preferences);
  await vi.waitFor(() => expect(state.admit).toHaveBeenCalledOnce());
  replaceSameAccountSession(); resolveAdmission(admission);
  await expect(pending).rejects.toMatchObject({ stage: "admission" });
  expect(state.webJoin).not.toHaveBeenCalled();
  expect(state.nativeJoin).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});

it.each(contexts)("stops a late %s %s room before navigation under a replacement session", async (platform, source) => {
  state.platform = platform; state.source = source;
  let finishConnection!: (value: { leave: typeof state.leave }) => void;
  const connect = platform === "web" ? state.webJoin : state.nativeJoin;
  connect.mockReturnValueOnce(new Promise(resolve => { finishConnection = resolve; }));
  const pending = renderJoin()(preferences);
  await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
  replaceSameAccountSession(); finishConnection({ leave: state.leave });
  await expect(pending).rejects.toMatchObject({ stage: "post_connect_guard" });
  expect(state.leave).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});

it.each(contexts)("allows a current %s %s invitation after an ordinary profile refresh", async (platform, source) => {
  state.platform = platform; state.source = source;
  const join = renderJoin();
  state.currentOwner!.name = "Updated profile";
  await join(preferences);
  expect(state.admit).toHaveBeenCalledOnce();
  expect(platform === "web" ? state.webJoin : state.nativeJoin).toHaveBeenCalledOnce();
  expect(state.leave).not.toHaveBeenCalled();
  expect(state.push).toHaveBeenCalledWith("/conference/room");
});

it("requires a fresh prejoin attempt and fresh admission to retry after session replacement", async () => {
  const retiredJoin = renderJoin();
  state.admit.mockRejectedValueOnce(new MeetingJoinFailure("admission"));
  await expect(retiredJoin(preferences)).rejects.toMatchObject({ stage: "admission" });
  replaceSameAccountSession();
  await expect(retiredJoin(preferences)).rejects.toMatchObject({ stage: "admission" });
  expect(state.admit).toHaveBeenCalledOnce();
  state.renderedOwner = state.currentOwner!;
  const freshAdmission = { ...admission, token: "fresh-admission" };
  state.admit.mockResolvedValueOnce(freshAdmission);
  await renderJoin()(preferences);
  expect(state.admit).toHaveBeenCalledTimes(2);
  expect(state.webJoin).toHaveBeenCalledWith(3001, "admitted-id", freshAdmission, {
    microphone: false, camera: false,
  });
  expect(state.push).toHaveBeenCalledOnce();
});

it("preserves a failed late-room teardown instead of navigating the new session", async () => {
  let finishConnection!: (value: { leave: typeof state.leave }) => void;
  state.webJoin.mockReturnValueOnce(new Promise(resolve => { finishConnection = resolve; }));
  const pending = renderJoin()(preferences);
  await vi.waitFor(() => expect(state.webJoin).toHaveBeenCalledOnce());
  replaceSameAccountSession();
  state.leave.mockRejectedValueOnce(new Error("private teardown failure"));
  finishConnection({ leave: state.leave });
  await expect(pending).rejects.toMatchObject({ stage: "room_cleanup" });
  expect(state.leave).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});

it.each(["back", "unmount"] as const)("discards admission after leaving prejoin through %s", async exit => {
  let resolveAdmission!: (value: typeof admission) => void;
  state.admit.mockReturnValueOnce(new Promise(resolve => { resolveAdmission = resolve; }));
  const pending = renderJoin()(preferences);
  await vi.waitFor(() => expect(state.admit).toHaveBeenCalledOnce());
  if (exit === "back") state.onBack!();
  else state.routeCleanups.forEach(cleanup => cleanup());
  resolveAdmission(admission);
  await expect(pending).rejects.toMatchObject({ stage: "post_connect_guard" });
  expect(state.webJoin).not.toHaveBeenCalled();
  expect(state.nativeJoin).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});

it("leaves a late connection once when prejoin navigation has already been cancelled", async () => {
  let finishConnection!: (value: { leave: typeof state.leave }) => void;
  state.webJoin.mockReturnValueOnce(new Promise(resolve => { finishConnection = resolve; }));
  const pending = renderJoin()(preferences);
  await vi.waitFor(() => expect(state.webJoin).toHaveBeenCalledOnce());
  state.onBack!();
  finishConnection({ leave: state.leave });
  await expect(pending).rejects.toMatchObject({ stage: "post_connect_guard" });
  expect(state.leave).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});

it.each(contexts)("retires pending %s %s admission on blur even after the route refocuses", async (platform, source) => {
  state.platform = platform; state.source = source;
  let resolveAdmission!: (value: typeof admission) => void;
  state.admit.mockReturnValueOnce(new Promise(resolve => { resolveAdmission = resolve; }));
  const join = renderJoin();
  const pending = join(preferences);
  await vi.waitFor(() => expect(state.admit).toHaveBeenCalledOnce());
  state.focusCleanup?.();
  state.focusSetup?.();
  resolveAdmission(admission);
  await expect(pending).rejects.toMatchObject({ stage: "post_connect_guard" });
  expect(state.webJoin).not.toHaveBeenCalled();
  expect(state.nativeJoin).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  await join(preferences);
  expect(state.admit).toHaveBeenCalledTimes(2);
  expect(platform === "web" ? state.webJoin : state.nativeJoin).toHaveBeenCalledOnce();
  expect(state.push).toHaveBeenCalledOnce();
});

it.each(contexts)("stops a late %s %s connection from a retired focus lifetime", async (platform, source) => {
  state.platform = platform; state.source = source;
  let finishConnection!: (value: { leave: typeof state.leave }) => void;
  const connect = platform === "web" ? state.webJoin : state.nativeJoin;
  connect.mockReturnValueOnce(new Promise(resolve => { finishConnection = resolve; }));
  const pending = renderJoin()(preferences);
  await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
  state.focusCleanup?.();
  state.focusSetup?.();
  finishConnection({ leave: state.leave });
  await expect(pending).rejects.toMatchObject({ stage: "post_connect_guard" });
  expect(state.leave).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});
