import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  source: "device" as "device" | "team",
  device: {} as any,
  settings: vi.fn(async () => {}),
  account: { ownerUserId: 1, tenantId: 1, enabled: true } as any,
  directory: {} as any,
  params: { id: "5", tenantId: "1" } as any,
  press: new Map<string, () => unknown>(),
  call: vi.fn(async () => {}),
  openMessage: vi.fn(async () => "channel-1"),
  push: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      initial === "device"
        ? [
            mocks.source,
            (next: "device" | "team") => {
              mocks.source = next;
            },
          ]
        : actual.useState(initial),
  };
});
vi.mock("../hooks/use-device-contacts", () => ({
  useDeviceContacts: () => mocks.device,
}));
vi.mock("react-native", () => ({
  Linking: { openSettings: mocks.settings },
  Alert: { alert: mocks.alert },
  StyleSheet: { create: (s: any) => s },
  View: ({ children }: any) => createElement("div", null, children),
  ScrollView: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TextInput: ({ accessibilityLabel }: any) =>
    createElement("input", { "aria-label": accessibilityLabel }),
  ActivityIndicator: () => createElement("span", null, "Loading"),
  FlatList: ({ data, renderItem, ListEmptyComponent }: any) =>
    createElement(
      "div",
      null,
      data.length
        ? data.map((item: any) =>
            createElement("div", { key: item.id }, renderItem({ item })),
          )
        : ListEmptyComponent,
    ),
  Pressable: ({ children, accessibilityLabel, onPress, disabled }: any) => {
    const label =
      accessibilityLabel ||
      (typeof children?.props?.children === "string"
        ? children.props.children
        : undefined);
    if (label) mocks.press.set(label, onPress);
    return createElement(
      "button",
      { "aria-label": accessibilityLabel, disabled },
      children,
    );
  },
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push, back: vi.fn() },
  useLocalSearchParams: () => mocks.params,
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
vi.mock("../hooks/use-directory", () => ({
  useDirectory: () => mocks.directory,
  openDirectConversation: mocks.openMessage,
}));
vi.mock("../hooks/use-phone-call", () => ({
  usePhoneCall: () => ({ placeCall: mocks.call }),
}));
vi.mock("../lib/sip/account-store", () => ({
  useSipAccountStore: Object.assign(
    (select: any) => select({ account: mocks.account }),
    { getState: () => ({ account: mocks.account }) },
  ),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: { id: 1 } }),
}));
import ContactsScreen from "../app/(tabs)/contacts";
import ContactDetailScreen from "../app/contacts/[id]";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.press.clear();
  mocks.source = "device";
  mocks.device = {
    permission: "unknown",
    people: [],
    loading: false,
    error: null,
    refreshedAt: null,
    refresh: vi.fn(async () => {}),
  };
  mocks.params = { id: "5", tenantId: "1" };
  mocks.account = { ownerUserId: 1, tenantId: 1, enabled: true };
  mocks.directory = {
    owner: 1,
    people: [{ id: 5, name: "สมชาย", extension: "3001" }],
    workspace: { id: 1, name: "My team" },
    workspaces: [{ id: 1, name: "My team" }],
    signedIn: true,
    loading: false,
    error: null,
    reload: vi.fn(),
  };
});
function selectTeam() {
  renderToStaticMarkup(<ContactsScreen />);
  mocks.press.get("Team")!();
}
it("lists real contacts without simulated presence or demo people", () => {
  selectTeam();
  const html = renderToStaticMarkup(<ContactsScreen />);
  expect(html).toContain("สมชาย");
  expect(html).not.toContain("Alice Johnson");
  expect(html).not.toContain("Online");
  mocks.press.get("Open contact สมชาย")!();
  expect(mocks.push).toHaveBeenCalledWith({
    pathname: "/contacts/[id]",
    params: { id: 5, tenantId: 1 },
  });
});
it("distinguishes signed-out, empty and failed directory states", () => {
  selectTeam();
  mocks.directory.people = [];
  mocks.directory.signedIn = false;
  expect(renderToStaticMarkup(<ContactsScreen />)).toContain(
    "Sign in to find people",
  );
  mocks.directory.signedIn = true;
  expect(renderToStaticMarkup(<ContactsScreen />)).toContain(
    "No team contacts yet",
  );
  mocks.directory.error = "Could not load your contacts.";
  expect(renderToStaticMarkup(<ContactsScreen />)).toContain(
    "Contacts unavailable",
  );
});
it("calls the real phone flow and never opens a simulated call screen", async () => {
  renderToStaticMarkup(<ContactDetailScreen />);
  await mocks.press.get("Call สมชาย")!();
  expect(mocks.call).toHaveBeenCalledWith("3001");
  expect(mocks.push).not.toHaveBeenCalled();
});
it("opens only a server-created conversation in the same tenant", async () => {
  renderToStaticMarkup(<ContactDetailScreen />);
  await mocks.press.get("Message สมชาย")!();
  expect(mocks.openMessage).toHaveBeenCalledWith(1, 5);
  expect(mocks.push).toHaveBeenCalledWith({
    pathname: "/chat/[id]",
    params: { id: "channel-1", tenantId: 1 },
  });
});
it("omits unavailable phone action and rejects stale contact IDs", () => {
  mocks.directory.people[0].extension = null;
  expect(renderToStaticMarkup(<ContactDetailScreen />)).not.toContain(
    'aria-label="Call สมชาย"',
  );
  mocks.params.id = "999";
  expect(renderToStaticMarkup(<ContactDetailScreen />)).toContain(
    "Contact not found",
  );
});
it("keeps the contact visible if message creation fails", async () => {
  mocks.openMessage.mockRejectedValueOnce(new Error("Network failed"));
  renderToStaticMarkup(<ContactDetailScreen />);
  await mocks.press.get("Message สมชาย")!();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith(
    "Conversation could not open",
    expect.any(String),
  );
});

it("does not offer another workspace's extension through the current phone account", () => {
  mocks.account.tenantId = 99;
  const html = renderToStaticMarkup(<ContactDetailScreen />);
  expect(html).not.toContain('aria-label="Call สมชาย"');
  expect(html).toContain('aria-label="Message สมชาย"');
});

it("offers device contact access without requesting permission until the user taps", async () => {
  const html = renderToStaticMarkup(<ContactsScreen />);
  expect(html).toContain("Your phone contacts");
  expect(html).toContain("not uploaded to your workspace");
  expect(mocks.device.refresh).not.toHaveBeenCalled();
  await mocks.press.get("Allow Contacts access")!();
  expect(mocks.device.refresh).toHaveBeenCalledWith(true);
});
it("shows denied access recovery and limited contact selection", async () => {
  mocks.device.permission = "denied";
  expect(renderToStaticMarkup(<ContactsScreen />)).toContain(
    "Allow Contacts access in Settings",
  );
  await mocks.press.get("Open Settings")!();
  expect(mocks.settings).toHaveBeenCalledOnce();
  expect(mocks.device.refresh).not.toHaveBeenCalled();
  mocks.device.permission = "limited";
  mocks.device.people = [
    {
      id: "local1",
      name: "Local friend",
      phones: [{ number: "0825826667", label: "Mobile", key: "+66825826667" }],
    },
  ];
  const html = renderToStaticMarkup(<ContactsScreen />);
  expect(html).toContain("Selected contacts only");
  expect(html).toContain("Local friend");
  expect(html).not.toContain("สมชาย");
  await mocks.press.get("Call Local friend, Mobile, 0825826667")!();
  expect(mocks.call).toHaveBeenCalledWith("+66825826667");
});
