import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({ list: {} as any, detail: {} as any }));
vi.mock("react-native", () => ({
  AppState: { currentState: "active" },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children }: any) =>
    createElement("button", null, children),
}));
vi.mock("../hooks/use-cloud-recordings", () => ({
  useCloudRecordings: (id?: string) => (id ? mocks.detail : mocks.list),
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ primary: "blue" }),
}));
vi.mock("../components/cloud-recordings/capture-controls", () => ({
  CaptureControls: ({ callUuid, controls }: any) =>
    createElement(
      "button",
      null,
      `${controls.canStop ? "Stop" : "Start"} recording ${callUuid}`,
    ),
}));
import {
  ActiveCallRecordingControls,
  exactActiveRecording,
} from "../components/cloud-recordings/active-call-recording-controls";
const row = {
  callUuid: "exact-cloud-call",
  nativeHistoryId: "native-wake:exact",
  number: "3001",
  startedAt: 1000,
  recordingStatus: "off",
  summaryStatus: "off",
  tenantId: 1,
  direction: "inbound",
} as const;
const render = (id = row.nativeHistoryId as string) =>
  renderToStaticMarkup(
    createElement(ActiveCallRecordingControls, { nativeHistoryId: id }),
  );
beforeEach(() => {
  mocks.list = { items: [row], reload: vi.fn(), loading: false };
  mocks.detail = {
    detail: { ...row, manualControls: { canStart: true, canStop: false } },
    reload: vi.fn(),
    loading: false,
  };
});
it("only exposes control for unique exact server-correlated native history ID", () => {
  expect(render()).toContain("Start recording exact-cloud-call");
  expect(render("other-call")).not.toContain("Start recording");
  expect(exactActiveRecording([row])).toBeUndefined();
  expect(
    exactActiveRecording(
      [row, { ...row, callUuid: "duplicate" }],
      row.nativeHistoryId,
    ),
  ).toBeUndefined();
});
it("does not fall back to matching phone and time", () => {
  mocks.list.items = [{ ...row, nativeHistoryId: "other-call" }];
  expect(render()).not.toContain("Start recording");
});
it("rejects old detail after native call identity changes", () => {
  mocks.list.items = [{ ...row, nativeHistoryId: "new-call" }];
  expect(render("new-call")).not.toContain("Start recording");
});
it("shows stop only after server grants it and reports genuine recording status", () => {
  mocks.detail.detail.recordingStatus = "recording";
  mocks.detail.detail.manualControls = { canStart: false, canStop: true };
  expect(render()).toContain("Recording in progress");
  expect(render()).toContain("Stop recording exact-cloud-call");
});
it("shows durable finalization without exposing stale Stop or unavailable copy", () => {
  mocks.detail.detail.recordingStatus = "recording";
  mocks.detail.detail.recordingFinalizing = true;
  mocks.detail.detail.manualControls = { canStart: false, canStop: false };
  const html = render();
  expect(html).toContain("Saving recording");
  expect(html).not.toContain("Stop recording");
  expect(html).not.toContain("controls are unavailable");
});
it("presents a retryable failed start as not recording", () => {
  mocks.detail.detail.recordingStatus = "failed";
  mocks.detail.detail.manualControls = { canStart: true, canStop: false };
  const html = render();
  expect(html).toContain("Not recording");
  expect(html).toContain("Start recording exact-cloud-call");
  expect(html).not.toContain("Recording unavailable");
});
it("does not show recording or buttons while detail is unavailable", () => {
  mocks.detail = { loading: true, reload: vi.fn() };
  expect(render()).toContain("Checking recording status");
  expect(render()).not.toContain("Start recording");
  expect(render()).not.toContain("Recording in progress");
});
it("honors administrator policy denying manual controls", () => {
  mocks.detail.detail.manualControls = { canStart: false, canStop: false };
  expect(render()).not.toContain("Start recording");
  expect(render()).toContain("Not recording");
});
