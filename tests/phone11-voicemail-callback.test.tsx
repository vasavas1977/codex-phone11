import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { Alert } from "react-native";
import { beginPlaybackSession } from "../lib/cloud-recordings/playback-session";
import VoicemailScreen, {
  VoicemailCallbackAction,
  voicemailCallbackTarget,
  voicemailInboxErrorMessage,
} from "../app/voicemail/index";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

const mocks = vi.hoisted(() => ({
  placeCall: vi.fn(),
  calling: false,
  platform: "ios",
  account: null as { ownerUserId: number; tenantId: number } | null,
  authLoading: false,
  invalidate: vi.fn(),
  query: vi.fn(),
  playback: [] as { path: string; sourceURL: (base: string, path: string) => string | null }[],
  buttons: new Map<string, { press: () => void; disabled: boolean; minHeight: number }>(),
  frame: null as { values: any[]; index: number; effectRegistered?: boolean; cleanup?: () => void } | null,
  user: { id: 1 } as { id: number } | null,
  inbox: { data: [] as any[], isLoading: false, error: null as unknown, isFetching: false, refetch: vi.fn() },
  markRead: { isPending: false, error: null as unknown, data: undefined as { success: boolean } | undefined, variables: undefined as { id: number } | undefined, mutateAsync: vi.fn() },
  remove: { isPending: false, error: null as unknown, data: undefined as { success: boolean } | undefined, variables: undefined as { id: number } | undefined, mutateAsync: vi.fn() },
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useState: (initial: any) => {
    const frame = mocks.frame;
    if (!frame) return actual.useState(initial);
    const index = frame.index++;
    if (index >= frame.values.length) frame.values[index] = initial;
    return [frame.values[index], (value: any) => {
      frame.values[index] = typeof value === "function" ? value(frame.values[index]) : value;
    }];
  }, useRef: (initial: any) => {
    const frame = mocks.frame;
    if (!frame) return actual.useRef(initial);
    const index = frame.index++;
    if (index >= frame.values.length) frame.values[index] = { current: initial };
    return frame.values[index];
  }, useEffect: (effect: () => void | (() => void)) => {
    const frame = mocks.frame;
    if (!frame || frame.effectRegistered) return;
    frame.effectRegistered = true;
    const cleanup = effect();
    if (typeof cleanup === "function") frame.cleanup = cleanup;
  } };
});

vi.mock("react-native", () => ({
  Platform: { get OS() { return mocks.platform; } },
  Alert: { alert: vi.fn() },
  ScrollView: ({ children }: any) => createElement("div", null, children),
  StyleSheet: { create: (styles: any) => styles },
  Text: ({ children }: any) => createElement("span", null, children),
  View: ({ children }: any) => createElement("div", null, children),
  TouchableOpacity: ({ children, accessibilityLabel, disabled, onPress, style }: any) => {
    if (accessibilityLabel) {
      mocks.buttons.set(accessibilityLabel, {
        press: onPress,
        disabled: Boolean(disabled),
        minHeight: style?.minHeight,
      });
    }
    return createElement("button", { "aria-label": accessibilityLabel, disabled, onClick: onPress }, children);
  },
}));
vi.mock("../hooks/use-phone-call", () => ({
  usePhoneCall: () => ({ placeCall: mocks.placeCall, calling: mocks.calling }),
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#06f" }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: mocks.user, loading: mocks.authLoading }) }));
vi.mock("../lib/sip/account-store", () => ({
  useSipAccountStore: Object.assign((select: any) => select({ account: mocks.account }), {
    getState: () => ({ account: mocks.account }),
  }),
}));
vi.mock("../components/screen-container", () => ({ ScreenContainer: ({ children }: any) => createElement("main", null, children) }));
vi.mock("../components/cloud-recordings/cloud-playback", () => ({ Playback: (props: any) => { mocks.playback.push(props); return null; } }));
vi.mock("expo-router", () => ({ router: { canGoBack: () => false, replace: vi.fn(), back: vi.fn() } }));
vi.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ pbx: { voicemail: { list: { invalidate: mocks.invalidate } } } }),
    pbx: { voicemail: {
      list: { useQuery: (input: unknown) => { mocks.query(input); return mocks.inbox; } },
      markRead: { useMutation: () => mocks.markRead },
      delete: { useMutation: () => mocks.remove },
    } },
  },
}));

function renderInbox() {
  mocks.frame ??= { values: [], index: 0 };
  mocks.frame.index = 0;
  mocks.buttons.clear();
  return renderToStaticMarkup(createElement(VoicemailScreen));
}

const message = {
  id: 7, extension_number: "3001", caller_number: "1020", caller_name: "Support",
  duration_seconds: 20, status: "read", created_at: "2026-10-04T00:00:00Z",
};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: (result: { success: boolean }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ success: boolean }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pressDelete() {
  mocks.buttons.get("Delete voicemail from Support")?.press();
  return vi.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.text === "Delete")?.onPress;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buttons.clear();
  mocks.calling = false;
  mocks.platform = "ios";
  mocks.account = null;
  mocks.authLoading = false;
  mocks.playback = [];
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.frame = null;
  mocks.user = { id: 1 };
  mocks.inbox = { data: [], isLoading: false, error: null, isFetching: false, refetch: vi.fn().mockResolvedValue(undefined) };
  mocks.markRead = { isPending: false, error: null, data: undefined, variables: undefined, mutateAsync: vi.fn().mockResolvedValue({ success: true }) };
  mocks.remove = { isPending: false, error: null, data: undefined, variables: undefined, mutateAsync: vi.fn().mockResolvedValue({ success: true }) };
});
afterEach(() => mocks.frame?.cleanup?.());

describe.each(["web", "ios", "android"])("retained voicemail consumer on %s", platform => {
  beforeEach(() => { mocks.platform = platform; });
  const revocations = [
    ["sign-out", () => { mocks.user = null; }],
    ["same-ID login replacement", () => { mocks.user = { id: 1 }; }],
    ["workspace replacement", () => { mocks.account = { ownerUserId: 1, tenantId: 21 }; }],
    ["loading authorization", () => { mocks.authLoading = true; }],
    ["inbox denial", () => { mocks.inbox.error = { data: { code: "FORBIDDEN" } }; }],
    ["message removal", () => { mocks.inbox.data = []; }],
    ["same-ID message replacement", () => { mocks.inbox.data = [{ ...message, caller_number: "1021" }]; }],
  ] as const;
  it.each(revocations)("rejects retained selection, callback, confirmation and media source after %s", (_name, revoke) => {
    mocks.account = { ownerUserId: 1, tenantId: 20 };
    mocks.inbox.data = [{ ...message, tenant_id: 20 }];
    renderInbox();
    const oldOpen = mocks.buttons.get("Voicemail from Support")!.press;
    oldOpen(); renderInbox();
    const oldCall = mocks.buttons.get("Call back Support")!.press;
    const oldDelete = pressDelete()!;
    const oldPlayback = mocks.playback.at(-1)!;
    expect(oldPlayback.sourceURL("https://api.example", oldPlayback.path)).toBe("https://api.example/api/recordings/voicemail/7");
    revoke(); // Store/auth changes are checked even before the next render.
    oldCall(); oldDelete(); oldOpen();
    expect(mocks.placeCall).not.toHaveBeenCalled();
    expect(mocks.remove.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.markRead.mutateAsync).not.toHaveBeenCalled();
    expect(oldPlayback.sourceURL("https://api.example", oldPlayback.path)).toBeNull();
    renderInbox();
    expect(renderInbox()).not.toContain("Mailbox 3001");
  });

  it("retires confirmed deletion immediately while reconciliation remains pending", async () => {
    mocks.inbox.data = [message];
    const reconciliation = deferred();
    mocks.invalidate.mockReturnValue(reconciliation.promise);
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    const oldCall = mocks.buttons.get("Call back Support")!.press;
    const oldPlayback = mocks.playback.at(-1)!;
    pressDelete()?.(); await flush();
    expect(renderInbox()).toContain("No voicemail"); // Query still holds its original row.
    expect(renderInbox()).not.toContain("Mailbox 3001");
    expect(oldPlayback.sourceURL("https://api.example", oldPlayback.path)).toBeNull();
    oldCall(); expect(mocks.placeCall).not.toHaveBeenCalled();
    mocks.inbox.error = { data: { code: "FORBIDDEN" } }; renderInbox();
    mocks.inbox.error = null;
    expect(renderInbox()).toContain("No voicemail"); // Access retry cannot resurrect a confirmed deletion.
    reconciliation.resolve({ success: true }); await flush();
  });

  it("keeps normal profile/read-state reconciliation current and rejects mismatched media paths", async () => {
    mocks.account = { ownerUserId: 1, tenantId: 20 };
    mocks.inbox.data = [{ ...message, tenant_id: 20, status: "new" }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    const oldCall = mocks.buttons.get("Call back Support")!.press;
    const source = mocks.playback.at(-1)!;
    Object.assign(mocks.user!, { name: "Profile refreshed" });
    mocks.inbox.data = [{ ...message, tenant_id: 20 }]; renderInbox();
    await flush();
    oldCall();
    expect(mocks.placeCall).toHaveBeenCalledWith("1020");
    expect(mocks.markRead.mutateAsync).toHaveBeenCalledWith({ id: 7, tenantId: 20 });
    expect(mocks.query).toHaveBeenCalledWith({ tenantId: 20 });
    expect(source.sourceURL("https://api.example", source.path)).toBe("https://api.example/api/recordings/voicemail/7");
    expect(source.sourceURL("https://api.example", "/api/recordings/voicemail/8")).toBeNull();
  });
});

describe("voicemail completion and selection ownership", () => {
  it("retains A's deletion lock and row busy state while B also deletes, then retires A without closing B", async () => {
    const a = deferred(), b = deferred();
    mocks.remove.mutateAsync.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    mocks.inbox.data = [message, { ...message, id: 8, caller_name: "Sales" }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox(); pressDelete()?.();
    mocks.buttons.get("Voicemail from Sales")!.press(); renderInbox();
    mocks.buttons.get("Delete voicemail from Sales")!.press();
    vi.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.text === "Delete")?.onPress?.();
    mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    expect(mocks.buttons.get("Delete voicemail from Support")!.disabled).toBe(true);
    pressDelete()?.(); expect(mocks.remove.mutateAsync).toHaveBeenCalledTimes(2);
    mocks.buttons.get("Voicemail from Sales")!.press(); renderInbox();
    a.resolve({ success: true }); await flush();
    expect(renderInbox()).not.toContain("Voicemail from Support");
    expect(renderInbox()).toContain("Mailbox 3001");
    expect(mocks.buttons.get("Delete voicemail from Sales")!.disabled).toBe(true);
    b.reject(new Error("synthetic retry failure")); await flush();
    renderInbox(); // This retained-hook fixture renders state updates explicitly.
    expect(mocks.buttons.get("Delete voicemail from Sales")!.disabled).toBe(false);
    expect(renderInbox()).toContain("Could not delete voicemail");
  });

  it("retires old Refresh callbacks while the current unavailable inbox can explicitly retry", () => {
    mocks.account = { ownerUserId: 1, tenantId: 20 };
    mocks.inbox.error = { data: { code: "FORBIDDEN" } };
    renderInbox(); const refresh = mocks.buttons.get("Refresh voicemail")!.press;
    refresh(); expect(mocks.inbox.refetch).toHaveBeenCalledOnce();
    mocks.account = { ownerUserId: 1, tenantId: 21 }; refresh();
    expect(mocks.inbox.refetch).toHaveBeenCalledOnce();
    renderInbox(); mocks.buttons.get("Refresh voicemail")!.press();
    expect(mocks.inbox.refetch).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenLastCalledWith({ tenantId: 21 });
  });

  it("keeps confirmed deletion retired when the same owner replaces its phone account", async () => {
    mocks.account = { ownerUserId: 1, tenantId: 20 };
    mocks.inbox.data = [{ ...message, tenant_id: 20 }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox(); pressDelete()?.(); await flush();
    mocks.account = { ownerUserId: 1, tenantId: 20 };
    expect(renderInbox()).toContain("No voicemail");
  });

  it("releases a completed request's lock if its row disappeared, without reviving feedback", async () => {
    const pending = deferred(); mocks.markRead.mutateAsync.mockReturnValueOnce(pending.promise);
    mocks.inbox.data = [{ ...message, status: "new" }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    mocks.inbox.data = []; renderInbox(); pending.reject(new Error("old failure")); await flush();
    mocks.inbox.data = [{ ...message, status: "new" }]; renderInbox();
    mocks.buttons.get("Voicemail from Support")!.press(); await flush();
    expect(mocks.markRead.mutateAsync).toHaveBeenCalledTimes(2);
    expect(renderInbox()).not.toContain("Could not mark voicemail");
  });

  it("does not revive an old confirmation after switching away and back to the same message", () => {
    mocks.inbox.data = [message, { ...message, id: 8, caller_name: "Sales" }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    const oldDelete = pressDelete()!;
    mocks.buttons.get("Voicemail from Sales")!.press(); renderInbox();
    mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    oldDelete(); expect(mocks.remove.mutateAsync).not.toHaveBeenCalled();
    pressDelete()?.(); expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ id: 7 });
  });

  it("cannot reopen a removed row when it reappears, and requires a new selection", () => {
    mocks.inbox.data = [message];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    const oldDelete = pressDelete()!;
    mocks.inbox.data = []; renderInbox();
    mocks.inbox.data = [message];
    expect(renderInbox()).not.toContain("Mailbox 3001");
    oldDelete(); expect(mocks.remove.mutateAsync).not.toHaveBeenCalled();
    mocks.buttons.get("Voicemail from Support")!.press();
    expect(renderInbox()).toContain("Mailbox 3001");
  });

  it.each(["read", "delete"] as const)("ignores late %s completion after inbox denial and permits an explicit retry", async kind => {
    const pending = deferred();
    const mutation = kind === "read" ? mocks.markRead : mocks.remove;
    mutation.mutateAsync.mockReturnValueOnce(pending.promise);
    mocks.inbox.data = [{ ...message, status: kind === "read" ? "new" : "read" }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    if (kind === "delete") pressDelete()?.();
    mocks.inbox.error = { data: { code: "FORBIDDEN" } }; renderInbox();
    mocks.inbox.error = null; renderInbox();
    pending.resolve({ success: true }); await flush();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(renderInbox()).not.toMatch(/Deleting…|Mailbox 3001|Could not delete/);
    mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    if (kind === "delete") pressDelete()?.();
    await flush(); expect(mutation.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("marks a newly selected message while a different read request is pending; late failure cannot replace current feedback", async () => {
    const pending = deferred();
    mocks.markRead.mutateAsync.mockReturnValueOnce(pending.promise);
    mocks.inbox.data = [{ ...message, status: "new" }, { ...message, id: 8, caller_name: "Sales", status: "new" }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    mocks.buttons.get("Voicemail from Sales")!.press(); renderInbox(); await flush();
    expect(mocks.markRead.mutateAsync).toHaveBeenNthCalledWith(2, { id: 8 });
    pending.reject(new Error("old private failure")); await flush();
    expect(renderInbox()).not.toContain("Could not mark voicemail");
  });

  it("retires both confirmed parallel deletions without an older receipt replacing current feedback", async () => {
    const old = deferred(), next = deferred();
    mocks.remove.mutateAsync.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    mocks.inbox.data = [message, { ...message, id: 8, caller_name: "Sales" }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox(); pressDelete()?.();
    mocks.buttons.get("Voicemail from Sales")!.press(); renderInbox();
    mocks.buttons.get("Delete voicemail from Sales")!.press();
    vi.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.text === "Delete")?.onPress?.();
    old.resolve({ success: true }); await flush();
    expect(renderInbox()).not.toContain("Voicemail from Support");
    expect(renderInbox()).toContain("Deleting…");
    next.resolve({ success: true }); await flush();
    expect(renderInbox()).toContain("No voicemail");
  });

  it("rejects a late token's source publication after workspace replacement using the actual playback session", async () => {
    mocks.account = { ownerUserId: 1, tenantId: 20 };
    mocks.inbox.data = [{ ...message, tenant_id: 20 }];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    const source = mocks.playback.at(-1)!;
    let resolve!: (token: string) => void;
    const token = new Promise<string>(yes => { resolve = yes; });
    const player = { pause: vi.fn(), replace: vi.fn() };
    const session = beginPlaybackSession({ player, base: "https://api.example", callUuid: "voicemail-7",
      path: source.path, sourceURL: source.sourceURL, identity: () => mocks.user, token: () => token,
      subscribe: () => () => {}, ready: vi.fn(), failed: vi.fn() });
    mocks.account = { ownerUserId: 1, tenantId: 21 };
    resolve("synthetic token"); await session.done;
    expect(player.replace).not.toHaveBeenCalled();
    session.dispose();
  });

  it("does not retire a replacement message or invalidate its inbox on the old deletion's completion", async () => {
    const pending = deferred(); mocks.remove.mutateAsync.mockReturnValueOnce(pending.promise);
    mocks.inbox.data = [message];
    renderInbox(); mocks.buttons.get("Voicemail from Support")!.press(); renderInbox(); pressDelete()?.();
    mocks.inbox.data = [{ ...message, caller_number: "1021" }]; renderInbox();
    mocks.buttons.get("Voicemail from Support")!.press(); renderInbox();
    pending.resolve({ success: true }); await flush();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(renderInbox()).toContain("Mailbox 3001");
    mocks.buttons.get("Call back Support")!.press(); expect(mocks.placeCall).toHaveBeenCalledWith("1021");
  });
});

describe("voicemail mutation feedback", () => {
  it("retains the expanded message on failed deletion and shows safe retry guidance", async () => {
    mocks.inbox.data = [message];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    expect(renderInbox()).toContain("Mailbox 3001");
    mocks.buttons.get("Delete voicemail from Support")?.press();
    const buttons = vi.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    mocks.remove.mutateAsync.mockImplementationOnce(async () => {
      mocks.remove.error = new Error("private deletion response");
      throw mocks.remove.error;
    });
    buttons?.find(button => button.text === "Delete")?.onPress?.();
    await Promise.resolve();
    const html = renderInbox();
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ id: 7 });
    expect(html).toContain("Could not delete voicemail. Try again.");
    expect(html).toContain("Mailbox 3001");
    expect(html).not.toContain("private deletion response");
    expect(mocks.buttons.get("Delete voicemail from Support")?.disabled).toBe(false);

    // Confirmed query removal, rather than an optimistic UI close, owns teardown.
    mocks.inbox.data = [];
    expect(renderInbox()).not.toContain("Mailbox 3001");
  });

  it("shows failed mark-read guidance without hiding playback or exposing errors", async () => {
    mocks.inbox.data = [{ ...message, status: "new" }];
    mocks.markRead.mutateAsync.mockImplementationOnce(async () => {
      mocks.markRead.error = new Error("private mark-read response");
      throw mocks.markRead.error;
    });
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    await Promise.resolve();
    const html = renderInbox();
    expect(html).toContain("Could not mark voicemail as read. Open it again to retry.");
    expect(html).toContain("Mailbox 3001");
    expect(html).not.toContain("private mark-read response");
  });

  it("hides old mutation feedback when the inbox is unavailable or signed out", () => {
    mocks.remove.error = new Error("private deletion response");
    mocks.user = null;
    expect(renderInbox()).not.toContain("Could not delete voicemail");
    mocks.user = { id: 1 };
    mocks.inbox.error = { data: { code: "FORBIDDEN" } };
    expect(renderInbox()).not.toContain("Could not delete voicemail");
    expect(renderInbox()).toContain("You do not have access to this voicemail inbox");
  });

  it("uses only the returned mailbox tenant for read and delete, while legacy rows remain compatible", async () => {
    mocks.inbox.data = [{ ...message, tenant_id: 20, status: "new" }];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    expect(mocks.markRead.mutateAsync).toHaveBeenCalledWith({ id: 7, tenantId: 20 });
    renderInbox();
    mocks.buttons.get("Delete voicemail from Support")?.press();
    vi.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.text === "Delete")?.onPress?.();
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ id: 7, tenantId: 20 });
    await flush();

    mocks.inbox.data = [{ ...message, status: "new" }];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    expect(mocks.markRead.mutateAsync).toHaveBeenLastCalledWith({ id: 7 });
  });

  it("does not claim success for false receipts, and clears them after inbox reconciliation", async () => {
    mocks.inbox.data = [{ ...message, status: "new" }];
    mocks.markRead.mutateAsync.mockResolvedValue({ success: false });
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    await flush();
    expect(renderInbox()).toContain("Could not mark voicemail as read");
    mocks.inbox.data = [message];
    expect(renderInbox()).not.toContain("Could not mark voicemail as read");
    mocks.remove.mutateAsync.mockResolvedValue({ success: false });
    pressDelete()?.();
    await flush();
    expect(renderInbox()).toContain("Could not delete voicemail");
    mocks.inbox.data = [];
    expect(renderInbox()).not.toContain("Could not delete voicemail");
  });

  it("refuses an old destructive confirmation after an account switch, even before rerender", () => {
    mocks.inbox.data = [message];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    renderInbox();
    const oldConfirmation = pressDelete();
    mocks.user = { id: 2 };
    oldConfirmation?.();
    expect(mocks.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it.each(["read", "delete"] as const)("suppresses late %s failure after switching accounts with an empty inbox", async kind => {
    const pending = deferred();
    const mutation = kind === "read" ? mocks.markRead : mocks.remove;
    mutation.mutateAsync.mockImplementationOnce(async () => {
      try { return await pending.promise; }
      catch (error) { mutation.error = error; throw error; }
    });
    mocks.inbox.data = [{ ...message, status: kind === "read" ? "new" : "read" }];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    renderInbox();
    if (kind === "delete") pressDelete()?.();
    mocks.user = { id: 2 };
    mocks.inbox.data = [];
    renderInbox();
    pending.reject(new Error("old private response"));
    await flush();
    const html = renderInbox();
    expect(mutation.error).toBeInstanceOf(Error); // The attached observer retained A's failure.
    expect(html).toContain("No voicemail");
    expect(html).not.toMatch(/Could not (delete|mark voicemail)|old private response|Mailbox 3001/);
  });

  it("old rejection cannot overwrite a new account's pending deletion or its success", async () => {
    const old = deferred(), next = deferred();
    mocks.remove.mutateAsync.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    mocks.inbox.data = [message];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    renderInbox();
    pressDelete()?.();
    mocks.user = { id: 2 };
    mocks.inbox.data = [{ ...message, id: 8 }];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    renderInbox();
    expect(mocks.buttons.get("Delete voicemail from Support")?.disabled).toBe(false);
    pressDelete()?.();
    expect(renderInbox()).toContain("Deleting…");
    old.reject(new Error("old private response"));
    await flush();
    expect(renderInbox()).toContain("Deleting…");
    expect(renderInbox()).not.toContain("Could not delete voicemail");
    next.resolve({ success: true });
    await flush();
    expect(renderInbox()).not.toMatch(/Deleting…|Could not delete voicemail/);
    expect(mocks.remove.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("retires pending actions on same-owner session replacement and unmount", async () => {
    const pending = deferred();
    mocks.remove.mutateAsync.mockReturnValueOnce(pending.promise);
    mocks.inbox.data = [message];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    renderInbox();
    const confirmation = pressDelete();
    confirmation?.();
    mocks.user = { id: 1 }; // Same numeric account, replaced authenticated object.
    expect(renderInbox()).not.toContain("Deleting…");
    mocks.frame?.cleanup?.();
    confirmation?.();
    expect(mocks.remove.mutateAsync).toHaveBeenCalledOnce();
    pending.reject(new Error("old private response"));
    await flush();
    expect(renderInbox()).not.toContain("Could not delete voicemail");
  });
});

describe("voicemail callback", () => {
  it("normalizes formatted phone numbers and accepts numeric extensions", () => {
    expect(voicemailCallbackTarget(" +66 (2) 030-3001 ")).toBe("+6620303001");
    expect(voicemailCallbackTarget("3001")).toBe("3001");
  });

  it("rejects missing, malformed, or ambiguous caller IDs", () => {
    for (const value of [null, undefined, "", "Unknown", "Call 3001", "*#"])
      expect(voicemailCallbackTarget(value)).toBeNull();
  });

  it("does not dial when voicemail details are rendered and calls the normalized caller only after an explicit tap", () => {
    renderToStaticMarkup(
      createElement(VoicemailCallbackAction, {
        callerNumber: "+66 (2) 030-3001",
        callerName: "Support",
      }),
    );
    const action = mocks.buttons.get("Call back Support");
    expect(action).toBeDefined();
    expect(action?.minHeight).toBeGreaterThanOrEqual(44);
    expect(mocks.placeCall).not.toHaveBeenCalled();

    action?.press();
    expect(mocks.placeCall).toHaveBeenCalledTimes(1);
    expect(mocks.placeCall).toHaveBeenCalledWith("+6620303001");
  });

  it("hides the action for invalid caller IDs and disables it while another call is starting", () => {
    renderToStaticMarkup(
      createElement(VoicemailCallbackAction, { callerNumber: "No caller ID", callerName: "Unknown caller" }),
    );
    expect(mocks.buttons.has("Call back Unknown caller")).toBe(false);

    mocks.calling = true;
    renderToStaticMarkup(
      createElement(VoicemailCallbackAction, { callerNumber: "3001", callerName: "Support" }),
    );
    const action = mocks.buttons.get("Call back Support");
    expect(action?.disabled).toBe(true);
    action?.press();
    expect(mocks.placeCall).not.toHaveBeenCalled();
  });
});

describe("voicemail inbox error copy", () => {
  it("shows setup guidance only for SERVICE_UNAVAILABLE", () => {
    expect(voicemailInboxErrorMessage({ data: { code: "SERVICE_UNAVAILABLE" } })).toContain(
      "storage is not configured",
    );
    expect(voicemailInboxErrorMessage({ data: { code: "INTERNAL_SERVER_ERROR" } })).toContain(
      "Check your connection",
    );
  });

  it("uses safe access copy for auth failures and never exposes provider error text", () => {
    expect(voicemailInboxErrorMessage({ data: { code: "UNAUTHORIZED" } })).toBe(
      "Sign in again to view voicemail.",
    );
    expect(voicemailInboxErrorMessage({ data: { code: "FORBIDDEN" } })).toBe(
      "You do not have access to this voicemail inbox.",
    );
    const result = voicemailInboxErrorMessage({
      message: "database password leaked",
      data: { code: "INTERNAL_SERVER_ERROR", message: "private server detail" },
    });
    expect(result).toContain("Check your connection");
    expect(result).not.toContain("password");
    expect(result).not.toContain("private server detail");
  });

  it("handles malformed errors with generic retry-safe copy", () => {
    expect(voicemailInboxErrorMessage("unexpected failure")).toBe(
      "Could not load voicemail. Check your connection and try again.",
    );
  });
});
