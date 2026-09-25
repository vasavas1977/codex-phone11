import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
import ConferenceScreen from "../app/conference/index";
import type { MeetingJoinPreferences } from "../components/meetings/meeting-prejoin";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

const state = vi.hoisted(() => ({
  platform: "web" as "web" | "ios",
  currentUserId: 3001,
  onJoin: undefined as ((preferences: MeetingJoinPreferences) => Promise<void>) | undefined,
  resolveAdmission: undefined as ((admission: { url: string; token: string }) => void) | undefined,
  admit: vi.fn(),
  webJoin: vi.fn(async () => undefined),
  nativeJoin: vi.fn(async () => undefined),
  push: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { get OS() { return state.platform; } } }));
vi.mock("expo-router", () => ({
  router: { push: state.push, back: vi.fn(), replace: vi.fn(), canGoBack: () => false },
  useLocalSearchParams: () => ({ meetingId: "admitted-id" }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 3001, name: "Pilot" } }),
}));
vi.mock("@/lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: { id: state.currentUserId } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { meetings: {
    join: { useMutation: () => ({ mutateAsync: state.admit }) },
    capabilities: { useQuery: () => ({ data: { available: true }, isLoading: false, isFetching: false }) },
    available: { useQuery: () => ({ data: [{ meetingId: "admitted-id" }], isLoading: false, isFetching: false }) },
  } },
}));
vi.mock("@/components/meetings/meeting-prejoin", () => ({
  MeetingPrejoin: ({ onJoin }: { onJoin?: typeof state.onJoin }) => {
    state.onJoin = onJoin;
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

beforeEach(() => {
  state.platform = "web";
  state.currentUserId = 3001;
  state.onJoin = undefined;
  state.resolveAdmission = undefined;
  state.admit.mockReset();
  state.webJoin.mockClear();
  state.nativeJoin.mockClear();
  state.push.mockClear();
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
