import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
import { DirectMeetingAction } from "../components/chat/direct-meeting-action";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  owner: { id: 3001 },
  renderedOwner: { id: 3001 },
  workspaceId: 1,
  chatOwnerId: 3001,
  available: true,
  error: null as Error | null,
  button: null as any,
  refetch: vi.fn(),
  start: vi.fn(),
  push: vi.fn(),
  alert: vi.fn(),
  loading: false,
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  focused: true,
  focusSetup: null as (() => void | (() => void)) | null,
  cleanup: null as (() => void) | null,
  focusDeps: null as unknown[] | null,
  callbackDeps: new Map<() => unknown, unknown[]>(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (initial: unknown) => {
    const index = m.refIndex++;
    if (!m.refs[index]) m.refs[index] = { current: initial };
    return m.refs[index];
  },
  useState: (initial: unknown) => {
    const index = m.stateIndex++;
    if (index >= m.values.length) m.values[index] = initial;
    return [
      m.values[index],
      (value: unknown) => {
        m.values[index] =
          typeof value === "function"
            ? (value as (prior: unknown) => unknown)(m.values[index])
            : value;
      },
    ];
  },
  useCallback: (callback: () => unknown, deps: unknown[]) => {
    m.callbackDeps.set(callback, deps);
    return callback;
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert: m.alert },
  Pressable: (props: any) => {
    m.button = props;
    return createElement(
      "button",
      { disabled: props.disabled, "aria-label": props.accessibilityLabel },
      props.children,
    );
  },
}));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("expo-router", () => ({
  router: { push: m.push },
  useFocusEffect: (setup: () => void | (() => void)) => {
    const deps = m.callbackDeps.get(setup) ?? [];
    m.focusSetup = setup;
    if (
      m.focusDeps &&
      deps.length === m.focusDeps.length &&
      deps.every((value, index) => value === m.focusDeps![index])
    )
      return;
    m.cleanup?.();
    m.cleanup = null;
    m.focusDeps = deps;
    if (m.focused) m.cleanup = setup() ?? null;
  },
}));
vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({ user: m.renderedOwner }),
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ primary: "#05f", muted: "#777" }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.owner, loading: m.loading }),
}));
vi.mock("../lib/chat/store", () => ({
  useChatStore: Object.assign(
    (select: any) =>
      select({ userId: m.chatOwnerId, workspace: { id: m.workspaceId } }),
    {
      getState: () => ({
        userId: m.chatOwnerId,
        workspace: { id: m.workspaceId },
        channels: [
          { id: "direct-1", kind: "direct" },
          { id: "direct-2", kind: "direct" },
        ],
      }),
    },
  ),
}));
vi.mock("../lib/trpc", () => ({
  trpc: {
    meetings: {
      directCapabilities: {
        useQuery: () => ({
          data: { available: m.available, canStart: m.available },
          error: m.error,
          isLoading: false,
          isFetching: false,
          refetch: m.refetch,
        }),
      },
      startDirectMeeting: { useMutation: () => ({ mutateAsync: m.start }) },
    },
  },
}));

beforeEach(() => {
  m.owner = { id: 3001 };
  m.renderedOwner = m.owner;
  m.workspaceId = 1;
  m.chatOwnerId = 3001;
  m.available = true;
  m.error = null;
  m.button = null;
  m.refetch
    .mockReset()
    .mockResolvedValue({
      data: { available: true, canStart: true },
      error: null,
    });
  m.start
    .mockReset()
    .mockResolvedValue({ meetingId: "22222222-2222-4222-8222-222222222222" });
  m.push.mockReset();
  m.alert.mockReset();
  m.loading = false;
  m.values = [];
  m.refs = [];
  m.stateIndex = 0;
  m.refIndex = 0;
  m.focused = true;
  m.focusSetup = null;
  m.cleanup = null;
  m.focusDeps = null;
  m.callbackDeps.clear();
});

function render(tenantId = 1, conversationId = "direct-1") {
  m.stateIndex = 0;
  m.refIndex = 0;
  return renderToStaticMarkup(
    createElement(DirectMeetingAction, { tenantId, conversationId }),
  );
}
function retire() {
  m.focused = false;
  m.cleanup?.();
  m.cleanup = null;
}
function refocus() {
  m.focused = true;
  m.cleanup = m.focusSetup?.() ?? null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const permission = {
  data: { available: true, canStart: true },
  error: null as Error | null,
};
const room = { meetingId: "22222222-2222-4222-8222-222222222222" };
const settle = () => new Promise<void>((done) => setImmediate(done));

it("starts an exact direct-contact invitation and opens that room", async () => {
  render();
  expect(m.button.accessibilityLabel).toBe("Meet with contact");
  m.button.onPress();
  await vi.waitFor(() => expect(m.push).toHaveBeenCalledOnce());
  expect(m.start).toHaveBeenCalledWith({
    tenantId: 1,
    conversationId: "direct-1",
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  expect(m.push).toHaveBeenCalledWith({
    pathname: "/conference",
    params: {
      meetingId: "22222222-2222-4222-8222-222222222222",
      tenantId: "1",
      source: "direct",
    },
  });
});

it("does not create a room when permission or workspace binding is missing", () => {
  m.available = false;
  render();
  expect(m.button.disabled).toBe(true);
  m.button.onPress();
  expect(m.start).not.toHaveBeenCalled();
  m.available = true;
  m.workspaceId = 2;
  render();
  expect(m.button.disabled).toBe(true);
  m.button.onPress();
  expect(m.start).not.toHaveBeenCalled();
});

it("drops a late permission result after account switch", async () => {
  let resolve!: (value: unknown) => void;
  m.refetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render();
  m.button.onPress();
  m.owner = { id: 1020 };
  resolve({ data: { available: true, canStart: true }, error: null });
  await vi.waitFor(() => expect(m.refetch).toHaveBeenCalledOnce());
  expect(m.start).not.toHaveBeenCalled();
  expect(m.push).not.toHaveBeenCalled();
  expect(m.alert).not.toHaveBeenCalled();
});

it.each(["blur", "unmount"])(
  "does not create or show feedback after %s during permission refresh",
  async () => {
    const fresh = deferred<typeof permission>();
    m.refetch.mockReturnValueOnce(fresh.promise);
    render();
    m.button.onPress();
    retire();
    fresh.resolve(permission);
    await settle();
    expect(m.start).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  },
);
it.each(["refusal", "rejection"])(
  "suppresses a late permission %s on a retired route",
  async (outcome) => {
    const fresh = deferred<typeof permission>();
    m.refetch.mockReturnValueOnce(fresh.promise);
    render();
    m.button.onPress();
    retire();
    if (outcome === "refusal")
      fresh.resolve({ ...permission, error: new Error("private failure") });
    else fresh.reject(new Error("private failure"));
    await settle();
    expect(m.start).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  },
);
it.each(["blur", "unmount"])(
  "does not navigate after %s during an already dispatched creation",
  async () => {
    const creation = deferred<typeof room>();
    m.start.mockReturnValueOnce(creation.promise);
    render();
    m.button.onPress();
    await settle();
    expect(m.start).toHaveBeenCalledOnce();
    retire();
    creation.resolve(room);
    await settle();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  },
);
it("suppresses a late creation rejection on a retired route", async () => {
  const creation = deferred<typeof room>();
  m.start.mockReturnValueOnce(creation.promise);
  render();
  m.button.onPress();
  await settle();
  retire();
  creation.reject(new Error("private failure"));
  await settle();
  expect(m.push).not.toHaveBeenCalled();
  expect(m.alert).not.toHaveBeenCalled();
});
it.each(["account", "session", "tenant", "conversation"])(
  "retires permission callbacks after %s replacement",
  async (kind) => {
    const fresh = deferred<typeof permission>();
    m.refetch.mockReturnValueOnce(fresh.promise);
    render();
    m.button.onPress();
    if (kind === "account") {
      m.owner = { id: 1020 };
      m.renderedOwner = m.owner;
      m.chatOwnerId = 1020;
    }
    if (kind === "session") {
      m.owner = { id: 3001 };
      m.renderedOwner = m.owner;
    }
    if (kind === "tenant") m.workspaceId = 2;
    render(
      kind === "tenant" ? 2 : 1,
      kind === "conversation" ? "direct-2" : "direct-1",
    );
    fresh.resolve(permission);
    await settle();
    expect(m.start).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  },
);
it.each(["account", "session", "tenant", "conversation"])(
  "retires creation success after %s replacement",
  async (kind) => {
    const creation = deferred<typeof room>();
    m.start.mockReturnValueOnce(creation.promise);
    render();
    m.button.onPress();
    await settle();
    if (kind === "account") {
      m.owner = { id: 1020 };
      m.renderedOwner = m.owner;
      m.chatOwnerId = 1020;
    }
    if (kind === "session") {
      m.owner = { id: 3001 };
      m.renderedOwner = m.owner;
    }
    if (kind === "tenant") m.workspaceId = 2;
    render(
      kind === "tenant" ? 2 : 1,
      kind === "conversation" ? "direct-2" : "direct-1",
    );
    creation.resolve(room);
    await settle();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  },
);
it.each(["account", "session", "tenant", "conversation"])(
  "rejects a retained old tap callback after %s replacement",
  async (kind) => {
    render();
    const oldTap = m.button.onPress;
    if (kind === "account") {
      m.owner = { id: 1020 };
      m.renderedOwner = m.owner;
      m.chatOwnerId = 1020;
    }
    if (kind === "session") {
      m.owner = { id: 3001 };
      m.renderedOwner = m.owner;
    }
    if (kind === "tenant") m.workspaceId = 2;
    render(
      kind === "tenant" ? 2 : 1,
      kind === "conversation" ? "direct-2" : "direct-1",
    );
    oldTap();
    await settle();
    expect(m.refetch).not.toHaveBeenCalled();
    expect(m.start).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  },
);
it("does not revive an old permission attempt on refocus or reset a newer attempt", async () => {
  const fresh = deferred<typeof permission>(),
    creation = deferred<typeof room>();
  m.refetch.mockReturnValueOnce(fresh.promise);
  m.start.mockReturnValueOnce(creation.promise);
  render();
  m.button.onPress();
  retire();
  refocus();
  render();
  m.button.onPress();
  await settle();
  expect(m.start).toHaveBeenCalledOnce();
  fresh.resolve(permission);
  await settle();
  render();
  expect(m.button.disabled).toBe(true);
  m.button.onPress();
  await settle();
  expect(m.start).toHaveBeenCalledOnce();
  expect(m.push).not.toHaveBeenCalled();
  creation.resolve(room);
  await settle();
  expect(m.push).toHaveBeenCalledOnce();
});
it.each(["success", "rejection"])(
  "keeps a newer retry pending when retired creation returns %s",
  async (outcome) => {
    const old = deferred<typeof room>(),
      retry = deferred<typeof room>();
    m.start.mockReturnValueOnce(old.promise).mockReturnValueOnce(retry.promise);
    render();
    m.button.onPress();
    await settle();
    retire();
    refocus();
    render();
    m.button.onPress();
    await settle();
    expect(m.start).toHaveBeenCalledTimes(2);
    expect(m.start.mock.calls[1][0]).toEqual(m.start.mock.calls[0][0]);
    if (outcome === "success") old.resolve(room);
    else old.reject(new Error("private failure"));
    await settle();
    render();
    expect(m.button.disabled).toBe(true);
    m.button.onPress();
    await settle();
    expect(m.start).toHaveBeenCalledTimes(2);
    expect(m.push).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
    retry.resolve(room);
    await settle();
    expect(m.push).toHaveBeenCalledOnce();
  },
);
it("coalesces duplicate taps and reuses the request ID on explicit uncertain retry", async () => {
  const creation = deferred<typeof room>();
  m.start.mockReturnValueOnce(creation.promise);
  render();
  m.button.onPress();
  m.button.onPress();
  await settle();
  expect(m.start).toHaveBeenCalledOnce();
  creation.reject(new Error("unknown result"));
  await settle();
  render();
  expect(m.button.disabled).toBe(false);
  m.button.onPress();
  await settle();
  expect(m.start).toHaveBeenCalledTimes(2);
  expect(m.start.mock.calls[1][0]).toEqual(m.start.mock.calls[0][0]);
  expect(m.push).toHaveBeenCalledOnce();
});
it("shows current permission failure without creating a room", async () => {
  m.refetch.mockResolvedValueOnce({
    data: { available: false, canStart: false },
    error: null,
  });
  render();
  m.button.onPress();
  await settle();
  expect(m.alert).toHaveBeenCalledOnce();
  expect(m.start).not.toHaveBeenCalled();
});
