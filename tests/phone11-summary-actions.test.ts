import { describe, expect, it } from "vitest";
import {
  decodePersonalRecordingMetadata,
  personalMetadataStorageKey,
  recordingDocument,
} from "../lib/cloud-recordings/summary-actions";

describe("recording summary actions", () => {
  it("keeps local metadata in an exact user and call scope", () => {
    expect(
      personalMetadataStorageKey(17, "11111111-1111-4111-8111-111111111111"),
    ).toBe(
      "@phone11:recording-personal:v1:17:11111111-1111-4111-8111-111111111111",
    );
    expect(() => personalMetadataStorageKey(0, "call")).toThrow();
    expect(() => personalMetadataStorageKey(17, "../other-user")).toThrow();
  });

  it("rejects oversized or malformed persisted personal content", () => {
    expect(decodePersonalRecordingMetadata("not-json")).toEqual({
      billable: false,
      updatedAt: 0,
    });
    expect(
      decodePersonalRecordingMetadata(
        JSON.stringify({
          editedSummary: "x".repeat(12_001),
          feedback: "maybe",
          task: { text: "Save proposal", completed: "yes" },
          billable: true,
          updatedAt: 20,
        }),
      ),
    ).toEqual({ billable: true, updatedAt: 20 });
  });

  it("exports a readable document without losing trusted speaker mapping", () => {
    const text = recordingDocument({
      title: "Call with +66812345678",
      startedAt: 0,
      content: {
        summary: "Agreed to send the proposal.",
        actionItems: ["Send proposal"],
        transcript: "Speaker 1: สวัสดี\nSpeaker 2: Hello",
      },
      speakerNames: { speaker1: "Somchai", speaker2: "Vasavas" },
      personal: {
        editedSummary: "Customer requested the September plan.",
        task: { text: "Prepare plan", completed: false },
        billable: true,
        feedback: "up",
        updatedAt: 1,
      },
    });
    expect(text).toContain("AI summary\nAgreed to send the proposal.");
    expect(text).toContain("Personal summary\nCustomer requested");
    expect(text).toContain("Somchai: สวัสดี");
    expect(text).toContain("Vasavas: Hello");
    expect(text).not.toContain("Billable call");
  });
});
