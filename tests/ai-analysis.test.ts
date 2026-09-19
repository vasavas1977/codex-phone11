import { beforeEach, describe, expect, it, vi } from "vitest";

const request = {
  recordingId: "test-001",
  transcription: "Speaker 1: Hello\nSpeaker 2: We agreed to send the proposal.",
  callerName: "Alice",
  calleeName: "Bob",
  direction: "inbound",
  duration: 300,
};

const providerAnalysis = {
  recordingId: request.recordingId,
  analyzedAt: 1_700_000_000_000,
  status: "completed",
  summary: "The participants agreed to send the proposal.",
  topics: [{ label: "Sales", confidence: 85, description: "The proposal was discussed." }],
  keyPoints: [{ text: "They agreed to send the proposal.", speaker: "callee" }],
  sentiment: "neutral",
  sentimentScore: 0,
  actionItems: [{ task: "Send the proposal", assignee: "Bob", urgency: "medium", completed: false }],
  language: "en",
  category: "Sales",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AI Transcript Analysis", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");
    aiAnalysisEngine.clearCache();
    aiAnalysisEngine.setServerUrl("https://phone11.test/");
  });

  it("accepts a complete server analysis and caches it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({ result: { data: { json: { success: true, analysis: providerAnalysis } } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");

    const first = await aiAnalysisEngine.analyzeTranscript(request);
    const second = await aiAnalysisEngine.analyzeTranscript(request);

    expect(first).toEqual(providerAnalysis);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not fabricate a summary when the server is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const { aiAnalysisEngine, AnalysisUnavailableError } = await import("../lib/recording/ai-engine");

    await expect(aiAnalysisEngine.analyzeTranscript(request)).rejects.toBeInstanceOf(AnalysisUnavailableError);
    expect(aiAnalysisEngine.getCached(request.recordingId)).toBeNull();
  });

  it("rejects an incomplete provider result instead of filling placeholders", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      response({ result: { data: { json: { success: true, analysis: { ...providerAnalysis, summary: "" } } } } }),
    ));
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");

    await expect(aiAnalysisEngine.analyzeTranscript(request)).rejects.toThrow("AI analysis is unavailable");
    expect(aiAnalysisEngine.getCached(request.recordingId)).toBeNull();
  });

  it("serves a completed server summary from cache without a second request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({ result: { data: { json: { success: true, analysis: providerAnalysis } } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { aiAnalysisEngine } = await import("../lib/recording/ai-engine");

    const first = await aiAnalysisEngine.analyzeTranscript(request);
    expect(await aiAnalysisEngine.analyzeTranscript(request)).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
