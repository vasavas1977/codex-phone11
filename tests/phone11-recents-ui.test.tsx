import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  history: {} as any,
  contacts: [] as any[],
  calling: false,
  call: vi.fn(async () => {}),
  refresh: undefined as (() => void) | undefined,
  press: new Map<string, { run: () => unknown; disabled: boolean }>(),
}));
vi.mock("../hooks/use-device-contacts", () => ({
  useDeviceContacts: () => ({ people: mocks.contacts }),
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (s: any) => s },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
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
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("../components/screen-container", () => ({
  ScreenContainer: ({ children }: any) => createElement("main", null, children),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
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
import RecentsScreen from "../app/(tabs)/recents";
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
  mocks.calling = false;
  mocks.history = {
    ownerUserId: 1,
    entries: [entry()],
    loading: false,
    error: null,
    reload: vi.fn(),
  };
});
it("routes both the saved call row and phone button through the guarded call hook", async () => {
  renderToStaticMarkup(<RecentsScreen />);
  await mocks.press.get("Call สมชาย, 3002")!.run();
  await mocks.press.get("Call 3002")!.run();
  expect(mocks.call).toHaveBeenNthCalledWith(1, "3002");
  expect(mocks.call).toHaveBeenNthCalledWith(2, "3002");
});
it("hides a previous owner's history after sign-out", () => {
  mocks.user = null;
  const html = renderToStaticMarkup(<RecentsScreen />);
  expect(html).toContain("Sign in to see your calls");
  expect(html).not.toContain("สมชาย");
  expect(mocks.press.size).toBe(0);
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
it("disables both call entry buttons while a call request is pending", () => {
  mocks.calling = true;
  renderToStaticMarkup(<RecentsScreen />);
  expect(mocks.press.get("Call สมชาย, 3002")!.disabled).toBe(true);
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
  await mocks.press.get("Call Local friend, +66825826667")!.run();
  expect(mocks.call).toHaveBeenCalledWith("+66825826667");
  mocks.contacts = [];
  expect(renderToStaticMarkup(<RecentsScreen />)).toContain("สมชาย");
});
