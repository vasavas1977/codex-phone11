import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { MediaOwnershipCoordinator } from "../lib/meetings/media-ownership";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};

const m = vi.hoisted(() => ({
  press: new Map<string, Record<string, any>>(),
  recorder: { prepareToRecordAsync: vi.fn(), record: vi.fn(), stop: vi.fn(), uri: "file://voice.m4a", currentTime: 0 },
  audio: { pause: vi.fn(), play: vi.fn(), replace: vi.fn(), seekTo: vi.fn(), addListener: vi.fn() },
  audioListener: null as ((status: any) => void) | null,
  audioStatus: { currentTime: 0, duration: 0, playing: false, isLoaded: false, playbackState: "unknown" },
  video: { pause: vi.fn(), play: vi.fn(), replace: vi.fn() },
  permission: vi.fn(),
  audioMode: vi.fn(),
  source: vi.fn(),
  state: { isRecording: false, durationMillis: 0 },
  fileInfo: vi.fn(),
  now: 1_000,
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
  Platform: { OS: "ios" },
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
  useAudioPlayerStatus: () => m.audioStatus,
}));
vi.mock("expo-video", () => ({ useVideoPlayer: () => m.video, VideoView: () => null }));
vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: (...args: any[]) => m.fileInfo(...args),
}));
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
  vi.spyOn(Date, "now").mockImplementation(() => m.now);
  m.now = 1_000;
  m.coordinator = new MediaOwnershipCoordinator();
  m.state = { isRecording: false, durationMillis: 0 };
  m.audioListener = null;
  m.audioStatus = { currentTime: 0, duration: 0, playing: false, isLoaded: false, playbackState: "unknown" };
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
  m.fileInfo.mockResolvedValue({
    exists: true,
    uri: "file://voice.m4a",
    isDirectory: false,
    size: 8_192,
    modificationTime: 1,
  });
  m.source.mockResolvedValue({ source: { uri: "private" }, release: vi.fn(), assertOwner: vi.fn() });
});
afterEach(() => {
  unmount();
  vi.mocked(Date.now).mockRestore();
});

it("records on hold and sends on release using a fresh voice lease", async () => {
  const ready = vi.fn();
  const node = createElement(VoiceNote, { onReady: ready });
  render(node);
  const hold = m.press.get("Hold to record voice note")!;
  hold.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  expect(m.recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
  expect(m.recorder.record).toHaveBeenCalledOnce();
  m.now += 1_000;
  m.state.isRecording = true;
  hold.onPressOut();
  await flush();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
  expect(ready).toHaveBeenCalledWith(
    expect.objectContaining({ uri: "file://voice.m4a", sizeBytes: 8_192 }),
    expect.objectContaining({ signal: expect.anything(), commit: expect.any(Function) }),
  );
});

it("keeps the idle panel to one recording action and keyboard return", () => {
  const markup = render(createElement(VoiceNote, { onReady: vi.fn() }));
  expect(m.press.has("Hold to record voice note")).toBe(true);
  expect(m.press.has("Return to message keyboard")).toBe(true);
  expect(m.press.has("Cancel voice note")).toBe(true);
  expect(markup).not.toContain("Voice waveform");
});

it("returns to the composer only after the recorder has been cancelled", async () => {
  const onClose = vi.fn();
  const onReturnToKeyboard = vi.fn();
  const prepare = deferred<void>();
  m.recorder.prepareToRecordAsync.mockReturnValue(prepare.promise);
  render(createElement(VoiceNote, { onReady: vi.fn(), onClose, onReturnToKeyboard }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.press.get("Return to message keyboard")!.onPress();
  await flush();
  expect(onReturnToKeyboard).not.toHaveBeenCalled();
  prepare.resolve();
  await flush();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(onReturnToKeyboard).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
});

it("closes safely while microphone permission is pending", async () => {
  const permission = deferred<{ granted: boolean }>();
  const onClose = vi.fn();
  const ready = vi.fn();
  m.permission.mockReturnValue(permission.promise);
  render(createElement(VoiceNote, { onReady: ready, onClose }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.press.get("Cancel voice note")!.onPress();
  await flush();
  expect(onClose).toHaveBeenCalledOnce();
  permission.resolve({ granted: true });
  await flush();
  expect(m.recorder.prepareToRecordAsync).not.toHaveBeenCalled();
  expect(m.recorder.record).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
});

it("waits for recorder preparation to stop before the visible Cancel closes", async () => {
  const prepare = deferred<void>();
  const onClose = vi.fn();
  m.recorder.prepareToRecordAsync.mockReturnValue(prepare.promise);
  render(createElement(VoiceNote, { onReady: vi.fn(), onClose }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.press.get("Cancel voice note")!.onPress();
  await flush();
  expect(onClose).not.toHaveBeenCalled();
  prepare.resolve();
  await flush();
  expect(m.recorder.stop).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
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

it("rejects a fast release after recording starts instead of uploading a zero-duration clip", async () => {
  const ready = vi.fn();
  const node = createElement(VoiceNote, { onReady: ready });
  render(node);
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.now += 100;
  m.press.get("Hold to record voice note")!.onPressOut();
  await flush();
  expect(ready).not.toHaveBeenCalled();
  expect(m.fileInfo).not.toHaveBeenCalled();
  expect(render(node)).toContain("Hold a little longer");
});

it("rejects an empty native recording before upload", async () => {
  const ready = vi.fn();
  const node = createElement(VoiceNote, { onReady: ready });
  m.fileInfo.mockResolvedValue({
    exists: true,
    uri: "file://voice.m4a",
    isDirectory: false,
    size: 0,
    modificationTime: 1,
  });
  render(node);
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.now += 1_000;
  m.press.get("Hold to record voice note")!.onPressOut();
  await flush();
  expect(ready).not.toHaveBeenCalled();
  expect(render(node)).toContain("voice recording was empty");
});

it("shows a nonzero rounded recording duration", async () => {
  const node = createElement(VoiceNote, { onReady: vi.fn() });
  render(node);
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.state = { isRecording: true, durationMillis: 1_250 };
  expect(render(node)).toContain("0:02");
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

it("lets the user close the sheet after recorder shutdown fails while ownership stays fail-closed", async () => {
  const onClose = vi.fn();
  m.recorder.stop.mockRejectedValueOnce(new Error("recorder stop failed"));
  const node = createElement(VoiceNote, { onReady: vi.fn(), onClose });
  render(node);
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.state.isRecording = true;
  render(node);
  m.press.get("Cancel voice note")!.onPress();
  await flush();
  expect(onClose).toHaveBeenCalledOnce();
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
  m.now += 1_000;
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

it("cancels an in-flight upload without allowing its message commit", async () => {
  const gate = deferred<void>();
  const onClose = vi.fn();
  let committed = false;
  const ready = vi.fn(async (_upload: unknown, delivery: any) => {
    await gate.promise;
    if (delivery.signal.aborted) throw delivery.signal.reason;
    committed = delivery.commit();
  });
  const node = createElement(VoiceNote, { onReady: ready, onClose });
  render(node);
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.now += 1_000;
  m.press.get("Hold to record voice note")!.onPressOut();
  await flush();
  expect(ready).toHaveBeenCalledOnce();
  render(node);
  m.press.get("Cancel voice note")!.onPress();
  await flush();
  expect(onClose).toHaveBeenCalledOnce();
  gate.resolve();
  await flush();
  expect(committed).toBe(false);
});

it("cancels while the captured file is being validated without starting upload", async () => {
  const fileInfo = deferred<any>();
  const ready = vi.fn();
  const onClose = vi.fn();
  m.fileInfo.mockReturnValue(fileInfo.promise);
  const node = createElement(VoiceNote, { onReady: ready, onClose });
  render(node);
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.now += 1_000;
  m.press.get("Hold to record voice note")!.onPressOut();
  await flush();
  render(node);
  m.press.get("Cancel voice note")!.onPress();
  await flush();
  expect(onClose).toHaveBeenCalledOnce();
  fileInfo.resolve({
    exists: true,
    uri: "file://voice.m4a",
    isDirectory: false,
    size: 8_192,
    modificationTime: 1,
  });
  await flush();
  expect(ready).not.toHaveBeenCalled();
});

it("invalidates pending file validation when the sheet unmounts", async () => {
  const fileInfo = deferred<any>();
  const ready = vi.fn();
  m.fileInfo.mockReturnValue(fileInfo.promise);
  render(createElement(VoiceNote, { onReady: ready }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.now += 1_000;
  m.press.get("Hold to record voice note")!.onPressOut();
  await flush();
  unmount();
  fileInfo.resolve({
    exists: true,
    uri: "file://voice.m4a",
    isDirectory: false,
    size: 8_192,
    modificationTime: 1,
  });
  await flush();
  expect(ready).not.toHaveBeenCalled();
});

it("aborts an uncommitted upload when the sheet unmounts", async () => {
  const gate = deferred<void>();
  let signal: AbortSignal | undefined;
  let committed = false;
  const ready = vi.fn(async (_upload: unknown, delivery: any) => {
    signal = delivery.signal;
    await gate.promise;
    committed = delivery.commit();
  });
  render(createElement(VoiceNote, { onReady: ready }));
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.now += 1_000;
  m.press.get("Hold to record voice note")!.onPressOut();
  await flush();
  expect(ready).toHaveBeenCalledOnce();
  unmount();
  expect(signal?.aborted).toBe(true);
  gate.resolve();
  await flush();
  expect(committed).toBe(false);
});

it("closes after message commit without aborting or pretending to unsend", async () => {
  const gate = deferred<void>();
  const onClose = vi.fn();
  let signal: AbortSignal | undefined;
  const ready = vi.fn(async (_upload: unknown, delivery: any) => {
    signal = delivery.signal;
    expect(delivery.commit()).toBe(true);
    await gate.promise;
  });
  const node = createElement(VoiceNote, { onReady: ready, onClose });
  render(node);
  m.press.get("Hold to record voice note")!.onPressIn({ nativeEvent: { pageX: 200 } });
  await flush();
  m.now += 1_000;
  m.press.get("Hold to record voice note")!.onPressOut();
  await flush();
  expect(render(node)).toContain("Close");
  m.press.get("Close voice note")!.onPress();
  await flush();
  expect(onClose).toHaveBeenCalledOnce();
  expect(signal?.aborted).toBe(false);
  gate.resolve();
  await flush();
});

it("keeps received voice playback compact with progress and elapsed duration", () => {
  m.audioStatus = { currentTime: 0, duration: 3, playing: false, isLoaded: true, playbackState: "readyToPlay" };
  const markup = render(createElement(ReceivedMedia, { attachment }));
  expect(m.press.get("Play voice.m4a")).toBeDefined();
  expect(markup).toContain("0:00 / 0:03");
});

it("labels an unloaded voice clip without falsely reporting a zero duration", () => {
  const markup = render(createElement(ReceivedMedia, { attachment }));
  expect(markup).toContain("Voice message");
  expect(markup).not.toContain("0:00");
});

it("resumes a paused voice clip from its protected source without refetching", async () => {
  const node = createElement(ReceivedMedia, { attachment });
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(m.source).toHaveBeenCalledWith(
    "attachment-1",
    attachment,
    expect.any(Object),
  );
  expect(m.audio.replace).toHaveBeenCalledOnce();
  expect(m.audio.play).toHaveBeenCalledOnce();
  expect(m.audioMode).toHaveBeenCalledWith({
    allowsRecording: false,
    playsInSilentMode: true,
  });

  render(node);
  m.press.get("Pause media")!.onPress();
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(m.source).toHaveBeenCalledOnce();
  expect(m.audio.replace).toHaveBeenCalledOnce();
  expect(m.audio.play).toHaveBeenCalledTimes(2);
});

it("does not configure or start chat playback while SIP owns audio", async () => {
  const sip = m.coordinator.requestSip("sip-active");
  await sip.ready;
  const node = createElement(ReceivedMedia, { attachment });
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(m.audioMode).not.toHaveBeenCalled();
  expect(m.audio.play).not.toHaveBeenCalled();
  expect(render(node)).toContain("Tap to retry");
});

it("waits for in-flight playback mode setup before granting SIP ownership", async () => {
  const mode = deferred<void>();
  m.audioMode.mockReturnValueOnce(mode.promise);
  render(createElement(ReceivedMedia, { attachment }));
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  const sip = m.coordinator.requestSip("sip-during-playback-mode");
  let sipReady = false;
  void sip.ready.then(() => {
    sipReady = true;
  });
  await flush();
  expect(sipReady).toBe(false);
  expect(m.audio.play).not.toHaveBeenCalled();
  mode.resolve();
  await flush();
  expect(sipReady).toBe(true);
  expect(m.audio.play).not.toHaveBeenCalled();
  expect(m.coordinator.getSnapshot().owner).toMatchObject({ kind: "sip" });
});

it("keeps playback ownership closed on unmount until native mode setup settles", async () => {
  const mode = deferred<void>();
  m.audioMode.mockReturnValueOnce(mode.promise);
  render(createElement(ReceivedMedia, { attachment }));
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(m.coordinator.getSnapshot().owner).toMatchObject({ kind: "voice-note" });
  unmount();
  await flush();
  expect(m.coordinator.getSnapshot().owner).toMatchObject({ kind: "voice-note" });
  mode.resolve();
  await flush();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
  expect(m.audio.play).not.toHaveBeenCalled();
});

it("releases playback ownership and surfaces a native playback failure", async () => {
  m.audio.play.mockImplementationOnce(() => {
    throw new Error("native player failed");
  });
  const node = createElement(ReceivedMedia, { attachment });
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
  expect(render(node)).toContain("Tap to retry");
});

it("turns an asynchronous native load failure into a retry state", async () => {
  const node = createElement(ReceivedMedia, { attachment });
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  m.audioStatus = {
    currentTime: 0,
    duration: 0,
    playing: false,
    isLoaded: false,
    playbackState: "failed",
  };
  render(node);
  await flush();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
  expect(render(node)).toContain("Tap to retry");
});

it("turns a completed zero-duration voice clip into a retry state", async () => {
  m.audioStatus = {
    currentTime: 0,
    duration: 0,
    playing: false,
    isLoaded: true,
    playbackState: "readyToPlay",
  };
  const node = createElement(ReceivedMedia, { attachment });
  render(node);
  m.press.get("Play voice.m4a")!.onPress();
  await flush();
  m.audioListener?.({ didJustFinish: true });
  await flush();
  expect(m.coordinator.getSnapshot().owner).toBeNull();
  expect(render(node)).toContain("Tap to retry");
});

it("replays a completed voice clip from zero while retaining its protected source", async () => {
  m.audioStatus = { currentTime: 0, duration: 3, playing: false, isLoaded: true, playbackState: "readyToPlay" };
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
