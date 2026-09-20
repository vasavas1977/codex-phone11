import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { MediaOwnershipCoordinator } from "../lib/meetings/media-ownership";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

const m = vi.hoisted(() => ({
  press: new Map<string, Record<string, any>>(),
  recorder: { prepareToRecordAsync: vi.fn(), record: vi.fn(), stop: vi.fn(), uri: "file://voice.m4a" },
  audio: { pause: vi.fn(), play: vi.fn(), replace: vi.fn(), seekTo: vi.fn(), addListener: vi.fn() },
  audioListener: null as ((status: any) => void) | null,
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
  StyleSheet: { create: (value: any) => value, hairlineWidth: 1 },
}));
vi.mock("@expo/vector-icons", () => ({ MaterialIcons: () => null }));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Warning: "warning" },
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: (...args: any[]) => m.audioMode(...args),
  requestRecordingPermissionsAsync: (...args: any[]) => m.permission(...args),
  useAudioRecorder: () => m.recorder,
  useAudioRecorderState: () => m.state,
  useAudioPlayer: () => m.audio,
  useAudioPlayerStatus: () => ({ currentTime: 0, duration: 3, playing: false }),
}));
vi.mock("expo-video", () => ({ useVideoPlayer: () => m.video, VideoView: () => null }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", muted: "gray", error: "red", border: "gray", surface: "white", foreground: "black" }) }));
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
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  m.audioListener = null;
  m.refs = []; m.values = []; m.cleanups = []; m.deps = [];
  m.permission.mockResolvedValue({ granted: true });
  m.audioMode.mockResolvedValue(undefined);
  m.audio.seekTo.mockResolvedValue(undefined);
  m.audio.addListener.mockImplementation((_event: string, listener: (status: any) => void) => {
    m.audioListener = listener;
    return { remove: vi.fn() };
  });
  m.recorder.prepareToRecordAsync.mockResolvedValue(undefined);
  m.recorder.stop.mockResolvedValue(undefined);
  m.source.mockResolvedValue({ source: { uri: "private" }, release: vi.fn(), assertOwner: vi.fn() });
});
afterEach(() => unmount());

it("records on hold and sends on release using a fresh voice lease", async () => {
  const ready = vi.fn();
  const node = createElement(VoiceNote, { onReady: ready });
  render(node);
  const hold = m.press.get("Hold to record voice note")!;
  hold.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  expect(m.recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
  expect(m.recorder.record).toHaveBeenCalledOnce();
  m.state.isRecording = true;
  hold.onPressOut();
  await flush();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
  expect(ready).toHaveBeenCalledWith(expect.objectContaining({ uri: "file://voice.m4a" }));
});

it("keeps the idle panel to one recording action and keyboard return", () => {
  const markup = render(createElement(VoiceNote, { onReady: vi.fn() }));
  expect(m.press.has("Hold to record voice note")).toBe(true);
  expect(m.press.has("Return to message keyboard")).toBe(true);
  expect(m.press.has("Cancel voice note")).toBe(false);
  expect(markup).not.toContain("Voice waveform");
});

it("does not record when SIP interrupts a pending recorder preparation", async () => {
  const prepare = deferred<void>();
  m.recorder.prepareToRecordAsync.mockReturnValue(prepare.promise);
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
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

it("cancels a quick release during preparation without starting or sending", async () => {
  const prepare = deferred<void>();
  m.recorder.prepareToRecordAsync.mockReturnValue(prepare.promise);
  const ready = vi.fn();
  render(createElement(VoiceNote, { onReady: ready }));
  const hold = m.press.get("Hold to record voice note")!;
  hold.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  hold.onPressOut();
  prepare.resolve();
  await flush();
  expect(m.recorder.record).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
});

it("holds its lease on unmount until a pending preparation has stopped", async () => {
  const prepare = deferred<void>();
  m.recorder.prepareToRecordAsync.mockReturnValue(prepare.promise);
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
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
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.state.isRecording = true;
  render(node);
  const hold = m.press.get("Hold to record voice note")!;
  hold.onAccessibilityAction?.({ nativeEvent: { actionName: "activate" } });
  await flush();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toMatchObject({ kind: "voice-note" });
  stopping.resolve();
  await flush();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
});

it("keeps the media lease closed when recorder shutdown fails, while still disabling mic mode", async () => {
  m.recorder.stop.mockRejectedValueOnce(new Error("recorder stop failed"));
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.state.isRecording = true;
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Hold to record voice note")!.onAccessibilityAction?.({
    nativeEvent: { actionName: "activate" },
  });
  await flush();
  expect(m.audioMode).toHaveBeenLastCalledWith({ allowsRecording: false });
  expect(m.coordinator.getSnapshot().owner).toMatchObject({ kind: "voice-note" });
});

it("keeps the panel open when sending the captured clip fails", async () => {
  const onClose = vi.fn();
  const ready = vi
    .fn()
    .mockRejectedValueOnce(new Error("upload failed"))
    .mockResolvedValue(undefined);
  const node = createElement(VoiceNote, { onReady: ready, onClose });
  render(node);
  const hold = m.press.get("Hold to record voice note")!;
  hold.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.state.isRecording = true;
  render(node);
  m.press.get("Hold to record voice note")!.onPressOut();
  await flush();
  expect(ready).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
  m.state.isRecording = false;
  render(node);
  expect(m.press.get("Retry voice note")).toBeDefined();
  m.press.get("Retry voice note")!.onPress();
  await flush();
  expect(ready).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps received voice playback compact with progress and elapsed duration", () => {
  const markup = render(createElement(ReceivedMedia, { attachment }));
  expect(m.press.get("Play voice.m4a")).toBeDefined();
  expect(markup).toContain("0:00 / 0:03");
});

it("resumes a paused voice clip from its protected source without refetching", async () => {
  const node = createElement(ReceivedMedia, { attachment });
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(m.source).toHaveBeenCalledOnce();
  expect(m.audio.replace).toHaveBeenCalledOnce();
  expect(m.audio.play).toHaveBeenCalledOnce();

  render(node);
  m.press.get("Pause media")!.onPress();
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(m.source).toHaveBeenCalledOnce();
  expect(m.audio.replace).toHaveBeenCalledOnce();
  expect(m.audio.play).toHaveBeenCalledTimes(2);
});

it("replays a completed voice clip from zero while retaining its protected source", async () => {
  const node = createElement(ReceivedMedia, { attachment });
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  render(node);
  m.audioListener?.({ didJustFinish: true });
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(m.source).toHaveBeenCalledOnce();
  expect(m.audio.replace).toHaveBeenCalledOnce();
  expect(m.audio.seekTo).toHaveBeenCalledWith(0);
  expect(m.audio.play).toHaveBeenCalledTimes(2);
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

it("uses an explicit recording hold to verify and recover a failed prior voice stop", async () => {
  const stopForSip = vi.fn().mockRejectedValueOnce(new Error("prior recorder active")).mockResolvedValue(undefined);
  const prior = m.coordinator.requestVoiceNote("prior-account-voice", { stopForSip }); await prior.ready;
  m.coordinator.clearForAuth(); await flush();
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } }); await flush();
  expect(stopForSip).toHaveBeenCalledTimes(2);
  expect(m.recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
  expect(m.recorder.record).toHaveBeenCalledOnce();
});

it("keeps a failed prior voice stop closed when a recording retry is rejected", async () => {
  const stopForSip = vi.fn(async () => { throw new Error("prior recorder active"); });
  const prior = m.coordinator.requestVoiceNote("prior-account-voice", { stopForSip }); await prior.ready;
  m.coordinator.clearForAuth(); await flush();
  render(createElement(VoiceNote, { onReady: vi.fn() }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } }); await flush();
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
