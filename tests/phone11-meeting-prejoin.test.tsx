import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };

const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
  joinButton: undefined as
    | undefined
    | { onPress: () => unknown; disabled: boolean },
  choices: {} as Record<string, () => unknown>,
  switches: {} as Record<string, { value: boolean; onValueChange: (value: boolean) => void }>,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = mocks.stateIndex++;
      if (index >= mocks.values.length)
        mocks.values[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        mocks.values[index],
        (value: unknown) => {
          mocks.values[index] =
            typeof value === "function"
              ? (value as (prior: unknown) => unknown)(mocks.values[index])
              : value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = mocks.refIndex++;
      if (!mocks.refs[index]) mocks.refs[index] = { current: initial };
      return mocks.refs[index];
    },
  };
});

function element({ children }: { children?: ReactNode }) {
  return createElement("div", null, children);
}

vi.mock("react-native", () => ({
  ActivityIndicator: element,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: any) => {
    if (!accessibilityLabel)
      mocks.joinButton = { onPress, disabled: Boolean(disabled) };
    if (accessibilityLabel?.startsWith("Select admitted meeting "))
      mocks.choices[accessibilityLabel] = onPress;
    return createElement("button", { disabled, "aria-label": accessibilityLabel }, children);
  },
  ScrollView: element,
  StyleSheet: { create: (styles: unknown) => styles },
  Switch: ({ accessibilityLabel, value, onValueChange }: any) => {
    mocks.switches[accessibilityLabel] = { value, onValueChange };
    return null;
  },
  Text: ({ children }: { children?: ReactNode }) =>
    createElement("span", null, children),
  TextInput: () => null,
  View: element,
}));

vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "blue",
    foreground: "black",
    muted: "gray",
    surface: "white",
    border: "gray",
    background: "white",
    error: "red",
  }),
}));

import { MeetingPrejoin } from "../components/meetings/meeting-prejoin";
import {
  MeetingJoinFailure,
  meetingJoinFailureReference,
} from "../lib/meetings/join-failure";
import { admittedMeetingsWithTenantTitles } from "../lib/meetings/admitted-selection";

beforeEach(() => {
  mocks.values = [];
  mocks.refs = [];
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  mocks.joinButton = undefined;
  mocks.choices = {};
  mocks.switches = {};
});

function render(onJoin: () => Promise<void>) {
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  mocks.joinButton = undefined;
  mocks.choices = {};
  mocks.switches = {};
  return renderToStaticMarkup(
    createElement(MeetingPrejoin, {
      authenticatedDisplayName: "Pilot",
      admittedMeetings: [{ meetingId: "12345678-1234-4234-8234-123456789012" }],
      onJoin,
      onBack: () => undefined,
    }),
  );
}

it("shows the authenticated name read-only and joins an admitted meeting without sending a client name", async () => {
  const onJoin = vi.fn().mockResolvedValue(undefined);
  const html = render(onJoin);

  expect(html).toContain("Signed in as");
  expect(html).toContain("Pilot");
  expect(html).not.toContain("Your name");
  expect(html).toContain("Your camera and microphone stay off until you join.");
  expect(html).toContain("Join muted");
  expect(html).toContain("Join with video off");
  expect(mocks.joinButton?.disabled).toBe(false);

  await mocks.joinButton?.onPress();

  expect(onJoin).toHaveBeenCalledWith({
    meetingCode: "12345678-1234-4234-8234-123456789012",
    microphoneEnabled: false,
    cameraEnabled: false,
  });
});

it("keeps capture off during prejoin and passes explicit media choices to join", async () => {
  const onJoin = vi.fn().mockResolvedValue(undefined);
  render(onJoin);
  expect(mocks.switches["Microphone on when joining"].value).toBe(false);
  expect(mocks.switches["Camera on when joining"].value).toBe(false);
  expect(onJoin).not.toHaveBeenCalled();

  mocks.switches["Microphone on when joining"].onValueChange(true);
  mocks.switches["Camera on when joining"].onValueChange(true);
  const html = render(onJoin);
  expect(html).toContain("Join with microphone on");
  expect(html).toContain("Join with video on");
  expect(html).toContain("Your camera and microphone stay off until you join.");
  expect(onJoin).not.toHaveBeenCalled();

  await mocks.joinButton?.onPress();
  expect(onJoin).toHaveBeenCalledWith({
    meetingCode: "12345678-1234-4234-8234-123456789012",
    microphoneEnabled: true,
    cameraEnabled: true,
  });
});

it("shows only the exact linked admitted meeting when multiple meetings are available", async () => {
  const onJoin = vi.fn().mockResolvedValue(undefined);
  const requested = "8407bc84-63ef-48a0-bceb-b29b16043555";
  const html = renderToStaticMarkup(createElement(MeetingPrejoin, {
    authenticatedDisplayName: "Pilot",
    admittedMeetings: [
      { meetingId: "11111111-1111-4111-8111-111111111111" },
      { meetingId: requested },
    ],
    initialMeetingCode: requested,
    onJoin,
    onBack: () => undefined,
  }));
  expect(html).toContain("Your meeting is ready");
  expect(html).not.toContain("Select admitted meeting");
  expect(html).not.toContain("11111111…11111");
  expect(html).not.toContain("8407bc84…43555");
  expect(Object.keys(mocks.choices)).toHaveLength(0);
  expect(mocks.joinButton?.disabled).toBe(false);
  await mocks.joinButton?.onPress();
  expect(onJoin).toHaveBeenCalledWith({
    meetingCode: requested,
    microphoneEnabled: false,
    cameraEnabled: false,
  });
});

it("keeps the generic chooser when no meeting ID was supplied", () => {
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const html = renderToStaticMarkup(createElement(MeetingPrejoin, {
    admittedMeetings: [{ meetingId: firstId }, { meetingId: secondId }],
    onJoin: vi.fn().mockResolvedValue(undefined),
    onBack: () => undefined,
  }));

  expect(html).toContain("Select an admitted meeting.");
  expect(html).toContain("Meeting 1 · 11111111…11111");
  expect(html).toContain("Meeting 2 · 22222222…22222");
  expect(Object.keys(mocks.choices)).toHaveLength(2);
});

it("shows a tenant-verified linked title without other choices and joins by opaque meeting ID", async () => {
  const onJoin = vi.fn().mockResolvedValue(undefined);
  const meetingId = "8407bc84-63ef-48a0-bceb-b29b16043555";
  const admitted = admittedMeetingsWithTenantTitles(
    [{ meetingId }],
    [{ meetingId, tenantId: 41, title: "Government & SI Team" }],
    41,
  );
  const html = renderToStaticMarkup(createElement(MeetingPrejoin, {
    authenticatedDisplayName: "Pilot", admittedMeetings: admitted,
    initialMeetingCode: meetingId, onJoin, onBack: () => undefined,
  }));
  expect(html).toContain("Government &amp; SI Team");
  expect(html).not.toContain("Meeting code");
  expect(html).not.toContain("Your meeting is ready");
  expect(Object.keys(mocks.choices)).toHaveLength(0);
  await mocks.joinButton?.onPress();
  expect(onJoin).toHaveBeenCalledWith({ meetingCode: meetingId, microphoneEnabled: false, cameraEnabled: false });
});

it("uses the safe channel title for the linked target in a multi-meeting result", async () => {
  const onJoin = vi.fn().mockResolvedValue(undefined);
  const titledId = "8407bc84-63ef-48a0-bceb-b29b16043555";
  const untitledId = "11111111-1111-4111-8111-111111111111";
  const html = renderToStaticMarkup(createElement(MeetingPrejoin, {
    authenticatedDisplayName: "Pilot",
    admittedMeetings: [
      { meetingId: untitledId },
      { meetingId: titledId, title: "Government & SI Team" },
    ],
    initialMeetingCode: titledId, onJoin, onBack: () => undefined,
  }));
  expect(html).toContain("Government &amp; SI Team");
  expect(html).not.toContain("8407bc84…43555");
  expect(html).not.toContain("11111111…11111");
  expect(html).not.toContain("Select admitted meeting");
  expect(Object.keys(mocks.choices)).toHaveLength(0);
  await mocks.joinButton?.onPress();
  expect(onJoin).toHaveBeenCalledWith({ meetingCode: titledId, microphoneEnabled: false, cameraEnabled: false });
});

it("does not show a title from another tenant, an unadmitted ID, or unsafe text", () => {
  const admitted = [{ meetingId: "11111111-1111-4111-8111-111111111111" }];
  const other = "22222222-2222-4222-8222-222222222222";
  expect(admittedMeetingsWithTenantTitles(admitted, [
    { meetingId: admitted[0].meetingId, tenantId: 42, title: "Other tenant" },
    { meetingId: other, tenantId: 41, title: "Unadmitted" },
  ], 41)).toEqual(admitted);
  expect(admittedMeetingsWithTenantTitles(admitted, [
    { meetingId: admitted[0].meetingId, tenantId: 41, title: "Unsafe\u202e title" },
  ], 41)).toEqual(admitted);
  expect(admittedMeetingsWithTenantTitles(admitted, [
    { meetingId: admitted[0].meetingId, tenantId: 41, title: "Channel" },
  ], null)).toEqual(admitted);
});

it("requires an explicit choice when a stale link has one different admitted meeting", async () => {
  const onJoin = vi.fn().mockResolvedValue(undefined);
  const available = "11111111-1111-4111-8111-111111111111";
  const props = {
    authenticatedDisplayName: "Pilot",
    admittedMeetings: [{ meetingId: available }],
    initialMeetingCode: "22222222-2222-4222-8222-222222222222",
    onJoin,
    onBack: () => undefined,
  };
  const renderStaleLink = () => {
    mocks.stateIndex = 0;
    mocks.refIndex = 0;
    return renderToStaticMarkup(createElement(MeetingPrejoin, props));
  };

  const first = renderStaleLink();
  expect(first).toContain("That meeting is no longer available.");
  expect(first).toContain("Meeting 1 · 11111111…11111");
  expect(mocks.joinButton?.disabled).toBe(true);
  expect(onJoin).not.toHaveBeenCalled();

  mocks.choices[`Select admitted meeting 1, ID ${available}`]();
  const selected = renderStaleLink();
  expect(selected).toContain("Meeting 1 · 11111111…11111 · Selected");
  expect(mocks.joinButton?.disabled).toBe(false);
  await mocks.joinButton?.onPress();
  expect(onJoin).toHaveBeenCalledWith({
    meetingCode: available,
    microphoneEnabled: false,
    cameraEnabled: false,
  });
});

it("keeps the friendly retry text while exposing only the safe join-stage reference", async () => {
  const onJoin = vi
    .fn()
    .mockRejectedValue(
      new MeetingJoinFailure(
        "signal_connect",
        { reason: "not_allowed", httpStatus: 401 },
        new Error(
          "access_token=private-token wss://private.example participant=user-1",
        ),
      ),
    );

  render(onJoin);
  expect(mocks.joinButton?.disabled).toBe(false);
  await mocks.joinButton?.onPress();
  const html = render(onJoin);

  expect(html).toContain(
    "Could not join. Check your connection and try again.",
  );
  expect(html).toContain("Reference: signal_connect / not_allowed / 401");
  expect(html).not.toContain("access_token");
  expect(html).not.toContain("wss://");
  expect(html).not.toContain("participant");
  expect(html).not.toContain("private-token");
});

it("drops non-allowlisted reason text and invalid numeric codes at construction", () => {
  const failure = new MeetingJoinFailure("signal_connect", {
    reason: "wss://private.example/?access_token=secret" as never,
    httpStatus: 12_345,
  });

  expect(meetingJoinFailureReference(failure)).toBe("signal_connect");
});
