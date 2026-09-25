import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

const mocks = vi.hoisted(() => ({
  placeCall: vi.fn(),
  calling: false,
  buttons: new Map<string, { press: () => void; disabled: boolean; minHeight: number }>(),
}));

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
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: ({ children }: any) => createElement("main", null, children) }));
vi.mock("../components/cloud-recordings/cloud-playback", () => ({ Playback: () => null }));
vi.mock("expo-router", () => ({ router: { canGoBack: () => false, replace: vi.fn(), back: vi.fn() } }));
vi.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ pbx: { voicemail: { list: { invalidate: vi.fn() } } } }),
    pbx: { voicemail: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      markRead: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      delete: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    } },
  },
}));

import {
  VoicemailCallbackAction,
  voicemailCallbackTarget,
  voicemailInboxErrorMessage,
} from "../app/voicemail/index";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buttons.clear();
  mocks.calling = false;
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
