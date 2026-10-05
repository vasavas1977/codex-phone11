/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[], effects: [] as (() => void)[] },
  presses: new Map<string, any>(),
  listeners: new Set<() => void>(),
  auth: { user: { id: 7 }, loading: false } as {
    user: { id: number } | null;
    loading: boolean;
  },
  platform: "ios",
  modal: null as any,
  tenant: 18,
  rows: [] as any[],
  cache: true,
  queryError: false,
  alert: vi.fn(),
  mutate: vi.fn(),
  invalidate: vi.fn(),
  writes: 0,
  retired: false,
  retiredWrites: 0,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = m.frame.index++;
      if (!(i in m.frame.values))
        m.frame.values[i] = typeof initial === "function" ? initial() : initial;
      return [
        m.frame.values[i],
        (value: any) => {
          m.writes++;
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
    useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const i = m.frame.index++,
        old = m.frame.values[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index])))
        m.frame.effects.push(() => {
          old?.cleanup?.();
          m.frame.values[i] = { deps, cleanup: effect() };
        });
    },
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  };
});
function element({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Alert: { alert: m.alert },
  Platform: {
    get OS() {
      return m.platform;
    },
  },
  Modal: (props: any) => {
    m.modal = props;
    return props.visible ? element(props) : null;
  },
  StyleSheet: { create: (value: unknown) => value },
  Text: element,
  View: element,
  ScrollView: element,
  useWindowDimensions: () => ({ width: 400 }),
  Pressable: (props: any) => {
    m.presses.set(props.accessibilityLabel, props);
    return createElement(
      "button",
      { disabled: props.disabled },
      props.children,
    );
  },
}));
vi.mock("expo-router", () => ({
  router: { canGoBack: () => true, back: vi.fn() },
}));
vi.mock("../components/admin/admin-workspace-boundary", () => ({
  AdminWorkspaceBoundary: ({ children }: any) =>
    createElement("div", null, children),
}));
vi.mock("../components/screen-container", () => ({
  ScreenContainer: ({ children }: any) => createElement("div", null, children),
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ foreground: "black", primary: "blue", error: "red" }),
}));
vi.mock("../hooks/use-pbx-admin", () => ({
  usePbxAdminWorkspace: () => ({ selectedTenantId: m.tenant }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => m.auth,
  addAuthChangeListener: (fn: () => void) => {
    m.listeners.add(fn);
    return () => m.listeners.delete(fn);
  },
}));
vi.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      pbx: {
        extensions: {
          list: {
            getData: (input: any) =>
              m.cache && input.tenantId === m.tenant
                ? { data: m.rows }
                : undefined,
            invalidate: m.invalidate,
          },
        },
      },
    }),
    pbx: {
      voicemail: { storageStatus: { useQuery: () => ({ data: undefined }) } },
      extensions: {
        list: {
          useQuery: () => ({
            data: { data: m.rows, total: m.rows.length },
            isError: m.queryError,
          }),
        },
        update: { useMutation: () => ({ mutateAsync: m.mutate }) },
      },
    },
  },
}));
import AdminVoicemail from "../app/admin/voicemail";
function row() {
  return {
    id: 101,
    extension_number: "1001",
    user_name: "Original member",
    user_id: 7,
    status: "active",
    type: "user",
    voicemail_enabled: false,
  };
}
function render() {
  m.frame.index = 0;
  m.modal = null;
  m.presses.clear();
  const html = renderToStaticMarkup(createElement(AdminVoicemail));
  for (const effect of m.frame.effects.splice(0)) effect();
  return html;
}
function press() {
  return m.presses.get(
    `${m.rows[0]?.voicemail_enabled ? "Disable" : "Enable"} voicemail for extension ${m.rows[0]?.extension_number}`,
  ).onPress;
}
function confirm() {
  render();
  press()();
  return m.alert.mock.calls.at(-1)![2][1].onPress as () => void;
}
function unmount() {
  for (const slot of m.frame.values) slot?.cleanup?.();
  m.retired = true;
}
function auth(user: { id: number } | null, loading = false) {
  m.auth = { user, loading };
  m.listeners.forEach((fn) => fn());
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.clearAllMocks();
  m.frame = { index: 0, values: [], effects: [] };
  m.presses.clear();
  m.listeners.clear();
  m.auth = { user: { id: 7 }, loading: false };
  m.platform = "ios";
  m.modal = null;
  m.tenant = 18;
  m.rows = [row()];
  m.cache = true;
  m.queryError = false;
  m.writes = 0;
  m.retired = false;
  m.retiredWrites = 0;
  m.mutate.mockReset().mockResolvedValue(undefined);
  m.invalidate.mockReset().mockResolvedValue(undefined);
});
const boundaries = {
  workspace: () => {
    m.tenant = 19;
    render();
  },
  unmount,
  sameIdSession: () => auth({ id: 7 }),
  logout: () => auth(null),
  loading: () => auth(m.auth.user, true),
  reassignment: () => {
    m.rows = [{ ...row(), user_id: 8 }];
  },
  inactive: () => {
    m.rows = [{ ...row(), status: "inactive" }];
  },
  mailbox: () => {
    m.rows = [{ ...row(), voicemail_enabled: true }];
  },
  shared: () => {
    m.rows = [{ ...row(), type: "shared" }];
  },
  replacementIdentity: () => {
    m.rows = [{ ...row(), extension_number: "2002" }];
  },
  removed: () => {
    m.rows = [];
  },
  missingCache: () => {
    m.cache = false;
  },
  queryError: () => {
    m.queryError = true;
    render();
  },
};
it.each(Object.keys(boundaries))(
  "does not mutate a retained native confirmation after %s",
  async (key) => {
    const enable = confirm();
    boundaries[key as keyof typeof boundaries]();
    enable();
    await flush();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.invalidate).not.toHaveBeenCalled();
    expect(m.retiredWrites).toBe(0);
  },
);
it("permanently retires an observed row change even after its values return", async () => {
  const enable = confirm();
  m.rows = [{ ...row(), user_id: 8 }];
  render();
  m.rows = [row()];
  render();
  enable();
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
  confirm()();
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(1);
});
it("retires away-and-back auth without waiting for render", async () => {
  const enable = confirm(),
    owner = m.auth.user;
  auth(null);
  auth(owner);
  enable();
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
  confirm()();
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(1);
});
it("allows an unchanged row copied by a cache refresh", async () => {
  const enable = confirm();
  m.rows = [{ ...row() }];
  enable();
  await flush();
  expect(m.mutate).toHaveBeenCalledWith({
    id: 101,
    tenantId: 18,
    voicemailEnabled: true,
  });
});
it("reserves confirmation and saving synchronously; repeated retained presses send once", async () => {
  render();
  const change = press();
  change();
  change();
  expect(m.alert).toHaveBeenCalledTimes(1);
  expect(render()).toContain("Saving…");
  const result = deferred();
  m.mutate.mockReturnValueOnce(result.promise);
  const enable = m.alert.mock.calls[0][2][1].onPress;
  enable();
  enable();
  change();
  expect(m.mutate).toHaveBeenCalledTimes(1);
  m.alert.mock.calls[0][3].onDismiss();
  enable();
  expect(m.mutate).toHaveBeenCalledTimes(1);
  result.resolve();
  await flush();
  expect(m.invalidate).toHaveBeenCalledWith({
    tenantId: 18,
    page: 1,
    pageSize: 50,
    sortBy: "extension_number",
    sortOrder: "asc",
  });
});
it.each(["cancel", "dismiss"])(
  "retires confirmation on %s and permits a fresh confirmation",
  async (mode) => {
    const enable = confirm();
    const alert = m.alert.mock.calls[0];
    if (mode === "cancel") alert[2][0].onPress();
    else alert[3].onDismiss();
    enable();
    await flush();
    expect(m.mutate).not.toHaveBeenCalled();
    confirm()();
    await flush();
    expect(m.mutate).toHaveBeenCalledTimes(1);
  },
);
it("keeps current failure feedback, releases busy and allows an explicit retry", async () => {
  m.mutate.mockRejectedValueOnce(new Error("try again"));
  confirm()();
  await flush();
  expect(render()).toContain("try again");
  expect(m.presses.get("Enable voicemail for extension 1001").disabled).toBe(
    false,
  );
  confirm()();
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(2);
  expect(render()).not.toContain("try again");
});
it.each(
  Object.keys(boundaries).flatMap((key) => [
    [key, "success"],
    [key, "failure"],
  ]),
)("ignores stale %s mutation completion (%s)", async (key, outcome) => {
  const result = deferred();
  m.mutate.mockReturnValueOnce(result.promise);
  confirm()();
  expect(m.mutate).toHaveBeenCalledTimes(1);
  boundaries[key as keyof typeof boundaries]();
  const writes = m.writes;
  if (outcome === "success") result.resolve();
  else result.reject(new Error("old failure"));
  await flush();
  expect(m.invalidate).not.toHaveBeenCalled();
  expect(m.writes).toBe(writes);
  expect(m.retiredWrites).toBe(0);
  if (!m.retired) expect(render()).not.toContain("old failure");
});
it("ignores stale invalidation completion after changing workspace", async () => {
  const result = deferred();
  m.invalidate.mockReturnValueOnce(result.promise);
  confirm()();
  await flush();
  expect(m.invalidate).toHaveBeenCalledTimes(1);
  m.tenant = 19;
  render();
  const writes = m.writes;
  result.reject(new Error("old invalidation"));
  await flush();
  expect(m.writes).toBe(writes);
  expect(render()).not.toContain("old invalidation");
});
it("preserves disabling an already enabled inactive mailbox without an Enable alert", async () => {
  m.rows = [
    { ...row(), status: "inactive", user_id: null, voicemail_enabled: true },
  ];
  render();
  press()();
  await flush();
  expect(m.alert).not.toHaveBeenCalled();
  expect(m.mutate).toHaveBeenCalledWith({
    id: 101,
    tenantId: 18,
    voicemailEnabled: false,
  });
});
it("cleans up auth observation on unmount", () => {
  render();
  expect(m.listeners.size).toBe(1);
  unmount();
  expect(m.listeners.size).toBe(0);
});
it("does not revive an old error after the row changes away and back", async () => {
  m.mutate.mockRejectedValueOnce(new Error("old row failure"));
  confirm()();
  await flush();
  expect(render()).toContain("old row failure");
  m.rows = [{ ...row(), user_id: 8 }];
  render();
  m.rows = [row()];
  expect(render()).not.toContain("old row failure");
});
it("a current invalidation failure allows an explicit fresh retry", async () => {
  m.invalidate.mockRejectedValueOnce(new Error("refresh failed"));
  confirm()();
  await flush();
  expect(render()).toContain("refresh failed");
  confirm()();
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(2);
  expect(render()).not.toContain("refresh failed");
});
it("unmount cleanup retires old confirmation across a fresh component mount", async () => {
  const enable = confirm();
  for (const slot of m.frame.values) slot?.cleanup?.();
  // Fresh mount receives a new hook frame; the old closure cannot acquire its scope.
  m.frame = { index: 0, values: [], effects: [] };
  render();
  enable();
  await flush();
  expect(m.mutate).not.toHaveBeenCalled();
  confirm()();
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(1);
});
function webConfirmation() {
  m.platform = "web";
  render();
  press()();
  render();
  expect(m.modal?.visible).toBe(true);
  expect(m.alert).not.toHaveBeenCalled();
  return m.presses.get("Confirm enable voicemail mailbox")
    .onPress as () => void;
}
it("web opens a real confirmation and never enables merely by opening or closing it", async () => {
  webConfirmation();
  expect(m.mutate).not.toHaveBeenCalled();
  expect(render()).toContain("Enable voicemail mailbox?");
  m.presses.get("Cancel voicemail mailbox confirmation").onPress();
  await flush();
  render();
  expect(m.modal).toBeNull();
  expect(m.mutate).not.toHaveBeenCalled();
  expect(m.presses.get("Enable voicemail for extension 1001").disabled).toBe(
    false,
  );
});
it.each(["cancel", "requestClose", "dismiss"])(
  "web %s closes confirmation and unlocks a different enabled mailbox",
  async (mode) => {
    m.rows.push({
      ...row(),
      id: 102,
      extension_number: "1002",
      voicemail_enabled: true,
    });
    const enable = webConfirmation();
    expect(m.presses.get("Disable voicemail for extension 1002").disabled).toBe(
      true,
    );
    const close =
      mode === "cancel"
        ? m.presses.get("Cancel voicemail mailbox confirmation").onPress
        : mode === "requestClose"
          ? m.modal.onRequestClose
          : m.modal.onDismiss;
    close();
    render();
    expect(m.modal).toBeNull();
    expect(m.presses.get("Disable voicemail for extension 1002").disabled).toBe(
      false,
    );
    enable();
    expect(m.mutate).not.toHaveBeenCalled();
    m.presses.get("Disable voicemail for extension 1002").onPress();
    await flush();
    expect(m.mutate).toHaveBeenCalledWith({
      id: 102,
      tenantId: 18,
      voicemailEnabled: false,
    });
  },
);
it("web confirms once, keeps other controls busy until completion, and unlocks afterward", async () => {
  m.rows.push({
    ...row(),
    id: 102,
    extension_number: "1002",
    voicemail_enabled: true,
  });
  const result = deferred();
  m.mutate.mockReturnValueOnce(result.promise);
  const enable = webConfirmation(),
    close = m.modal.onRequestClose;
  enable();
  enable();
  close();
  render();
  expect(m.modal).toBeNull();
  expect(m.mutate).toHaveBeenCalledTimes(1);
  expect(m.presses.get("Disable voicemail for extension 1002").disabled).toBe(
    true,
  );
  result.resolve();
  await flush();
  render();
  expect(m.presses.get("Disable voicemail for extension 1002").disabled).toBe(
    false,
  );
  expect(m.invalidate).toHaveBeenCalledWith({
    tenantId: 18,
    page: 1,
    pageSize: 50,
    sortBy: "extension_number",
    sortOrder: "asc",
  });
});
it("web failure retains an error and permits an explicit fresh confirmed retry", async () => {
  m.mutate.mockRejectedValueOnce(new Error("web save failed"));
  webConfirmation()();
  await flush();
  expect(render()).toContain("web save failed");
  expect(m.modal).toBeNull();
  expect(m.presses.get("Enable voicemail for extension 1001").disabled).toBe(
    false,
  );
  webConfirmation()();
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(2);
  expect(render()).not.toContain("web save failed");
});
it.each(Object.keys(boundaries))(
  "web confirmation retires after %s without relying on Alert",
  async (key) => {
    const enable = webConfirmation();
    boundaries[key as keyof typeof boundaries]();
    enable();
    await flush();
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.invalidate).not.toHaveBeenCalled();
    expect(m.retiredWrites).toBe(0);
    if (!m.retired) {
      render();
      expect(m.modal).toBeNull();
    }
  },
);
it("web row reassignment closes the old dialog and permits a fresh confirmation for its new assignment", async () => {
  const enable = webConfirmation();
  m.rows = [{ ...row(), user_id: 8 }];
  render();
  expect(m.modal).toBeNull();
  expect(m.presses.get("Enable voicemail for extension 1001").disabled).toBe(
    false,
  );
  enable();
  expect(m.mutate).not.toHaveBeenCalled();
  webConfirmation()();
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(1);
});
it("web repeated row presses cannot open another confirmation while one is visible", async () => {
  m.platform = "web";
  render();
  const change = press();
  change();
  change();
  render();
  expect(m.modal?.visible).toBe(true);
  expect(m.alert).not.toHaveBeenCalled();
  expect(m.mutate).not.toHaveBeenCalled();
  m.presses.get("Cancel voicemail mailbox confirmation").onPress();
  change();
  render();
  expect(m.modal?.visible).toBe(true);
  m.presses.get("Confirm enable voicemail mailbox").onPress();
  await flush();
  expect(m.mutate).toHaveBeenCalledTimes(1);
});
