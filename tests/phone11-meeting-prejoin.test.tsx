import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
import { meetingAdmissionFailure } from "../lib/meetings/admission-failure";

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
  openInvitations: undefined as (() => void) | undefined,
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
    if (accessibilityLabel === "Open Team Chat invitations") mocks.openInvitations = onPress;
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

import { MeetingPrejoin, type MeetingPrejoinProps } from "../components/meetings/meeting-prejoin";
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
  mocks.openInvitations = undefined;
});

function render(onJoin: () => Promise<void>, props: Partial<MeetingPrejoinProps> = {}) {
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
      ...props,
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
  expect(html).not.toContain("12345678");
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

it("offers named Team Chat invitations instead of opaque multiple-room choices", () => {
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const onJoin = vi.fn(), openInvitations = vi.fn();
  const html = renderToStaticMarkup(createElement(MeetingPrejoin, {
    admittedMeetings: [{ meetingId: firstId }, { meetingId: secondId }],
    onJoin, onOpenInvitations: openInvitations,
    onBack: () => undefined,
  }));

  expect(html).toContain("Choose your meeting in Team Chat");
  expect(html).toContain("Open a meeting invitation in Team Chat");
  expect(html).not.toContain(firstId); expect(html).not.toContain(secondId);
  expect(html).not.toMatch(/11111111|22222222|Select admitted|Meeting code/);
  expect(Object.keys(mocks.choices)).toHaveLength(0);
  expect(onJoin).not.toHaveBeenCalled(); mocks.openInvitations!();
  expect(openInvitations).toHaveBeenCalledOnce();
});

it("requires a named invitation when only some generic rooms have safe titles", () => {
  const onJoin = vi.fn();
  const html = render(onJoin, { admittedMeetings: [
    { meetingId: "opaque-untitled" }, { meetingId: "opaque-titled", title: "Team planning" },
  ], onOpenInvitations: vi.fn() });
  expect(html).toContain("Choose your meeting in Team Chat");
  expect(html).not.toContain("opaque-"); expect(Object.keys(mocks.choices)).toHaveLength(0);
  expect(onJoin).not.toHaveBeenCalled();
});

it("keeps safe named generic choices explicit and never renders their opaque IDs", async () => {
  const onJoin = vi.fn().mockResolvedValue(undefined);
  const props = { admittedMeetings: [
    { meetingId: "opaque-planning", title: "Team planning" },
    { meetingId: "opaque-support", title: "Support" },
  ] };
  const html = render(onJoin, props);
  expect(html).toContain("Team planning"); expect(html).toContain("Support");
  expect(html).not.toContain("opaque-"); expect(mocks.joinButton?.disabled).toBe(true);
  mocks.choices["Select admitted meeting 2, Support"](); render(onJoin, props);
  await mocks.joinButton?.onPress();
  expect(onJoin).toHaveBeenCalledWith({ meetingCode: "opaque-support", microphoneEnabled: false, cameraEnabled: false });
});

it("shows fixed Phone-call recovery guidance and clears it on an explicit successful retry", async () => {
  const onJoin = vi.fn().mockRejectedValueOnce(new MeetingJoinFailure("audio_start",
    { reason: "phone_call_active" }, new Error("token=private wss://private.invalid")))
    .mockResolvedValueOnce(undefined);
  render(onJoin); await mocks.joinButton?.onPress();
  const html = render(onJoin);
  expect(html).toContain("Finish your Phone call before joining this meeting, then try again.");
  expect(html).not.toContain("private"); expect(html).not.toContain("wss://");
  expect(mocks.joinButton?.disabled).toBe(false);
  await mocks.joinButton?.onPress();
  expect(render(onJoin)).not.toContain("Finish your Phone call");
  expect(onJoin).toHaveBeenCalledTimes(2);
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
  expect(first).toContain("Your meeting");
  expect(first).not.toContain(available);
  expect(mocks.joinButton?.disabled).toBe(true);
  expect(onJoin).not.toHaveBeenCalled();

  mocks.choices["Select admitted meeting 1"]();
  const selected = renderStaleLink();
  expect(selected).toContain("Your meeting · Selected");
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

it.each(["unauthorized", "forbidden", "not_found", "unavailable", "timeout"] as const)(
  "renders only the allowlisted admission %s reference", async reason => {
    const onJoin = vi.fn().mockRejectedValue(new MeetingJoinFailure("admission", { reason }));
    render(onJoin); await mocks.joinButton?.onPress();
    const html = render(onJoin);
    expect(html).toContain(`Reference: admission / ${reason}`);
    expect(html).toContain(reason === "unavailable"
      ? "This meeting is currently unavailable. Try again later or contact your administrator."
      : "Could not join this meeting. Try again.");
    expect(html).not.toContain("Check your connection");
  },
);

it.each([false, true])("shows service availability copy for a public 412 with manual entry %s", async manual => {
  const failure = meetingAdmissionFailure({
    data: { code: "PRECONDITION_FAILED", httpStatus: 412 },
    message: "trial_expired token=private-token billing=no_billable_wallet",
    meta: { responseJSON: { email: "private@example.test", provider_status: 402 } },
  });
  const onJoin = vi.fn().mockRejectedValue(failure);
  const props = manual ? { admittedMeetings: undefined,
    initialMeetingCode: "12345678-1234-4234-8234-123456789012" } : {};
  render(onJoin, props);
  await mocks.joinButton?.onPress();
  const html = render(onJoin, props);
  expect(html).toContain("This meeting is currently unavailable. Try again later or contact your administrator.");
  expect(html).toContain("Reference: admission / unavailable / 412");
  expect(html).not.toMatch(/Check your connection|trial_expired|no_billable_wallet|billing=|private-token|private@example|provider_status|402/);
  expect(onJoin).toHaveBeenCalledTimes(1);
  expect(onJoin).toHaveBeenCalledWith({ meetingCode: "12345678-1234-4234-8234-123456789012",
    microphoneEnabled: false, cameraEnabled: false });
});

it.each([
  new MeetingJoinFailure("admission"),
  new Error("trial_expired private-token connection problem"),
  { stage: "admission", reason: "unavailable", message: "private-token" },
])("keeps unknown or untyped failures neutral without inferring a provider gate", async error => {
  const onJoin = vi.fn().mockRejectedValue(error);
  render(onJoin);
  await mocks.joinButton?.onPress();
  const html = render(onJoin);
  expect(html).toContain("Could not join this meeting. Try again.");
  expect(html).not.toMatch(/Check your connection|currently unavailable|private-token|trial_expired/);
});

it.each(["native_setup", "bindings", "audio_start", "room_cleanup", "room_create", "event_bind"] as const)(
  "uses device preparation copy for typed %s without permission or billing inference", async stage => {
    const onJoin = vi.fn().mockRejectedValue(new MeetingJoinFailure(stage, {},
      new Error("permission denied trial_expired token=private-token wss://private.invalid")));
    render(onJoin);
    await mocks.joinButton?.onPress();
    const html = render(onJoin);
    expect(html).toContain("Could not prepare this meeting on your device. Try again.");
    expect(html).toContain(`Reference: ${stage}`);
    expect(html).not.toMatch(/Check your connection|permission denied|trial_expired|private-token|wss:\/\//);
  },
);

it("clears availability copy and reference on a successful retry while preventing duplicate joins", async () => {
  let finish: (() => void) | undefined;
  const onJoin = vi.fn()
    .mockRejectedValueOnce(new MeetingJoinFailure("admission", { reason: "unavailable", httpStatus: 412 }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(onJoin);
  await mocks.joinButton?.onPress();
  let html = render(onJoin);
  expect(html).toContain("This meeting is currently unavailable.");
  expect(html).toContain("Reference: admission / unavailable / 412");
  expect(mocks.joinButton?.disabled).toBe(false);
  const retry = mocks.joinButton!.onPress();
  await mocks.joinButton!.onPress();
  expect(onJoin).toHaveBeenCalledTimes(2);
  html = render(onJoin);
  expect(html).not.toContain("currently unavailable");
  expect(html).not.toContain("Reference:");
  expect(mocks.joinButton?.disabled).toBe(true);
  finish!();
  await retry;
  html = render(onJoin);
  expect(html).not.toContain("Could not join");
  expect(html).not.toContain("Reference:");
  expect(mocks.joinButton?.disabled).toBe(false);
});
