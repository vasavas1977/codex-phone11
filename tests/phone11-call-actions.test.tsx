import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  authOwner: 7 as number | null,
  presses: new Map<string, () => unknown>(),
  alerts: [] as { title: string; message: string; buttons: any[] }[],
  share: vi.fn(async () => ({ action: "sharedAction" })),
  copy: vi.fn(async () => true),
  contact: vi.fn(async () => undefined),
}));

vi.mock("react-native", () => ({
  Alert: {
    alert: (title: string, message: string, buttons: any[] = []) =>
      mocks.alerts.push({ title, message, buttons }),
  },
  Modal: ({ visible, children }: any) =>
    visible ? createElement("dialog", null, children) : null,
  Platform: { OS: "ios" },
  Pressable: ({ children, accessibilityLabel, onPress, disabled }: any) => {
    if (accessibilityLabel)
      mocks.presses.set(accessibilityLabel, disabled ? () => undefined : onPress);
    return createElement(
      "button",
      { "aria-label": accessibilityLabel, disabled },
      typeof children === "function" ? children({ pressed: false }) : children,
    );
  },
  ScrollView: ({ children }: any) => createElement("section", null, children),
  Share: { share: mocks.share },
  StyleSheet: {
    absoluteFill: {},
    hairlineWidth: 1,
    create: (styles: any) => styles,
  },
  Text: ({ children }: any) => createElement("span", null, children),
  View: ({ children }: any) => createElement("div", null, children),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => createElement("main", null, children),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: mocks.copy }));
vi.mock("expo-contacts", () => ({
  ContactTypes: { Person: "person" },
  presentFormAsync: mocks.contact,
}));
vi.mock("../components/ui/icon-symbol", () => ({
  IconSymbol: ({ name }: any) => createElement("i", null, name),
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#111",
    muted: "#666",
    primary: "#1672d4",
    surface: "#eee",
    border: "#ddd",
    error: "#d33",
  }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({
    user: mocks.authOwner === null ? null : { id: mocks.authOwner },
  }),
}));

// Imports follow mocks so the component binds the native test doubles.
// eslint-disable-next-line import/first
import {
  CallActionsSheet,
  callDetailsText,
  callShareText,
  type CallActionCall,
} from "../components/cloud-recordings/call-actions-sheet";

const call: CallActionCall = {
  id: "call-1",
  ownerUserId: 7,
  name: "Nok",
  number: "+66812345678",
  direction: "incoming",
  duration: "2:03",
  occurredAtLabel: "Today, 10:30",
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function render(overrides: Partial<React.ComponentProps<typeof CallActionsSheet>> = {}) {
  const props: React.ComponentProps<typeof CallActionsSheet> = {
    visible: true,
    call,
    starred: false,
    onCall: vi.fn(),
    onToggleStar: vi.fn(),
    onDeleteHistory: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, html: renderToStaticMarkup(<CallActionsSheet {...props} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.presses.clear();
  mocks.alerts.length = 0;
  mocks.authOwner = 7;
});

describe("call actions sheet", () => {
  it("copies and opens the native share sheet with concise call details", async () => {
    const { props } = render();
    const copy = mocks.presses.get("Copy number")!;
    void copy();
    void copy();
    await tick();
    expect(mocks.copy).toHaveBeenCalledWith(call.number);
    expect(mocks.copy).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalled();

    render();
    await mocks.presses.get("Share call details")!();
    await tick();
    expect(mocks.share).toHaveBeenCalledWith({
      title: "Phone11 call details",
      message: callShareText(call),
    });
    expect(callShareText(call)).toContain("Incoming call with Nok");
  });

  it("offers native create and add flows, or the exact matched profile", async () => {
    let result = render();
    expect(result.html).toContain("Star number");
    expect(result.html).toContain("Create new contact");
    expect(result.html).toContain("Add to existing contact");
    await mocks.presses.get("Create new contact")!();
    await tick();
    expect(mocks.contact).toHaveBeenLastCalledWith(
      null,
      expect.objectContaining({
        name: "Nok",
        phoneNumbers: [{ number: call.number, label: "Phone11" }],
      }),
      expect.objectContaining({ isNew: true }),
    );
    render();
    await mocks.presses.get("Add to existing contact")!();
    await tick();
    expect(mocks.contact).toHaveBeenLastCalledWith(
      null,
      expect.objectContaining({
        phoneNumbers: [{ number: call.number, label: "Phone11" }],
      }),
      expect.objectContaining({ isNew: false, allowsActions: true }),
    );

    result = render({ call: { ...call, deviceContactId: "device-1" } });
    expect(result.html).toContain("View contact");
    expect(result.html).toContain("Star contact");
    expect(result.html).not.toContain("Create new contact");
    await mocks.presses.get("View contact")!();
    await tick();
    expect(mocks.contact).toHaveBeenLastCalledWith(
      "device-1",
      undefined,
      expect.objectContaining({ allowsEditing: true }),
    );
  });

  it("shows Chat only for a supplied resolved target and supports real extensions", async () => {
    expect(render().html).not.toContain("Open the existing teammate conversation");
    const chat = vi.fn();
    const extra = vi.fn();
    const { html } = render({
      onChat: chat,
      chatLabel: "Chat with Nok",
      extraActions: [
        {
          id: "copy-transcript",
          label: "Copy transcript",
          icon: "doc.on.clipboard",
          onPress: extra,
        },
      ],
    });
    expect(html).toContain("Chat with Nok");
    expect(html).toContain("Copy transcript");
    await mocks.presses.get("Chat with Nok")!();
    await tick();
    expect(chat).toHaveBeenCalledOnce();
    render({
      extraActions: [
        {
          id: "copy-transcript",
          label: "Copy transcript",
          icon: "doc.on.clipboard",
          onPress: extra,
        },
      ],
    });
    await mocks.presses.get("Copy transcript")!();
    await tick();
    expect(extra).toHaveBeenCalledOnce();
  });

  it("requires destructive confirmation and preserves the recording", async () => {
    const remove = vi.fn();
    render({ onDeleteHistory: remove });
    await mocks.presses.get("Remove from Recents")!();
    expect(remove).not.toHaveBeenCalled();
    expect(mocks.alerts[0].title).toBe("Remove from Recents?");
    expect(mocks.alerts[0].message).toContain("cloud recording is preserved");
    expect(mocks.alerts[0].message).toContain("Hidden calls");
    await mocks.alerts[0].buttons.find((button) => button.text === "Remove")
      .onPress();
    await tick();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("shows independent recording and AI summary status in call details", async () => {
    const detailed = {
      ...call,
      recordingStatus: "ready",
      summaryStatus: "processing",
    };
    const { html } = render({ call: detailed });
    expect(html).toContain("Call details");
    await mocks.presses.get("Call details")!();
    expect(mocks.alerts[0]).toMatchObject({
      title: "Call details",
      message: callDetailsText(detailed),
    });
    expect(mocks.alerts[0].message).toContain("Recording: Ready");
    expect(mocks.alerts[0].message).toContain("AI summary: Processing");
  });

  it("blocks, reports spam, and unblocks through the local blocklist", async () => {
    const setBlock = vi.fn();
    render({ onSetBlock: setBlock });
    expect(mocks.presses.has("Block or report spam")).toBe(true);
    await mocks.presses.get("Block or report spam")!();
    expect(mocks.alerts[0].title).toBe("Block or report spam");
    await mocks.alerts[0].buttons.find(
      (button) => button.text === "Report spam & block",
    ).onPress();
    await tick();
    expect(setBlock).toHaveBeenCalledWith("spam");

    mocks.alerts.length = 0;
    setBlock.mockClear();
    render({ blockReason: "spam", onSetBlock: setBlock });
    expect(mocks.presses.has("Unblock number")).toBe(true);
    await mocks.presses.get("Unblock number")!();
    await mocks.alerts[0].buttons.find(
      (button) => button.text === "Unblock",
    ).onPress();
    await tick();
    expect(setBlock).toHaveBeenCalledWith(null);
  });

  it("rejects a stale menu action after the signed-in owner changes", async () => {
    const dial = vi.fn();
    render({ onCall: dial });
    mocks.authOwner = 8;
    await mocks.presses.get(`Call ${call.number}`)!();
    await tick();
    expect(dial).not.toHaveBeenCalled();
    expect(mocks.alerts[0]).toMatchObject({ title: "Account changed" });
  });
});
