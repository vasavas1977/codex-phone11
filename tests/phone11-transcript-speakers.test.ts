import { describe, expect, it } from "vitest";
import {
  mergeTranscriptSpeakerNames,
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
    expect(transcriptSpeakerLabel("speaker1", { speaker1: "Somchai" })).toBe(
      "Somchai",
    );
    expect(transcriptSpeakerLabel("speaker2", { speaker1: "Somchai" })).toBe(
      "Speaker 2",
    );
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

  it("prefers device contacts over server caller-ID names", () => {
    expect(
      mergeTranscriptSpeakerNames(
        { speaker1: "Somchai Contact", speaker2: "Vasavas" },
        { speaker1: "SOMCHAI TRADING", speaker2: "Extension 3001" },
      ),
    ).toEqual({ speaker1: "Somchai Contact", speaker2: "Vasavas" });
    expect(
      mergeTranscriptSpeakerNames(
        { speaker1: "+66 81 234 5678" },
        { speaker1: "  Somchai\n  S.  " },
      ),
    ).toEqual({ speaker1: "+66812345678" });
  });

  it("keeps fallback labels distinct when participant names collide", () => {
    const names = { speaker1: "Alex", speaker2: "alex" };
    expect(transcriptSpeakerLabel("speaker1", names)).toBe("Alex");
    expect(transcriptSpeakerLabel("speaker2", names)).toBe("Speaker 2");
    expect(transcriptTurns("Alex: First\nalex: Second", names)).toEqual([
      {
        speaker: "unknown",
        text: "Alex: First\nalex: Second",
      },
    ]);
    expect(
      transcriptTurns("Speaker 1: First\nSpeaker 2: Second", names),
    ).toEqual([
      { speaker: "speaker1", text: "First" },
      { speaker: "speaker2", text: "Second" },
    ]);
  });

  it("treats missing or placeholder participant names as fallbacks", () => {
    expect(
      mergeTranscriptSpeakerNames(
        { speaker1: "Unknown", speaker2: "+66 81 234 5678" },
        { speaker1: "Somchai" },
      ),
    ).toEqual({ speaker1: "Somchai", speaker2: "+66812345678" });
    expect(
      transcriptSpeakerLabel("speaker2", {
        speaker1: "Somchai",
        speaker2: "Unknown",
      }),
    ).toBe("Speaker 2");
  });

  it("shows a normalized remote number when no device contact is available", () => {
    expect(
      transcriptSpeakerLabel("speaker2", { speaker2: "02 030 3001" }),
    ).toBe("+6620303001");
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
