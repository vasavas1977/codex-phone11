import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("../components/cloud-recordings/summary-actions", () => ({
  RecordingSummaryActions: (props: any) => {
    mocks.summaryProps = props;
    return null;
  },
}));
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  cloud: {} as any,
  speakerNames: {} as any,
  summaryProps: undefined as any,
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  playback: vi.fn(),
  identity: { id: 1 } as any,
  start: vi.fn(),
  stop: vi.fn(),
  contacts: { people: [] } as any,
  press: new Map<string, () => unknown>(),
}));
vi.mock("../hooks/use-recording-speaker-names", () => ({
  useRecordingSpeakerNames: () => ({
    names: mocks.speakerNames,
    ready: true,
    saving: false,
    save: vi.fn(async () => true),
  }),
}));
vi.mock("react-native", () => ({
  NativeModules: {},
  Platform: { OS: "web" },
  AppState: { currentState: "active" },
  View: ({ children }: any) => createElement("div", null, children),
  ScrollView: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({ children, disabled, onPress }: any) => {
    const label = children?.props?.children;
    if (typeof label === "string") mocks.press.set(label, onPress);
    return createElement("button", { disabled }, children);
  },
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: mocks.push,
    back: mocks.back,
    replace: mocks.replace,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({
    callUuid: "11111111-1111-4111-8111-111111111111",
  }),
}));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("expo-audio", () => ({
  useAudioPlayer: mocks.playback,
  useAudioPlayerStatus: () => ({ isLoaded: false }),
}));
vi.mock("../hooks/use-cloud-recordings", () => ({
  useCloudRecordings: () => mocks.cloud,
}));
vi.mock("../hooks/use-device-contacts", () => ({
  useDeviceContacts: () => mocks.contacts,
}));
vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({ user: mocks.identity }),
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({ foreground: "black", primary: "blue", muted: "gray" }),
}));
vi.mock("../components/screen-container", () => ({
  ScreenContainer: ({ children }: any) => createElement("div", null, children),
}));
vi.mock("../lib/sip/call-store", () => ({
  useSipCallStore: (select: any) =>
    select({ incomingCall: null, activeCalls: {} }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: mocks.identity }),
}));
vi.mock("../lib/trpc", () => ({
  createTRPCClient: () => ({
    cloudRecordings: {
      startCapture: { mutate: mocks.start },
      stopCapture: { mutate: mocks.stop },
    },
  }),
}));
vi.mock("../constants/oauth", () => ({
  getApiBaseUrl: () => "https://api.phone11.ai",
}));
import {
  CallHistoryRow,
  RecordingPanel,
  PlaybackControls,
} from "../components/cloud-recordings/call-history-view";
import {
  CaptureControls,
  recordingChangeMessage,
} from "../components/cloud-recordings/capture-controls";
import {
  LiveRecordingPanel,
  recordingStatusMessage,
  recordingStatusNeedsRefresh,
} from "../components/cloud-recordings/live-recording-panel";
import Detail from "../app/call-recording/[callUuid]";
import { playbackURL } from "../lib/cloud-recordings/presentation";
import { recordingDocument } from "../lib/cloud-recordings/summary-actions";
import type { CloudRecordingDetail } from "../shared/cloud-recordings";
const item = {
  callUuid: "11111111-1111-4111-8111-111111111111",
  number: "3001",
  startedAt: 1000,
  recordingStatus: "pending",
  summaryStatus: "queued",
  nativeHistoryId: "native-wake:exact",
};
beforeEach(() => {
  mocks.cloud = { items: [item], loading: false, reload: vi.fn() };
  mocks.playback.mockClear();
  mocks.press.clear();
  mocks.identity = { id: 1 };
  mocks.speakerNames = {};
  mocks.summaryProps = undefined;
  mocks.start.mockReset();
  mocks.stop.mockReset();
  mocks.contacts = { people: [] };
});
it("shows real pending statuses without creating playback", () => {
  mocks.cloud.detail = item;
  const html = renderToStaticMarkup(createElement(Detail));
  expect(html).toContain("Preparing recording");
  expect(html).toContain("Preparing transcription before the AI summary");
  expect(html).toContain("Refresh status");
  expect(html).not.toContain("Play recording");
  expect(mocks.playback).not.toHaveBeenCalled();
});
it("offers a manual AI refresh for failed or stale detail", async () => {
  mocks.cloud.detail = {
    ...item,
    recordingStatus: "ready",
    summaryStatus: "failed",
  };
  let html = renderToStaticMarkup(createElement(Detail));
  expect(html).toContain("AI summary is unavailable");
  expect(html).toContain("Refresh status");
  await mocks.press.get("Refresh status")?.();
  expect(mocks.cloud.reload).toHaveBeenCalledOnce();
  mocks.cloud.loading = true;
  html = renderToStaticMarkup(createElement(Detail));
  expect(html).toContain("Refreshing status");
});
it("distinguishes recording preparation, readiness, and durable failure", () => {
  const statusDetail: CloudRecordingDetail = {
    ...item,
    tenantId: 1,
    direction: "inbound",
    recordingStatus: "pending",
    summaryStatus: "queued",
  };
  expect(recordingStatusMessage(statusDetail)).toBe("Preparing recording…");
  expect(recordingStatusNeedsRefresh(statusDetail)).toBe(true);

  const readyWithoutPlayback = {
    ...statusDetail,
    recordingStatus: "ready" as const,
    manualControls: undefined,
  };
  expect(recordingStatusMessage(readyWithoutPlayback)).toBe(
    "Recording saved. Preparing playback…",
  );
  expect(recordingStatusNeedsRefresh(readyWithoutPlayback)).toBe(true);

  const retryableFailure = {
    ...statusDetail,
    recordingStatus: "failed" as const,
    manualControls: { canStart: true, canStop: false },
  };
  expect(recordingStatusMessage(retryableFailure)).toBe(
    "Recording is off. You can start it again.",
  );
  expect(recordingStatusNeedsRefresh(retryableFailure)).toBe(false);

  const durableFailure = {
    ...statusDetail,
    recordingStatus: "failed" as const,
    manualControls: { canStart: false, canStop: false },
  };
  expect(recordingStatusMessage(durableFailure)).toBe(
    "Recording could not be saved.",
  );
  expect(recordingStatusNeedsRefresh(durableFailure)).toBe(true);
});
it("shows explicit transcript processing and failure states", () => {
  let html = renderToStaticMarkup(
    createElement(RecordingPanel, {
      summaryStatus: "processing",
      activeTab: "transcription",
      onTabChange: vi.fn(),
    }),
  );
  expect(html).toContain("Transcription is processing");
  expect(html).not.toContain("No transcription available");

  html = renderToStaticMarkup(
    createElement(RecordingPanel, {
      summaryStatus: "failed",
      activeTab: "transcription",
      onTabChange: vi.fn(),
    }),
  );
  expect(html).toContain("Transcription could not be created");
  expect(html).toContain("Refresh status to check again");
});
it("renders server summary and transcript only when provided", () => {
  mocks.cloud.detail = {
    ...item,
    summaryStatus: "ready",
    summary: {
      summary: "Agreed next steps",
      actionItems: ["Send proposal"],
      language: "en",
    },
    transcript: "Call transcript",
  };
  const html = renderToStaticMarkup(createElement(Detail));
  expect(html).toContain("Send proposal");
  expect(html).not.toContain("Call transcript");
  const transcriptHTML = renderToStaticMarkup(
    createElement(RecordingPanel, {
      summaryStatus: "ready",
      transcript: "Speaker 1: Call transcript\nSpeaker 2: Reply transcript",
      speakerNames: { speaker1: "Somchai", speaker2: "Vasavas" },
      activeTab: "transcription",
      onTabChange: vi.fn(),
      onViewFull: vi.fn(),
    }),
  );
  expect(transcriptHTML).toContain("Call transcript");
  expect(transcriptHTML).toContain("Somchai");
  expect(transcriptHTML).toContain("Vasavas");
  expect(transcriptHTML).toContain("View full transcription");
});
it("keeps generic labels when only direction, contact, and caller ID are available", () => {
  mocks.identity = { id: 1, name: "Vasavas" };
  mocks.contacts = {
    people: [
      {
        id: "contact-1",
        name: "Somchai Contact",
        phones: [
          {
            number: "+66812345678",
            label: "Mobile",
            key: "+66812345678",
          },
        ],
      },
    ],
  };
  mocks.cloud.detail = {
    ...item,
    number: "+66812345678",
    direction: "inbound",
    summaryStatus: "ready",
    transcript: "Speaker 1: Hello\nSpeaker 2: Sawasdee",
    participantNames: {
      speaker1: "SERVER CALLER ID",
      speaker2: "Server Extension",
    },
  };
  const html = renderToStaticMarkup(
    createElement(LiveRecordingPanel, {
      callUuid: item.callUuid,
      full: true,
      initialTab: "transcription",
    }),
  );
  expect(html).toContain("Speaker 1");
  expect(html).toContain("Speaker 2");
  expect(html).not.toContain("Somchai Contact");
  expect(html).not.toContain("Vasavas");
  expect(html).not.toContain("SERVER CALLER ID");
  expect(html).not.toContain("Server Extension");
});

it("does not rewrite summary participants from outbound direction", () => {
  mocks.identity = { id: 1, name: "Vasavas" };
  mocks.contacts = {
    people: [
      {
        id: "contact-1",
        name: "Somchai Contact",
        phones: [
          {
            number: "+66812345678",
            label: "Mobile",
            key: "+66812345678",
          },
        ],
      },
    ],
  };
  mocks.cloud.detail = {
    ...item,
    number: "+66812345678",
    direction: "outbound",
    summaryStatus: "ready",
    transcript: "Speaker 1: Hello\nSpeaker 2: Sawasdee",
    summary: {
      summary: "Person 1 called Person 2. The caller confirmed the plan.",
      actionItems: ["Speaker 2 will reply to Speaker 1."],
      language: "en",
    },
  };
  const html = renderToStaticMarkup(
    createElement(LiveRecordingPanel, {
      callUuid: item.callUuid,
      full: true,
      initialTab: "summary",
    }),
  );
  expect(html).toContain("Speaker 1 called Speaker 2. Speaker 1 confirmed the plan.");
  expect(html).toContain("Speaker 2 will reply to Speaker 1.");
  expect(html).not.toContain("Vasavas");
  expect(html).not.toContain("Somchai Contact");
});

it("uses local account and contact names only after verified stereo roles arrive", () => {
  mocks.identity = { id: 1, name: "Vasavas" };
  mocks.cloud.detail = {
    ...item,
    number: "+66812345678",
    summaryStatus: "ready",
    transcript: "Speaker 1: Hello\nSpeaker 2: Sawasdee",
    speakerRoles: {
      schemaVersion: 1,
      verified: true,
      speaker1Role: "extension",
      speaker2Role: "remote",
    },
  };
  const html = renderToStaticMarkup(
    createElement(LiveRecordingPanel, {
      callUuid: item.callUuid,
      full: true,
      initialTab: "transcription",
      contactName: "Nathasa",
    }),
  );
  expect(html).toContain("Vasavas");
  expect(html).toContain("Nathasa");
  expect(html).not.toContain("Speaker 1");
  expect(html).not.toContain("Speaker 2");
});

it("uses participant names only when the caller supplies a trusted identity map", () => {
  mocks.cloud.detail = {
    ...item,
    direction: "inbound",
    summaryStatus: "ready",
    transcript: "Speaker 1: Hello\nSpeaker 2: Sawasdee",
    participantNames: {
      speaker1: "Untrusted server caller ID",
      speaker2: "Untrusted server extension",
    },
  };
  const html = renderToStaticMarkup(
    createElement(LiveRecordingPanel, {
      callUuid: item.callUuid,
      full: true,
      initialTab: "transcription",
      trustedSpeakerNames: {
        speaker1: "Verified participant one",
        speaker2: "Verified participant two",
      },
    }),
  );
  expect(html).toContain("Verified participant one");
  expect(html).toContain("Verified participant two");
  expect(html).not.toContain("Untrusted server caller ID");
  expect(html).not.toContain("Untrusted server extension");
});
it.each(["inbound", "outbound"] as const)(
  "does not fill missing verified voice mapping from an %s call",
  (direction) => {
    mocks.identity = { id: 1, name: "Vasavas" };
    mocks.contacts = {
      people: [
        {
          id: "contact-1",
          name: "Somchai Contact",
          phones: [
            { number: "+66812345678", label: "Mobile", key: "+66812345678" },
          ],
        },
      ],
    };
    mocks.cloud.detail = {
      ...item,
      number: "+66812345678",
      direction,
      summaryStatus: "ready",
      transcript: "Speaker 1: Hello\nSpeaker 2: Sawasdee",
      participantNames: {
        speaker1: "Server caller",
        speaker2: "Server extension",
      },
    };
    const html = renderToStaticMarkup(
      createElement(LiveRecordingPanel, {
        callUuid: item.callUuid,
        full: true,
        initialTab: "transcription",
        trustedSpeakerNames: { speaker1: "Verified participant" },
      }),
    );
    expect(html).toContain("Verified participant");
    expect(html).toContain("Speaker 2");
    expect(html).not.toContain("Vasavas");
    expect(html).not.toContain("Somchai Contact");
    expect(html).not.toContain("Server caller");
    expect(html).not.toContain("Server extension");
  },
);
it("shows unavailable server state without fake records", () => {
  mocks.cloud = {
    items: [],
    error: "Could not load cloud recordings",
    reload: vi.fn(),
  };
  const html = renderToStaticMarkup(createElement(Detail));
  expect(html).toContain("Could not load");
  expect(html).not.toContain("Play recording");
});
it("only permits authenticated same-origin exact call playback path", () => {
  const id = item.callUuid;
  expect(
    playbackURL("https://api.phone11.ai", id, `/api/recordings/play/${id}`),
  ).toBe(`https://api.phone11.ai/api/recordings/play/${id}`);
  for (const path of [
    "https://other.test/file",
    "//other.test/file",
    "/api/recordings/play/other",
    `/api/recordings/play/${id}?token=secret`,
  ])
    expect(playbackURL("https://api.phone11.ai", id, path)).toBeNull();
  expect(
    playbackURL("http://api.phone11.ai", id, `/api/recordings/play/${id}`),
  ).toBeNull();
});

it("shows manual controls only when server explicitly permits them", () => {
  mocks.cloud.detail = {
    ...item,
    manualControls: { canStart: false, canStop: false },
  };
  let html = renderToStaticMarkup(createElement(Detail));
  expect(html).not.toContain("Start recording");
  expect(html).not.toContain("Stop recording");
  mocks.cloud.detail.manualControls = { canStart: true, canStop: false };
  html = renderToStaticMarkup(createElement(Detail));
  expect(html).toContain("Start recording");
  expect(html).not.toContain("Stop recording");
});
it("hides a stale stop action once durable finalization has started", () => {
  mocks.cloud.detail = {
    ...item,
    recordingStatus: "recording",
    recordingFinalizing: true,
    summaryStatus: "off",
    manualControls: { canStart: false, canStop: true },
  };
  const html = renderToStaticMarkup(createElement(Detail));
  expect(html).toContain("Saving recording");
  expect(html).not.toContain("Stop recording");
});
it("manual capture sends only exact UUID and drops a result after account change", async () => {
  let resolve!: (value: any) => void;
  mocks.start.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const refresh = vi.fn(async () => {});
  renderToStaticMarkup(
    createElement(CaptureControls, {
      callUuid: item.callUuid,
      controls: { canStart: true, canStop: false },
      refresh,
    }),
  );
  mocks.press.get("Start recording")!();
  mocks.press.get("Start recording")!();
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.start).toHaveBeenCalledWith({ callUuid: item.callUuid });
  mocks.identity = { id: 2 };
  resolve({ started: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(refresh).not.toHaveBeenCalled();
});
it("manual stop refreshes authoritative status without inventing a ready recording", async () => {
  mocks.stop.mockResolvedValue({ stopped: true });
  const refresh = vi.fn(async () => {});
  renderToStaticMarkup(
    createElement(CaptureControls, {
      callUuid: item.callUuid,
      controls: { canStart: false, canStop: true },
      refresh,
    }),
  );
  mocks.press.get("Stop recording")!();
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.stop).toHaveBeenCalledWith({ callUuid: item.callUuid });
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("keeps an accepted stop successful when status refresh temporarily fails", () => {
  const message = recordingChangeMessage("stop", true, true);
  expect(message).toContain("accepted");
  expect(message).toContain("refresh again");
  expect(message).not.toContain("could not be changed");
});

it("keeps ready indicators small and hides content when collapsed", () => {
  const call = {
    id: "1",
    name: "คุณสมชาย",
    number: "+66825826667",
    direction: "incoming" as const,
    time: "09:30",
    duration: "2:04",
  };
  let html = renderToStaticMarkup(
    createElement(
      CallHistoryRow,
      { call, expanded: false, onToggle: vi.fn(), onCall: vi.fn() },
      "private-inline-content",
    ),
  );
  expect(html).not.toContain("private-inline-content");
  expect(html).not.toContain("● Recording");
  expect(html).not.toContain("✦ AI summary");
  html = renderToStaticMarkup(
    createElement(
      CallHistoryRow,
      {
        call: { ...call, recordingReady: true, summaryReady: true },
        expanded: true,
        onToggle: vi.fn(),
        onCall: vi.fn(),
      },
      "inline-content",
    ),
  );
  expect(html).toContain("inline-content");
  expect(html).toContain("● Recording");
  expect(html).toContain("✦ AI summary");
});
it("ready without returned summary never claims AI is off", () => {
  const html = renderToStaticMarkup(
    createElement(RecordingPanel, {
      summaryStatus: "ready",
      activeTab: "summary",
      onTabChange: vi.fn(),
    }),
  );
  expect(html).toContain("AI summary is unavailable");
  expect(html).not.toContain("AI summary was not enabled");
});

it("full call detail offers a working explicit Back control", () => {
  mocks.cloud.detail = item;
  renderToStaticMarkup(createElement(Detail));
  mocks.press.get("‹ Back")!();
  expect(mocks.back).toHaveBeenCalled();
});
it("full transcription link preserves the chosen tab", () => {
  const view = vi.fn();
  renderToStaticMarkup(
    createElement(RecordingPanel, {
      summaryStatus: "ready",
      transcript: "ข้อความภาษาไทย",
      activeTab: "transcription",
      onTabChange: vi.fn(),
      onViewFull: view,
    }),
  );
  mocks.press.get("View full transcription")!();
  expect(view).toHaveBeenCalledWith("transcription");
});

it("uses the same confirmed speaker mapping for the transcript and copy/export actions", () => {
  mocks.cloud = {
    owner: 1,
    loading: false,
    items: [],
    reload: vi.fn(),
    detail: {
      ...item,
      direction: "inbound",
      summaryStatus: "ready",
      summary: { summary: "Agreed", actionItems: [] },
      transcript: "Speaker 1: Hello\nSpeaker 2: Sawasdee",
    },
  };
  mocks.speakerNames = { speaker1: "Nathasa", speaker2: "Vasavas" };
  const html = renderToStaticMarkup(
    createElement(LiveRecordingPanel, {
      callUuid: item.callUuid,
      initialTab: "transcription",
    }),
  );
  expect(html).toContain("Nathasa");
  expect(html).toContain("Vasavas");
  expect(mocks.summaryProps.speakerNames).toEqual(mocks.speakerNames);
  const copied = recordingDocument({
    title: "Call",
    startedAt: 1,
    content: {
      summary: "Agreed",
      actionItems: [],
      transcript: mocks.summaryProps.transcript,
    },
    speakerNames: mocks.summaryProps.speakerNames,
  });
  expect(copied).toContain("Nathasa: Hello");
  expect(copied).toContain("Vasavas: Sawasdee");
  expect(copied).not.toContain("Speaker 1:");
  expect(html.indexOf("Correct speaker labels")).toBeLessThan(
    html.indexOf("Hello"),
  );
  expect(html).toContain("Correct speaker labels");
});

it("does not use the recording number as a diarized speaker name", () => {
  mocks.identity = { id: 1, name: "Vasavas" };
  mocks.cloud.detail = {
    ...item,
    number: "02 030 3001",
    direction: "outbound",
    summaryStatus: "ready",
    transcript: "Speaker 1: Hello\nSpeaker 2: Sawasdee",
    summary: {
      summary: "Speaker 1 called Speaker 2.",
      actionItems: [],
      language: "en",
    },
  };
  const html = renderToStaticMarkup(
    createElement(LiveRecordingPanel, {
      callUuid: item.callUuid,
      full: true,
      initialTab: "transcription",
    }),
  );
  expect(html).toContain("Speaker 1");
  expect(html).toContain("Speaker 2");
  expect(html).not.toContain("Vasavas");
  expect(html).not.toContain("+6620303001");
});
