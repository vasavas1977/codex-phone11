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
  m.frame = { index: 0, values: [] };
  m.owner = { id: 7 };
  m.authListeners.clear();
  m.getItem.mockReset().mockResolvedValue(null);
  m.setItem.mockReset().mockResolvedValue(undefined);
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
