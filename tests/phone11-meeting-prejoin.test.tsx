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
  joinButton: undefined as undefined | { onPress: () => unknown; disabled: boolean },
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = mocks.stateIndex++;
      if (index >= mocks.values.length)
        mocks.values[index] = typeof initial === "function" ? initial() : initial;
      return [mocks.values[index], (value: unknown) => {
        mocks.values[index] = typeof value === "function"
          ? (value as (prior: unknown) => unknown)(mocks.values[index])
          : value;
      }];
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
    if (!accessibilityLabel) mocks.joinButton = { onPress, disabled: Boolean(disabled) };
    return createElement("button", { disabled }, children);
  },
  ScrollView: element,
  StyleSheet: { create: (styles: unknown) => styles },
  Switch: () => null,
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
import { MeetingJoinFailure } from "../lib/meetings/join-failure";

beforeEach(() => {
  mocks.values = [];
  mocks.refs = [];
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  mocks.joinButton = undefined;
});

function render(onJoin: () => Promise<void>) {
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  mocks.joinButton = undefined;
  return renderToStaticMarkup(
    createElement(MeetingPrejoin, {
      initialDisplayName: "Pilot",
      admittedMeetings: [{ meetingId: "12345678-1234-4234-8234-123456789012" }],
      onJoin,
      onBack: () => undefined,
    }),
  );
}

it("keeps the friendly retry text while exposing only the safe join-stage reference", async () => {
  const onJoin = vi.fn().mockRejectedValue(
    new MeetingJoinFailure("room_connect"),
  );

  render(onJoin);
  expect(mocks.joinButton?.disabled).toBe(false);
  await mocks.joinButton?.onPress();
  const html = render(onJoin);

  expect(html).toContain("Could not join. Check your connection and try again.");
  expect(html).toContain("Reference: room_connect");
  expect(html).not.toContain("access_token");
  expect(html).not.toContain("wss://");
});
