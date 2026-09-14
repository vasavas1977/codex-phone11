import { describe, expect, it } from "vitest";
import {
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
});
