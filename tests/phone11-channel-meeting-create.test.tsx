import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
import { ChannelMeetingCreate } from "../components/meetings/channel-meeting-create";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const channelId = "11111111-1111-4111-8111-111111111111";
const meetingId = "22222222-2222-4222-8222-222222222222";
const m = vi.hoisted(() => ({
  owner: { id: 1 } as any,
  renderedOwner: null as any,
  chat: {} as any,
  authLoading: false,
  buttons: [] as any[],
  picker: null as any,
  values: [] as any[],
  refs: [] as any[],
  stateIndex: 0,
  refIndex: 0,
  focus: null as (() => void | (() => void)) | null,
  details: vi.fn(),
  capability: vi.fn(),
  start: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  load: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: any) => {
      const index = m.stateIndex++;
      if (!(index in m.values))
        m.values[index] = typeof initial === "function" ? initial() : initial;
      return [
        m.values[index],
        (value: any) => {
          m.values[index] =
            typeof value === "function" ? value(m.values[index]) : value;
        },
      ];
    },
    useRef: (initial: any) => {
      const index = m.refIndex++;
      return (m.refs[index] ??= { current: initial });
    },
    useCallback: (value: any) => value,
  };
});
vi.mock("react-native", () => ({
  ScrollView: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TextInput: () => null,
  View: ({ children }: any) => createElement("div", null, children),
  Pressable: (props: any) => {
    m.buttons.push(props);
    return createElement(
      "button",
      { disabled: props.disabled },
      props.children,
    );
  },
}));
vi.mock("expo-router", () => ({
  router: {
    push: m.push,
    replace: m.replace,
    back: m.back,
    canGoBack: () => true,
  },
  useFocusEffect: (value: any) => {
    m.focus = value;
  },
}));
vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({ user: m.renderedOwner }),
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "#05f",
    foreground: "#111",
    muted: "#666",
    surface: "#eee",
    error: "#c00",
    border: "#ddd",
  }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.owner, loading: m.authLoading }),
}));
vi.mock("../lib/chat/store", () => ({
  useChatStore: Object.assign(() => m.chat, { getState: () => m.chat }),
}));
vi.mock("../lib/chat/transport", () => ({
  createChatTransport: () => ({
    details: m.details,
    channelMeetingCapabilities: m.capability,
    startChannelMeeting: m.start,
  }),
}));
vi.mock("../components/chat/channel-meeting-picker", () => ({
  ChannelMeetingPicker: (props: any) => {
    m.picker = props;
    return null;
  },
}));

const render = () => {
  m.stateIndex = 0;
  m.refIndex = 0;
  m.buttons = [];
  m.picker = null;
  return renderToStaticMarkup(createElement(ChannelMeetingCreate));
};
const button = (label: string) =>
  m.buttons.find((item) => item.accessibilityLabel === label);
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const open = async () => {
  button("Choose meeting channel Project team").onPress();
  render();
  await flush();
  render();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  m.owner = { id: 1 };
  m.renderedOwner = m.owner;
  m.authLoading = false;
  m.values = [];
  m.refs = [];
  m.focus = null;
  m.load.mockReset().mockResolvedValue(undefined);
  m.chat = {
    userId: 1,
    workspace: { id: 7, name: "Workspace Seven" },
    loading: false,
    error: null,
    loadChannels: m.load,
    channels: [
      { id: channelId, kind: "channel", name: "Project team" },
      { id: "group", kind: "group", name: "Working group" },
      { id: "direct", kind: "direct", name: "Private contact" },
    ],
  };
  m.details.mockReset().mockResolvedValue({
    members: [
      { id: 1, name: "Host" },
      { id: 2, name: "Second" },
      { id: 3, name: "Third" },
    ],
  });
  m.capability
    .mockReset()
    .mockResolvedValue({
      available: true,
      canStart: true,
      maxSelectedMembers: 50,
    });
  m.start
    .mockReset()
    .mockResolvedValue({ meetingId, channelId, invitedMemberIds: [2, 3] });
  m.push.mockReset();
  m.replace.mockReset();
  m.back.mockReset();
  render();
  m.focus!();
  render();
});

it("refreshes only the selected workspace and lists channel/group creation choices", () => {
  const html = render();
  expect(m.load).toHaveBeenCalledWith(7);
  expect(html).toContain("Workspace Seven");
  expect(html).toContain("Project team");
  expect(html).toContain("Working group");
  expect(html).not.toContain("Private contact");
  expect(m.start).not.toHaveBeenCalled();
});

it("loads the exact protected roster and hosting permission before enabling the existing picker", async () => {
  const roster = deferred<any>();
  m.details.mockReturnValueOnce(roster.promise);
  button("Choose meeting channel Project team").onPress();
  render();
  expect(m.picker.loading).toBe(true);
  expect(m.picker.members).toEqual([]);
  expect(m.picker.startAvailable).toBe(false);
  expect(m.details).toHaveBeenCalledWith(7, channelId);
  expect(m.capability).toHaveBeenCalledWith(7, channelId);
  m.picker.onStart([2, 3]);
  await flush();
  expect(m.start).not.toHaveBeenCalled();
  roster.resolve({ members: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  await flush();
  render();
  expect(m.picker.startAvailable).toBe(true);
  expect(m.picker.hostId).toBe(1);
  expect(m.picker.tenantId).toBe(7);
  expect(m.picker.members.map((person: any) => person.id)).toEqual([1, 2, 3]);
});

it("rechecks hosting, uses the real requestId contract, and opens only the returned exact room", async () => {
  await open();
  m.picker.onStart([3, 2]);
  await flush();
  render();
  expect(m.capability).toHaveBeenCalledTimes(2);
  expect(m.start).toHaveBeenCalledWith(
    7,
    channelId,
    [2, 3],
    expect.stringMatching(/^[0-9a-f-]{36}$/),
  );
  expect(m.replace).toHaveBeenCalledWith({
    pathname: "/conference",
    params: { meetingId, tenantId: "7", source: "channel" },
  });
  expect(m.picker).toBeNull();
});

it.each(["signed out", "other owner", "other session", "auth loading"])(
  "cannot load or create a meeting with %s scope",
  async (condition) => {
    if (condition === "signed out") m.owner = m.renderedOwner = null;
    if (condition === "other owner") m.chat.userId = 99;
    if (condition === "other session") m.owner = { id: 1 };
    if (condition === "auth loading") m.authLoading = true;
    render();
    button("Choose meeting channel Project team")?.onPress();
    await flush();
    expect(m.details).not.toHaveBeenCalled();
    expect(m.start).not.toHaveBeenCalled();
  },
);

it.each(["denied", "capability failure", "roster failure"])(
  "fails closed for %s without representing an authorized empty roster",
  async (condition) => {
    if (condition === "denied")
      m.capability.mockResolvedValue({
        available: false,
        canStart: false,
        maxSelectedMembers: 50,
      });
    if (condition === "capability failure")
      m.capability.mockRejectedValue(new Error("SQL sensitive details"));
    if (condition === "roster failure")
      m.details.mockRejectedValue(new Error("SQL sensitive details"));
    await open();
    expect(m.picker.startAvailable).toBe(false);
    if (condition === "roster failure") {
      expect(m.picker.members).toEqual([]);
      expect(m.picker.rosterError).toContain("Could not load channel members");
    }
    if (condition === "capability failure")
      expect(m.picker.error).toContain("Could not check meeting hosting");
    m.picker.onStart([2, 3]);
    await flush();
    expect(m.start).not.toHaveBeenCalled();
  },
);

it.each(["account", "session", "workspace", "channel", "cancel", "focus"])(
  "discards a late roster after %s change",
  async (condition) => {
    const roster = deferred<any>();
    m.details.mockReturnValueOnce(roster.promise);
    const cleanup = m.focus!();
    button("Choose meeting channel Project team").onPress();
    render();
    if (condition === "account") m.owner = m.renderedOwner = { id: 99 };
    if (condition === "session") m.owner = { id: 1 };
    if (condition === "workspace") m.chat = { ...m.chat, workspace: { id: 8 } };
    if (condition === "channel") m.chat = { ...m.chat, channels: [] };
    if (condition === "cancel") m.picker.onCancel();
    if (condition === "focus") (cleanup as () => void)();
    roster.resolve({ members: [{ id: 1 }, { id: 2 }] });
    await flush();
    render();
    expect(m.picker === null || m.picker.loading).toBe(true);
    expect(m.start).not.toHaveBeenCalled();
  },
);

it("rejects a hosting permission revoked after selection and never sends creation", async () => {
  await open();
  m.capability.mockResolvedValue({
    available: false,
    canStart: false,
    maxSelectedMembers: 50,
  });
  m.picker.onStart([2, 3]);
  await flush();
  render();
  expect(m.start).not.toHaveBeenCalled();
  expect(m.picker.startAvailable).toBe(false);
  expect(m.picker.error).toContain("No new request was sent");
});

it("does not apply a cancelled selector's Start callback to a reopened selection", async () => {
  await open();
  const staleStart = m.picker.onStart;
  m.picker.onCancel(); render();
  await open();
  staleStart([2, 3]); await flush();
  expect(m.start).not.toHaveBeenCalled();
  m.picker.onStart([2, 3]); await flush();
  expect(m.start).toHaveBeenCalledOnce();
});

it.each(["workspace", "session", "focus"])(
  "does not submit after %s change during the final capability check",
  async (condition) => {
    const cleanup = m.focus!();
    await open();
    const fresh = deferred<any>();
    m.capability.mockReturnValueOnce(fresh.promise);
    m.picker.onStart([2, 3]);
    expect(m.capability).toHaveBeenCalledTimes(2);
    expect(m.start).not.toHaveBeenCalled();
    if (condition === "workspace") m.chat = { ...m.chat, workspace: { id: 8 } };
    if (condition === "session") m.owner = { id: 1 };
    if (condition === "focus") (cleanup as () => void)();
    fresh.resolve({ available: true, canStart: true, maxSelectedMembers: 50 });
    await flush();
    expect(m.start).not.toHaveBeenCalled();
    expect(m.replace).not.toHaveBeenCalled();
  },
);

it.each([[1, 2], [2, 2], [99], [], [2, 3, 4]].map(ids => ({ ids })))(
  "rejects invalid local invitee selection %j",
  async ({ ids }) => {
    await open();
    m.picker.onStart(ids);
    await flush();
    expect(m.capability).toHaveBeenCalledOnce();
    expect(m.start).not.toHaveBeenCalled();
  },
);

it("locks duplicate taps and preserves one requestId through failure, Cancel, and explicit retry", async () => {
  const response = deferred<any>();
  m.start.mockReturnValueOnce(response.promise);
  await open();
  const start = m.picker.onStart;
  start([2, 3]);
  start([2, 3]);
  await flush();
  render();
  expect(m.start).toHaveBeenCalledOnce();
  expect(m.picker.busy).toBe(true);
  m.picker.onCancel();
  render();
  expect(m.picker).not.toBeNull();
  response.reject(new Error("uncertain transport"));
  await flush();
  render();
  expect(m.picker.busy).toBe(false);
  expect(m.picker.error).toContain("same selection");
  const requestId = m.start.mock.calls[0][3];
  m.picker.onCancel();
  render();
  await open();
  m.picker.onStart([2]);
  await flush();
  render();
  expect(m.start).toHaveBeenCalledOnce();
  expect(m.picker.error).toContain("original selection");
  m.picker.onStart([3, 2]);
  await flush();
  expect(m.start).toHaveBeenLastCalledWith(7, channelId, [2, 3], requestId);
  expect(m.replace).toHaveBeenCalledOnce();
});

it.each(["session", "workspace", "channel", "focus"])(
  "ignores a creation acknowledgement after %s change",
  async (condition) => {
    const response = deferred<any>();
    m.start.mockReturnValueOnce(response.promise);
    const cleanup = m.focus!();
    await open();
    m.picker.onStart([2, 3]);
    await flush();
    if (condition === "session") m.owner = { id: 1 };
    if (condition === "workspace") m.chat = { ...m.chat, workspace: { id: 8 } };
    if (condition === "channel") m.chat = { ...m.chat, channels: [] };
    if (condition === "focus") (cleanup as () => void)();
    response.resolve({ meetingId, channelId, invitedMemberIds: [2, 3] });
    await flush();
    expect(m.replace).not.toHaveBeenCalled();
  },
);

it.each(["room", "channel", "invitees"])(
  "refuses a mismatched %s acknowledgement",
  async (condition) => {
    m.start.mockResolvedValue({
      meetingId: condition === "room" ? "not-a-uuid" : meetingId,
      channelId: condition === "channel" ? "other-channel" : channelId,
      invitedMemberIds: condition === "invitees" ? [99] : [2, 3],
    });
    await open();
    m.picker.onStart([2, 3]);
    await flush();
    render();
    expect(m.replace).not.toHaveBeenCalled();
    expect(m.picker.error).toContain("Could not confirm");
  },
);

it("provides back, Team Chat, loading and list failure retry without creating meetings", () => {
  button("Back to Meetings").onPress();
  expect(m.back).toHaveBeenCalledOnce();
  button("Open Team Chat").onPress();
  expect(m.push).toHaveBeenCalledWith("/(tabs)/teamchat");
  m.chat.loading = true;
  expect(render()).toContain("Loading your channels");
  expect(button("Choose meeting channel Project team")).toBeUndefined();
  m.chat.loading = false;
  m.chat.error = "sensitive raw error";
  expect(render()).toContain("Could not refresh your channels");
  expect(button("Choose meeting channel Project team")).toBeUndefined();
  button("Retry meeting channels").onPress();
  expect(m.load).toHaveBeenLastCalledWith(7);
  expect(m.start).not.toHaveBeenCalled();
});
