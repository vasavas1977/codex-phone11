/**
 * Tests for Speaker Label Correction and Call Transfer
 */
import { describe, it, expect } from "vitest";
import type {
  SpeakerCorrection,
  SegmentReassignment,
  DiarizationCorrections,
  Speaker,
  DiarizedSegment,
  DiarizationResult,
} from "../lib/recording/diarization-types";
import type {
  TransferMode,
  TransferTarget,
  TransferOperation,
  TransferFavorite,
  TransferHistoryEntry,
} from "../lib/transfer/types";

describe("Speaker Label Correction Types", () => {
  it("should create a valid SpeakerCorrection", () => {
    const correction: SpeakerCorrection = {
      speakerId: "speaker_0",
      originalLabel: "Caller",
      originalName: undefined,
      newLabel: "John Smith",
      newName: "John Smith",
      correctedAt: Date.now(),
    };
    expect(correction.speakerId).toBe("speaker_0");
    expect(correction.newLabel).toBe("John Smith");
    expect(correction.correctedAt).toBeGreaterThan(0);
  });

  it("should create a valid SegmentReassignment", () => {
    const reassignment: SegmentReassignment = {
      segmentIndex: 3,
      fromSpeakerId: "speaker_0",
      toSpeakerId: "speaker_1",
      reassignedAt: Date.now(),
    };
    expect(reassignment.segmentIndex).toBe(3);
    expect(reassignment.fromSpeakerId).not.toBe(reassignment.toSpeakerId);
  });

  it("should create a valid DiarizationCorrections record", () => {
    const corrections: DiarizationCorrections = {
      recordingId: "rec_123",
      speakerCorrections: [
        {
          speakerId: "speaker_0",
          originalLabel: "Caller",
          newLabel: "Alice",
          newName: "Alice Johnson",
          correctedAt: Date.now(),
        },
      ],
      segmentReassignments: [
        {
          segmentIndex: 2,
          fromSpeakerId: "speaker_1",
          toSpeakerId: "speaker_0",
          reassignedAt: Date.now(),
        },
      ],
      lastModified: Date.now(),
    };
    expect(corrections.speakerCorrections).toHaveLength(1);
    expect(corrections.segmentReassignments).toHaveLength(1);
    expect(corrections.lastModified).toBeGreaterThan(0);
  });

  it("should simulate renaming a speaker in a diarization result", () => {
    const result: DiarizationResult = {
      recordingId: "rec_1",
      processedAt: Date.now(),
      status: "completed",
      speakers: [
        { id: "speaker_0", label: "Caller", color: "#0A7EA4", totalDuration: 60, talkPercentage: 50, averageSentiment: 0.5, segmentCount: 5 },
        { id: "speaker_1", label: "Agent", color: "#8B5CF6", totalDuration: 60, talkPercentage: 50, averageSentiment: 0.3, segmentCount: 5 },
      ],
      segments: [],
      turnCount: 10,
      averageSegmentDuration: 12,
      overlapPercentage: 5,
    };

    // Simulate rename
    const updatedSpeakers = result.speakers.map((s) =>
      s.id === "speaker_0" ? { ...s, label: "John", name: "John Doe" } : s
    );

    expect(updatedSpeakers[0].label).toBe("John");
    expect(updatedSpeakers[0].name).toBe("John Doe");
    expect(updatedSpeakers[1].label).toBe("Agent"); // unchanged
  });

  it("should simulate reassigning a segment to a different speaker", () => {
    const segments: DiarizedSegment[] = [
      { index: 0, speakerId: "speaker_0", startTime: 0, endTime: 5, duration: 5, text: "Hello", confidence: 0.9 },
      { index: 1, speakerId: "speaker_1", startTime: 5, endTime: 10, duration: 5, text: "Hi there", confidence: 0.85 },
      { index: 2, speakerId: "speaker_0", startTime: 10, endTime: 15, duration: 5, text: "How are you?", confidence: 0.7 },
    ];

    // Reassign segment 2 from speaker_0 to speaker_1
    const updated = segments.map((s) =>
      s.index === 2 ? { ...s, speakerId: "speaker_1" } : s
    );

    expect(updated[2].speakerId).toBe("speaker_1");
    // speaker_0 now has 1 segment, speaker_1 has 2
    const sp0Count = updated.filter((s) => s.speakerId === "speaker_0").length;
    const sp1Count = updated.filter((s) => s.speakerId === "speaker_1").length;
    expect(sp0Count).toBe(1);
    expect(sp1Count).toBe(2);
  });
});

describe("Call Transfer Types", () => {
  it("should create a valid TransferTarget", () => {
    const target: TransferTarget = {
      name: "Sales Queue",
      number: "2000",
      source: "favorites",
    };
    expect(target.name).toBe("Sales Queue");
    expect(target.source).toBe("favorites");
  });

  it("should create a valid blind TransferOperation", () => {
    const op: TransferOperation = {
      id: "xfer_123",
      callId: "call_456",
      mode: "blind",
      target: { name: "Reception", number: "1000", source: "favorites" },
      status: "completed",
      initiatedAt: Date.now() - 2000,
      completedAt: Date.now(),
    };
    expect(op.mode).toBe("blind");
    expect(op.status).toBe("completed");
    expect(op.completedAt! - op.initiatedAt).toBeGreaterThan(0);
  });

  it("should create a valid attended TransferOperation with consultation", () => {
    const op: TransferOperation = {
      id: "xfer_789",
      callId: "call_012",
      mode: "attended",
      target: { name: "Support", number: "3000", source: "manual" },
      status: "consulting",
      initiatedAt: Date.now(),
      consultCallId: "consult_345",
      consultConnected: true,
    };
    expect(op.mode).toBe("attended");
    expect(op.status).toBe("consulting");
    expect(op.consultCallId).toBeDefined();
    expect(op.consultConnected).toBe(true);
  });

  it("should create a valid TransferFavorite", () => {
    const fav: TransferFavorite = {
      name: "Voicemail",
      number: "*97",
      transferCount: 5,
      lastUsed: Date.now(),
    };
    expect(fav.transferCount).toBe(5);
    expect(fav.lastUsed).toBeGreaterThan(0);
  });

  it("should create a valid TransferHistoryEntry", () => {
    const entry: TransferHistoryEntry = {
      id: "xfer_hist_1",
      callId: "call_100",
      mode: "blind",
      target: { name: "Reception", number: "1000", source: "favorites" },
      status: "completed",
      timestamp: Date.now(),
      duration: 1500,
    };
    expect(entry.status).toBe("completed");
    expect(entry.duration).toBe(1500);
  });
});
