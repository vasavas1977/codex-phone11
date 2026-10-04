import { describe, expect, it } from "vitest";
import {
  nameCallSummaryParticipants,
  nameSummaryParticipants,
  transcriptSpeakerLabel,
  transcriptTurns,
} from "../lib/cloud-recordings/transcript";

describe("Phone11 transcript speaker labels", () => {
  it("uses persisted participant names for explicit speaker turns", () => {
    expect(
      transcriptTurns("Speaker 1: สวัสดี\nSpeaker 2: Hello", {
        speaker1: "Somchai",
        speaker2: "Vasavas",
      }),
    ).toEqual([
      { speaker: "speaker1", text: "สวัสดี" },
      { speaker: "speaker2", text: "Hello" },
    ]);
    expect(
      transcriptSpeakerLabel("speaker1", { speaker1: "Somchai" }),
    ).toBe("Somchai");
    expect(
      transcriptSpeakerLabel("speaker2", { speaker1: "Somchai" }),
    ).toBe("Speaker 2");
  });

  it("accepts named turns and joins continuation lines without guessing", () => {
    const turns = transcriptTurns(
      "Alice: First line\ncontinued here\nBob: Reply",
      { speaker1: "Alice", speaker2: "Bob" },
    );
    expect(turns).toEqual([
      { speaker: "speaker1", text: "First line continued here" },
      { speaker: "speaker2", text: "Reply" },
    ]);
  });

  it("preserves a legacy plain transcript as unassigned text", () => {
    expect(transcriptTurns("A plain transcript without diarization")).toEqual([
      { speaker: "unknown", text: "A plain transcript without diarization" },
    ]);
    expect(transcriptSpeakerLabel("unknown")).toBe("Transcript");
  });

  it("supports participant names shown on their own line", () => {
    expect(
      transcriptTurns(
        "Vasavas Nonsopa Boss/บอส\nฮัลโหลค่ะ\nSavitree Lerdhirunvanich\nดีว่า?",
        {
          speaker1: "Vasavas Nonsopa Boss/บอส",
          speaker2: "Savitree Lerdhirunvanich",
        },
      ),
    ).toEqual([
      { speaker: "speaker1", text: "ฮัลโหลค่ะ" },
      { speaker: "speaker2", text: "ดีว่า?" },
    ]);
  });
  it("uses the same participant names throughout summaries and next steps", () => {
    const names = { speaker1: "Me", speaker2: "Ping Ping Daughter" };
    expect(
      nameSummaryParticipants(
        "Person 1 called Person 2. The caller asked the callee to reply.",
        names,
      ),
    ).toBe(
      "Me called Ping Ping Daughter. Me asked Ping Ping Daughter to reply.",
    );
    expect(
      nameCallSummaryParticipants(
        {
          summary: "Speaker 1 thanked Speaker 2.",
          actionItems: ["Participant 2 will call person 1."],
          language: "en",
        },
        names,
      ),
    ).toEqual({
      summary: "Me thanked Ping Ping Daughter.",
      actionItems: ["Ping Ping Daughter will call Me."],
      language: "en",
    });
  });

  it("returns no summary for malformed payloads instead of throwing", () => {
    expect(
      nameCallSummaryParticipants({ summary: null, actionItems: [] }),
    ).toBeUndefined();
    expect(
      nameCallSummaryParticipants({ summary: "Recap", actionItems: null }),
    ).toBeUndefined();
    expect(
      nameCallSummaryParticipants({ summary: "Recap", actionItems: [42] }),
    ).toBeUndefined();
    expect(nameCallSummaryParticipants(null)).toBeUndefined();
  });
});

it("rejects sparse summary items and an invalid summary language", () => {
  expect(nameCallSummaryParticipants({ summary: "Recap", actionItems: new Array(1) })).toBeUndefined();
  expect(nameCallSummaryParticipants({ summary: "Recap", actionItems: [], language: 42 })).toBeUndefined();
  expect(nameCallSummaryParticipants(["Recap"])).toBeUndefined();
});
