import { beforeEach, describe, expect, it, vi } from "vitest";
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
  frame: null as { values: any[]; index: number } | null,
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

  it("uses only the returned mailbox tenant for read and delete, while legacy rows remain compatible", () => {
    mocks.inbox.data = [{ ...message, tenant_id: 20, status: "new" }];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    expect(mocks.markRead.mutateAsync).toHaveBeenCalledWith({ id: 7, tenantId: 20 });
    renderInbox();
    mocks.buttons.get("Delete voicemail from Support")?.press();
    vi.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.text === "Delete")?.onPress?.();
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ id: 7, tenantId: 20 });

    mocks.inbox.data = [{ ...message, status: "new" }];
    renderInbox();
    mocks.buttons.get("Voicemail from Support")?.press();
    expect(mocks.markRead.mutateAsync).toHaveBeenLastCalledWith({ id: 7 });
  });

  it("does not claim success for false receipts, and clears them after inbox reconciliation", () => {
    mocks.inbox.data = [{ ...message, status: "new" }];
    mocks.markRead.data = { success: false };
    mocks.markRead.variables = { id: 7 };
    expect(renderInbox()).toContain("Could not mark voicemail as read");
    mocks.inbox.data = [message];
    expect(renderInbox()).not.toContain("Could not mark voicemail as read");
    mocks.remove.data = { success: false };
    mocks.remove.variables = { id: 7 };
    expect(renderInbox()).toContain("Could not delete voicemail");
    mocks.inbox.data = [];
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
