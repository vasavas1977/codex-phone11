import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { Alert } from "react-native";
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
  buttons: new Map<string, { press: () => void; disabled: boolean; minHeight: number }>(),
  frame: null as { values: any[]; index: number; effectRegistered?: boolean; cleanup?: () => void } | null,
  user: { id: 1 } as { id: number } | null,
  inbox: { data: [] as any[], isLoading: false, error: null as unknown },
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
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: mocks.user, loading: false }) }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: ({ children }: any) => createElement("main", null, children) }));
vi.mock("../components/cloud-recordings/cloud-playback", () => ({ Playback: () => null }));
vi.mock("expo-router", () => ({ router: { canGoBack: () => false, replace: vi.fn(), back: vi.fn() } }));
vi.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ pbx: { voicemail: { list: { invalidate: vi.fn() } } } }),
    pbx: { voicemail: {
      list: { useQuery: () => mocks.inbox },
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
  mocks.frame = null;
  mocks.user = { id: 1 };
  mocks.inbox = { data: [], isLoading: false, error: null };
  mocks.markRead = { isPending: false, error: null, data: undefined, variables: undefined, mutateAsync: vi.fn().mockResolvedValue({ success: true }) };
  mocks.remove = { isPending: false, error: null, data: undefined, variables: undefined, mutateAsync: vi.fn().mockResolvedValue({ success: true }) };
});
afterEach(() => mocks.frame?.cleanup?.());

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
