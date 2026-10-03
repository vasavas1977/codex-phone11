/* eslint-disable import/first, react-hooks/rules-of-hooks */
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as any[] },
  owner: { id: 7 } as { id: number } | null,
  authListeners: new Set<() => void>(),
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

function sameDependencies(left?: unknown[], right?: unknown[]) {
  return Boolean(
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index])),
  );
}

vi.mock("react", () => ({
  useRef(initial: unknown) {
    const frame = m.frame;
    const index = frame.index++;
    return (frame.values[index] ??= { current: initial });
  },
  useState(initial: unknown) {
    const frame = m.frame;
    const index = frame.index++;
    if (!(index in frame.values))
      frame.values[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      frame.values[index],
      (value: unknown) => {
        frame.values[index] =
          typeof value === "function"
            ? (value as (current: unknown) => unknown)(frame.values[index])
            : value;
      },
    ];
  },
  useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
    const frame = m.frame;
    const index = frame.index++;
    const previous = frame.values[index] as
      | { dependencies?: unknown[]; cleanup?: () => void }
      | undefined;
    if (sameDependencies(previous?.dependencies, dependencies)) return;
    previous?.cleanup?.();
    const cleanup = effect();
    frame.values[index] = {
      dependencies,
      ...(typeof cleanup === "function" ? { cleanup } : {}),
    };
  },
  useCallback(callback: unknown) {
    m.frame.index++;
    return callback;
  },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: m.getItem, setItem: m.setItem },
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.owner }),
  addAuthChangeListener: (listener: () => void) => {
    m.authListeners.add(listener);
    return () => m.authListeners.delete(listener);
  },
}));

import { useRecordingSpeakerNames } from "../hooks/use-recording-speaker-names";
import {
  transcriptFingerprint,
  speakerNamesStorageKey,
  decodeAssignedSpeakerNames,
  defaultCallSpeakerNames,
  validateAssignedSpeakerNames,
} from "../lib/cloud-recordings/speaker-names";
const callUuid = "11111111-1111-4111-8111-111111111111";
const transcript = "Speaker 1: Hello\nSpeaker 2: Hi";
function render(owner = 7, call = callUuid, text = transcript) {
  m.frame.index = 0;
  return useRecordingSpeakerNames(owner, call, text);
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
beforeEach(() => {
  for (const value of m.frame.values) value?.cleanup?.();
  m.frame = { index: 0, values: [] };
  m.owner = { id: 7 };
  m.authListeners.clear();
  m.getItem.mockReset().mockResolvedValue(null);
  m.setItem.mockReset().mockResolvedValue(undefined);
});
it("never assigns diarized speakers from direction, contact, or owner", () => {
  expect(defaultCallSpeakerNames("inbound", "Somchai", "Vasavas")).toEqual(
    {},
  );
  expect(defaultCallSpeakerNames("outbound", "Somchai", "Vasavas")).toEqual(
    {},
  );
  expect(
    defaultCallSpeakerNames("outbound", undefined, undefined, "02 030 3001"),
  ).toEqual({});
});
it("saves confirmed names and loads them when the same recording is reopened", async () => {
  render();
  await settle();
  expect(
    await render().save({ speaker1: "Nathasa", speaker2: "Vasavas" }),
  ).toBe(true);
  expect(render().names).toEqual({ speaker1: "Nathasa", speaker2: "Vasavas" });
  expect(m.setItem.mock.calls[0][0]).toBe(speakerNamesStorageKey(7, callUuid));
  expect(m.setItem.mock.calls[0][1]).not.toContain("Hello");
  expect(JSON.parse(m.setItem.mock.calls[0][1]).transcriptFingerprint).toMatch(
    /^[a-f0-9]{64}$/,
  );
  m.getItem.mockResolvedValue(m.setItem.mock.calls[0][1]);
  m.frame = { index: 0, values: [] };
  render();
  await settle();
  expect(render().names).toEqual({ speaker1: "Nathasa", speaker2: "Vasavas" });
});
it("clears visible names on sign-out and rejects stale save handlers after account or call switch", async () => {
  m.getItem.mockResolvedValue(
    JSON.stringify({
      transcriptFingerprint: transcriptFingerprint(transcript),
      names: { speaker1: "Private name" },
    }),
  );
  render();
  await settle();
  const old = render();
  expect(old.names.speaker1).toBe("Private name");
  m.owner = { id: 8 };
  for (const listener of m.authListeners) listener();
  expect(render().names).toEqual({});
  expect(await old.save({ speaker1: "Other owner" })).toBe(false);
  render(8);
  await settle();
  const previousCall = render(8);
  render(8, "another-call");
  expect(await previousCall.save({ speaker1: "Wrong call" })).toBe(false);
  expect(m.setItem).not.toHaveBeenCalled();
});
it("does not show late reads or completed writes from another account", async () => {
  let finish!: (value: string) => void;
  m.getItem.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  m.owner = { id: 8 };
  for (const listener of m.authListeners) listener();
  render(8);
  finish(
    JSON.stringify({
      transcriptFingerprint: transcriptFingerprint(transcript),
      names: { speaker1: "Private old name" },
    }),
  );
  await settle();
  expect(render(8).names).toEqual({});
  let saveDone!: () => void;
  m.setItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        saveDone = resolve;
      }),
  );
  const pending = render(8).save({ speaker1: "Eight" });
  m.owner = null;
  for (const listener of m.authListeners) listener();
  saveDone();
  expect(await pending).toBe(false);
  expect(render(8).names).toEqual({});
});
it("keeps existing names on a failed save and prevents a second in-flight save", async () => {
  m.getItem.mockResolvedValue(
    JSON.stringify({
      transcriptFingerprint: transcriptFingerprint(transcript),
      names: { speaker1: "Original" },
    }),
  );
  render();
  await settle();
  let fail!: (error: Error) => void;
  m.setItem.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const hook = render();
  const pending = hook.save({ speaker1: "Changed" });
  expect(await hook.save({ speaker1: "Concurrent" })).toBe(false);
  fail(new Error("disk failure"));
  expect(await pending).toBe(false);
  expect(render().names).toEqual({ speaker1: "Original" });
  expect(render().error).toContain("could not be saved");
});
it("invalidates assignments when transcription changes and supports clearing names", async () => {
  const stored = JSON.stringify({
    transcriptFingerprint: transcriptFingerprint(transcript),
    names: { speaker1: "Known" },
  });
  expect(decodeAssignedSpeakerNames(stored, transcript + " changed")).toEqual(
    {},
  );
  m.getItem.mockResolvedValue(stored);
  render();
  await settle();
  expect(await render().save({})).toBe(true);
  expect(render().names).toEqual({});
});
it("validates names and ignores malformed stored data", () => {
  expect(validateAssignedSpeakerNames({ speaker1: "  สมชาย  ใจดี  " })).toEqual(
    { speaker1: "สมชาย ใจดี" },
  );
  expect(() =>
    validateAssignedSpeakerNames({ speaker1: "Same", speaker2: "same" }),
  ).toThrow("different names");
  expect(() => validateAssignedSpeakerNames({ speaker1: "1234" })).toThrow(
    "Enter a name",
  );
  expect(decodeAssignedSpeakerNames("invalid json", transcript)).toEqual({});
  expect(
    decodeAssignedSpeakerNames(
      JSON.stringify({
        transcriptFingerprint: transcriptFingerprint(transcript),
        names: { speaker1: {}, speaker2: 123 },
      }),
      transcript,
    ),
  ).toEqual({});
  expect(() => speakerNamesStorageKey(0, callUuid)).toThrow();
});

it.each([
  "Speaker 2",
  "speaker_1",
  "Speaker\n2",
  "Caller",
  "Callee",
  "Agent",
  "Customer",
  "You",
  "Other",
])(
  "rejects reserved label %s so voices cannot be merged or swapped",
  (label) => {
    expect(() =>
      validateAssignedSpeakerNames({ speaker1: label, speaker2: "Pat" }),
    ).toThrow("person’s name");
    expect(
      decodeAssignedSpeakerNames(
        JSON.stringify({
          transcriptFingerprint: transcriptFingerprint(transcript),
          names: { speaker1: label, speaker2: "Pat" },
        }),
        transcript,
      ),
    ).toEqual({ speaker2: "Pat" });
  },
);

it("synchronizes saved and cleared names across mounted views only for the same account, call, and transcript", async () => {
  const inline = { index: 0, values: [] as any[] };
  const detail = { index: 0, values: [] as any[] };
  const otherCall = { index: 0, values: [] as any[] };
  const otherTranscript = { index: 0, values: [] as any[] };
  const useView = (
    frame: typeof inline,
    owner = 7,
    call = callUuid,
    text = transcript,
  ) => {
    m.frame = frame;
    return render(owner, call, text);
  };
  useView(inline);
  useView(detail);
  useView(otherCall, 7, "other-call");
  useView(otherTranscript, 7, callUuid, transcript + " changed");
  await settle();
  expect(await useView(detail).save({ speaker1: "Nathasa" })).toBe(true);
  expect(useView(inline).names).toEqual({ speaker1: "Nathasa" });
  expect(useView(otherCall, 7, "other-call").names).toEqual({});
  expect(
    useView(otherTranscript, 7, callUuid, transcript + " changed").names,
  ).toEqual({});
  expect(await useView(detail).save({})).toBe(true);
  expect(useView(inline).names).toEqual({});
  expect(await useView(detail).save({ speaker1: "Private seven" })).toBe(true);
  m.owner = { id: 8 };
  for (const listener of m.authListeners) listener();
  expect(useView(inline).names).toEqual({});
  useView(detail, 8);
  await settle();
  expect(await useView(detail, 8).save({ speaker1: "Private eight" })).toBe(
    true,
  );
  expect(useView(inline).names).toEqual({});
  for (const frame of [inline, detail, otherCall, otherTranscript])
    for (const value of frame.values) value?.cleanup?.();
});
it("does not overwrite a notified save with an older pending read or broadcast a failed save", async () => {
  const inline = { index: 0, values: [] as any[] };
  const detail = { index: 0, values: [] as any[] };
  let finish!: (value: string | null) => void;
  m.getItem.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  m.frame = inline;
  render();
  m.frame = detail;
  render();
  await settle();
  expect(await render().save({ speaker1: "Latest" })).toBe(true);
  finish(null);
  await settle();
  m.frame = inline;
  expect(render().names).toEqual({ speaker1: "Latest" });
  m.frame = detail;
  m.setItem.mockRejectedValueOnce(new Error("disk error"));
  expect(await render().save({ speaker1: "Failed" })).toBe(false);
  m.frame = inline;
  expect(render().names).toEqual({ speaker1: "Latest" });
  for (const frame of [inline, detail])
    for (const value of frame.values) value?.cleanup?.();
});
