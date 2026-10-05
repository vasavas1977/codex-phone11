import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
import ConferenceScreen from "../app/conference/index";
import type { MeetingJoinPreferences } from "../components/meetings/meeting-prejoin";
import { MeetingJoinFailure, meetingJoinFailureReference } from "../lib/meetings/join-failure";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

const state = vi.hoisted(() => ({
  platform: "web" as "web" | "ios",
  user: { id: 3001, name: "Pilot" },
  currentUserId: 3001,
  params: { meetingId: "admitted-id" } as { meetingId: string; tenantId?: string; source?: string },
  chatOwnerId: 3001,
  workspaceId: 1,
  generalMeetingsError: false,
  exactMeeting: { meetingId: "admitted-id", tenantId: 1 } as { meetingId: string; tenantId: number } | null,
  onJoin: undefined as ((preferences: MeetingJoinPreferences) => Promise<void>) | undefined,
  onBack: undefined as (() => void) | undefined,
  resolveAdmission: undefined as ((admission: { url: string; token: string }) => void) | undefined,
  admit: vi.fn(),
  completedMeeting: { leave: vi.fn(async () => undefined) },
  webJoin: vi.fn(async () => ({ leave: vi.fn(async () => undefined) })),
  nativeJoin: vi.fn(async () => ({ leave: vi.fn(async () => undefined) })),
  push: vi.fn(),
  createButton: null as any,
  capabilitiesAvailable: true,
  availableRooms: [{ meetingId: "admitted-id" }],
  tenantRooms: [] as { meetingId: string; tenantId: number; title?: string }[],
  prejoinProps: null as any,
  sipState: { incomingCall: null, activeCalls: {} } as { incomingCall: { status: string } | null; activeCalls: Record<string, { status: string }> },
  routeCleanups: [] as (() => void)[],
}));

// Static rendering does not run effects. Capture this route's lifecycle cleanup
// so the same harness can exercise removal by gestures or external navigation.
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (setup: () => void | (() => void)) => {
    const cleanup = setup();
    if (cleanup) state.routeCleanups.push(cleanup);
  },
}));

vi.mock("react-native", () => ({
  Platform: { get OS() { return state.platform; } },
  Text: ({ children }: any) => createElement("span", null, children),
  Pressable: (props: any) => { state.createButton = props; return createElement("button", null, props.children); },
}));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "#05f" }) }));
vi.mock("expo-router", () => ({
  router: { push: state.push, back: vi.fn(), replace: vi.fn(), canGoBack: () => false },
  useLocalSearchParams: () => state.params,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: state.user }),
}));
vi.mock("@/lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: state.currentUserId === 3001 ? state.user : { id: state.currentUserId } }),
}));
vi.mock("@/lib/chat/store", () => ({
  useChatStore: Object.assign((selector: (value: unknown) => unknown) => selector({
    userId: state.chatOwnerId, workspace: { id: state.workspaceId },
  }), { getState: () => ({ userId: state.chatOwnerId, workspace: { id: state.workspaceId } }) }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { meetings: {
    join: { useMutation: () => ({ mutateAsync: state.admit }) },
    capabilities: { useQuery: () => ({ data: { available: state.capabilitiesAvailable }, isLoading: false, isFetching: false }) },
    available: { useQuery: () => ({ data: state.availableRooms, isLoading: false, isFetching: false,
      error: state.generalMeetingsError ? new Error("Global list unavailable") : null }) },
    availableForTenant: { useQuery: () => ({ data: state.tenantRooms, isLoading: false, isFetching: false }) },
    availableMeetingForTenant: { useQuery: () => ({ data: state.exactMeeting, isLoading: false, isFetching: false }) },
  } },
}));
vi.mock("@/components/meetings/meeting-prejoin", () => ({
  MeetingPrejoin: (props: any) => {
    const { onJoin, onBack } = props;
    state.prejoinProps = props;
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
  useSipCallStore: { getState: () => state.sipState },
}));

beforeEach(() => {
  state.platform = "web";
  state.currentUserId = 3001;
  state.params = { meetingId: "admitted-id" };
  state.chatOwnerId = 3001;
  state.workspaceId = 1;
  state.generalMeetingsError = false;
  state.exactMeeting = { meetingId: "admitted-id", tenantId: 1 };
  state.onJoin = undefined;
  state.onBack = undefined;
  state.resolveAdmission = undefined;
  state.admit.mockReset();
  state.completedMeeting.leave.mockClear();
  state.webJoin.mockReset().mockResolvedValue(state.completedMeeting);
  state.nativeJoin.mockReset().mockResolvedValue(state.completedMeeting);
  state.push.mockClear();
  state.createButton = null;
  state.capabilitiesAvailable = true;
  state.availableRooms = [{ meetingId: "admitted-id" }];
  state.tenantRooms = [];
  state.prejoinProps = null;
  state.sipState = { incomingCall: null, activeCalls: {} };
  state.routeCleanups = [];
  const admission = new Promise<{ url: string; token: string }>(resolve => {
    state.resolveAdmission = resolve;
  });
  state.admit.mockReturnValue(admission);
});

const preferences: MeetingJoinPreferences = {
  meetingCode: "admitted-id",
  microphoneEnabled: false,
  cameraEnabled: false,
};

const cancelledRoutes = [
  ["web", "Back"], ["ios", "Back"],
  ["web", "unmount"], ["ios", "unmount"],
] as const;
const cancelRoute = (action: "Back" | "unmount") => {
  if (action === "Back") state.onBack!();
  else state.routeCleanups.forEach(cleanup => cleanup());
};

it.each(cancelledRoutes)("cancels %s joining before media starts on %s during admission", async (platform, action) => {
  state.platform = platform;
  renderToStaticMarkup(createElement(ConferenceScreen));
  const pendingJoin = state.onJoin!(preferences);
  await vi.waitFor(() => expect(state.admit).toHaveBeenCalledOnce());
  cancelRoute(action);
  state.resolveAdmission!({ url: "wss://tenant-a.invalid", token: "tenant-a-token" });
  await expect(pendingJoin).rejects.toMatchObject({ name: "MeetingJoinFailure", stage: "post_connect_guard" });
  expect(state.webJoin).not.toHaveBeenCalled();
  expect(state.nativeJoin).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});

it.each(cancelledRoutes)("stops a late %s connection without returning to the meeting after %s", async (platform, action) => {
  state.platform = platform;
  renderToStaticMarkup(createElement(ConferenceScreen));
  state.admit.mockResolvedValueOnce({ url: "wss://tenant-a.invalid", token: "tenant-a-token" });
  let finishConnection!: (meeting: typeof state.completedMeeting) => void;
  const connecting = new Promise<typeof state.completedMeeting>(resolve => { finishConnection = resolve; });
  const join = platform === "web" ? state.webJoin : state.nativeJoin;
  join.mockReturnValueOnce(connecting);
  const pendingJoin = state.onJoin!(preferences);
  await vi.waitFor(() => expect(join).toHaveBeenCalledOnce());
  cancelRoute(action);
  finishConnection(state.completedMeeting);
  await expect(pendingJoin).rejects.toMatchObject({ name: "MeetingJoinFailure", stage: "post_connect_guard" });
  expect(state.completedMeeting.leave).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});

it("preserves failed cancellation cleanup for the lifecycle to retry", async () => {
  renderToStaticMarkup(createElement(ConferenceScreen));
  state.admit.mockResolvedValueOnce({ url: "wss://tenant-a.invalid", token: "tenant-a-token" });
  let finishConnection!: (meeting: typeof state.completedMeeting) => void;
  state.webJoin.mockReturnValueOnce(new Promise(resolve => { finishConnection = resolve; }));
  state.completedMeeting.leave.mockRejectedValueOnce(new Error("temporary private teardown failure"));
  const pendingJoin = state.onJoin!(preferences);
  await vi.waitFor(() => expect(state.webJoin).toHaveBeenCalledOnce());
  state.onBack!();
  finishConnection(state.completedMeeting);
  await expect(pendingJoin).rejects.toMatchObject({ name: "MeetingJoinFailure", stage: "room_cleanup" });
  expect(state.completedMeeting.leave).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});

it.each(["web", "ios"] as const)("rejects %s join when the account changes while admission is pending", async platform => {
  state.platform = platform;
  renderToStaticMarkup(createElement(ConferenceScreen));
  const pendingJoin = state.onJoin!(preferences);
  await vi.waitFor(() => expect(state.admit).toHaveBeenCalledOnce());
  state.currentUserId = 3002;
  state.resolveAdmission!({ url: "wss://tenant-a.invalid", token: "tenant-a-token" });

  await expect(pendingJoin).rejects.toMatchObject({ name: "MeetingJoinFailure", stage: "admission" });
  expect(state.webJoin).not.toHaveBeenCalled();
  expect(state.nativeJoin).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});

it("passes the initiating account into the web lifecycle after admission", async () => {
  renderToStaticMarkup(createElement(ConferenceScreen));
  const pendingJoin = state.onJoin!(preferences);
  await vi.waitFor(() => expect(state.admit).toHaveBeenCalledOnce());
  const admission = { url: "wss://tenant-a.invalid", token: "tenant-a-token" };
  state.resolveAdmission!(admission);
  await pendingJoin;
  expect(state.webJoin).toHaveBeenCalledWith(3001, "admitted-id", admission, {
    microphone: false,
    camera: false,
  });
  expect(state.push).toHaveBeenCalledWith("/conference/room");
});

it("opens a direct invitation from exact admission even if the general list fails", () => {
  state.params = { meetingId: "admitted-id", tenantId: "1", source: "direct" };
  state.generalMeetingsError = true;
  renderToStaticMarkup(createElement(ConferenceScreen));
  expect(state.onJoin).toBeTypeOf("function");
  expect(state.prejoinProps.initialMeetingCode).toBe("admitted-id");
  expect(state.prejoinProps.admittedMeetings).toEqual([{ meetingId: "admitted-id", title: undefined }]);
  expect(state.prejoinProps.onOpenInvitations).toBeUndefined();
});

it("preserves the safe title for the exact admitted channel invitation", () => {
  state.params = { meetingId: "admitted-id", tenantId: "1", source: "channel" };
  state.tenantRooms = [{ meetingId: "admitted-id", tenantId: 1, title: "Planning team" }];
  renderToStaticMarkup(createElement(ConferenceScreen));
  expect(state.prejoinProps.admittedMeetings).toEqual([{ meetingId: "admitted-id", title: "Planning team" }]);
  expect(state.prejoinProps.initialMeetingCode).toBe("admitted-id");
  expect(state.prejoinProps.onOpenInvitations).toBeUndefined();
});

it("routes ordinary multiple-room entry to existing Team Chat invitations without choosing a first room", () => {
  state.params = { meetingId: "" };
  state.availableRooms = [{ meetingId: "first-opaque-id" }, { meetingId: "second-opaque-id" }];
  renderToStaticMarkup(createElement(ConferenceScreen));
  expect(state.prejoinProps.initialMeetingCode).toBe("");
  expect(state.prejoinProps.admittedMeetings).toEqual(state.availableRooms);
  state.prejoinProps.onOpenInvitations();
  expect(state.push).toHaveBeenCalledWith("/(tabs)/teamchat");
  expect(state.admit).not.toHaveBeenCalled();
  state.push.mockClear(); state.currentUserId = 3002;
  state.prejoinProps.onOpenInvitations(); expect(state.push).not.toHaveBeenCalled();
});

it("keeps ordinary entry unavailable when there are no admitted rooms", () => {
  state.params = { meetingId: "" }; state.availableRooms = [];
  renderToStaticMarkup(createElement(ConferenceScreen));
  expect(state.onJoin).toBeUndefined();
  expect(state.prejoinProps.unavailableReason).toBe("There are no admitted meetings for this account.");
});

it.each(["incoming", "active"])("preserves actionable typed %s Phone-call refusal and requests fresh admission after the call ends", async kind => {
  state.platform = "ios";
  if (kind === "incoming") state.sipState.incomingCall = { status: "ringing" };
  else state.sipState.activeCalls.call = { status: "connected" };
  renderToStaticMarkup(createElement(ConferenceScreen));
  const failure = await state.onJoin!(preferences).catch(error => error);
  expect(failure).toMatchObject({ stage: "audio_start", reason: "phone_call_active" });
  expect(failure).not.toHaveProperty("cause");
  expect(state.admit).not.toHaveBeenCalled(); expect(state.nativeJoin).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  state.sipState = { incomingCall: null, activeCalls: {} };
  state.admit.mockResolvedValueOnce({ url: "wss://fresh.invalid", token: "fresh-token" });
  await state.onJoin!(preferences);
  expect(state.admit).toHaveBeenCalledOnce(); expect(state.nativeJoin).toHaveBeenCalledOnce();
  expect(state.push).toHaveBeenCalledWith("/conference/room");
});

it("does not open a direct invitation from another selected workspace", () => {
  state.params = { meetingId: "admitted-id", tenantId: "2", source: "direct" };
  renderToStaticMarkup(createElement(ConferenceScreen));
  expect(state.onJoin).toBeUndefined();
});

it.each([false, true])("offers the channel creation picker with no admitted room when joining capability is %s", available => {
  state.capabilitiesAvailable = available;
  state.availableRooms = [];
  renderToStaticMarkup(createElement(ConferenceScreen));
  expect(state.createButton.accessibilityLabel).toBe("New meeting");
  state.createButton.onPress();
  expect(state.push).toHaveBeenCalledWith("/conference/create");
  expect(state.onJoin).toBeUndefined();
  expect(state.admit).not.toHaveBeenCalled();
  expect(state.webJoin).not.toHaveBeenCalled();
  expect(state.nativeJoin).not.toHaveBeenCalled();
});

it.each(["session", "workspace"])(
  "drops a stale creation tap after %s change",
  (change) => {
    renderToStaticMarkup(createElement(ConferenceScreen));
    if (change === "session") state.currentUserId = 3002;
    else state.workspaceId = 2;
    state.createButton.onPress();
    expect(state.push).not.toHaveBeenCalled();
  },
);

it("keeps an exact conversation invitation focused on joining its named room", () => {
  state.params = { meetingId: "admitted-id", tenantId: "1", source: "channel" };
  renderToStaticMarkup(createElement(ConferenceScreen));
  expect(state.createButton).toBeNull();
  expect(state.onJoin).toBeTypeOf("function");
});

it.each(["web", "ios"] as const)("classifies rejected %s admission without loading a room", async platform => {
  state.platform = platform;
  renderToStaticMarkup(createElement(ConferenceScreen));
  state.admit.mockRejectedValueOnce({ data: { code: "FORBIDDEN", httpStatus: 403 }, message: "private-token" });
  const failure = await state.onJoin!(preferences).catch(error => error);
  expect(meetingJoinFailureReference(failure)).toBe("admission / forbidden / 403");
  expect(failure).not.toHaveProperty("cause");
  expect(state.nativeJoin).not.toHaveBeenCalled(); expect(state.webJoin).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});

it.each([
  ["UNAUTHORIZED", 401, "unauthorized"], ["NOT_FOUND", 404, "not_found"],
  ["PRECONDITION_FAILED", 412, "unavailable"], ["TIMEOUT", 408, "timeout"],
])("preserves safe %s admission labels on native join", async (code, httpStatus, reason) => {
  state.platform = "ios"; renderToStaticMarkup(createElement(ConferenceScreen));
  state.admit.mockRejectedValueOnce({ data: { code, httpStatus } });
  const failure = await state.onJoin!(preferences).catch(error => error);
  expect(meetingJoinFailureReference(failure)).toBe(`admission / ${reason} / ${httpStatus}`);
  expect(state.nativeJoin).not.toHaveBeenCalled(); expect(state.push).not.toHaveBeenCalled();
});

it("labels an unclassified native preamble error after successful admission as native setup", async () => {
  state.platform = "ios"; renderToStaticMarkup(createElement(ConferenceScreen));
  state.admit.mockResolvedValueOnce({ url: "wss://private.invalid", token: "private-token" });
  state.nativeJoin.mockRejectedValueOnce(new Error("private SIP/lease details"));
  const failure = await state.onJoin!(preferences).catch(error => error);
  expect(meetingJoinFailureReference(failure)).toBe("native_setup");
  expect(JSON.stringify(failure)).not.toContain("private"); expect(failure).not.toHaveProperty("cause");
  expect(state.push).not.toHaveBeenCalled();
});

it("keeps malformed successful admission failures out of the request stage", async () => {
  state.platform = "ios"; renderToStaticMarkup(createElement(ConferenceScreen));
  state.admit.mockResolvedValueOnce(null);
  state.nativeJoin.mockRejectedValueOnce(new TypeError("Cannot read grant_profile of null"));
  const failure = await state.onJoin!(preferences).catch(error => error);
  expect(meetingJoinFailureReference(failure)).toBe("native_setup");
  expect(state.nativeJoin).toHaveBeenCalledWith("admitted-id", null, { microphone: false, camera: false });
  expect(state.push).not.toHaveBeenCalled();
});

it("preserves a classified native SDK stage after admission", async () => {
  state.platform = "ios"; renderToStaticMarkup(createElement(ConferenceScreen));
  state.admit.mockResolvedValueOnce({ url: "wss://private.invalid", token: "private-token" });
  state.nativeJoin.mockRejectedValueOnce(new MeetingJoinFailure("signal_connect", { reason: "not_allowed", httpStatus: 401 }));
  const failure = await state.onJoin!(preferences).catch(error => error);
  expect(meetingJoinFailureReference(failure)).toBe("signal_connect / not_allowed / 401");
  expect(state.push).not.toHaveBeenCalled();
});
