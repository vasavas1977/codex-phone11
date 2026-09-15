import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
vi.mock("../components/cloud-recordings/call-actions-sheet", () => ({
  CallActionsSheet: () => null,
}));
vi.mock("../hooks/use-hidden-calls", () => ({
  useHiddenCalls: () => ({
    ids: [],
    ready: true,
    hide: vi.fn(),
    restoreAll: vi.fn(),
  }),
}));
vi.mock("../hooks/use-call-favorites", () => ({
  useCallFavorites: () => ({ starred: () => false, toggle: vi.fn() }),
}));
vi.mock("../lib/chat/store", () => ({
  useChatStore: () => ({ userId: null, workspace: null }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: mocks.user }),
}));
const mocks = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  history: {} as any,
  cloud: { items: [] as any[], reload: vi.fn(), loading: false },
  contacts: [] as any[],
  calling: false,
  call: vi.fn(async () => {}),
  refresh: undefined as (() => void) | undefined,
  press: new Map<string, { run: () => unknown; disabled: boolean }>(),
}));
vi.mock("../hooks/use-device-contacts", () => ({
  useDeviceContacts: () => ({ people: mocks.contacts }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../hooks/use-cloud-recordings", () => ({
  useCloudRecordings: () => mocks.cloud,
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (s: any) => s },
  View: ({ children }: any) => createElement("div", null, children),
  ScrollView: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TextInput: ({ accessibilityLabel, placeholder, value }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      placeholder,
      value,
      readOnly: true,
    }),
  FlatList: ({
    data,
    renderItem,
    ListEmptyComponent,
    ListHeaderComponent,
    onRefresh,
  }: any) => {
    mocks.refresh = onRefresh;
    return createElement(
      "div",
      null,
      ListHeaderComponent,
      data.length
        ? data.map((item: any, index: number) =>
            createElement("div", { key: item.id }, renderItem({ item, index })),
          )
        : ListEmptyComponent,
    );
  },
  TouchableOpacity: ({
    children,
    accessibilityLabel,
    onPress,
    disabled,
  }: any) => {
    if (accessibilityLabel)
      mocks.press.set(accessibilityLabel, { run: onPress, disabled });
    return createElement(
      "button",
      { "aria-label": accessibilityLabel, disabled },
      children,
    );
  },
}));
vi.mock("../components/cloud-recordings/live-recording-panel", () => ({
  LiveRecordingPanel: () => null,
}));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("../components/screen-container", () => ({
  ScreenContainer: ({ children }: any) => createElement("main", null, children),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "#008877",
    foreground: "#112233",
    muted: "#556677",
    surface: "#eeeeee",
  }),
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../hooks/use-phone-call", () => ({
  usePhoneCall: () => ({ placeCall: mocks.call, calling: mocks.calling }),
}));
vi.mock("../lib/sip/call-history", () => ({
  useCallHistoryStore: () => mocks.history,
  historyDuration: () => 12,
  isMissedCall: (entry: any) =>
    entry.direction === "inbound" && entry.answeredAt === undefined,
}));
import RecentsScreen, { filterRecentsRows } from "../app/(tabs)/recents";
function entry(ownerUserId = 1) {
  return {
    id: `saved-${ownerUserId}`,
    ownerUserId,
    number: "3002",
    name: ownerUserId === 1 ? "สมชาย" : "Other account private contact",
    startedAt: Date.now() - 20000,
    answeredAt: Date.now() - 13000,
    endedAt: Date.now() - 1000,
    direction: "inbound",
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.press.clear();
  mocks.user = { id: 1 };
  mocks.contacts = [];
  mocks.cloud.items = [];
  mocks.calling = false;
  mocks.history = {
    ownerUserId: 1,
    entries: [entry()],
    loading: false,
    error: null,
    reload: vi.fn(),
  };
});
it("expands a row without dialing; only its explicit call button places a call", async () => {
  renderToStaticMarkup(<RecentsScreen />);
  await mocks.press.get("Details for สมชาย")!.run();
  expect(mocks.call).not.toHaveBeenCalled();
  await mocks.press.get("Call 3002")!.run();
  expect(mocks.call).toHaveBeenNthCalledWith(1, "3002");
  expect(mocks.call).toHaveBeenCalledTimes(1);
});
it("hides a previous owner's history after sign-out", () => {
  mocks.user = null;
  const html = renderToStaticMarkup(<RecentsScreen />);
  expect(html).toContain("Sign in to see your calls");
  expect(html).not.toContain("สมชาย");
  expect(
    [...mocks.press.keys()].some((label) => label.startsWith("Call ")),
  ).toBe(false);
  expect(
    [...mocks.press.keys()].some((label) => label.startsWith("Details for ")),
  ).toBe(false);
});
it("requires both the history owner and each individual entry to match the signed-in user", () => {
  mocks.history.entries.push(entry(2));
  expect(renderToStaticMarkup(<RecentsScreen />)).not.toContain(
    "Other account private contact",
  );
  mocks.history.ownerUserId = 2;
  expect(renderToStaticMarkup(<RecentsScreen />)).not.toContain("สมชาย");
});
it("shows loading and error feedback and supports a real refresh", () => {
  mocks.history.entries = [];
  mocks.history.loading = true;
  expect(renderToStaticMarkup(<RecentsScreen />)).toContain("Loading calls...");
  mocks.history.loading = false;
  mocks.history.error = "Could not load saved calls. Please try again.";
  expect(renderToStaticMarkup(<RecentsScreen />)).toContain(
    "Could not load saved calls",
  );
  mocks.refresh!();
  expect(mocks.history.reload).toHaveBeenCalledOnce();
});
it("disables callback while keeping call details accessible during a pending request", () => {
  mocks.calling = true;
  renderToStaticMarkup(<RecentsScreen />);
  expect(mocks.press.get("Details for สมชาย")!.disabled).not.toBe(true);
  expect(mocks.press.get("Call 3002")!.disabled).toBe(true);
});

it("resolves a local contact name without changing saved history or its call target", async () => {
  mocks.history.entries[0].number = "+66825826667";
  mocks.contacts = [
    {
      id: "local1",
      name: "Local friend",
      phones: [{ number: "0825826667", label: "Mobile", key: "+66825826667" }],
    },
  ];
  expect(renderToStaticMarkup(<RecentsScreen />)).toContain("Local friend");
  expect(mocks.history.entries[0].name).toBe("สมชาย");
  await mocks.press.get("Call +66825826667")!.run();
  expect(mocks.call).toHaveBeenCalledWith("+66825826667");
  mocks.contacts = [];
  mocks.cloud.items = [];
  expect(renderToStaticMarkup(<RecentsScreen />)).toContain("สมชาย");
});

it("joins cloud recording controls only by exact server-provided history ID", () => {
  mocks.cloud.items = [
    {
      callUuid: "11111111-1111-4111-8111-111111111111",
      nativeHistoryId: "saved-1",
      number: "3002",
      startedAt: 1000,
      recordingStatus: "ready",
      summaryStatus: "queued",
    },
  ];
  let html = renderToStaticMarkup(createElement(RecentsScreen));
  expect(html.match(/● Recording/g)).toHaveLength(1);
  expect(html.match(/aria-label="Details for/g)).toHaveLength(1);
  mocks.cloud.items[0].nativeHistoryId = "other-id";
  html = renderToStaticMarkup(createElement(RecentsScreen));
  expect(html.match(/aria-label="Details for/g)).toHaveLength(2);
  expect(html.match(/● Recording/g)).toHaveLength(1);
});

it("offers compact filters and name-or-number search", () => {
  const html = renderToStaticMarkup(<RecentsScreen />);
  expect(html).toContain('aria-label="Search recent calls"');
  expect(html).toContain('placeholder="Search name or number"');
  expect(html).toContain('aria-label="Show recorded calls"');
  expect(html).toContain('aria-label="Show ai summary calls"');
});

it("filters recorded and summarized calls from cloud metadata", () => {
  const rows = [
    {
      id: "plain",
      name: "Plain call",
      number: "+6620303001",
      direction: "incoming",
      startedAt: 1,
      time: "10:00",
      duration: "0:30",
    },
    {
      id: "recorded",
      name: "Recorded call",
      number: "+66811111111",
      direction: "outgoing",
      startedAt: 2,
      time: "10:01",
      duration: "1:00",
      recordingReady: true,
    },
    {
      id: "summary",
      name: "Summarized call",
      number: "+66822222222",
      direction: "outgoing",
      startedAt: 3,
      time: "10:02",
      duration: "2:00",
      recordingReady: true,
      summaryReady: true,
    },
  ] as any[];
  expect(
    filterRecentsRows(
      rows,
      "recorded",
      "",
      () => false,
      () => false,
    ).map((row) => row.id),
  ).toEqual(["summary", "recorded"]);
  expect(
    filterRecentsRows(
      rows,
      "summary",
      "",
      () => false,
      () => false,
    ).map((row) => row.id),
  ).toEqual(["summary"]);
});

it("searches contact names and normalized phone digits within the active filter", () => {
  const rows = [
    {
      id: "friend",
      name: "Nathasa Friend",
      number: "+66 82 550 3222",
      direction: "outgoing",
      startedAt: 2,
      time: "10:01",
      duration: "1:00",
      recordingReady: true,
    },
    {
      id: "other",
      name: "Somchai",
      number: "+66 81 111 1111",
      direction: "incoming",
      startedAt: 1,
      time: "10:00",
      duration: "0:30",
    },
  ] as any[];
  const filter = (query: string) =>
    filterRecentsRows(
      rows,
      "recorded",
      query,
      () => false,
      () => false,
    ).map((row) => row.id);
  expect(filter("nathasa")).toEqual(["friend"]);
  expect(filter("0825503222")).toEqual(["friend"]);
  expect(filter("Somchai")).toEqual([]);
});
