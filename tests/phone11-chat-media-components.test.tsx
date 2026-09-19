import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { MediaOwnershipCoordinator } from "../lib/meetings/media-ownership";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

const m = vi.hoisted(() => ({
  press: new Map<string, { onPress: () => void }>(),
  recorder: { prepareToRecordAsync: vi.fn(), record: vi.fn(), stop: vi.fn(), uri: "file://voice.m4a" },
  audio: { pause: vi.fn(), play: vi.fn(), replace: vi.fn() },
  video: { pause: vi.fn(), play: vi.fn(), replace: vi.fn() },
  permission: vi.fn(),
  audioMode: vi.fn(),
  source: vi.fn(),
  state: { isRecording: false, durationMillis: 0 },
  coordinator: null as any,
  refs: [] as Array<{ current: any }>,
  values: [] as any[],
  cleanups: [] as Array<(() => void) | undefined>,
  deps: [] as unknown[][],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: any) => {
      const index = m.stateIndex++;
      if (index >= m.values.length) m.values[index] = typeof initial === "function" ? initial() : initial;
      return [m.values[index], (value: any) => {
        m.values[index] = typeof value === "function" ? value(m.values[index]) : value;
      }];
    },
    useRef: (initial: any) => {
      const index = m.refIndex++;
      if (!m.refs[index]) m.refs[index] = { current: initial };
      return m.refs[index];
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => {
      const index = m.effectIndex++;
      const prior = m.deps[index];
      const unchanged = prior?.length === deps.length && prior.every((item, i) => item === deps[i]);
      if (unchanged) return;
      m.cleanups[index]?.();
      m.deps[index] = deps;
      m.cleanups[index] = effect() || undefined;
    },
  };
});
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  Pressable: (props: any) => {
    m.press.set(props.accessibilityLabel, props);
    return createElement("button", { disabled: props.disabled }, props.children);
  },
}));
vi.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: (...args: any[]) => m.audioMode(...args),
  requestRecordingPermissionsAsync: (...args: any[]) => m.permission(...args),
  useAudioRecorder: () => m.recorder,
  useAudioRecorderState: () => m.state,
  useAudioPlayer: () => m.audio,
}));
vi.mock("expo-video", () => ({ useVideoPlayer: () => m.video, VideoView: () => null }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", muted: "gray", error: "red", border: "gray" }) }));
vi.mock("../lib/meetings/native-session", () => ({
  phone11MediaOwnership: {
    requestVoiceNote: (...args: any[]) => m.coordinator.requestVoiceNote(...args),
    retryVoiceStop: (...args: any[]) => m.coordinator.retryVoiceStop(...args),
    release: (...args: any[]) => m.coordinator.release(...args),
    isCurrent: (...args: any[]) => m.coordinator.isCurrent(...args),
  },
}));
vi.mock("../lib/chat/media-client", () => ({ getChatMediaSource: (...args: any[]) => m.source(...args) }));

import { VoiceNote } from "../components/chat/voice-note";
import { ReceivedMedia } from "../components/chat/received-media";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}
function render(node: ReactNode) {
  m.stateIndex = 0; m.refIndex = 0; m.effectIndex = 0; m.press.clear();
  return renderToStaticMarkup(node);
}
function unmount() {
  for (const cleanup of [...m.cleanups].reverse()) cleanup?.();
  m.cleanups = []; m.deps = [];
}
const attachment = { id: "attachment-1", conversationId: "conversation-1", filename: "voice.m4a", mimeType: "audio/mp4", sizeBytes: 1, status: "attached" as const };

beforeEach(() => {
  vi.clearAllMocks();
  m.coordinator = new MediaOwnershipCoordinator();
  m.state = { isRecording: false, durationMillis: 0 };
  m.refs = []; m.values = []; m.cleanups = []; m.deps = [];
  m.permission.mockResolvedValue({ granted: true });
  m.audioMode.mockResolvedValue(undefined);
  m.recorder.prepareToRecordAsync.mockResolvedValue(undefined);
  m.recorder.stop.mockResolvedValue(undefined);
  m.source.mockResolvedValue({ source: { uri: "private" }, release: vi.fn(), assertOwner: vi.fn() });
});
afterEach(() => unmount());

it("records, stops, and previews using a fresh voice lease", async () => {
  const node = createElement(VoiceNote, { onReady: vi.fn() });
  render(node);
  m.press.get("Record voice")!.onPress();
  await flush();
  expect(m.recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
  expect(m.recorder.record).toHaveBeenCalledOnce();
  m.state.isRecording = true;
  render(node);
  m.press.get("Stop")!.onPress();
  await flush();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
  m.state.isRecording = false;
  render(node);
  m.press.get("Play")!.onPress();
  await flush();
  expect(m.audio.replace).toHaveBeenCalledWith("file://voice.m4a");
  expect(m.audio.play).toHaveBeenCalledOnce();
});

it("does not record when SIP interrupts a pending recorder preparation", async () => {
  const prepare = deferred<void>();
  m.recorder.prepareToRecordAsync.mockReturnValue(prepare.promise);
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Record voice")!.onPress();
  await flush();
  expect(m.recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
  const sip = m.coordinator.requestSip("sip-1");
  prepare.resolve();
  await sip.ready;
  await flush();
  expect(m.recorder.record).not.toHaveBeenCalled();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toMatchObject({ kind: "sip", state: "active" });
});

it("holds its lease on unmount until a pending preparation has stopped", async () => {
  const prepare = deferred<void>();
  m.recorder.prepareToRecordAsync.mockReturnValue(prepare.promise);
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Record voice")!.onPress();
  await flush();
  unmount();
  expect(m.coordinator.getSnapshot().owner).toMatchObject({ kind: "voice-note" });
  prepare.resolve();
  await flush();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
});

it("cancels only after the recorder has stopped", async () => {
  const stopping = deferred<void>();
  m.recorder.stop.mockReturnValue(stopping.promise);
  const node = createElement(VoiceNote, { onReady: vi.fn() });
  render(node);
  m.press.get("Record voice")!.onPress();
  await flush();
  m.state.isRecording = true;
  render(node);
  m.press.get("Cancel")!.onPress();
  await flush();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toMatchObject({ kind: "voice-note" });
  stopping.resolve();
  await flush();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
});

it("releases a fetched source without playing when unmounted during download", async () => {
  const fetched = { source: { uri: "private" }, release: vi.fn(), assertOwner: vi.fn() };
  const source = deferred<typeof fetched>();
  m.source.mockReturnValue(source.promise);
  render(createElement(ReceivedMedia, { attachment }));
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  unmount();
  source.resolve(fetched);
  await flush();
  expect(m.audio.play).not.toHaveBeenCalled();
  expect(fetched.release).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
});

it("cleans up fetched media when account ownership changes after lease readiness", async () => {
  const fetched = {
    source: { uri: "private" },
    release: vi.fn(),
    assertOwner: vi.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("account changed"); }),
  };
  m.source.mockResolvedValue(fetched);
  render(createElement(ReceivedMedia, { attachment }));
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(fetched.assertOwner).toHaveBeenCalledTimes(2);
  expect(m.audio.play).not.toHaveBeenCalled();
  expect(fetched.release).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
});

it("uses an explicit Record tap to verify and recover a failed prior voice stop", async () => {
  const stopForSip = vi.fn().mockRejectedValueOnce(new Error("prior recorder active")).mockResolvedValue(undefined);
  const prior = m.coordinator.requestVoiceNote("prior-account-voice", { stopForSip }); await prior.ready;
  m.coordinator.clearForAuth(); await flush();
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Record voice")!.onPress(); await flush();
  expect(stopForSip).toHaveBeenCalledTimes(2);
  expect(m.recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
  expect(m.recorder.record).toHaveBeenCalledOnce();
});

it("keeps a failed prior voice stop closed when a Record retry is rejected", async () => {
  const stopForSip = vi.fn(async () => { throw new Error("prior recorder active"); });
  const prior = m.coordinator.requestVoiceNote("prior-account-voice", { stopForSip }); await prior.ready;
  m.coordinator.clearForAuth(); await flush();
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Record voice")!.onPress(); await flush();
  expect(stopForSip).toHaveBeenCalledTimes(2);
  expect(m.recorder.prepareToRecordAsync).not.toHaveBeenCalled();
  expect(() => m.coordinator.requestVoiceNote("still-blocked", { stopForSip })).toThrow("pause-failed");
});

it("uses an explicit received-media Play tap to recover the same failed voice stop", async () => {
  const stopForSip = vi.fn().mockRejectedValueOnce(new Error("prior recorder active")).mockResolvedValue(undefined);
  const prior = m.coordinator.requestVoiceNote("prior-account-voice", { stopForSip }); await prior.ready;
  m.coordinator.clearForAuth(); await flush();
  render(createElement(ReceivedMedia, { attachment }));
  m.press.get("Play voice.m4a")!.onPress(); await flush();
  expect(stopForSip).toHaveBeenCalledTimes(2);
  expect(m.audio.play).toHaveBeenCalledOnce();
});
