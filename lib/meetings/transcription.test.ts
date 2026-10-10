import { describe, expect, it } from "vitest";
import { normalizeCoreGuardTranscriptionEvent as normalize, shouldAttachTranscriptTranslation } from "./transcription";

describe("meeting caption reuse", () => {
  it("keeps Thai to English translations rather than emergency-console Thai suppression", () => {
    const segments = normalize({ id: "1", text: "สวัสดี", translated_text: "Hello", source_lang: "th", identity: "member-1" }, "en");
    expect(segments).toHaveLength(2);
    expect(shouldAttachTranscriptTranslation(segments[0])).toBe(true);
    expect(segments[0].participantIdentity).toBe("member-1");
    expect(segments[0]).not.toHaveProperty("participantRole");
  });
  it("retains stable original and translated IDs for interim/final updates", () => {
    const interim = normalize({ segment_id: "s", text: "Hel", is_final: false }, "th");
    const final = normalize({ segment_id: "s", text: "Hello", is_final: true }, "th");
    expect(interim[0].id).toBe(final[0].id);
    expect(interim[0].isFinal).toBe(false);
    expect(final[0].isFinal).toBe(true);
  });
  it("accepts nested provider segments without inventing a speaker", () => {
    expect(normalize({segment: {id: "s", text: "Hello", participant_identity: "p"}}, "th")[0].participantIdentity).toBe("p");
    expect(normalize({text: "Hello"}, "th")[0].participantIdentity).toBeNull();
  });
  it("does not repeat identical translated captions or accept empty events", () => {
    expect(normalize({text: "Hello", translatedText: "Hello"}, "en")).toHaveLength(1);
    expect(normalize(null, "en")).toEqual([]);
    expect(normalize({text: " "}, "en")).toEqual([]);
  });
});
