import { describe, it, expect } from "vitest";

// Test the local analysis logic by importing the engine
// We test the mock/local fallback since server may not be available
describe("AI Transcript Analysis", () => {
  it("should define correct analysis types", async () => {
    const types = await import("../lib/recording/ai-types");
    // Verify type exports exist (compile-time check via import)
    expect(types).toBeDefined();
  });

  it("should generate local analysis for a transcript with keywords", async () => {
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");

    // Clear any cached results
    aiAnalysisEngine.clearCache();

    const result = await aiAnalysisEngine.analyzeTranscript({
      recordingId: "test-001",
      transcription:
        "Hi, I'm interested in your enterprise VoIP solution. We need to schedule a demo meeting next week. The billing issue from last month has been resolved, thank you for your great support.",
      callerName: "Alice",
      calleeName: "Bob",
      direction: "inbound",
      duration: 300,
    });

    expect(result).toBeDefined();
    expect(result.recordingId).toBe("test-001");
    expect(result.status).toBe("completed");
    expect(result.summary).toBeTruthy();
    expect(result.topics.length).toBeGreaterThan(0);
    expect(result.sentiment).toBeDefined();
    expect(["positive", "neutral", "negative", "mixed"]).toContain(result.sentiment);
    expect(result.sentimentScore).toBeGreaterThanOrEqual(-1);
    expect(result.sentimentScore).toBeLessThanOrEqual(1);
    expect(result.language).toBe("en");
    expect(result.category).toBeTruthy();
  });

  it("should return cached analysis on second call", async () => {
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");

    const first = await aiAnalysisEngine.analyzeTranscript({
      recordingId: "test-cache",
      transcription: "Quick test call about billing.",
      callerName: "Test",
      calleeName: "Support",
      direction: "outbound",
      duration: 60,
    });

    const second = await aiAnalysisEngine.analyzeTranscript({
      recordingId: "test-cache",
      transcription: "Quick test call about billing.",
      callerName: "Test",
      calleeName: "Support",
      direction: "outbound",
      duration: 60,
    });

    expect(second.analyzedAt).toBe(first.analyzedAt);
  });

  it("should detect positive sentiment", async () => {
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");
    aiAnalysisEngine.clearCache();

    const result = await aiAnalysisEngine.analyzeTranscript({
      recordingId: "test-positive",
      transcription:
        "Thank you so much for your excellent help. Everything is great and I really appreciate the wonderful service.",
      callerName: "Happy Customer",
      calleeName: "Agent",
      direction: "inbound",
      duration: 120,
    });

    expect(result.sentiment).toBe("positive");
    expect(result.sentimentScore).toBeGreaterThan(0);
  });

  it("should detect negative sentiment", async () => {
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");
    aiAnalysisEngine.clearCache();

    const result = await aiAnalysisEngine.analyzeTranscript({
      recordingId: "test-negative",
      transcription:
        "I'm very frustrated with this issue. The problem keeps happening and it's wrong that nothing has been done. I'm disappointed with the bad service.",
      callerName: "Unhappy Customer",
      calleeName: "Agent",
      direction: "inbound",
      duration: 180,
    });

    expect(result.sentiment).toBe("negative");
    expect(result.sentimentScore).toBeLessThan(0);
  });

  it("should extract action items from action-oriented phrases", async () => {
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");
    aiAnalysisEngine.clearCache();

    const result = await aiAnalysisEngine.analyzeTranscript({
      recordingId: "test-actions",
      transcription:
        "We need to update the billing system by Friday. Please send the proposal to the client. Also, schedule a follow-up meeting for next Tuesday.",
      callerName: "Manager",
      calleeName: "Team Lead",
      direction: "outbound",
      duration: 240,
    });

    expect(result.actionItems.length).toBeGreaterThan(0);
    result.actionItems.forEach((item) => {
      expect(item.task).toBeTruthy();
      expect(["high", "medium", "low"]).toContain(item.urgency);
      expect(item.completed).toBe(false);
    });
  });

  it("should clear cache properly", async () => {
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");

    await aiAnalysisEngine.analyzeTranscript({
      recordingId: "test-clear",
      transcription: "Test call.",
      callerName: "A",
      calleeName: "B",
      direction: "inbound",
      duration: 30,
    });

    expect(aiAnalysisEngine.getCached("test-clear")).not.toBeNull();

    aiAnalysisEngine.clearCache("test-clear");
    expect(aiAnalysisEngine.getCached("test-clear")).toBeNull();
  });
});
