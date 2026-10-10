/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
  presses: new Map<string, any>(),
  inputs: new Map<string, any>(),
  props: { tenantId: 18, userId: 7, actorRole: "owner", workspaceValid: true },
  retired: false,
  retiredWrites: 0,
  availability: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: (fn: unknown, deps: unknown[]) => {
      const i = m.frame.index++;
      const old = m.frame.values[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index])))
        m.frame.values[i] = { deps, fn };
      return m.frame.values[i].fn;
    },
    useState: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = initial;
      return [
        m.frame.values[i],
        (value: any) => {
          if (m.retired) m.retiredWrites++;
          m.frame.values[i] =
            typeof value === "function" ? value(m.frame.values[i]) : value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values)) m.frame.values[i] = { current: initial };
      return m.frame.values[i];
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const i = m.frame.index++;
      const old = m.frame.values[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index])))
        m.frame.effects.push(() => {
          old?.cleanup?.();
          m.frame.values[i] = { deps, effect, cleanup: effect() };
        });
    },
  };
});
function element({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Platform: { OS: "web" },
  View: element,
  Text: ({ children, accessibilityRole }: any) =>
    createElement("span", { role: accessibilityRole }, children),
  TextInput: (props: any) => {
    m.inputs.set(props.accessibilityLabel, props);
    return null;
  },
  Pressable: (props: any) => {
    const label = props.accessibilityLabel || props.children?.props?.children;
    if (typeof label === "string") m.presses.set(label, props);
    return createElement(
      "button",
      { disabled: props.disabled, "aria-label": props.accessibilityLabel },
      props.children,
    );
  },
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ primary: "#06c", surface: "#fff", border: "#ddd" }),
}));
vi.mock("../lib/trpc", () => ({
  createTRPCClient: () => ({
    invitations: {
      availability: { query: m.availability },
      list: { query: m.list },
      create: { mutate: m.create },
      resend: { mutate: m.resend },
      revoke: { mutate: m.revoke },
    },
  }),
}));
import * as Auth from "../lib/_core/auth";
import { AdminInvitations } from "../components/admin/admin-invitations";

type ActionKind = "create" | "resend" | "revoke";

const invitation = {
  id: "invite-88",
  email: "nok@example.test",
  role: "user",
  status: "pending",
  expiresAt: "2026-10-05T12:00:00Z",
  createdAt: "2026-10-04T12:00:00Z",
  deliveryStatus: "sent",
};
function actor() {
  return {
    id: 7,
    openId: "actor-7",
    name: "Owner",
    email: "owner@example.test",
    loginMethod: "email",
    lastSignedIn: new Date("2026-10-04T00:00:00Z"),
  };
}
function render(runEffects = true) {
  m.frame.index = 0;
  m.presses.clear();
  m.inputs.clear();
  const markup = renderToStaticMarkup(createElement(AdminInvitations, m.props));
  if (runEffects) for (const effect of m.frame.effects.splice(0)) effect();
  return markup;
}
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
async function settled() {
  await flush();
  return m.retired ? "" : render();
}
async function loaded() {
  render();
  await settled();
}
function press(label: string) {
  const button = m.presses.get(label);
  expect(button, label).toBeDefined();
  expect(button.disabled, label).not.toBe(true);
  return button.onPress();
}
async function actionCallback(kind: string) {
  await loaded();
  if (kind === "create") {
    press("Invite people");
    render();
    m.inputs.get("Invitation email address").onChangeText("nok@example.test");
    render();
    return m.presses.get("Create invitation").onPress;
  }
  return m.presses.get(
    `${kind === "resend" ? "Resend" : "Revoke"} invitation to nok@example.test`,
  ).onPress;
}
function unmount() {
  for (const slot of m.frame.values) slot?.cleanup?.();
  m.retired = true;
}
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.frame = { index: 0, values: [], effects: [] };
  m.retired = false;
  m.retiredWrites = 0;
  m.props = {
    tenantId: 18,
    userId: 7,
    actorRole: "owner",
    workspaceValid: true,
  };
  Auth.updateAuthState({ user: null });
  Auth.updateAuthState({ user: actor(), loading: false, error: null });
  m.availability.mockResolvedValue({ enabled: true });
  m.list.mockResolvedValue([invitation]);
  m.create.mockResolvedValue(invitation);
  m.resend.mockResolvedValue(invitation);
  m.revoke.mockResolvedValue({ ...invitation, status: "revoked" });
});

describe("admin invitation child lifetime", () => {
  it.each(["create", "resend", "revoke"])(
    "retires a retained %s callback when the parent unmounts invitations",
    async (kind) => {
      const callback = await actionCallback(kind);
      unmount();
      callback();
      await settled();
      expect(m[kind as ActionKind]).not.toHaveBeenCalled();
      expect(m.retiredWrites).toBe(0);
    },
  );
  it("retires retained Refresh before any capability query after unmount", async () => {
    await loaded();
    const refresh = m.presses.get("Refresh invitations").onPress;
    const calls = m.availability.mock.calls.length;
    unmount();
    refresh();
    await settled();
    expect(m.availability).toHaveBeenCalledTimes(calls);
    expect(m.retiredWrites).toBe(0);
  });
  it.each(["availability", "list"])(
    "retires a pending %s completion after unmount",
    async (step) => {
      const pending = deferred();
      m[step as "list"].mockReturnValueOnce(pending.promise);
      render();
      for (let i = 0; i < 4; i++) await Promise.resolve();
      unmount();
      const lists = m.list.mock.calls.length;
      pending.resolve(
        step === "availability" ? { enabled: true } : [invitation],
      );
      await settled();
      expect(m.list).toHaveBeenCalledTimes(lists);
      expect(m.retiredWrites).toBe(0);
    },
  );
  it.each(["create", "resend", "revoke"])(
    "retires an in-flight %s result without list refresh or state publication",
    async (kind) => {
      const pending = deferred();
      m[kind as ActionKind].mockReturnValueOnce(pending.promise);
      const callback = await actionCallback(kind);
      callback();
      unmount();
      const lists = m.list.mock.calls.length;
      pending.resolve(invitation);
      await settled();
      expect(m.list).toHaveBeenCalledTimes(lists);
      expect(m.retiredWrites).toBe(0);
    },
  );
  it.each(["create", "resend", "revoke"])(
    "retires an in-flight %s error without state publication",
    async (kind) => {
      const pending = deferred();
      m[kind as ActionKind].mockReturnValueOnce(pending.promise);
      const callback = await actionCallback(kind);
      callback();
      unmount();
      pending.reject(new Error("retired failure"));
      await settled();
      expect(m.retiredWrites).toBe(0);
    },
  );
  it.each(["create", "resend", "revoke"])(
    "retires a retained %s callback on same-account session replacement before rerender",
    async (kind) => {
      const callback = await actionCallback(kind);
      Auth.updateAuthState({
        user: { ...actor(), lastSignedIn: new Date("2026-10-04T01:00:00Z") },
      });
      callback();
      await settled();
      expect(m[kind as ActionKind]).not.toHaveBeenCalled();
    },
  );
  it("retires a pending capability result on same-account session replacement before rerender", async () => {
    const pending = deferred();
    m.availability.mockReturnValueOnce(pending.promise);
    render();
    Auth.updateAuthState({
      user: { ...actor(), lastSignedIn: new Date("2026-10-04T01:00:00Z") },
    });
    pending.resolve({ enabled: true });
    await flush();
    expect(m.list).not.toHaveBeenCalled();
    render();
    await settled();
    expect(m.list).toHaveBeenCalledTimes(1);
  });
  it.each(["create", "resend", "revoke"])(
    "retires a pending %s result on same-account session replacement",
    async (kind) => {
      const pending = deferred();
      m[kind as ActionKind].mockReturnValueOnce(pending.promise);
      const callback = await actionCallback(kind);
      callback();
      const lists = m.list.mock.calls.length;
      Auth.updateAuthState({
        user: { ...actor(), lastSignedIn: new Date("2026-10-04T01:00:00Z") },
      });
      m.retired = true;
      pending.resolve(invitation);
      await flush();
      expect(m.list).toHaveBeenCalledTimes(lists);
      expect(m.retiredWrites).toBe(0);
    },
  );

  it("retires a pending list completion before a replacement session rerenders the child", async () => {
    const pending = deferred();
    m.list.mockReturnValueOnce(pending.promise);
    render();
    await flush();
    Auth.updateAuthState({
      user: { ...actor(), lastSignedIn: new Date("2026-10-04T01:00:00Z") },
    });
    m.retired = true;
    pending.resolve([invitation]);
    await flush();
    expect(m.retiredWrites).toBe(0);
  });

  it.each(["create", "resend", "revoke"])(
    "retires the pending post-%s list refresh after unmount",
    async (kind) => {
      const callback = await actionCallback(kind);
      const pending = deferred();
      m.list.mockReturnValueOnce(pending.promise);
      callback();
      await flush();
      unmount();
      pending.resolve([invitation]);
      await settled();
      expect(m.retiredWrites).toBe(0);
    },
  );

  it.each(["resolve", "reject"])(
    "does not let an old %s unlock a newer workspace's pending action",
    async (outcome) => {
      const old = deferred();
      m.create.mockReturnValueOnce(old.promise);
      const oldCallback = await actionCallback("create");
      oldCallback();
      m.props = { ...m.props, tenantId: 19 };
      render();
      await settled();
      const next = deferred();
      m.create.mockReturnValueOnce(next.promise);
      const nextCallback = await actionCallback("create");
      nextCallback();
      if (outcome === "resolve") old.resolve(invitation);
      else old.reject(new Error("retired owner failure"));
      await settled();
      expect(m.presses.get("Create invitation").disabled).toBe(true);
      nextCallback();
      await settled();
      expect(m.create).toHaveBeenCalledTimes(2);
      next.resolve(invitation);
      await settled();
      expect(m.presses.has("Invite people")).toBe(true);
      expect(m.create.mock.calls[1][0].tenantId).toBe(19);
    },
  );

  it("retires an old action after workspace validity cycles back and admits its current replacement", async () => {
    const old = await actionCallback("create");
    m.props = { ...m.props, workspaceValid: false };
    render();
    await settled();
    m.props = { ...m.props, workspaceValid: true };
    render();
    await settled();
    old();
    await settled();
    expect(m.create).not.toHaveBeenCalled();
    const current = await actionCallback("create");
    current();
    await settled();
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it("restores usable current actions after effect cleanup and setup replay", async () => {
    await loaded();
    for (const slot of m.frame.values)
      if (slot?.effect) {
        slot.cleanup?.();
        slot.cleanup = slot.effect();
      }
    await settled();
    const callback = await actionCallback("create");
    callback();
    await settled();
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it.each(["availability", "list"])(
    "retires a pending %s rejection after unmount",
    async (step) => {
      const pending = deferred();
      m[step as "list"].mockReturnValueOnce(pending.promise);
      render();
      await flush();
      unmount();
      pending.reject(new Error("retired load failure"));
      await settled();
      expect(m.retiredWrites).toBe(0);
    },
  );

  it("retires a pending post-create list rejection after unmount", async () => {
    const callback = await actionCallback("create");
    const pending = deferred();
    m.list.mockReturnValueOnce(pending.promise);
    callback();
    await flush();
    unmount();
    pending.reject(new Error("retired list failure"));
    await settled();
    expect(m.retiredWrites).toBe(0);
  });

  it("retires a pending create rejection before a same-account replacement session rerenders", async () => {
    const callback = await actionCallback("create");
    const pending = deferred();
    m.create.mockReturnValueOnce(pending.promise);
    callback();
    Auth.updateAuthState({
      user: { ...actor(), lastSignedIn: new Date("2026-10-04T01:00:00Z") },
    });
    m.retired = true;
    pending.reject(new Error("retired session failure"));
    await flush();
    expect(m.retiredWrites).toBe(0);
  });

  it.each(["create", "resend", "revoke"])(
    "keeps ordinary owner %s and same-session profile refresh working",
    async (kind) => {
      const callback = await actionCallback(kind);
      const identity = Auth.getAuthSnapshot().user;
      Auth.updateAuthState({ user: { ...actor(), name: "Updated Owner" } });
      expect(Auth.getAuthSnapshot().user).toBe(identity);
      callback();
      await settled();
      expect(m[kind as ActionKind]).toHaveBeenCalledTimes(1);
      expect(m[kind as ActionKind]).toHaveBeenCalledWith(
        kind === "create"
          ? { tenantId: 18, email: "nok@example.test", role: "user" }
          : { tenantId: 18, invitationId: "invite-88" },
      );
    },
  );
  it.each(["create", "resend", "revoke"])(
    "preserves explicit retry after current-owner %s failure",
    async (kind) => {
      m[kind as ActionKind].mockRejectedValueOnce(
        new Error("Delivery request unavailable"),
      );
      const callback = await actionCallback(kind);
      callback();
      expect(await settled()).toContain("Delivery request unavailable");
      callback();
      await settled();
      expect(m[kind as ActionKind]).toHaveBeenCalledTimes(2);
    },
  );
  it("preserves current-owner Administrator invitation role", async () => {
    await actionCallback("create");
    press("Administrator");
    render();
    press("Create invitation");
    await settled();
    expect(m.create).toHaveBeenCalledWith({
      tenantId: 18,
      email: "nok@example.test",
      role: "admin",
    });
  });
  it("retires a retained owner-only Administrator Create before downgrade effects run", async () => {
    await actionCallback("create");
    press("Administrator");
    render();
    const create = m.presses.get("Create invitation").onPress;
    m.props = { ...m.props, actorRole: "admin" };
    render(false);
    create();
    await flush();
    expect(m.create).not.toHaveBeenCalled();
    render();
    await settled();
    const current = await actionCallback("create");
    current();
    await settled();
    expect(m.create).toHaveBeenCalledWith({
      tenantId: 18,
      email: "nok@example.test",
      role: "user",
    });
  });

  it("retires a pending owner-only create result before downgrade effects run", async () => {
    await actionCallback("create");
    press("Administrator");
    render();
    const pending = deferred();
    m.create.mockReturnValueOnce(pending.promise);
    press("Create invitation");
    const lists = m.list.mock.calls.length;
    m.props = { ...m.props, actorRole: "admin" };
    render(false);
    m.retired = true;
    pending.resolve(invitation);
    await flush();
    expect(m.retiredWrites).toBe(0);
    expect(m.list).toHaveBeenCalledTimes(lists);
  });

  it("keeps a mounted administrator's ordinary Member invitation working", async () => {
    m.props.actorRole = "admin";
    const create = await actionCallback("create");
    expect(m.presses.has("Administrator")).toBe(false);
    create();
    await settled();
    expect(m.create).toHaveBeenCalledWith({
      tenantId: 18,
      email: "nok@example.test",
      role: "user",
    });
  });

  it("preserves capability retry and unavailable capability presentation", async () => {
    m.availability.mockRejectedValueOnce(new Error("Capability unavailable"));
    render();
    await settled();
    press("Try again");
    await settled();
    expect(m.presses.has("Invite people")).toBe(true);
    m.availability.mockResolvedValue({ enabled: false });
    press("Refresh invitations");
    expect(await settled()).toContain("Invitations are not available yet");
    expect(m.presses.has("Create invitation")).toBe(false);
  });
});
